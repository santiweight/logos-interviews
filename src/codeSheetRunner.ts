import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompleteFunction,
  type CompletedCodeSheet,
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
  const completed = await completeSheet(cache, codeSheet, options.complete);
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

export async function startInteractiveCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<InteractiveRunStart> {
  const cache = options.cache ?? new Map();
  const completed = await completeSheet(cache, codeSheet, options.complete);
  const source = buildPythonProgram(completed.source, runnable);
  return {
    session: new InteractivePythonRun(source, options.python ?? "python3"),
    completed,
  };
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
): Promise<
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string }
> {
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
