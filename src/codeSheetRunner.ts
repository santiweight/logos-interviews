import { spawn } from "node:child_process";
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
};

export async function runCodeSheet(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: RunOptions = {},
): Promise<RunResult> {
  const cache = options.cache ?? new Map();
  const completed = await completeSheet(cache, codeSheet, options.complete);
  const source = buildPythonProgram(completed.source, runnable);
  const executed = await runPython(source, options.python ?? "python3");

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

function buildPythonProgram(source: string, runnable: Runnable): string {
  return `${source}

if __name__ == "__main__":
  ${runnable}()
`;
}

function runPython(
  source: string,
  command: string,
): Promise<
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string }
> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-c", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
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
