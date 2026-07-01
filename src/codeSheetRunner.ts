import type {
  CodeCache,
  CodeSheet,
  CompilationStrategy,
  CompleteFunction,
  Runnable,
} from "./codeSheet";
import {
  buildTypeScriptProgram,
  compileCodeSheetToTypeScript,
  InteractiveTypeScriptRun,
  runTypeScript,
  type InteractiveRunStatus,
  type RunArtifact,
  type RunChunk,
} from "./typescriptTarget";
import type { CompilationMode } from "./compilationStrategies/types";

export type RunResult =
  | {
      ok: true;
      stdout: string[];
      artifacts: RunArtifact[];
      completed: Awaited<ReturnType<typeof compileCodeSheetToTypeScript>>["completed"];
    }
  | {
      ok: false;
      error: string;
      stdout: string[];
      stderr: string;
      artifacts: RunArtifact[];
      completed: Awaited<ReturnType<typeof compileCodeSheetToTypeScript>>["completed"];
    };

export type { CompilationMode } from "./compilationStrategies/types";
export type { InteractiveRunStatus, RunArtifact, RunChunk };
export { buildTypeScriptProgram };

export type RunOptions = {
  complete?: CompleteFunction;
  cache?: CodeCache;
  compilationStrategy?: CompilationMode;
  node?: string;
  onStdoutLine?: (line: string) => void;
};

export type InteractiveRunStart = {
  session: InteractiveTypeScriptRun;
  completed: Awaited<ReturnType<typeof compileCodeSheetToTypeScript>>["completed"];
};

export async function runCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<RunResult> {
  const compiled = await compileCodeSheetToTypeScript(codeSheet, runnable, {
    cache: options.cache,
    complete: options.complete,
    strategy: compileStrategy(options.compilationStrategy),
  });
  const executed = await runTypeScript(compiled.program, options.node ?? "node", options.onStdoutLine);

  if (executed.ok) {
    return {
      ok: true,
      stdout: stdoutLines(executed.stdout),
      artifacts: executed.artifacts,
      completed: compiled.completed,
    };
  }

  return {
    ok: false,
    error: executed.stderr.trim() || executed.stdout.trim() || `Node exited ${executed.code}`,
    stdout: stdoutLines(executed.stdout),
    stderr: executed.stderr,
    artifacts: executed.artifacts,
    completed: compiled.completed,
  };
}

export async function startInteractiveCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<InteractiveRunStart> {
  const compiled = await compileCodeSheetToTypeScript(codeSheet, runnable, {
    cache: options.cache,
    complete: options.complete,
    strategy: compileStrategy(options.compilationStrategy),
  });
  return {
    session: new InteractiveTypeScriptRun(compiled.program, options.node ?? "node"),
    completed: compiled.completed,
  };
}

function stdoutLines(stdout: string): string[] {
  return stdout.trimEnd().length === 0 ? [] : stdout.trimEnd().split(/\r?\n/);
}

function compileStrategy(strategy: CompilationMode | undefined): CompilationStrategy {
  if (strategy === "agentic" || strategy === "agentic-methods") {
    return "agentic";
  }
  if (strategy === "sequential") {
    return "sequential";
  }
  return "parallel";
}
