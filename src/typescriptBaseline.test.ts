import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compile,
  buildCompletionPrompt,
  dependencyGraphForCodeSheet,
  definitionReadiness,
  hashCompletionInput,
  parse,
  runnables,
  type CodeCache,
  type CompilationEvent,
  type CompilationStrategy,
  type CompleteFunction,
} from "./codeSheet";
import { checkCode, checkWebPageHtml, generateCode } from "./codegenQualityChecks";
import { runCodeSheet } from "./codeSheetRunner";
import { anthropicMaxTokens, throwIfMaxTokensStop } from "./anthropicComplete";
import { seedSampleCodeCache } from "./sampleCodeCacheSeed";
import { defaultProjectIds, sampleAppEvalCases, sampleEvalCases, sampleReactAppEvalCases, samples, sampleTemplateGroups } from "./samples";
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

const reactSudokuComponentSheet = sampleReactAppEvalCases.find((testCase) => testCase.sampleId === "react-sudoku-components")?.sheet ?? "";

function requestedCompletionSnippet(prompt: string): string {
  return prompt.split("Your job is to finish the implementation of:").at(-1) ?? prompt;
}

function requestedCompletionName(prompt: string): string {
  return requestedCompletionSnippet(prompt).match(/function\s+([A-Za-z_][A-Za-z0-9_]*)\b/)?.[1] ?? "unknown";
}

function reactSudokuCompletion(prompt: string): string {
  const target = requestedCompletionSnippet(prompt);
  if (target.includes("function test_sudoku")) {
    return `function test_sudoku(): SudokuState {
  const state = new SudokuState();
  const puzzle = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ];
  state.grid = puzzle.map((row) => row.map((value): CellState => {
    return value === 0 ? { kind: "Annotations", values: [] } : { kind: "Solved", value };
  }));
  return state;
}`;
  }
  if (target.includes("function sudoku_cell")) {
    return `function sudoku_cell(cell: CellState, row: number, col: number): ReactComponent {
  const label = cell.kind === "Solved" ? String(cell.value) : cell.values.join(" ");
  return React.createElement(
    "button",
    { "data-row": row, "data-col": col, className: "sudoku-cell" },
    label,
  );
}`;
  }
  if (target.includes("function sudoku_board")) {
    expect(prompt).toContain("// Renders and supports clicking of sudoku_cell instances and registering of fills/notes");
    expect(prompt).toContain("function sudoku_cell(cell: CellState, row: number, col: number): ReactComponent {");
    return `function sudoku_board(state: SudokuState): ReactComponent {
  return React.createElement(function SudokuBoard() {
    const [selectedCell, setSelectedCell] = React.useState<string | null>(null);
    const cells = state.grid.flatMap((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const key = rowIndex + "-" + colIndex;
        return React.createElement(
          "div",
          {
            key,
            "data-selected": selectedCell === key ? "true" : "false",
            onClick: () => setSelectedCell(key),
          },
          sudoku_cell(cell, rowIndex, colIndex),
        );
      })
    );
    return React.createElement(
      "section",
      { "data-testid": "sudoku-board" },
      React.createElement("div", { className: "sudoku-grid" }, cells),
      React.createElement("output", {}, selectedCell ?? "none"),
    );
  });
}`;
  }
  if (target.includes("function sudoku_controls")) {
    return `function sudoku_controls(): ReactComponent {
  return React.createElement(function SudokuControls() {
    const [mode, setMode] = React.useState<"fill" | "notes">("fill");
    return React.createElement(
      "button",
      { onClick: () => setMode(mode === "fill" ? "notes" : "fill") },
      "Mode: " + mode,
    );
  });
}`;
  }
  if (target.includes("function sudoku_app")) {
    expect(prompt).toContain("function sudoku_board(state: SudokuState): ReactComponent {");
    expect(prompt).toContain("function sudoku_controls(): ReactComponent {");
    return `function sudoku_app(initial_state: SudokuState): ReactApp {
  return React.createElement(function SudokuApp() {
    const [state] = React.useState(initial_state);
    return React.createElement(
      "main",
      { className: "sudoku-app" },
      React.createElement("aside", {}, sudoku_controls()),
      React.createElement("section", {}, sudoku_board(state)),
    );
  });
}`;
  }
  throw new Error(`Unexpected React Sudoku prompt: ${prompt}`);
}

async function collectCompileEvents(
  cache: CodeCache,
  sheet: string,
  complete: CompleteFunction,
  strategy: CompilationStrategy = "sequential",
): Promise<CompilationEvent[]> {
  const events: CompilationEvent[] = [];
  for await (const event of compile(cache, sheet, complete, { strategy })) {
    events.push(event);
  }
  return events;
}

async function eventually(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

function completionTargetName(prompt: string): "add" | "mul" {
  const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? prompt;
  return target.includes("function mul") ? "mul" : "add";
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
    const baseProjectIds = ["counter-button", "react-sudoku-components"];
    const appEvalProjectIds = ["sudoku-human-viewer"];
    const reactAppEvalProjectIds = ["react-sudoku-components"];

    expect(defaultProjectIds).toEqual([...baseProjectIds, "sudoku-human-viewer"]);
    expect(samples.map((sample) => sample.id)).toEqual([...baseProjectIds, ...evalProjectIds, ...appEvalProjectIds]);
    expect(sampleTemplateGroups.flatMap((group) => group.sampleIds)).toEqual(samples.map((sample) => sample.id));
    expect(sampleEvalCases.map((testCase) => testCase.sampleId)).toEqual(evalProjectIds);
    expect(sampleAppEvalCases.map((testCase) => testCase.sampleId)).toEqual(appEvalProjectIds);
    expect(sampleReactAppEvalCases.map((testCase) => testCase.sampleId)).toEqual(reactAppEvalProjectIds);
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
    for (const testCase of sampleReactAppEvalCases) {
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

  it("uses TypeScript double-slash comments in baseline samples", () => {
    for (const sample of samples) {
      expect(sample.code, sample.id).not.toMatch(/^\s*#/m);
    }
    expect(samples.some((sample) => /^\s*\/\//m.test(sample.code))).toBe(true);
  });

  it("parses and lowers double-slash comments without hash-comment support", () => {
    const sheet = `// File comment
type App = WebPage;

function main(): App {
  // Function comment
  return "<!doctype html><html><body>ok</body></html>";
}`;
    const parsed = parse(sheet);
    const module = buildTypeScriptModule(sheet);

    expect(parsed.topLevelComments).toEqual(["// File comment"]);
    expect(module).toContain("// Function comment");
    expect(() => transpileTypeScript(module)).not.toThrow();
  });

  it("models runnable readiness through TypeScript incomplete definitions and snippets", async () => {
    const cache: CodeCache = new Map();
    const sheet = `function add(x: number, y: number): number;

function test(): void {
  console.log(add(1, 2));
}`;
    const parsed = parse(sheet);

    expect(definitionReadiness(parsed, cache)).toEqual([
      {
        name: "add",
        line: 1,
        kind: "function",
        ready: false,
        reason: "implementation",
        dependencies: [],
        blockingDependencies: [],
      },
      {
        name: "test",
        line: 3,
        kind: "function",
        ready: false,
        reason: "dependency",
        dependencies: ["add"],
        blockingDependencies: ["add"],
      },
    ]);

    await collectCompileEvents(cache, sheet, () => `function add(x: number, y: number): number {
  return x + y;
}`);

    expect(definitionReadiness(parsed, cache)).toEqual([
      {
        name: "add",
        line: 1,
        kind: "function",
        ready: true,
        dependencies: [],
        blockingDependencies: [],
      },
      {
        name: "test",
        line: 3,
        kind: "function",
        ready: true,
        dependencies: ["add"],
        blockingDependencies: [],
      },
    ]);

    const naturalCache: CodeCache = new Map();
    const naturalSheet = `function main(): WebPage {
  \`\`\`
  render a small status page
  \`\`\`
}`;
    const naturalParsed = parse(naturalSheet);
    expect(definitionReadiness(naturalParsed, naturalCache)).toEqual([
      {
        name: "main",
        line: 1,
        kind: "function",
        ready: false,
        reason: "implementation",
        dependencies: [],
        blockingDependencies: [],
      },
    ]);

    await collectCompileEvents(naturalCache, naturalSheet, () => `return "<!doctype html><html><body>Status ready</body></html>";`);

    expect(definitionReadiness(naturalParsed, naturalCache)).toEqual([
      {
        name: "main",
        line: 1,
        kind: "function",
        ready: true,
        dependencies: [],
        blockingDependencies: [],
      },
    ]);
  });

  it("emits multiline TypeScript type aliases with variant comments", () => {
    const sheet = `type SudokuStrategy =
  // A box has a number that can only go in one cell.
  "UniqueBoxSolve" |
  // A line has a number that can only appear in one cell.
  "UniqueLineSolve" |
  "HiddenSingle";

type CellUpdate =
  { kind: "Remove Notes"; values: number[] } |
  { kind: "Add Note"; values: number[] } |
  { kind: "Fill Square"; value: number }

type App = WebPage;

function update_for(strategy: SudokuStrategy): CellUpdate {
  return strategy === "HiddenSingle"
    ? { kind: "Fill Square", value: 1 }
    : { kind: "Add Note", values: [1] };
}

function main(): App {
  const update: CellUpdate = update_for("UniqueBoxSolve");
  return "<!doctype html><html><body>" + update.kind + "</body></html>";
}`;
    const module = buildTypeScriptModule(sheet);

    expect(module).toContain('type SudokuStrategy = "UniqueBoxSolve" | "UniqueLineSolve" | "HiddenSingle";');
    expect(module).toContain('type CellUpdate = { kind: "Remove Notes"; values: number[] } | { kind: "Add Note"; values: number[] } | { kind: "Fill Square"; value: number };');
    expect(() => transpileTypeScript(module)).not.toThrow();
  });

  it("uses attached comments as dependency contract for function completion hashes", () => {
    const parsed = parse(reactSudokuComponentSheet);
    const boardSnippet = parsed.incompleteSnippets.find((snippet) => snippet.snippet.startsWith("function sudoku_board"))?.snippet;
    expect(boardSnippet).toBeDefined();
    if (!boardSnippet) return;

    const baseHash = hashCompletionInput(parsed, boardSnippet);
    const changedAttachedComment = reactSudokuComponentSheet.replace(
      "registering of fills/notes",
      "registering of selected cells",
    );
    const changedCellContract = reactSudokuComponentSheet.replace(
      "function sudoku_cell(cell: CellState, row: number, col: number): ReactComponent;",
      "function sudoku_cell(cell: CellState, row: number, col: number, selected: boolean): ReactComponent;",
    );

    expect(hashCompletionInput(parse(changedAttachedComment), boardSnippet)).not.toBe(baseHash);
    expect(hashCompletionInput(parse(changedCellContract), boardSnippet)).not.toBe(baseHash);
  });

  it("builds a dependency graph for the Sudoku ReactComponent stub", () => {
    const graph = dependencyGraphForCodeSheet(reactSudokuComponentSheet);
    const node = (name: string) => graph.nodes.find((item) => item.name === name);

    expect(node("sudoku_board")?.dependencies).toEqual(expect.arrayContaining([
      "sudoku_cell",
      "SudokuState",
    ]));
    expect(node("sudoku_app")?.dependencies).toEqual(expect.arrayContaining([
      "SudokuState",
      "sudoku_board",
      "sudoku_controls",
    ]));
    expect(node("main")?.dependencies).toEqual(expect.arrayContaining([
      "sudoku_app",
      "test_sudoku",
    ]));
    expect(node("main")?.transitiveDependencies).toEqual(expect.arrayContaining([
      "sudoku_app",
      "test_sudoku",
      "sudoku_board",
      "sudoku_controls",
      "sudoku_cell",
      "SudokuState",
      "CellState",
    ]));
  });

  it("models Sudoku ReactComponent readiness from incomplete dependency cache state", async () => {
    const parsed = parse(reactSudokuComponentSheet);
    const cache: CodeCache = new Map();
    const readiness = definitionReadiness(parsed, cache);
    const byName = new Map(readiness.map((item) => [item.name, item]));

    expect(byName.get("sudoku_cell")).toMatchObject({
      ready: false,
      reason: "implementation",
      blockingDependencies: [],
    });
    expect(byName.get("sudoku_board")).toMatchObject({
      ready: false,
      reason: "implementation",
      dependencies: expect.arrayContaining(["sudoku_cell"]),
      blockingDependencies: [],
    });
    expect(byName.get("main")).toMatchObject({
      ready: false,
      reason: "dependency",
      dependencies: expect.arrayContaining(["sudoku_app", "test_sudoku"]),
      blockingDependencies: expect.arrayContaining(["sudoku_app", "test_sudoku"]),
    });

    await compileCodeSheetToTypeScript(reactSudokuComponentSheet, "main", {
      cache,
      complete: reactSudokuCompletion,
      strategy: "parallel",
    });

    const completedByName = new Map(definitionReadiness(parsed, cache).map((item) => [item.name, item]));
    expect(completedByName.get("main")).toMatchObject({
      ready: true,
      blockingDependencies: [],
    });
  });

  it("compiles the Sudoku ReactComponent contract to a hosted React app program", async () => {
    const testCase = sampleReactAppEvalCases.find((item) => item.sampleId === "react-sudoku-components");
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const starts: string[] = [];
    const compiled = await compileCodeSheetToTypeScript(testCase.sheet, testCase.runnable, {
      cache: new Map(),
      complete: (prompt) => {
        starts.push(requestedCompletionName(prompt));
        return reactSudokuCompletion(prompt);
      },
      strategy: "parallel",
    });

    expect(starts.indexOf("sudoku_cell")).toBeLessThan(starts.indexOf("sudoku_board"));
    expect(starts.indexOf("sudoku_board")).toBeLessThan(starts.indexOf("sudoku_app"));
    expect(starts.indexOf("sudoku_controls")).toBeLessThan(starts.indexOf("sudoku_app"));
    expect(parse(compiled.completed.lowered.parsed.source).incompleteSnippets.filter((snippet) => snippet.kind !== "natural")).toEqual([]);
    expect(compiled.completed.source).toContain("type ReactComponent = React.ReactElement");
    expect(compiled.completed.source).toContain("type ReactApp = ReactComponent");
    expect(compiled.completed.source).toContain("function sudoku_board");
    expect(compiled.completed.source).toContain("React.useState");
    expect(compiled.completed.source).toContain("sudoku_cell(cell, rowIndex, colIndex)");
    expect(() => transpileTypeScript(compiled.program)).not.toThrow();
    expect(compiled.program).toContain("logos-react-app-");
    expect(compiled.program).toContain('"iframe-url"');
    expect(compiled.program).toContain("createRoot(root).render(main())");
  });

  it("waits for dependency implementations before prompting dependent functions", async () => {
    const sheet = `function first(): number;

// Must call first.
function second(): number;

// Must call second.
function third(): number;

function main(): void {
  console.log(third());
}`;
    const starts: string[] = [];
    const prompts = new Map<string, string>();

    const compiled = await compileCodeSheetToTypeScript(sheet, "main", {
      cache: new Map(),
      complete: (prompt) => {
        const name = requestedCompletionName(prompt);
        starts.push(name);
        prompts.set(name, prompt);
        if (name === "first") {
          return `function first(): number {
  return 1;
}`;
        }
        if (name === "second") {
          expect(prompt).toContain(`function first(): number {
  return 1;
}`);
          return `function second(): number {
  return first() + 1;
}`;
        }
        if (name === "third") {
          expect(prompt).toContain(`function second(): number {
  return first() + 1;
}`);
          return `function third(): number {
  return second() + 1;
}`;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    });

    expect(starts).toEqual(["first", "second", "third"]);
    expect(prompts.get("second")).not.toContain("function first(): number;");
    expect(prompts.get("third")).not.toContain("function second(): number;");
    expect(compiled.completed.source).toContain("return second() + 1;");
  });

  it("does not reuse a dependent cached completion when a dependency implementation changes", async () => {
    const sheet = `function first(): number;

// Must call first.
function second(): number;

function main(): void {
  console.log(second());
}`;
    const cache: CodeCache = new Map();

    const first = await compileCodeSheetToTypeScript(sheet, "main", {
      cache,
      complete: (prompt) => {
        const name = requestedCompletionName(prompt);
        if (name === "first") {
          return `function first(): number {
  return 1;
}`;
        }
        if (name === "second") {
          expect(prompt).toContain("return 1;");
          return `function second(): number {
  return first() + 1;
}`;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    });
    expect(first.completed.source).toContain("return first() + 1;");

    const changedDependencySheet = sheet.replace(
      "function first(): number;",
      `function first(): number {
  return 10;
}`,
    );
    const secondStarts: string[] = [];
    const second = await compileCodeSheetToTypeScript(changedDependencySheet, "main", {
      cache,
      complete: (prompt) => {
        const name = requestedCompletionName(prompt);
        secondStarts.push(name);
        if (name === "second") {
          expect(prompt).toContain("return 10;");
          return `function second(): number {
  return first() + 10;
}`;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    });

    expect(secondStarts).toEqual(["second"]);
    expect(second.completed.source).toContain("return first() + 10;");
    expect(second.completed.source).not.toContain("return first() + 1;");
  });

  it("does not reuse a dependent cached completion when the cached dependency implementation changes", async () => {
    const sheet = `function first(): number;

// Must call first.
function second(): number;

function main(): void {
  console.log(second());
}`;
    const cache: CodeCache = new Map();

    const firstCompile = await compileCodeSheetToTypeScript(sheet, "main", {
      cache,
      complete: (prompt) => {
        const name = requestedCompletionName(prompt);
        if (name === "first") {
          return `function first(): number {
  return 1;
}`;
        }
        if (name === "second") {
          expect(prompt).toContain("return 1;");
          return `function second(): number {
  return first() + 1;
}`;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    });

    const firstCompletion = firstCompile.completed.completions.find((completion) => completion.snippet.startsWith("function first"));
    expect(firstCompletion).toBeDefined();
    if (!firstCompletion) return;
    cache.set(firstCompletion.hash, `function first(): number {
  return 10;
}`);

    const starts: string[] = [];
    const secondCompile = await compileCodeSheetToTypeScript(sheet, "main", {
      cache,
      complete: (prompt) => {
        const name = requestedCompletionName(prompt);
        starts.push(name);
        if (name === "second") {
          expect(prompt).toContain("return 10;");
          return `function second(): number {
  return first() + 10;
}`;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    });

    expect(starts).toEqual(["second"]);
    expect(secondCompile.completed.source).toContain("return first() + 10;");
    expect(secondCompile.completed.source).not.toContain("return first() + 1;");
  });

  it("rejects completed code sheets that still contain unimplemented stubs", async () => {
    await expect(compileCodeSheetToTypeScript(`function helper(): number;

function main(): void {
  console.log(helper());
}`, "main", {
      cache: new Map(),
      complete: (prompt) => {
        const target = requestedCompletionSnippet(prompt);
        if (target.includes("function helper")) {
          return "function helper(): number;";
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
      strategy: "parallel",
    })).rejects.toThrow(/Completion for requested snippet left incomplete Logos stubs: function helper\(\): number;/);
  });

  it("retries a completion that returns an unimplemented declaration stub", async () => {
    let calls = 0;
    const compiled = await compileCodeSheetToTypeScript(`function helper(): number;

function main(): void {
  console.log(helper());
}`, "main", {
      cache: new Map(),
      complete: (prompt) => {
        expect(requestedCompletionSnippet(prompt)).toContain("function helper");
        calls += 1;
        return calls === 1
          ? "function helper(): number;"
          : `function helper(): number {
  return 42;
}`;
      },
      strategy: "parallel",
    });

    expect(calls).toBe(2);
    expect(compiled.completed.source).toContain("return 42;");
    expect(parse(compiled.completed.lowered.parsed.source).incompleteSnippets.filter((snippet) => snippet.kind !== "natural")).toEqual([]);
  });

  it("invalidates cached declaration stubs before compiling dependent React components", async () => {
    const parsed = parse(reactSudokuComponentSheet);
    const cellSnippet = parsed.incompleteSnippets.find((snippet) => snippet.snippet.startsWith("function sudoku_cell"));
    expect(cellSnippet).toBeDefined();
    if (!cellSnippet) return;

    const cache: CodeCache = new Map();
    cache.set(
      hashCompletionInput(parsed, cellSnippet.snippet, cellSnippet.annotationContexts),
      "function sudoku_cell(cell: CellState, row: number, col: number): ReactComponent;",
    );

    const starts: string[] = [];
    const compiled = await compileCodeSheetToTypeScript(reactSudokuComponentSheet, "main", {
      cache,
      complete: (prompt) => {
        starts.push(requestedCompletionName(prompt));
        return reactSudokuCompletion(prompt);
      },
      strategy: "parallel",
    });

    expect(starts).toContain("sudoku_cell");
    expect(compiled.completed.source).toContain("function sudoku_cell(cell: CellState, row: number, col: number): ReactComponent {");
    expect(compiled.completed.source).toContain("function sudoku_controls(): ReactComponent {");
    expect(parse(compiled.completed.lowered.parsed.source).incompleteSnippets.filter((snippet) => snippet.kind !== "natural")).toEqual([]);
  });

  it("treats App aliases to ReactApp as hosted React apps", () => {
    const program = buildTypeScriptProgram(`type App = ReactApp;

function main(): App {
  return React.createElement("main", {}, "Hello React");
}`, "main");

    expect(() => transpileTypeScript(program)).not.toThrow();
    expect(program).toContain('"iframe-url"');
    expect(program).toContain("createRoot(root).render(main())");
    expect(program).not.toContain("const __logosResult = main()");
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

  it("starts independent TypeScript completions in parallel", async () => {
    const sheet = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log(add(1, 2));
  console.log(mul(2, 3));
}`;
    const started: string[] = [];
    const resolvers: Array<(value: string) => void> = [];
    const eventsPromise = collectCompileEvents(new Map(), sheet, (prompt) => {
      const target = completionTargetName(prompt);
      started.push(target);
      return new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });
    }, "parallel");

    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    expect(resolvers).toHaveLength(2);
    resolvers[0]("function add(x: number, y: number): number {\n  return x + y;\n}");
    resolvers[1]("function mul(x: number, y: number): number {\n  return x * y;\n}");

    const events = await eventsPromise;
    expect(events.filter((event) => event.kind === "llm-start")).toHaveLength(2);
    expect(events.at(-1)?.kind).toBe("compiled");
  });

  it("streams tokens from parallel TypeScript completions before all snippets finish", async () => {
    const sheet = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;`;
    const gates: Array<() => void> = [];
    const eventsPromise = collectCompileEvents(new Map(), sheet, async function* (prompt) {
      const target = completionTargetName(prompt);
      yield target === "add"
        ? "function add(x: number, y: number): number {\n"
        : "function mul(x: number, y: number): number {\n";
      await new Promise<void>((resolve) => gates.push(resolve));
      yield target === "add" ? "  return x + y;\n}" : "  return x * y;\n}";
    }, "parallel");

    await eventually(() => expect(gates).toHaveLength(2));
    gates[0]?.();
    gates[1]?.();
    const events = await eventsPromise;
    const firstCompleteIndex = events.findIndex((event) => event.kind === "llm-complete");
    const tokenEventsBeforeCompletion = events.slice(0, firstCompleteIndex).filter((event) => event.kind === "llm-token");

    expect(tokenEventsBeforeCompletion.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)?.kind).toBe("compiled");
  });

  it("passes parallel strategy through the TypeScript runner", async () => {
    const sheet = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log(add(1, 2));
  console.log(mul(2, 3));
}`;
    const started: string[] = [];
    const resolvers: Array<(value: string) => void> = [];
    const runPromise = runCodeSheet(sheet, "main", {
      compilationStrategy: "parallel",
      complete(prompt) {
        const target = completionTargetName(prompt);
        started.push(target);
        return new Promise<string>((resolve) => {
          resolvers.push(resolve);
        });
      },
    });

    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    resolvers[0]("function add(x: number, y: number): number {\n  return x + y;\n}");
    resolvers[1]("function mul(x: number, y: number): number {\n  return x * y;\n}");

    const result = await runPromise;
    expect(result.ok).toBe(true);
    expect(result.stdout).toEqual(["3", "6"]);
  });

  it("uses a larger Anthropic completion budget and fails loudly on truncation", () => {
    expect(anthropicMaxTokens(undefined)).toBe(8192);
    expect(anthropicMaxTokens("12000")).toBe(12000);
    expect(() => anthropicMaxTokens("nope")).toThrow("ANTHROPIC_MAX_TOKENS must be a positive integer");
    expect(() => throwIfMaxTokensStop("max_tokens", 8192)).toThrow(
      "Anthropic completion stopped after reaching max_tokens=8192",
    );
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

  it("rejects generated WebPage code that fakes interactivity with alerts", async () => {
    const generated = await generateCode(shadcnCounterSheet, "main", {
      cache: new Map(),
      complete: () => `return shadcn.renderApp(
  shadcn.Page({ title: "Strategy Viewer" },
    shadcn.Button({ onClick: "alert('Strategy applied. Re-render required for updated state.')" }, "Apply")
  )
);`,
    });

    const codeResult = checkCode(generated.code, { expectedKind: "webpage" });
    const htmlResult = checkWebPageHtml(
      '<!doctype html><html><body data-shadcn-runtime><button onclick="alert(\'Strategy applied. Re-render required for updated state.\')">Apply</button></body></html>',
    );

    expect(codeResult.ok).toBe(false);
    expect(codeResult.failures).toEqual(expect.arrayContaining([
      "generated WebPage code uses blocking browser dialogs instead of rendering UI state",
      "generated WebPage code contains a fake re-render placeholder",
    ]));
    expect(htmlResult.ok).toBe(false);
    expect(htmlResult.failures).toEqual(expect.arrayContaining([
      "webpage html uses blocking browser dialogs instead of rendering UI state",
      "webpage html contains a fake re-render placeholder",
    ]));
  });

  it("rejects generated WebPage code that shadows a top-level sheet API", () => {
    const program = buildTypeScriptProgram(`type App = WebPage;

function apply_strategy(): number {
  return 1;
}

function main(): App {
  function apply_strategy(): number {
    return 2;
  }

  return shadcn.renderApp(shadcn.Page({}, String(apply_strategy())));
}`, "main");

    const result = checkCode(program, { expectedKind: "webpage" });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'generated code shadows top-level declaration "apply_strategy" inside a nested scope',
    );
  });

  it("tells WebPage codegen not to use modal placeholders for client state", () => {
    const snippet = parse(shadcnCounterSheet).incompleteSnippets[0]?.snippet;
    expect(snippet).toBeDefined();
    if (!snippet) return;
    const prompt = buildCompletionPrompt(
      shadcnCounterSheet,
      snippet,
      "natural",
    );

    expect(prompt).toContain("static browser page");
    expect(prompt).toContain("updates the DOM directly");
    expect(prompt).toContain("Do not use alert(), confirm(), prompt()");
    expect(prompt).toContain("re-render required");
  });

  it("ports the Python-target anti-shadowing prompt rules to TS natural snippets", () => {
    const testCase = sampleAppEvalCases.find((item) => item.sampleId === "sudoku-human-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const snippet = parse(testCase.sheet).incompleteSnippets.find((item) => item.kind === "natural")?.snippet;
    expect(snippet).toBeDefined();
    if (!snippet) return;
    const prompt = buildCompletionPrompt(testCase.sheet, snippet, "natural");

    expect(prompt).toContain(
      "Do not define a nested class or function with the same name as a top-level declaration from the sheet",
    );
    expect(prompt).toContain(
      "Do not assign local variables, loop variables, classes, or functions with the same names as top-level helpers",
    );
    expect(prompt).toContain(
      "If another class, result type, helper, or function is referenced elsewhere in the sheet or in an attached declaration comment, use it as an existing dependency",
    );
  });

  it("seeds the base counter app as shadcn WebPage code", async () => {
    const sample = samples.find((item) => item.id === "counter-button");
    expect(sample).toBeDefined();
    if (!sample) return;

    const cache = new Map();
    await seedSampleCodeCache(cache);
    const parsed = parse(sample.code);
    expect(parsed.incompleteSnippets.map((item) => item.snippet)).toHaveLength(1);
    const snippet = parsed.incompleteSnippets[0];
    expect(snippet).toBeDefined();
    expect(cache.has(hashCompletionInput(parsed, snippet?.snippet ?? "", snippet?.annotationContexts))).toBe(true);
    const compiled = await compileCodeSheetToTypeScript(sample.code, "main", {
      cache,
      complete: () => {
        throw new Error("counter base project should be seeded");
      },
      strategy: "parallel",
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

  it("allows shadcn Script to use the same props-first shape as other helpers", async () => {
    const body = `const count = 0;

const html = shadcn.renderApp(
  shadcn.Page(
    {},
    shadcn.Card(
      { style: "max-width: 320px; margin: 80px auto;" },
      shadcn.CardHeader(
        {},
        shadcn.CardTitle({}, "Counter"),
        shadcn.CardDescription({}, "Click the button to increment the counter.")
      ),
      shadcn.CardContent(
        {},
        shadcn.Stack(
          {},
          shadcn.Metric({ id: "counter-display" }, String(count)),
          shadcn.Button({ onClick: "window.incrementCounter()" }, "Increment")
        )
      )
    ),
    shadcn.Script(
      {},
      \`
        window._count = 0;
        window.incrementCounter = function() {
          window._count += 1;
          document.getElementById('counter-display').textContent = window._count;
        };
      \`
    )
  )
);

return html;`;
    const program = buildTypeScriptProgram(`function main(): WebPage {
${body.split("\n").map((line) => `  ${line}`).join("\n")}
}`, "main");

    expect(() => transpileTypeScript(program)).not.toThrow();
    const result = await runTypeScript(program);
    expect(result.ok).toBe(true);
    const html = result.artifacts[0]?.content ?? "";
    expect(html).toContain("window.incrementCounter");
    expect(html).toContain('id="counter-display"');
    expect(html).toContain('onclick="window.incrementCounter()"');
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

  it("keeps seeded browser e2e completions out of the developer cache", () => {
    const source = readFileSync(new URL("./typescriptBaseline.browser.e2e.ts", import.meta.url), "utf8");

    expect(source).toContain("mkdtemp");
    expect(source).toContain("CODE_CACHE_DIR: codeCacheDir");
    expect(source).toContain('SEED_SAMPLE_CODE_CACHE: "true"');
  });
});
