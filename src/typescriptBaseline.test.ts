import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, runnables } from "./codeSheet";
import { defaultProjectIds, sampleEvalCases, samples, sampleTemplateGroups } from "./samples";
import {
  buildTypeScriptModule,
  buildTypeScriptProgram,
  compileCodeSheetToTypeScript,
  runTypeScript,
  transpileTypeScript,
} from "./typescriptTarget";

const shadcnCounterSheet = `fn main() -> WebPage:
  \`\`\`
  a counter than increments when you click it
  \`\`\``;

const shadcnCounterBody = `const incrementScript = "window.incrementCounter = () => { const el = document.getElementById('count'); if (!el) return; el.textContent = String(Number(el.textContent || '0') + 1); };";
return shadcn.renderApp(shadcn.Page({ title: "Hello shadcn", description: "Counter demo" }, shadcn.Card({}, shadcn.CardHeader({}, shadcn.CardTitle({}, "Counter"), shadcn.CardDescription({}, "Click the button to increment the value.")), shadcn.CardContent({}, shadcn.Stack({}, shadcn.Metric({ id: "count" }, "0"), shadcn.Button({ id: "increment", onClick: "window.incrementCounter()" }, "Increment"))))), { title: "Hello shadcn Counter", scripts: [incrementScript] });`;

describe("Logos-TS compiler shape", () => {
  it("keeps the migrated baseline files as the product contract", () => {
    expect(defaultProjectIds).toEqual([
      "starter-arithmetic",
      "beyond-basics",
      "formula-spreadsheet",
      "annotated-maze",
    ]);
    expect(samples.map((sample) => sample.id)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
    expect(sampleTemplateGroups.flatMap((group) => group.sampleIds)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
    expect(sampleEvalCases.map((testCase) => testCase.sampleId)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
  });

  it("discovers the runnable for each baseline file", () => {
    for (const testCase of sampleEvalCases) {
      expect(runnables(testCase.sheet), testCase.name).toEqual([
        { line: expect.any(Number), name: testCase.runnable },
      ]);
    }
  });

  it("keeps class-based samples in TypeScript-shaped class syntax", () => {
    for (const sampleId of ["beyond-basics", "formula-spreadsheet", "annotated-maze", "portfolio-viewer"]) {
      const sample = samples.find((item) => item.id === sampleId);
      expect(sample, sampleId).toBeDefined();
      if (!sample) continue;
      expect(sample.code, sampleId).toMatch(/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/);
      expect(sample.code, sampleId).not.toMatch(/^class\s+[A-Za-z_][A-Za-z0-9_]*\s*:/m);
      expect(sample.code, sampleId).not.toMatch(/\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*self\b/);
    }
  });

  it("discovers class snippets that need implementation", () => {
    const sample = samples.find((item) => item.id === "beyond-basics");
    expect(sample).toBeDefined();
    if (!sample) return;

    const snippets = parse(sample.code).incompleteSnippets;
    expect(snippets.some((snippet) => snippet.kind === "class" && snippet.snippet.includes("class MagicSquare"))).toBe(true);
  });

  it("lowers completed Logos-TS to executable TypeScript and captures HTML artifacts", async () => {
    const completed = `type App = WebPage

function main(): App {
  return "<!doctype html><html><body><h1>Hello App</h1></body></html>";
}`;
    const module = buildTypeScriptModule(completed);
    const program = buildTypeScriptProgram(completed, "main");
    expect(() => transpileTypeScript(module)).not.toThrow();
    expect(() => transpileTypeScript(program)).not.toThrow();

    const result = await runTypeScript(program);
    expect(result.ok).toBe(true);
    expect(result.artifacts).toEqual([
      { kind: "html", content: "<!doctype html><html><body><h1>Hello App</h1></body></html>" },
    ]);
    expect(result.stdout.trim()).toBe("");
  });

  it("compiles a WebPage natural prompt to code that uses the baked shadcn runtime", async () => {
    let prompt = "";
    const compiled = await compileCodeSheetToTypeScript(shadcnCounterSheet, "main", {
      cache: new Map(),
      complete: (nextPrompt) => {
        prompt = nextPrompt;
        return shadcnCounterBody;
      },
    });

    expect(prompt).toContain("global shadcn helper object");
    expect(prompt).toContain("shadcn.renderApp");
    expect(compiled.completed.source).toContain("const shadcn =");
    expect(compiled.completed.source).toContain("shadcn.renderApp");
    expect(compiled.program).toContain("shadcn.Button");
    expect(() => transpileTypeScript(compiled.program)).not.toThrow();
  });

  it("runs hard-coded shadcn app code to an interactive HTML artifact", async () => {
    const program = buildTypeScriptProgram(`fn main() -> WebPage:
${shadcnCounterBody.split("\n").map((line) => `  ${line}`).join("\n")}`, "main");

    const result = await runTypeScript(program);

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].content).toContain("data-shadcn-runtime");
    expect(result.artifacts[0].content).toContain("Hello shadcn");
    expect(result.artifacts[0].content).toContain("window.incrementCounter");
    expect(result.artifacts[0].content).toContain('id="increment"');
  });

  it("keeps sample-specific knowledge out of the production TypeScript target", () => {
    const source = readFileSync(new URL("./typescriptTarget.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "MagicSquare",
      "Spreadsheet",
      "Maze",
      "Portfolio",
      "NVDA",
      "CVNA",
      "portfolioReadout",
      "magicSquare",
      "spreadsheetRuntime",
      "mazeRuntime",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
