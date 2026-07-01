import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compile,
  hashCompletionInput,
  parse,
  runnables,
  type CodeCache,
  type CompilationEvent,
  type CompleteFunction,
} from "./codeSheet";
import { checkCode, checkWebPageHtml, generateCode } from "./codegenQualityChecks";
import { seedSampleCodeCache } from "./sampleCodeCacheSeed";
import { defaultProjectIds, sampleAppEvalCases, sampleEvalCases, samples, sampleTemplateGroups } from "./samples";
import {
  buildTypeScriptModule,
  buildTypeScriptProgram,
  compileCodeSheetToTypeScript,
  runTypeScript,
  transpileTypeScript,
} from "./typescriptTarget";

const shadcnCounterSheet = `function main(): WebPage {
  \`\`\`
  a counter than increments when you click it
  \`\`\`
}`;

const shadcnCounterBody = `const incrementScript = "window.incrementCounter = () => { const el = document.getElementById('count'); if (!el) return; el.textContent = String(Number(el.textContent || '0') + 1); };";
return shadcn.renderApp(
  shadcn.Page({ title: "Hello shadcn", description: "Counter demo" },
    shadcn.Card(
      shadcn.CardHeader(
        shadcn.CardTitle("Counter"),
        shadcn.CardDescription("Click the button to increment the value."),
      ),
      shadcn.CardContent(
        shadcn.Stack(
          shadcn.Metric({ id: "count" }, "0"),
          shadcn.Button({ id: "increment", onClick: "window.incrementCounter()" }, "Increment"),
        ),
      ),
    ),
  ),
  { title: "Hello shadcn Counter", scripts: [incrementScript] },
);`;

const borkedCounterBody = `const counterId = "counter-value";

const counterScript = shadcn.Script(\`
  var count = 0;
  function increment() {
    count++;
    document.getElementById('\${counterId}').textContent = count;
  }
\`);

const metricDisplay = shadcn.Metric("Count", \`<span id="\${counterId}">0</span>\`);

const incrementButton = shadcn.Button("Increment", "increment()");

const card = shadcn.Card(
  shadcn.CardHeader(
    shadcn.CardTitle("Counter"),
    shadcn.CardDescription("A counter that starts at 0 and increments each time the button is clicked.")
  ),
  shadcn.CardContent(
    shadcn.Stack(
      metricDisplay,
      incrementButton
    )
  )
);

const page = shadcn.Page("Counter Button", card, counterScript);

return shadcn.renderApp(page);`;

async function collectCompileEvents(
  cache: CodeCache,
  sheet: string,
  complete: CompleteFunction,
): Promise<CompilationEvent[]> {
  const events: CompilationEvent[] = [];
  for await (const event of compile(cache, sheet, complete)) {
    events.push(event);
  }
  return events;
}

describe("Logos-TS compiler shape", () => {
  it("uses the counter app as the base project and keeps migrated files as eval targets", () => {
    const evalProjectIds = [
      "starter-arithmetic",
      "beyond-basics",
      "formula-spreadsheet",
      "annotated-maze",
      "portfolio-viewer",
    ];
    const appEvalProjectIds = ["sudoku-human-viewer"];

    expect(defaultProjectIds).toEqual(["counter-button", "sudoku-human-viewer"]);
    expect(samples.map((sample) => sample.id)).toEqual(["counter-button", ...evalProjectIds, ...appEvalProjectIds]);
    expect(sampleTemplateGroups.flatMap((group) => group.sampleIds)).toEqual(samples.map((sample) => sample.id));
    expect(sampleEvalCases.map((testCase) => testCase.sampleId)).toEqual(evalProjectIds);
    expect(sampleAppEvalCases.map((testCase) => testCase.sampleId)).toEqual(appEvalProjectIds);
  });

  it("discovers the runnable for each baseline file", () => {
    for (const testCase of sampleEvalCases) {
      expect(runnables(testCase.sheet), testCase.name).toEqual([
        { line: expect.any(Number), name: testCase.runnable },
      ]);
    }
    for (const testCase of sampleAppEvalCases) {
      expect(runnables(testCase.sheet), testCase.name).toEqual([
        { line: expect.any(Number), name: testCase.runnable },
      ]);
    }
  });

  it("keeps class-based samples in TypeScript-shaped class syntax", () => {
    for (const sampleId of ["beyond-basics", "formula-spreadsheet", "annotated-maze", "portfolio-viewer", "sudoku-human-viewer"]) {
      const sample = samples.find((item) => item.id === sampleId);
      expect(sample, sampleId).toBeDefined();
      if (!sample) continue;
      expect(sample.code, sampleId).toMatch(/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/);
      expect(sample.code, sampleId).not.toMatch(/^class\s+[A-Za-z_][A-Za-z0-9_]*\s*:/m);
      expect(sample.code, sampleId).not.toMatch(/\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*self\b/);
    }
  });

  it("keeps baseline samples on TypeScript-native function syntax", () => {
    for (const sample of samples) {
      expect(sample.code, sample.id).not.toMatch(/^\s*(?:fn|def)\s+/m);
      expect(sample.code, sample.id).not.toMatch(/^\s*function\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*$/m);
      expect(sample.code, sample.id).not.toMatch(/^\s*(?:fn|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*->/m);
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
    expect(prompt).toContain('shadcn.Button({ onClick: "window.someHandler()" }, "Label")');
    expect(prompt).toContain('Do not put JavaScript handlers in button text');
    expect(compiled.completed.source).toContain("const shadcn =");
    expect(compiled.completed.source).toContain("shadcn.renderApp");
    expect(compiled.program).toContain("shadcn.Button");
    expect(() => transpileTypeScript(compiled.program)).not.toThrow();
  });

  it("keeps function completion hashes stable when only runnable bodies change", () => {
    const base = `type Value = number;

function add(x: Value, y: Value): Value;
function mul(x: Value, y: Value): Value;

function main(): void {
  console.log(add(1, 2));
}`;
    const changedRunnable = base.replace(
      "console.log(add(1, 2));",
      "console.log(add(1, 2));\n  console.log(mul(2, 3));",
    );
    const changedDependency = base.replace("type Value = number;", "type Value = string;");
    const baseParsed = parse(base);
    const changedRunnableParsed = parse(changedRunnable);
    const changedDependencyParsed = parse(changedDependency);
    const addSnippet = baseParsed.incompleteSnippets.find((snippet) => snippet.snippet.startsWith("function add"))?.snippet;
    expect(addSnippet).toBeDefined();
    if (!addSnippet) return;

    expect(hashCompletionInput(baseParsed, addSnippet)).toBe(hashCompletionInput(changedRunnableParsed, addSnippet));
    expect(hashCompletionInput(baseParsed, addSnippet)).not.toBe(hashCompletionInput(changedDependencyParsed, addSnippet));
  });

  it("reuses cached function completions when only the runnable body changes", async () => {
    const base = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log(add(1, 2));
}`;
    const changedRunnable = base.replace(
      "console.log(add(1, 2));",
      "console.log(add(1, 2));\n  console.log(mul(2, 3));",
    );
    const cache: CodeCache = new Map();
    const firstEvents = await collectCompileEvents(cache, base, (prompt) => {
      if (prompt.includes("function add")) {
        return "function add(x: number, y: number): number {\n  return x + y;\n}";
      }
      if (prompt.includes("function mul")) {
        return "function mul(x: number, y: number): number {\n  return x * y;\n}";
      }
      throw new Error(`Unexpected prompt: ${prompt}`);
    });
    const secondEvents = await collectCompileEvents(cache, changedRunnable, () => {
      throw new Error("unchanged function completions should come from cache");
    });

    expect(firstEvents.filter((event) => event.kind === "llm-complete")).toHaveLength(2);
    expect(secondEvents.filter((event) => event.kind === "cache-hit")).toHaveLength(2);
    expect(secondEvents.some((event) => event.kind === "llm-start")).toBe(false);
  });

  it("checks generated WebPage code with generic code quality gates", async () => {
    const generated = await generateCode(shadcnCounterSheet, "main", {
      cache: new Map(),
      complete: () => shadcnCounterBody,
    });

    expect(checkCode(generated.code, {
      expectedKind: "webpage",
      promptFragments: ["a counter than increments when you click it"],
      requiredSubstrings: ["shadcn.Button", "shadcn.renderApp"],
    })).toEqual({ ok: true, failures: [] });
  });

  it("rejects borked generated code before running it", () => {
    const result = checkCode("```ts\nconsole.log('a counter than increments when you click it')\n```", {
      promptFragments: ["a counter than increments when you click it"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "generated code still contains markdown fences",
      "generated code appears to echo prompt fragment: a counter than increments when you click it",
    ]));
  });

  it("rejects generated shadcn buttons that put handlers in text children", async () => {
    const generated = await generateCode(shadcnCounterSheet, "main", {
      cache: new Map(),
      complete: () => borkedCounterBody,
    });

    const result = checkCode(generated.code, {
      expectedKind: "webpage",
      requiredSubstrings: ["shadcn.Button"],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("generated WebPage code passes a string handler as Button text instead of an onClick prop");
  });

  it("seeds the base counter app as shadcn WebPage code", async () => {
    const sample = samples.find((item) => item.id === "counter-button");
    expect(sample).toBeDefined();
    if (!sample) return;

    const cache = new Map();
    await seedSampleCodeCache(cache);
    const compiled = await compileCodeSheetToTypeScript(sample.code, "main", {
      cache,
      complete: () => {
        throw new Error("counter base project should be seeded");
      },
    });

    expect(compiled.completed.source).toContain("shadcn.renderApp");
    expect(compiled.program).toContain("Counter Button");
    expect(() => transpileTypeScript(compiled.program)).not.toThrow();

    const result = await runTypeScript(compiled.program);
    expect(result.ok).toBe(true);
    expect(result.artifacts[0]?.content).toContain('id="increment"');
    expect(result.artifacts[0]?.content).toContain('id="count"');
  });

  it("seeds the human Sudoku viewer as a shadcn WebPage app", async () => {
    const testCase = sampleAppEvalCases.find((item) => item.sampleId === "sudoku-human-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const cache = new Map();
    await seedSampleCodeCache(cache);
    const compiled = await compileCodeSheetToTypeScript(testCase.sheet, testCase.runnable, {
      cache,
      complete: () => {
        throw new Error("sudoku app sample should be seeded");
      },
    });

    expect(compiled.completed.source).toContain("class SudokuState");
    expect(compiled.completed.source).toContain("function apply_strategy");
    expect(compiled.completed.source).toContain("shadcn.renderApp");
    expect(() => transpileTypeScript(compiled.program)).not.toThrow();

    const result = await runTypeScript(compiled.program);
    expect(result.ok).toBe(true);
    const html = result.artifacts.find((artifact) => artifact.kind === "html")?.content ?? "";
    expect(testCase.htmlCheck.matches(html)).toBe(true);
  });

  it("runs hard-coded shadcn app code to an interactive HTML artifact", async () => {
    const program = buildTypeScriptProgram(`function main(): WebPage {
${shadcnCounterBody.split("\n").map((line) => `  ${line}`).join("\n")}
}`, "main");

    const result = await runTypeScript(program);

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].content).toContain("data-shadcn-runtime");
    expect(result.artifacts[0].content).toContain("Hello shadcn");
    expect(result.artifacts[0].content).toContain("window.incrementCounter");
    expect(result.artifacts[0].content).toContain('id="increment"');
  });

  it("rejects webpages with object-string rendering artifacts", () => {
    const html = `<!doctype html><html><head><style data-shadcn-runtime="true"></style></head><body><button>[object Object]</button></body></html>`;

    const result = checkWebPageHtml(html);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("webpage html contains [object Object]");
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
      "SudokuState",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("does not seed sample completions in the server unless tests opt in", () => {
    const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^import\s+\{\s*seedSampleCodeCache\s*\}/m);
    expect(source).toContain('process.env.SEED_SAMPLE_CODE_CACHE === "true"');
    expect(source).toContain('await import("./sampleCodeCacheSeed")');
  });
});
