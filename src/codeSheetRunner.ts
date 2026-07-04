import * as pty from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
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
} from "./codeSheet";
import { compilationStrategies } from "./compilationStrategies";
import {
  buildPythonProgram,
  runPython,
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
export { buildPythonProgram } from "./compilationStrategies/shared";

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
  session: InteractivePythonRun;
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
    const executed = await runPython(
      buildPythonProgram(cached.source, runnable),
      options.python ?? "python3",
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
  const source = buildPythonProgram(completed.source, runnable);
  return {
    session: new InteractivePythonRun(source, options.python ?? "python3"),
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

export class InteractivePythonRun {
  private readonly child: IPty | null;
  private readonly chunks: RunChunk[] = [];
  private exitStatus: InteractiveRunStatus | null = null;
  private stopSignal: NodeJS.Signals | null = null;

  constructor(source: string, command: string) {
    try {
      this.child = pty.spawn(command, ["-u", "-c", source], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.child = null;
      this.chunks.push({ stream: "stderr", text: message });
      this.exitStatus = {
        state: "exited",
        code: null,
        signal: null,
        error: message,
      };
      return;
    }

    this.child.onData((data) => {
      this.chunks.push({ stream: "stdout", text: data });
    });
    this.child.onExit(({ exitCode }) => {
      this.exitStatus = {
        state: "exited",
        code: exitCode,
        signal: this.stopSignal,
        error: this.exitStatus?.state === "exited" ? this.exitStatus.error : undefined,
      };
    });
  }

  writeInput(input: string): boolean {
    if (!this.child || this.exitStatus?.state === "exited") {
      return false;
    }

    try {
      this.child.write(input);
      return true;
    } catch {
      return false;
    }
  }

  resize(cols: number, rows: number): boolean {
    if (!this.child || this.exitStatus?.state === "exited") {
      return false;
    }

    try {
      this.child.resize(cols, rows);
      return true;
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
    if (!this.child || this.exitStatus?.state === "exited") {
      return;
    }

    this.stopSignal = "SIGTERM";
    this.child.kill("SIGTERM");
  }
}
