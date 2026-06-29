import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { benchmarkProvidersFromEnv, type BenchmarkProvider } from "./benchmarkProviders";
import type { CodeCache, CodeSheet, CompleteFunction, CompleteResult, Runnable } from "./codeSheet";
import { runCodeSheet, type CompilationMode, type RunResult } from "./codeSheetRunner";
import { sampleEvalCases, type SampleEvalCase } from "./samples";

type BenchmarkMode = CompilationMode | "semantic-auto";

type BenchmarkCase = {
  name: string;
  sheet: CodeSheet;
  runnable: Runnable;
  expectedStdout?: string[];
  stdoutCheck?: SampleEvalCase["stdoutCheck"];
};

type CompletionTrace = {
  index: number;
  target: string;
  promptChars: number;
  completionChars?: number;
  elapsedMs: number;
  ok: boolean;
  error?: string;
};

type StrategyAttempt = {
  strategy: Exclude<CompilationMode, "auto">;
  elapsedMs: number;
  completionCalls: number;
  completionMs: number;
  runtimeOk: boolean;
  semanticOk: boolean;
  stdout: string[];
  error?: string;
  sourcePath?: string;
  completions: CompletionTrace[];
};

type BenchmarkResult = {
  case: string;
  model: string;
  mode: BenchmarkMode;
  attempt: number;
  elapsedMs: number;
  runtimeOk: boolean;
  semanticOk: boolean;
  stdout: string[];
  error?: string;
  strategyAttempts: StrategyAttempt[];
};

const interestingCases = [
  "formula spreadsheet strings and rendering",
  "formula spreadsheet precedence and parentheses",
  "mandelbrot render and rotate natural snippet",
  "julia set explorer view contract",
  "isometric cube stack rotation contract",
];

const enabled = process.env.RUN_STRATEGY_BENCHMARK === "true";
const describeIfEnabled = enabled ? describe : describe.skip;

const attempts = numericEnv("BENCH_ATTEMPTS", 1);
const warmCache = process.env.BENCH_CACHE === "warm";
const saveSources = process.env.BENCH_SAVE_SOURCES === "true";
const artifactDir = process.env.BENCH_ARTIFACT_DIR ?? ".strategy-benchmark";
const concurrency = numericEnv("BENCH_CONCURRENCY", 1);
const cases = selectedCases();
const modes = selectedModes();
const providers = enabled ? benchmarkProvidersFromEnv() : [];

describeIfEnabled("strategy benchmark", () => {
  it(
    "prints targeted strategy benchmark summaries",
    async () => {
      console.log(JSON.stringify({
        event: "benchmark-start",
        attempts,
        warmCache,
        concurrency,
        models: providers.map((provider) => provider.id),
        modes,
        cases: cases.map((testCase) => testCase.name),
      }));

      const warmCaches = new Map<string, CodeCache>();
      const jobs = benchmarkJobs();
      const results = await runWithConcurrency(jobs, concurrency, async (job) => {
        const cacheKey = `${job.provider.id}:${job.testCase.name}:${job.mode}`;
        const cache = warmCache
          ? warmCaches.get(cacheKey) ?? new Map()
          : new Map();
        warmCaches.set(cacheKey, cache);

        const context = {
          caseName: job.testCase.name,
          model: job.provider.id,
          mode: job.mode,
          attempt: job.attempt,
        };
        const result = job.mode === "semantic-auto"
          ? await runSemanticAutoBenchmark(job.testCase, job.provider, cache, context)
          : await runModeBenchmark(job.testCase, job.provider, job.mode, cache, context);
        const summary = {
          case: job.testCase.name,
          model: job.provider.id,
          mode: job.mode,
          attempt: job.attempt,
          ...result,
        };
        console.log(JSON.stringify({ event: "benchmark-result", ...summary }));
        return summary;
      });

      console.log(JSON.stringify({ event: "benchmark-summary", rows: summarize(results) }));
    },
    numericEnv("BENCH_TIMEOUT_MS", 900_000),
  );
});

async function runModeBenchmark(
  testCase: BenchmarkCase,
  provider: BenchmarkProvider,
  mode: Exclude<BenchmarkMode, "semantic-auto">,
  cache: CodeCache,
  context: ArtifactContext,
): Promise<Omit<BenchmarkResult, "case" | "model" | "mode" | "attempt">> {
  const started = nowMs();
  const attempt = await runStrategyAttempt(testCase, provider, mode, cache, context);
  return {
    elapsedMs: roundMs(nowMs() - started),
    runtimeOk: attempt.runtimeOk,
    semanticOk: attempt.semanticOk,
    stdout: attempt.stdout,
    ...(attempt.error === undefined ? {} : { error: attempt.error }),
    strategyAttempts: [attempt],
  };
}

async function runSemanticAutoBenchmark(
  testCase: BenchmarkCase,
  provider: BenchmarkProvider,
  cache: CodeCache,
  context: ArtifactContext,
): Promise<Omit<BenchmarkResult, "case" | "model" | "mode" | "attempt">> {
  const started = nowMs();
  const strategyAttempts: StrategyAttempt[] = [];
  let lastAttempt: StrategyAttempt | null = null;

  for (const strategy of strategyOrder()) {
    const forkedCache = new Map(cache);
    const attempt = await runStrategyAttempt(testCase, provider, strategy, forkedCache, context);
    strategyAttempts.push(attempt);
    lastAttempt = attempt;
    if (attempt.semanticOk) {
      commitCache(cache, forkedCache);
      return {
        elapsedMs: roundMs(nowMs() - started),
        runtimeOk: attempt.runtimeOk,
        semanticOk: true,
        stdout: attempt.stdout,
        ...(attempt.error === undefined ? {} : { error: attempt.error }),
        strategyAttempts,
      };
    }
  }

  return {
    elapsedMs: roundMs(nowMs() - started),
    runtimeOk: lastAttempt?.runtimeOk ?? false,
    semanticOk: false,
    stdout: lastAttempt?.stdout ?? [],
    ...(lastAttempt?.error === undefined ? {} : { error: lastAttempt.error }),
    strategyAttempts,
  };
}

async function runStrategyAttempt(
  testCase: BenchmarkCase,
  provider: BenchmarkProvider,
  strategy: CompilationMode,
  cache: CodeCache,
  context: ArtifactContext,
): Promise<StrategyAttempt> {
  const completions: CompletionTrace[] = [];
  let completionCount = 0;
  const complete: CompleteFunction = async (prompt) => {
    completionCount += 1;
    const index = completionCount;
    const started = nowMs();
    try {
      const replacement = await collectCompletionResult(provider.complete(prompt));
      completions.push({
        index,
        target: completionTarget(prompt),
        promptChars: prompt.length,
        completionChars: replacement.length,
        elapsedMs: roundMs(nowMs() - started),
        ok: true,
      });
      return replacement;
    } catch (error) {
      completions.push({
        index,
        target: completionTarget(prompt),
        promptChars: prompt.length,
        elapsedMs: roundMs(nowMs() - started),
        ok: false,
        error: errorMessage(error),
      });
      throw error;
    }
  };

  const started = nowMs();
  const result: RunResult | { ok: false; error: string; stdout: [] } = await runCodeSheet(testCase.sheet, testCase.runnable, {
    complete,
    cache,
    compilationStrategy: strategy,
  }).catch((error: unknown) => ({
    ok: false as const,
    error: errorMessage(error),
    stdout: [],
  }));
  const elapsedMs = roundMs(nowMs() - started);
  const stdout = result.stdout;
  const runtimeOk = result.ok;
  const semanticOk = runtimeOk && stdoutMatches(stdout, testCase);
  const sourcePath = "completed" in result && result.completed
    ? saveCompletedSource(context, strategy, result.completed.source)
    : undefined;

  return {
    strategy: strategy === "auto" ? "parallel" : strategy,
    elapsedMs,
    completionCalls: completions.length,
    completionMs: roundMs(completions.reduce((sum, item) => sum + item.elapsedMs, 0)),
    runtimeOk,
    semanticOk,
    stdout,
    ...(runtimeOk ? {} : { error: result.error }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    completions,
  };
}

type ArtifactContext = {
  caseName: string;
  model: string;
  mode: BenchmarkMode;
  attempt: number;
};

function saveCompletedSource(
  context: ArtifactContext,
  strategy: CompilationMode,
  source: string,
): string | undefined {
  if (!saveSources) {
    return undefined;
  }

  mkdirSync(artifactDir, { recursive: true });
  const filename = [
    slug(context.model),
    slug(context.caseName),
    context.mode,
    `attempt-${context.attempt}`,
    strategy,
  ].join("__");
  const path = join(artifactDir, `${filename}.py`);
  writeFileSync(path, source);
  return path;
}

function slug(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type BenchmarkJob = {
  testCase: BenchmarkCase;
  provider: BenchmarkProvider;
  mode: BenchmarkMode;
  attempt: number;
};

function benchmarkJobs(): BenchmarkJob[] {
  const jobs: BenchmarkJob[] = [];
  for (const testCase of cases) {
    for (const provider of providers) {
      for (const mode of modes) {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          jobs.push({ testCase, provider, mode, attempt });
        }
      }
    }
  }
  return jobs;
}

async function runWithConcurrency<T, Result>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function selectedCases(): BenchmarkCase[] {
  const requested = csvEnv("BENCH_CASES");
  const names = requested.length === 0 ? interestingCases : requested;
  const byName = new Map(sampleEvalCases.map((testCase) => [testCase.name, testCase]));
  const selected = names.map((name) => {
    const testCase = byName.get(name);
    if (!testCase) {
      throw new Error(`Unknown benchmark case "${name}". Available sample cases: ${
        sampleEvalCases.map((item) => item.name).join(", ")
      }`);
    }
    return testCase;
  });
  return selected;
}

function selectedModes(): BenchmarkMode[] {
  const raw = csvEnv("BENCH_MODES");
  const values: string[] = raw.length === 0 ? ["parallel", "sequential", "semantic-auto"] : raw;
  for (const value of values) {
    if (!isBenchmarkMode(value)) {
      throw new Error(`Unknown benchmark mode "${value}"`);
    }
  }
  return values.filter(isBenchmarkMode);
}

function isBenchmarkMode(value: string): value is BenchmarkMode {
  return value === "parallel" ||
    value === "sequential" ||
    value === "agentic" ||
    value === "agentic-methods" ||
    value === "auto" ||
    value === "semantic-auto";
}

function strategyOrder(): Array<Exclude<CompilationMode, "auto">> {
  return ["parallel", "sequential", "agentic-methods", "agentic"];
}

function commitCache(target: CodeCache, source: CodeCache): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function stdoutMatches(stdout: string[], testCase: BenchmarkCase): boolean {
  if (testCase.expectedStdout) {
    return arraysEqual(stdout, testCase.expectedStdout);
  }

  return testCase.stdoutCheck?.matches(stdout) ?? false;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function summarize(results: BenchmarkResult[]): Array<{
  case: string;
  model: string;
  mode: BenchmarkMode;
  attempts: number;
  semanticSuccesses: number;
  runtimeSuccesses: number;
  elapsedMs: { min: number; mean: number; max: number };
}> {
  const groups = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const key = `${result.case}\u0000${result.model}\u0000${result.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return Array.from(groups.values()).map((items) => ({
    case: items[0].case,
    model: items[0].model,
    mode: items[0].mode,
    attempts: items.length,
    semanticSuccesses: items.filter((item) => item.semanticOk).length,
    runtimeSuccesses: items.filter((item) => item.runtimeOk).length,
    elapsedMs: stats(items.map((item) => item.elapsedMs)),
  }));
}

function stats(values: number[]): { min: number; mean: number; max: number } {
  return {
    min: Math.min(...values),
    mean: roundMs(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: Math.max(...values),
  };
}

function completionTarget(prompt: string): string {
  const methodAgentMarker = "You are one of several parallel coding agents compiling a Python worksheet.";
  if (prompt.includes(methodAgentMarker)) {
    const target = prompt.match(/Target snippet:\n```python\n([\s\S]*?)\n```/)?.[1]?.trim();
    return target ? `method agent: ${target.split("\n")[0]}` : "method agent";
  }

  const agenticMarker = "Your job is to compile this worksheet into one complete Python file.";
  if (prompt.includes(agenticMarker)) {
    return "agentic file";
  }

  const implementationMarker = "Your job is to finish the implementation of:";
  const naturalMarker = "Your job is to replace this natural-language Python fragment with valid Python code:";
  const marker = prompt.includes(implementationMarker) ? implementationMarker : naturalMarker;
  const afterMarker = prompt.split(marker).at(-1)?.trim() ?? "";
  return afterMarker.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "(unknown)";
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundMs(value: number): number {
  return Math.round(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectCompletionResult(result: CompleteResult): Promise<string> {
  if (!isAsyncIterable(result)) {
    return await result;
  }

  let replacement = "";
  for await (const token of result) {
    replacement += token;
  }
  return replacement;
}

function isAsyncIterable(value: CompleteResult): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
