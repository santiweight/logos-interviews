import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  buildCompilationIR,
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompleteFunction,
  type CompleteResult,
  type CompletedCodeSheet,
  type CompileOptions,
  type CompilationStrategy,
  hashSnippet,
  lower,
  parse,
  renderImplementation,
  type Runnable,
} from "./codeSheet";

export type RunResult =
  | { ok: true; stdout: string[]; completed: CompletedCodeSheet }
  | { ok: false; error: string; stdout: string[]; stderr: string; completed: CompletedCodeSheet };

export type RunOptions = {
  complete?: CompleteFunction;
  cache?: CodeCache;
  python?: string;
  onStdoutLine?: (line: string) => void;
  compilationStrategy?: CompilationMode;
  experimentalParallelCompletions?: boolean;
  agenticMaxIterations?: number;
};

export type CompilationMode = CompilationStrategy | "auto";

export type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type InteractiveRunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: NodeJS.Signals | null; error?: string };

export type InteractiveRunStart = {
  session: InteractivePythonRun;
  completed: CompletedCodeSheet;
};

type PythonExecution =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string };

type AgenticAction = {
  tool: "replace_file" | "finish";
  source?: string;
};

type AgenticObservation = {
  iteration: number;
  action: AgenticAction["tool"];
  ok: boolean;
  stdout: string[];
  stderr: string;
};

export async function runCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<RunResult> {
  const cache = options.cache ?? new Map();
  const mode = compilationMode(options);
  if (mode !== "auto") {
    return compileAndRun(cache, codeSheet, runnable, options, mode);
  }

  let lastResult: RunResult | null = null;
  for (const strategy of strategyOrder()) {
    const forkedCache = new Map(cache);
    const result = await compileAndRun(forkedCache, codeSheet, runnable, options, strategy);
    if (result.ok) {
      commitCache(cache, forkedCache);
      return result;
    }
    lastResult = result;
  }

  if (lastResult) {
    return lastResult;
  }

  throw new Error("No compilation strategy was attempted");
}

export async function startInteractiveCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<InteractiveRunStart> {
  const cache = options.cache ?? new Map();
  const completed = await completeSheet(cache, codeSheet, options.complete, compileOptions(options, interactiveStrategy(options)));
  const source = buildPythonProgram(completed.source, runnable);
  return {
    session: new InteractivePythonRun(source, options.python ?? "python3"),
    completed,
  };
}

async function compileAndRun(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions,
  strategy: CompilationStrategy,
): Promise<RunResult> {
  if (strategy === "agentic") {
    return compileAndRunAgentically(cache, codeSheet, runnable, options);
  }

  const completed = await completeSheet(cache, codeSheet, options.complete, compileOptions(options, strategy));
  const source = buildPythonProgram(completed.source, runnable);
  const executed = await runPython(source, options.python ?? "python3", options.onStdoutLine);

  if (executed.ok) {
    return {
      ok: true,
      stdout: stdoutLines(executed.stdout),
      completed,
    };
  }

  return {
    ok: false,
    error: executed.stderr.trim() || executed.stdout.trim() || `Python exited ${executed.code}`,
    stdout: stdoutLines(executed.stdout),
    stderr: executed.stderr,
    completed,
  };
}

function runResult(executed: PythonExecution, completed: CompletedCodeSheet): RunResult {
  if (executed.ok) {
    return {
      ok: true,
      stdout: stdoutLines(executed.stdout),
      completed,
    };
  }

  return {
    ok: false,
    error: executed.stderr.trim() || executed.stdout.trim() || `Python exited ${executed.code}`,
    stdout: stdoutLines(executed.stdout),
    stderr: executed.stderr,
    completed,
  };
}

async function compileAndRunAgentically(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions,
): Promise<RunResult> {
  if (!options.complete) {
    return compileAndRun(cache, codeSheet, runnable, options, "sequential");
  }

  const cacheKey = hashSnippet(`agentic-file:${runnable}\n${codeSheet}`);
  const cachedSource = cache.get(cacheKey);
  if (cachedSource !== undefined) {
    const completed = completedAgenticSheet(codeSheet, cachedSource, cacheKey, true);
    const executed = await runPython(
      buildPythonProgram(completed.source, runnable),
      options.python ?? "python3",
      options.onStdoutLine,
    );
    return runResult(executed, completed);
  }

  const maxIterations = options.agenticMaxIterations ?? 4;
  const parsed = parse(codeSheet);
  const initialSource = renderImplementation(buildCompilationIR(parsed));
  let currentSource = initialSource;
  const observations: AgenticObservation[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const prompt = buildAgenticFilePrompt({
      codeSheet,
      runnable,
      currentSource,
      observations,
      iteration,
      maxIterations,
    });
    const raw = await collectCompletionResult(options.complete(prompt));
    const action = parseAgenticAction(raw);

    if (action.source !== undefined) {
      currentSource = normalizeAgenticSource(action.source);
    }

    const executed = await runPython(
      buildPythonProgram(currentSource, runnable),
      options.python ?? "python3",
    );
    observations.push({
      iteration,
      action: action.tool,
      stdout: stdoutLines(executed.stdout),
      stderr: executed.stderr.trim(),
      ok: executed.ok,
    });

    if (executed.ok || action.tool === "finish") {
      break;
    }
  }

  const completed = completedAgenticSheet(codeSheet, currentSource, cacheKey, false);
  const executed = await runPython(
    buildPythonProgram(completed.source, runnable),
    options.python ?? "python3",
    options.onStdoutLine,
  );
  if (executed.ok) {
    cache.set(cacheKey, currentSource);
  }
  return runResult(executed, completed);
}

function compileOptions(options: RunOptions, strategy: CompilationStrategy): CompileOptions {
  return {
    strategy,
    experimentalParallelCompletions: options.experimentalParallelCompletions,
  };
}

function compilationMode(options: RunOptions): CompilationMode {
  if (options.compilationStrategy) {
    return options.compilationStrategy;
  }

  return options.experimentalParallelCompletions ? "parallel" : "sequential";
}

function interactiveStrategy(options: RunOptions): CompilationStrategy {
  const mode = compilationMode(options);
  return mode === "auto" ? "parallel" : mode;
}

function strategyOrder(): CompilationStrategy[] {
  return ["parallel", "sequential", "agentic"];
}

function commitCache(target: CodeCache, source: CodeCache): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function completedAgenticSheet(
  codeSheet: CodeSheet,
  source: string,
  cacheKey: string,
  cached: boolean,
): CompletedCodeSheet {
  const parsed = parse(codeSheet);
  return {
    source,
    lowered: lower(parsed),
    completions: [{
      hash: cacheKey,
      snippet: "<agentic-file>",
      replacement: source,
      cached,
    }],
    ir: buildCompilationIR(parsed),
  };
}

function buildAgenticFilePrompt(options: {
  codeSheet: CodeSheet;
  runnable: Runnable;
  currentSource: string;
  observations: AgenticObservation[];
  iteration: number;
  maxIterations: number;
}): string {
  return `Your job is to compile this worksheet into one complete Python file.

You are a stateful coding agent editing a single Python source file. Use the tool protocol below instead of returning prose.

Tool protocol:
- Return exactly one JSON object.
- To edit the file: {"tool":"replace_file","source":"<complete Python source without a __main__ block>"}
- To finish with the current or supplied file: {"tool":"finish"} or {"tool":"finish","source":"<complete Python source without a __main__ block>"}

Rules:
- Preserve the public behavior required by the runnable/test function.
- Use only the Python standard library.
- Keep declarations top-level unless nesting is explicitly required.
- If the worksheet declares a class without __init__, no-argument construction must produce a valid default object.
- Do not include an if __name__ == "__main__" block; the runner adds it.

Runnable to satisfy: ${options.runnable}
Iteration: ${options.iteration} of ${options.maxIterations}

Worksheet:
\`\`\`python
${options.codeSheet}
\`\`\`

Current file:
\`\`\`python
${options.currentSource}
\`\`\`

Prior tool results:
\`\`\`json
${JSON.stringify(options.observations, null, 2)}
\`\`\``;
}

function parseAgenticAction(raw: string): AgenticAction {
  const parsed = parseJsonAction(raw);
  if (parsed) {
    return parsed;
  }

  return {
    tool: "replace_file",
    source: raw,
  };
}

function parseJsonAction(raw: string): AgenticAction | null {
  const candidates = [
    raw.trim(),
    raw.trim().match(/```(?:json)?\s*\n([\s\S]*?)```/)?.[1]?.trim(),
    raw.trim().match(/({[\s\S]*})/)?.[1]?.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as { tool?: unknown; source?: unknown };
      if (value.tool !== "replace_file" && value.tool !== "finish") {
        continue;
      }

      return {
        tool: value.tool,
        ...(typeof value.source === "string" ? { source: value.source } : {}),
      };
    } catch {
      // Try the next extraction shape.
    }
  }

  return null;
}

function normalizeAgenticSource(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(/```(?:python)?\s*\n([\s\S]*?)```/)?.[1] ?? trimmed;
  const lines = fenced.replaceAll("\r\n", "\n").split("\n");
  const withoutFuture = lines.filter((line) => line.trim() !== "from __future__ import annotations");
  const mainIndex = withoutFuture.findIndex((line) => /^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(line.trim()));
  return trimOuterBlankLines(mainIndex < 0 ? withoutFuture : withoutFuture.slice(0, mainIndex)).join("\n").trimEnd();
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) {
    start += 1;
  }
  while (end > start && lines[end - 1].trim().length === 0) {
    end -= 1;
  }
  return lines.slice(start, end);
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

export function buildPythonProgram(source: string, runnable: Runnable): string {
  return `from __future__ import annotations

${source}

if __name__ == "__main__":
  ${runnable}()
`;
}

export class InteractivePythonRun {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly chunks: RunChunk[] = [];
  private exitStatus: InteractiveRunStatus | null = null;

  constructor(source: string, command: string) {
    this.child = spawn(command, ["-u", "-c", source], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.chunks.push({ stream: "stdout", text: chunk.toString("utf8") });
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.chunks.push({ stream: "stderr", text: chunk.toString("utf8") });
    });
    this.child.on("error", (error) => {
      this.chunks.push({ stream: "stderr", text: error.message });
      this.exitStatus = {
        state: "exited",
        code: null,
        signal: null,
        error: error.message,
      };
    });
    this.child.on("close", (code, signal) => {
      this.exitStatus = {
        state: "exited",
        code,
        signal,
        error: this.exitStatus?.state === "exited" ? this.exitStatus.error : undefined,
      };
    });
  }

  writeInput(input: string): boolean {
    if (this.exitStatus?.state === "exited" || this.child.stdin.destroyed) {
      return false;
    }

    try {
      return this.child.stdin.write(input);
    } catch {
      return false;
    }
  }

  drainOutput(): RunChunk[] {
    return this.chunks.splice(0, this.chunks.length);
  }

  status(): InteractiveRunStatus {
    return this.exitStatus ?? { state: "running" };
  }

  stop(): void {
    if (this.exitStatus?.state === "exited") {
      return;
    }

    this.child.kill("SIGTERM");
  }
}

function runPython(
  source: string,
  command: string,
  onStdoutLine?: (line: string) => void,
): Promise<PythonExecution> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-u", "-c", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let pendingStdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (!onStdoutLine) {
        return;
      }

      const text = pendingStdout + chunk.toString("utf8");
      const lines = text.split("\n");
      pendingStdout = lines.pop() ?? "";
      for (const line of lines) {
        onStdoutLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      if (onStdoutLine && pendingStdout.length > 0) {
        onStdoutLine(pendingStdout.endsWith("\r") ? pendingStdout.slice(0, -1) : pendingStdout);
      }

      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ ok: true, stdout: out, stderr: err });
      } else {
        resolve({ ok: false, code, stdout: out, stderr: err });
      }
    });
  });
}

function stdoutLines(stdout: string): string[] {
  return stdout.trimEnd().length === 0 ? [] : stdout.trimEnd().split("\n");
}
