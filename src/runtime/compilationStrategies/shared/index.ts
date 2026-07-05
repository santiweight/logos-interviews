import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as pty from "node-pty";
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
} from "../../../domain/codeSheet";

export type RunResult =
  | { ok: true; stdout: string[]; completed: CompletedCodeSheet }
  | { ok: false; error: string; stdout: string[]; stderr: string; completed: CompletedCodeSheet };

export type StrategyRunOptions = {
  complete?: CompleteFunction;
  cache?: CodeCache;
  python?: string;
  tsx?: string;
  onStdoutLine?: (line: string) => void;
  agenticMaxIterations?: number;
};

export type TypeScriptExecution =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string };

export type PythonExecution = TypeScriptExecution;

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

export function runResult(executed: TypeScriptExecution, completed: CompletedCodeSheet): RunResult {
  if (executed.ok) {
    return {
      ok: true,
      stdout: stdoutLines(executed.stdout),
      completed,
    };
  }

  return {
    ok: false,
    error: executed.stderr.trim() || executed.stdout.trim() || `TypeScript exited ${executed.code}`,
    stdout: stdoutLines(executed.stdout),
    stderr: executed.stderr,
    completed,
  };
}

export function buildPythonProgram(source: string, runnable: Runnable): string {
  return buildTypeScriptProgram(source, runnable);
}

export function buildTypeScriptProgram(source: string, runnable: Runnable): string {
  return `${stripTopLevelTypeScriptEntrypoint(source)}

const __logosResult = ${runnable}();
if (__logosResult && typeof __logosResult.then === "function") {
  await __logosResult;
}
`;
}

export function runPython(
  source: string,
  command = defaultTsxCommand(),
  onStdoutLine?: (line: string) => void,
): Promise<TypeScriptExecution> {
  return runTypeScript(source, command, onStdoutLine);
}

export async function runTypeScript(
  source: string,
  command = defaultTsxCommand(),
  onStdoutLine?: (line: string) => void,
): Promise<TypeScriptExecution> {
  const file = await writeTemporaryTypeScriptFile(source);
  const invocation = tsxInvocation(file, command);
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
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
      void rm(file, { force: true });
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      void rm(file, { force: true });
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

export class InteractiveTypeScriptRun {
  private readonly terminal: pty.IPty | null = null;
  private readonly child: ChildProcessWithoutNullStreams | null = null;
  private readonly chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
  private exitStatus: { state: "exited"; code: number | null; signal: NodeJS.Signals | null; error?: string } | null = null;

  private constructor(
    private readonly file: string,
    command: string,
  ) {
    const invocation = tsxInvocation(file, command);
    try {
      this.terminal = pty.spawn(invocation.command, invocation.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });

      this.terminal.onData((text) => {
        this.chunks.push({ stream: "stdout", text });
      });
      this.terminal.onExit(({ exitCode }) => {
        this.exitStatus = { state: "exited", code: exitCode, signal: null };
        void rm(file, { force: true });
      });
    } catch (error) {
      this.child = spawn(invocation.command, invocation.args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });

      this.child.stdout.on("data", (chunk: Buffer) => {
        this.chunks.push({ stream: "stdout", text: chunk.toString("utf8") });
      });
      this.child.stderr.on("data", (chunk: Buffer) => {
        this.chunks.push({ stream: "stderr", text: chunk.toString("utf8") });
      });
      this.child.on("error", (childError) => {
        this.exitStatus = {
          state: "exited",
          code: null,
          signal: null,
          error: childError.message,
        };
        void rm(file, { force: true });
      });
      this.child.on("close", (code, signal) => {
        this.exitStatus = { state: "exited", code, signal };
        void rm(file, { force: true });
      });

      this.chunks.push({
        stream: "stderr",
        text: `PTY unavailable, using pipe fallback: ${error instanceof Error ? error.message : String(error)}\n`,
      });
    }
  }

  static async start(source: string, command = defaultTsxCommand()): Promise<InteractiveTypeScriptRun> {
    const file = await writeTemporaryTypeScriptFile(source);
    await ensurePtyRuntime();
    return new InteractiveTypeScriptRun(file, command);
  }

  writeInput(input: string): boolean {
    if (this.exitStatus?.state === "exited") {
      return false;
    }
    if (this.terminal) {
      this.terminal.write(input);
      return true;
    }
    this.child?.stdin.write(input);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (this.exitStatus?.state === "exited" || !this.terminal) {
      return false;
    }

    this.terminal.resize(cols, rows);
    return true;
  }

  drainOutput(): Array<{ stream: "stdout" | "stderr"; text: string }> {
    return this.chunks.splice(0, this.chunks.length);
  }

  status(): { state: "running" } | { state: "exited"; code: number | null; signal: NodeJS.Signals | null; error?: string } {
    return this.exitStatus ?? { state: "running" };
  }

  stop(): void {
    if (this.exitStatus?.state === "exited") {
      return;
    }
    this.terminal?.kill();
    this.child?.kill();
    void rm(this.file, { force: true });
  }
}

function stripTopLevelTypeScriptEntrypoint(source: string): string {
  return source
    .replace(/^\s*main\(\);\s*$/gm, "")
    .replace(/^\s*void\s+main\(\);\s*$/gm, "")
    .trimEnd();
}

async function writeTemporaryTypeScriptFile(source: string): Promise<string> {
  const dir = join(process.cwd(), ".logos-runs");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${randomUUID()}.ts`);
  await writeFile(file, source, "utf8");
  return file;
}

function defaultTsxCommand(): string {
  return "__logos_default_tsx__";
}

function tsxInvocation(file: string, command: string): { command: string; args: string[] } {
  if (command !== "__logos_default_tsx__") {
    return { command, args: [file] };
  }

  return {
    command: process.execPath,
    args: [defaultTsxCliPath(), file],
  };
}

function defaultTsxCliPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("tsx")), "cli.mjs");
}

async function ensurePtyRuntime(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    await chmod(nodePtyDarwinSpawnHelperPath(), 0o755);
  } catch {
    // If this fails, node-pty will still report the real startup error and the
    // runner will fall back to pipes.
  }
}

function nodePtyDarwinSpawnHelperPath(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve("node-pty/package.json")),
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
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
  return line.match(/^\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:(?:->|:)\s*[^;{:=]+)?\s*;?\s*$/);
}

export function classNamesFromSnippets(snippets: string[]): Set<string> {
  return new Set(snippets.flatMap((snippet) => {
    const match = snippet.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    return match ? [match[1]] : [];
  }));
}

export function synthesizeNoArgClassFactory(snippet: string, classNames: Set<string>): string | null {
  const tsMatch = snippet.match(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*:\s*([A-Z][A-Za-z0-9_]*)\s*;?\s*$/);
  if (tsMatch && classNames.has(tsMatch[2])) {
    return `function ${tsMatch[1]}(): ${tsMatch[2]} {\n  return new ${tsMatch[2]}();\n}`;
  }

  const match = snippet.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*->\s*([A-Z][A-Za-z0-9_]*)\s*$/);
  if (!match || !classNames.has(match[2])) {
    return null;
  }

  return `def ${match[1]}() -> ${match[2]}:\n  return ${match[2]}()`;
}

export function normalizeFencedCode(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(/```(?:typescript|ts|python)?\s*\n([\s\S]*?)```/)?.[1] ?? trimmed;
  return normalizeLineEndings(fenced).trimEnd();
}

export function methodNameAndIndent(line: string): { name: string; indent: number } | null {
  const match = line.match(/^(\s*)(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
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
