import { spawn } from "node:child_process";
import {
  buildCompilationIR,
  type CodeCache,
  type CodeSheet,
  type CompleteFunction,
  type CompleteResult,
  type CompletedCodeSheet,
  hashSnippet,
  lower,
  parse,
  type Runnable,
} from "../../codeSheet";

export type RunResult =
  | { ok: true; stdout: string[]; completed: CompletedCodeSheet }
  | { ok: false; error: string; stdout: string[]; stderr: string; completed: CompletedCodeSheet };

export type StrategyRunOptions = {
  complete?: CompleteFunction;
  cache?: CodeCache;
  python?: string;
  onStdoutLine?: (line: string) => void;
  agenticMaxIterations?: number;
};

export type PythonExecution =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string };

export type MethodTask = {
  snippet: string;
  method?: boolean;
};

export function completedStrategySheet(
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
      snippet: "<strategy-file>",
      replacement: source,
      cached,
    }],
    ir: buildCompilationIR(parsed),
  };
}

export function strategyCacheKey(prefix: string, runnable: Runnable, codeSheet: CodeSheet): string {
  return hashSnippet(`${prefix}:${runnable}\n${codeSheet}`);
}

export function runResult(executed: PythonExecution, completed: CompletedCodeSheet): RunResult {
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

export function buildPythonProgram(source: string, runnable: Runnable): string {
  return `from __future__ import annotations

${source}

if __name__ == "__main__":
  ${runnable}()
`;
}

export function runPython(
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

export function stdoutLines(stdout: string): string[] {
  return stdout.trimEnd().length === 0 ? [] : stdout.trimEnd().split(/\r?\n/);
}

export async function collectCompletionResult(result: CompleteResult): Promise<string> {
  if (!isAsyncIterable(result)) {
    return await result;
  }

  let replacement = "";
  for await (const token of result) {
    replacement += token;
  }
  return replacement;
}

export function isAsyncIterable(value: CompleteResult): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

export function replaceSnippet(source: string, snippet: string, replacement: string): string {
  const normalizedSource = normalizeLineEndings(source);
  const index = normalizedSource.indexOf(snippet);
  if (index < 0) {
    return source;
  }

  return `${normalizedSource.slice(0, index)}${replacement}${normalizedSource.slice(index + snippet.length)}`;
}

export function normalizeLineEndings(source: string): string {
  return source.replaceAll("\r\n", "\n");
}

export function trimOuterBlankLines(lines: string[]): string[] {
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

export function methodHeadersFromClassSnippet(snippet: string): string[] {
  return snippet.split("\n").filter((line) => {
    return /^\s+/.test(line) && methodHeaderWithoutColon(line) !== null;
  }).map((line) => line.trimEnd());
}

function methodHeaderWithoutColon(line: string): RegExpMatchArray | null {
  return line.match(/^\s+def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*$/);
}

export function classNamesFromSnippets(snippets: string[]): Set<string> {
  return new Set(snippets.flatMap((snippet) => {
    const match = snippet.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    return match ? [match[1]] : [];
  }));
}

export function synthesizeNoArgClassFactory(snippet: string, classNames: Set<string>): string | null {
  const match = snippet.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*->\s*([A-Z][A-Za-z0-9_]*)\s*$/);
  if (!match || !classNames.has(match[2])) {
    return null;
  }

  return `def ${match[1]}() -> ${match[2]}:\n  return ${match[2]}()`;
}

export function normalizeFencedCode(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(/```(?:python)?\s*\n([\s\S]*?)```/)?.[1] ?? trimmed;
  return normalizeLineEndings(fenced).trimEnd();
}

export function methodNameAndIndent(line: string): { name: string; indent: number } | null {
  const match = line.match(/^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  return match ? { name: match[2], indent: match[1].length } : null;
}

export function extractRequestedMethodReplacement(replacement: string, targetSnippet: string): string {
  const target = methodNameAndIndent(targetSnippet);
  if (!target) {
    return replacement;
  }

  const lines = replacement.split("\n");
  const start = lines.findIndex((line) => {
    const match = methodNameAndIndent(line);
    return match?.name === target.name;
  });
  if (start < 0) {
    return replacement;
  }

  const result = [lines[start].trimEnd()];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      result.push(line);
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= target.indent && methodNameAndIndent(line)) {
      break;
    }
    result.push(line.trimEnd());
  }

  return trimOuterBlankLines(result).join("\n").trimEnd();
}
