import { describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import { singleFileAgentTools } from "./claudeSingleFileAgent";
import type { CodeCache, CompilationEvent } from "./codeSheet";
import type { SingleFileAgentFunction, SingleFileAgentInput } from "./claudeSingleFileAgent";

describe("AgentCompilationFramework single-file agent evals", () => {
  it("compiles and runs end-to-end through the single-file agent", async () => {
    const cache: CodeCache = new Map();
    const agentInputs: SingleFileAgentInput[] = [];
    const compiled = `def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1, 2))`;
    const framework = new AgentCompilationFramework({
      cache,
      fileAgent: recordAndReturn(agentInputs, compiled),
    });
    const sheet = `def add(x: int, y: int) -> int

def test():
  print(add(1, 2))`;

    const events = await collectEvents(framework.compileEvents(sheet));
    const run = await framework.run(sheet, "test");

    expect(events.at(-1)?.kind).toBe("compiled");
    expect(run).toMatchObject({ ok: true, stdout: ["3"] });
    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0].nextSheet).toBe(sheet);
    expect(agentInputs[0].currentCode).toContain("def add");
    await expect(framework.cache(sheet)).resolves.toBe(compiled);
  });

  it("uses the update agent for a minor numeric edit with previous code and diff", async () => {
    const agentInputs: SingleFileAgentInput[] = [];
    const firstCode = `def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1, 5))`;
    const updatedCode = firstCode.replace("add(1, 5)", "add(1, 6)");
    const framework = new AgentCompilationFramework({
      fileAgent: async function* (input) {
        agentInputs.push(input);
        const source = input.diffFromPrevious ? updatedCode : firstCode;
        yield { kind: "file", source };
        yield { kind: "done", source };
      },
    });
    const sheet = `def add(x: int, y: int) -> int

def test():
  print(add(1, 5))`;
    const nextSheet = sheet.replace("add(1, 5)", "add(1, 6)");

    const first = await framework.update("intro-to-logos", sheet, "");
    const updated = await framework.update(
      "intro-to-logos",
      nextSheet,
      "-  print(add(1, 5))\n+  print(add(1, 6))",
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
      diffFromPrevious: "-  print(add(1, 5))\n+  print(add(1, 6))",
    });
  });

  it("streams draft implementation updates and exposes no read-file tool", async () => {
    const agentInputs: SingleFileAgentInput[] = [];
    const draft = `def answer() -> int:
  return 41`;
    const final = draft.replace("41", "42");
    const framework = new AgentCompilationFramework({
      fileAgent: async function* (input) {
        agentInputs.push(input);
        yield { kind: "file", source: draft };
        yield { kind: "file", source: final };
        yield { kind: "done", source: final };
      },
    });
    const sheet = `def answer() -> int`;

    const events = await collectEvents(framework.compileEvents(sheet));
    const implementationEvents = events.filter((event) => event.kind === "implementation");

    expect(singleFileAgentTools.map((tool) => tool.name)).not.toContain("read_file");
    expect(agentInputs[0].currentCode).toContain("def answer");
    expect(implementationEvents.map((event) => event.source)).toEqual([
      draft,
      final,
      final,
      final,
    ]);
  });

  it("does not reuse cached or remembered implementations after clear", async () => {
    const cache: CodeCache = new Map();
    const agentInputs: SingleFileAgentInput[] = [];
    const agentOutputs = [
      `def test():
  print("first")`,
      `def test():
  print("second")`,
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
    const sheet = `def test():
  print("hello")`;

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
