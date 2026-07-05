import { describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import {
  singleFileAgentTools,
  singleFileAgentTypeScriptSyntaxErrors,
} from "./claudeSingleFileAgent";
import type { CodeCache, CompilationEvent } from "../domain/codeSheet";
import type { SingleFileAgentFunction, SingleFileAgentInput } from "./claudeSingleFileAgent";

describe("AgentCompilationFramework single-file agent evals", () => {
  it("compiles and runs end-to-end through the single-file agent", async () => {
    const cache: CodeCache = new Map();
    const agentInputs: SingleFileAgentInput[] = [];
    const compiled = `function add(x: number, y: number): number {
  return x + y;
}

function test(): void {
  console.log(add(1, 2));
}`;
    const framework = new AgentCompilationFramework({
      cache,
      fileAgent: recordAndReturn(agentInputs, compiled),
    });
    const sheet = `function add(x: number, y: number): number;

function test(): void {
  console.log(add(1, 2));
}`;

    const events = await collectEvents(framework.compileEvents(sheet));
    const run = await framework.run(sheet, "test");

    expect(events.at(-1)?.kind).toBe("compiled");
    expect(run).toMatchObject({ ok: true, stdout: ["3"] });
    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0].nextSheet).toBe(sheet);
    expect(agentInputs[0].currentCode).toContain("function add");
    await expect(framework.cache(sheet)).resolves.toBe(compiled);
  });

  it("uses the update agent for a minor numeric edit with previous code and diff", async () => {
    const agentInputs: SingleFileAgentInput[] = [];
    const firstCode = `function add(x: number, y: number): number {
  return x + y;
}

function test(): void {
  console.log(add(1, 5));
}`;
    const updatedCode = firstCode.replace("add(1, 5)", "add(1, 6)");
    const framework = new AgentCompilationFramework({
      fileAgent: async function* (input) {
        agentInputs.push(input);
        const source = input.diffFromPrevious ? updatedCode : firstCode;
        yield { kind: "file", source };
        yield { kind: "done", source };
      },
    });
    const sheet = `function add(x: number, y: number): number;

function test(): void {
  console.log(add(1, 5));
}`;
    const nextSheet = sheet.replace("add(1, 5)", "add(1, 6)");

    const first = await framework.update("intro-to-logos", sheet, "");
    const updated = await framework.update(
      "intro-to-logos",
      nextSheet,
      "-  console.log(add(1, 5));\n+  console.log(add(1, 6));",
    );
    const run = await framework.run(nextSheet, "test");

    expect(first).toBe(firstCode);
    expect(updated).toBe(updatedCode);
    expect(run).toMatchObject({ ok: true, stdout: ["7"] });
    expect(agentInputs).toHaveLength(2);
    expect(agentInputs[1]).toMatchObject({
      previousSheet: sheet,
      nextSheet,
      currentCode: firstCode,
      diffFromPrevious: "-  console.log(add(1, 5));\n+  console.log(add(1, 6));",
    });
  });

  it("streams draft implementation updates and exposes no read-file tool", async () => {
    const agentInputs: SingleFileAgentInput[] = [];
    const draft = `function answer(): number {
  return 41;
}`;
    const final = draft.replace("41", "42");
    const framework = new AgentCompilationFramework({
      fileAgent: async function* (input) {
        agentInputs.push(input);
        yield { kind: "file", source: draft };
        yield { kind: "file", source: final };
        yield { kind: "done", source: final };
      },
    });
    const sheet = `function answer(): number;`;

    const events = await collectEvents(framework.compileEvents(sheet));
    const implementationEvents = events.filter((event) => event.kind === "implementation");

    expect(singleFileAgentTools.map((tool) => tool.name)).not.toContain("read_file");
    expect(agentInputs[0].currentCode).toContain("function answer");
    expect(implementationEvents.map((event) => event.source)).toEqual([
      draft,
      final,
      final,
      final,
    ]);
  });

  it("strips top-level runnable calls returned by the file agent", async () => {
    const framework = new AgentCompilationFramework({
      fileAgent: async function* () {
        const source = `function main(): void {
  console.log("hello world");
}

main();`;
        yield { kind: "file", source };
        yield { kind: "done", source };
      },
    });
    const sheet = `function main(): void {
  l\`print hello world\`
}`;

    const code = await framework.compile(sheet);
    const run = await framework.run(sheet, "main");

    expect(code).toBe(`function main(): void {
  console.log("hello world");
}`);
    expect(run).toMatchObject({ ok: true, stdout: ["hello world"] });
  });

  it("marks source runnables ready when the file agent returns whole-file TypeScript", async () => {
    const implementation = `function main(): void {
  console.log("hello world");
}`;
    const framework = new AgentCompilationFramework({
      fileAgent: async function* () {
        yield { kind: "file", source: implementation };
        yield { kind: "done", source: implementation };
      },
    });
    const sheet = `function main(): void {
  l\`print hello world\`
}`;

    const events = await collectEvents(framework.compileEvents(sheet));
    const readiness = events.filter((event) => event.kind === "readiness").at(-1);

    expect(readiness).toMatchObject({
      kind: "readiness",
      definitions: [{
        name: "main",
        ready: true,
        dependencies: [],
        blockingDependencies: [],
      }],
    });
  });

  it("does not reuse cached or remembered implementations after clear", async () => {
    const cache: CodeCache = new Map();
    const agentInputs: SingleFileAgentInput[] = [];
    const agentOutputs = [
      `function test(): void {
  console.log("first");
}`,
      `function test(): void {
  console.log("second");
}`,
    ];
    const framework = new AgentCompilationFramework({
      cache,
      fileAgent: async function* (input) {
        agentInputs.push(input);
        const source = agentOutputs[agentInputs.length - 1] ?? agentOutputs.at(-1) ?? "";
        yield { kind: "file", source };
        yield { kind: "done", source };
      },
    });
    const sheet = `function test(): void {
  console.log("hello");
}`;

    await expect(framework.compile(sheet)).resolves.toContain("first");
    cache.clear();
    framework.clear();
    await expect(framework.compile(sheet)).resolves.toContain("second");

    expect(agentInputs).toHaveLength(2);
    expect(agentInputs[1]).toMatchObject({
      nextSheet: sheet,
      previousSheet: undefined,
    });
  });

  it("describes replace_file as an exceptional tool, not the default edit path", () => {
    const replaceFile = singleFileAgentTools.find((tool) => tool.name === "replace_file");
    const replaceRange = singleFileAgentTools.find((tool) => tool.name === "replace_range");

    expect(singleFileAgentTools.map((tool) => tool.name)).toEqual([
      "replace_range",
      "replace_text",
      "replace_file",
      "finish",
    ]);
    expect(replaceFile?.description).toContain("Use this only when the current file is mostly obsolete");
    expect(replaceFile?.description).toContain("Do not use this for normal first-pass codegen from a scaffold");
    expect(replaceRange?.description).toContain("including first-pass implementation from a scaffold");
  });

  it("detects invalid TypeScript before accepting a single-file agent finish", () => {
    const invalidSplice = `class TodoList {
  delete(todoId: string): void {
function todo_app(): ReactApp {
  return React.createElement("div", null, "broken");
}
}`;

    expect(singleFileAgentTypeScriptSyntaxErrors(invalidSplice).join("\n")).toContain("'}' expected");
    expect(singleFileAgentTypeScriptSyntaxErrors(`function todo_app(): ReactApp {
  return React.createElement("div", null, "ok");
}`)).toEqual([]);
  });
});

function recordAndReturn(
  inputs: SingleFileAgentInput[],
  source: string,
): SingleFileAgentFunction {
  return async function* (input) {
    inputs.push(input);
    yield { kind: "file", source };
    yield { kind: "done", source };
  };
}

async function collectEvents(events: AsyncIterable<CompilationEvent>): Promise<CompilationEvent[]> {
  const collected: CompilationEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
