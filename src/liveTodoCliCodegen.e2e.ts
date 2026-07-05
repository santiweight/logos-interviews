import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import { runClaudeSingleFileAgent, type SingleFileAgentFunction } from "./claudeSingleFileAgent";
import {
  definitionReadinessFromImplementation,
  parse,
  type CodeCache,
  type CodeSheet,
} from "./codeSheet";
import todoCliWorksheet from "../todo-cli.logos.ts?raw";

const codegenModel = process.env.ANTHROPIC_CODEGEN_MODEL
  ?? process.env.ANTHROPIC_E2E_MODEL
  ?? "claude-opus-4-8";

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.LOGOS_ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("live Todo ReactApp codegen eval", () => {
  it("runs the root Todo ReactApp worksheet through Claude four times", async () => {
    const attempts = 4;
    const results = await Promise.all(Array.from({ length: attempts }, (_, index) => {
      return runTodoCliCodegenAttempt(index + 1);
    }));
    const failures = results.flatMap((result) => result.ok ? [] : [result.message]);

    expect(failures).toEqual([]);
  }, 900_000);
});

async function runTodoCliCodegenAttempt(attempt: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const cache: CodeCache = new Map();
  const events: string[] = [];
  const fileAgent: SingleFileAgentFunction = async function* (input, options) {
        for await (const event of runClaudeSingleFileAgent(input, {
          ...options,
          model: codegenModel,
          maxTurns: 6,
        })) {
      if (event.kind === "tool") {
        events.push(event.name);
      }
      yield event;
    }
  };
  const framework = new AgentCompilationFramework({ cache, fileAgent });

  try {
    const implementation = await framework.compile(todoCliWorksheet);
    assertTodoCliImplementation(implementation);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: [
        `Attempt ${attempt} failed using ${codegenModel}.`,
        `Agent tools: ${events.join(", ") || "(none)"}.`,
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
    };
  }
}

function assertTodoCliImplementation(implementation: CodeSheet): void {
  expect(implementation).not.toContain("neo-blessed");
  expect(implementation).not.toContain("blessed.");
  expect(implementation).not.toMatch(/return\s+[`'"]/);
  expect(implementation).toContain("React.createElement");
  expect(implementation).toMatch(/\bReact\.useState\b/);
  expect(implementation).not.toContain("l`");
  expect(implementation).not.toMatch(/^\s*(?:(?:void|await)\s+)?(?:todo_app|main)\(\);?\s*$/m);

  const readiness = definitionReadinessFromImplementation(parse(todoCliWorksheet), implementation);
  expect(readiness).toContainEqual(expect.objectContaining({
    name: "todo_app",
    ready: true,
    blockingDependencies: [],
  }));

  expectSyntaxOnlyTranspileToPass(implementation);
}

function expectSyntaxOnlyTranspileToPass(source: CodeSheet): void {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

  expect(errors, source.slice(0, 2000)).toEqual([]);
}
