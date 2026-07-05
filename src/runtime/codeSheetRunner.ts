import {
  cachedCompiledSheet,
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompleteFunction,
  type CompletedCodeSheet,
  type CompileOptions,
  type CompilationStrategy,
  type Runnable,
} from "../domain/codeSheet";
import { compilationStrategies } from "./compilationStrategies";
import {
  buildTypeScriptProgram,
  InteractiveTypeScriptRun,
  runTypeScript,
  runResult,
  type RunResult,
  type StrategyRunOptions,
} from "./compilationStrategies/shared";
import {
  defaultAutoStrategyOrder,
  type CompilationMode,
  type RunnerStrategy,
} from "./compilationStrategies/types";

export type { RunResult } from "./compilationStrategies/shared";
export type { CompilationMode, RunnerStrategy } from "./compilationStrategies/types";
export { buildPythonProgram, buildTypeScriptProgram, InteractiveTypeScriptRun } from "./compilationStrategies/shared";
export type InteractivePythonRun = InteractiveTypeScriptRun;

export type RunOptions = StrategyRunOptions & {
  complete?: CompleteFunction;
  cache?: CodeCache;
  compilationStrategy?: CompilationMode;
};

export type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type InteractiveRunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: NodeJS.Signals | null; error?: string };

export type InteractiveRunStart = {
  session: InteractiveTypeScriptRun;
  completed: CompletedCodeSheet;
};

export async function runCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<RunResult> {
  const cache = options.cache ?? new Map();
  const cached = await cachedCompiledSheet(cache, codeSheet);
  if (cached) {
    const executed = await runTypeScript(
      buildTypeScriptProgram(cached.source, runnable),
      options.tsx,
      options.onStdoutLine,
    );
    return runResult(executed, cached);
  }

  const mode = compilationMode(options);
  if (mode !== "auto") {
    return compileAndRunStrategy(cache, codeSheet, runnable, options, mode);
  }

  let lastResult: RunResult | null = null;
  for (const strategy of strategyOrder()) {
    const forkedCache = new Map(cache);
    const result = await compileAndRunStrategy(forkedCache, codeSheet, runnable, options, strategy);
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
  const completed = await cachedCompiledSheet(cache, codeSheet) ??
    await completeSheet(cache, codeSheet, options.complete, compileOptions(interactiveStrategy(options)));
  const source = buildTypeScriptProgram(completed.source, runnable);
  return {
    session: await InteractiveTypeScriptRun.start(source, options.tsx),
    completed,
  };
}

function compileAndRunStrategy(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions,
  strategy: RunnerStrategy,
): Promise<RunResult> {
  const definition = compilationStrategies[strategy];
  const fallbackStrategy = "fallback" in definition ? definition.fallback : undefined;
  const fallback = fallbackStrategy === undefined
    ? () => Promise.reject(new Error(`Strategy ${strategy} has no fallback`))
    : () => compileAndRunStrategy(cache, codeSheet, runnable, options, fallbackStrategy);
  return definition.run({ cache, codeSheet, runnable, options }, fallback);
}

function compileOptions(strategy: CompilationStrategy): CompileOptions {
  return {
    strategy,
  };
}

function compilationMode(options: RunOptions): CompilationMode {
  if (options.compilationStrategy) {
    return options.compilationStrategy;
  }

  return "sequential";
}

function interactiveStrategy(options: RunOptions): CompilationStrategy {
  const mode = compilationMode(options);
  if (mode === "auto") {
    return "parallel";
  }
  return mode === "agentic-methods" ? "agentic" : mode === "parallel-methods" ? "parallel" : mode;
}

function strategyOrder(): RunnerStrategy[] {
  return [...defaultAutoStrategyOrder];
}

function commitCache(target: CodeCache, source: CodeCache): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}
