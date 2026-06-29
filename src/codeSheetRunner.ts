import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompleteFunction,
  type CompletedCodeSheet,
  type CompileOptions,
  type CompilationStrategy,
  type Runnable,
} from "./codeSheet";
import { compileAndRunAgentically } from "./compilationStrategies/agenticFile";
import { compileAndRunAgenticMethods } from "./compilationStrategies/agenticMethods";
import { compileAndRunParallel } from "./compilationStrategies/parallel";
import { compileAndRunParallelMethods } from "./compilationStrategies/parallelMethods";
import { compileAndRunSequential } from "./compilationStrategies/sequential";
import {
  buildPythonProgram,
  type RunResult,
  type StrategyRunOptions,
} from "./compilationStrategies/shared";

export type { RunResult } from "./compilationStrategies/shared";
export { buildPythonProgram } from "./compilationStrategies/shared";

export type RunOptions = StrategyRunOptions & {
  complete?: CompleteFunction;
  cache?: CodeCache;
  compilationStrategy?: CompilationMode;
  experimentalParallelCompletions?: boolean;
};

export type MethodStrategy = "parallel-methods" | "agentic-methods";
export type CompilationMode = CompilationStrategy | MethodStrategy | "auto";
type RunnerStrategy = Exclude<CompilationMode, "auto">;

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
  const completed = await completeSheet(cache, codeSheet, options.complete, compileOptions(options, interactiveStrategy(options)));
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
  switch (strategy) {
    case "sequential":
      return compileAndRunSequential(cache, codeSheet, runnable, options);
    case "parallel":
      return compileAndRunParallel(cache, codeSheet, runnable, options);
    case "agentic":
      return compileAndRunAgentically(
        cache,
        codeSheet,
        runnable,
        options,
        () => compileAndRunStrategy(cache, codeSheet, runnable, options, "sequential"),
      );
    case "parallel-methods":
      return compileAndRunParallelMethods(
        cache,
        codeSheet,
        runnable,
        options,
        () => compileAndRunStrategy(cache, codeSheet, runnable, options, "parallel"),
      );
    case "agentic-methods":
      return compileAndRunAgenticMethods(
        cache,
        codeSheet,
        runnable,
        options,
        () => compileAndRunStrategy(cache, codeSheet, runnable, options, "agentic"),
      );
  }
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
  if (mode === "auto") {
    return "parallel";
  }
  return mode === "agentic-methods" ? "agentic" : mode === "parallel-methods" ? "parallel" : mode;
}

function strategyOrder(): RunnerStrategy[] {
  return ["parallel", "sequential", "agentic"];
}

function commitCache(target: CodeCache, source: CodeCache): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
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
