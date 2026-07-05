import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { runnables as parseRunnables } from "../domain/codeSheet";
import type { LogosSheet, LogosImplSheet, LogosImplSheetId } from "./codegen";

export type DeclaredRunnable = {
  name: string;
  line: number;
};

export type ReadyRunnable = DeclaredRunnable & {
  ready: true;
  implSheetId: LogosImplSheetId;
};

export type RunEvent =
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "exit"; code: number }
  | { kind: "error"; message: string };

export function runnables(sheet: LogosSheet): DeclaredRunnable[] {
  return parseRunnables(sheet).map((r) => ({ name: r.name, line: r.line }));
}

export function validateRunnables(
  impl: LogosImplSheet,
  declared: DeclaredRunnable[],
  implSheetId: LogosImplSheetId,
): ReadyRunnable[] {
  const defined = topLevelFunctionNames(impl);
  return declared
    .filter((r) => defined.has(r.name))
    .map((r) => ({ ...r, ready: true as const, implSheetId }));
}

function topLevelFunctionNames(source: string): Set<string> {
  const sourceFile = ts.createSourceFile("impl.ts", source, ts.ScriptTarget.Latest, false);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

export async function* run(
  _sheet: LogosSheet,
  impl: LogosImplSheet,
  runnable: DeclaredRunnable,
): AsyncIterable<RunEvent> {
  const program = buildProgram(impl, runnable.name);
  const file = await writeTempFile(program);

  try {
    const events = await execute(file);
    for (const event of events) {
      yield event;
    }
  } finally {
    await rm(file, { force: true });
  }
}

function buildProgram(impl: LogosImplSheet, runnable: string): string {
  const stripped = impl
    .replace(/^\s*main\(\);\s*$/gm, "")
    .replace(/^\s*void\s+main\(\);\s*$/gm, "")
    .trimEnd();

  return `${stripped}

const __logosResult = ${runnable}();
if (__logosResult && typeof __logosResult.then === "function") {
  await __logosResult;
}
`;
}

async function writeTempFile(source: string): Promise<string> {
  const dir = join(process.cwd(), ".logos-runs");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${randomUUID()}.ts`);
  await writeFile(file, source, "utf8");
  return file;
}

async function execute(file: string): Promise<RunEvent[]> {
  const tsxPath = findTsx();

  return new Promise<RunEvent[]>((resolve) => {
    const events: RunEvent[] = [];
    const child = spawn(tsxPath, [file], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    child.stdout.on("data", (chunk: Buffer) => {
      events.push({ kind: "stdout", text: chunk.toString("utf8") });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      events.push({ kind: "stderr", text: chunk.toString("utf8") });
    });

    child.on("error", (error) => {
      events.push({ kind: "error", message: error.message });
      resolve(events);
    });

    child.on("close", (code) => {
      events.push({ kind: "exit", code: code ?? 1 });
      resolve(events);
    });
  });
}

function findTsx(): string {
  try {
    const req = require("node:module").createRequire(join(process.cwd(), "package.json"));
    return req.resolve("tsx/cli");
  } catch {
    return "tsx";
  }
}
