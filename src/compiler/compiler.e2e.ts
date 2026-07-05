import { describe, it, expect } from "vitest";
import { compile, compileFresh, compileUpdate, type CompilerCache, type CompilerEvent, type LogosImplSheet, type LogosSheet } from "./codegen";
import { runnables, run, validateRunnables, type DeclaredRunnable, type RunEvent } from "./run";

const MODEL = "claude-sonnet-5" as const;

async function collectEvents(iter: AsyncIterable<CompilerEvent>): Promise<CompilerEvent[]> {
  const events: CompilerEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

function lastDone(events: CompilerEvent[]): LogosImplSheet {
  const done = events.filter((e) => e.kind === "done").at(-1);
  if (!done || done.kind !== "done") throw new Error("No done event");
  return done.code;
}

function hasAgentActivity(events: CompilerEvent[]): boolean {
  return events.some((e) => e.kind === "agent-text" || e.kind === "agent-tool");
}

function emptyCache(): CompilerCache {
  const store = new Map<LogosSheet, LogosImplSheet>();
  return {
    get: (sheet) => store.get(sheet) ?? null,
    set: (sheet, code) => store.set(sheet, code),
    findPrevious: () => null,
  };
}

async function compileAndRun(sheet: LogosSheet, runnableName: string): Promise<{ code: LogosImplSheet; events: CompilerEvent[]; stdout: string }> {
  const events = await collectEvents(compileFresh(sheet, { model: MODEL }));
  const code = lastDone(events);
  const stdout = await captureStdout(sheet, code, runnableName);
  return { code, events, stdout };
}

async function captureStdout(sheet: LogosSheet, code: LogosImplSheet, runnableName: string): Promise<string> {
  const chunks: string[] = [];
  for await (const event of run(sheet, code, { name: runnableName, line: 0 })) {
    if (event.kind === "stdout") chunks.push(event.text);
  }
  return chunks.join("");
}

function toolEvents(events: CompilerEvent[]): CompilerEvent[] {
  return events.filter((e) => e.kind === "agent-tool");
}

function finishCount(events: CompilerEvent[]): number {
  return toolEvents(events).filter((e) => e.kind === "agent-tool" && e.tool === "finish").length;
}

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.LOGOS_ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("logos compiler e2e", () => {
  it("compiles a hello world program from scratch", async () => {
    const sheet = `
function main(): void {
  \`print "hello world"\`
}
`;
    const { events, stdout } = await compileAndRun(sheet, "main");
    expect(events.some((e) => e.kind === "scaffold")).toBe(true);
    expect(runnables(sheet)).toContain("main");
    expect(stdout).toContain("hello world");
  });

  it("updates a snippet from hello world to foo bar", async () => {
    const original = `
function main(): void {
  \`print "hello world"\`
}
`;
    const { code: originalCode } = await compileAndRun(original, "main");

    const updated = `
function main(): void {
  \`print "foo bar"\`
}
`;
    const diff = `-  \`print "hello world"\`\n+  \`print "foo bar"\``;
    const updateEvents = await collectEvents(compileUpdate(updated, diff, originalCode, { model: MODEL }));
    const updatedCode = lastDone(updateEvents);
    const stdout = await captureStdout(updated, updatedCode, "main");
    expect(stdout).toContain("foo bar");
  });

  it("compiles a program with logic", async () => {
    const sheet = `
function isPrime(n: number): boolean {
  \`return true if n is prime, false otherwise\`
}

function main(): void {
  \`print all prime numbers from 1 to 20, one per line\`
}
`;
    const { code, stdout } = await compileAndRun(sheet, "main");
    expect(code).toContain("isPrime");
    expect(stdout).toContain("2");
    expect(stdout).toContain("7");
    expect(stdout).toContain("19");
    expect(stdout).not.toContain("4\n");
  });

  it("updates a sheet by adding a new function", async () => {
    const original = `
function greet(name: string): string {
  \`return a greeting for the given name\`
}

function main(): void {
  console.log(greet("world"))
}
`;
    const { code: originalCode } = await compileAndRun(original, "main");

    const updated = `
function greet(name: string): string {
  \`return a greeting for the given name\`
}

function farewell(name: string): string {
  \`return a farewell for the given name\`
}

function main(): void {
  console.log(greet("world"))
  console.log(farewell("world"))
}
`;
    const diff = `+function farewell(name: string): string {\n+  \`return a farewell for the given name\`\n+}\n+\n+  console.log(farewell("world"))`;
    const updateEvents = await collectEvents(compileUpdate(updated, diff, originalCode, { model: MODEL }));
    const updatedCode = lastDone(updateEvents);
    const stdout = await captureStdout(updated, updatedCode, "main");
    expect(updatedCode).toContain("farewell");
    expect(stdout).toMatch(/hello|hi|hey/i);
    expect(stdout).toMatch(/goodbye|bye|farewell/i);
  });

  it("returns a cache hit without running the agent", async () => {
    const sheet = `
function main(): void {
  \`print "cached"\`
}
`;
    const cache = emptyCache();
    const firstEvents = await collectEvents(compile("test-sheet", sheet, cache, { model: MODEL }));
    const firstCode = lastDone(firstEvents);
    expect(hasAgentActivity(firstEvents)).toBe(true);

    const secondEvents = await collectEvents(compile("test-sheet", sheet, cache, { model: MODEL }));
    expect(lastDone(secondEvents)).toBe(firstCode);
    expect(hasAgentActivity(secondEvents)).toBe(false);
  });

  it("compiles the intro-to-logos rainbow primes in one shot without retries", async () => {
    const sheet = `
function main(): void {
  l\`
  Print all prime numbers from 1 to 50 in a rainbow gradient
  in a 3-wide grid.

  The first number is red, the last is indigo.
  \`
}
`;
    const events = await collectEvents(compileFresh(sheet, { model: MODEL }));
    const code = lastDone(events);

    expect(finishCount(events)).toBe(1);

    const declared = runnables(sheet);
    expect(declared.map((r) => r.name)).toContain("main");

    const ready = validateRunnables(code, declared, "test-impl-sheet");
    expect(ready.map((r) => r.name)).toContain("main");

    const stdout = await captureStdout(sheet, code, "main");
    expect(stdout).toContain("2");
    expect(stdout).toContain("47");
  });
});
