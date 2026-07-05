import { describe, expect, it } from "vitest";
import { completeWithAnthropic } from "./anthropicComplete";
import { runnables, type CodeCache, type RunnableInfo } from "./codeSheet";
import { buildPythonProgram, runCodeSheet } from "./codeSheetRunner";
import { runPython } from "./compilationStrategies/shared";
import { defaultProjectIds, samples, type SampleProgram } from "./samples";

type SmokeCase = {
  sample: SampleProgram;
  runnable: RunnableInfo;
};

type SmokeResult = {
  sampleId: string;
  sampleLabel: string;
  runnable: string;
  attempt: number;
  ok: boolean;
  stdout: string[];
  stderr: string;
  error?: string;
  borkedOutput: string[];
};

const smokeAttempts = 5;

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.LOGOS_ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("default workspace smoke eval", () => {
  it("runs every runnable in every default-loaded sample without errors", async () => {
    const cache: CodeCache = new Map();
    const cases = defaultWorkspaceSmokeCases();
    const results: SmokeResult[] = [];

    expect(new Set(cases.map((testCase) => testCase.sample.id))).toEqual(new Set(defaultProjectIds));

    for (const testCase of cases) {
      for (let attempt = 1; attempt <= smokeAttempts; attempt += 1) {
        results.push(await runSmokeCase(testCase, attempt, cache));
      }
    }

    expect(results, JSON.stringify(results, null, 2)).toEqual(
      results.map((result) => ({
        ...result,
        ok: true,
        error: undefined,
        stderr: "",
        borkedOutput: [],
      })),
    );
  }, 300_000);
});

function defaultWorkspaceSmokeCases(): SmokeCase[] {
  return defaultWorkspaceSamples().flatMap((sample) => {
    return runnables(sample.code).map((runnable) => ({ sample, runnable }));
  });
}

function defaultWorkspaceSamples(): SampleProgram[] {
  return defaultProjectIds.map((sampleId) => {
    const sample = samples.find((item) => item.id === sampleId);
    if (!sample) {
      throw new Error(`Default workspace sample is missing: ${sampleId}`);
    }
    return sample;
  });
}

async function runSmokeCase(testCase: SmokeCase, attempt: number, cache: CodeCache): Promise<SmokeResult> {
  const python = process.env.PYTHON ?? "python3";
  const base = {
    sampleId: testCase.sample.id,
    sampleLabel: testCase.sample.label,
    runnable: testCase.runnable.name,
    attempt,
  };

  const result = await runCodeSheet(testCase.sample.code, testCase.runnable.name, {
    complete: completeWithAnthropic,
    cache,
    python,
  }).catch((error: unknown) => ({
    ok: false as const,
    error: errorMessage(error),
    stdout: [],
  }));

  if (!result.ok) {
    return {
      ...base,
      ok: false,
      stdout: result.stdout,
      stderr: "stderr" in result ? result.stderr : "",
      error: result.error,
      borkedOutput: borkedOutputLines(result.stdout, "stderr" in result ? result.stderr : result.error),
    };
  }

  const executed = await runPython(
    buildPythonProgram(result.completed.source, testCase.runnable.name),
    python,
  );
  const stderr = executed.stderr.trim();
  const stdout = executed.stdout.trimEnd().length === 0
    ? result.stdout
    : executed.stdout.trimEnd().split(/\r?\n/);

  return {
    ...base,
    ok: executed.ok && stdout.length > 0 && stderr.length === 0,
    stdout,
    stderr,
    error: executed.ok ? undefined : `Python exited with ${executed.code}`,
    borkedOutput: borkedOutputLines(stdout, stderr),
  };
}

function borkedOutputLines(stdout: string[], stderr: string): string[] {
  const lines = [...stdout, ...stderr.split(/\r?\n/)].filter((line) => line.trim().length > 0);
  return lines.filter((line) => borkedOutputPattern().test(line));
}

function borkedOutputPattern(): RegExp {
  return /\b(?:Traceback|SyntaxError|NameError|TypeError|ValueError|AttributeError|ImportError|ModuleNotFoundError|IndentationError|RuntimeError|NotImplementedError|Exception)\b/i;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
