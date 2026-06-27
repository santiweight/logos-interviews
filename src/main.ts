import "./styles.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import { runnables, type Runnable } from "./codeSheet";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

type SampleProgram = {
  id: string;
  label: string;
  code: string;
};

const samples: SampleProgram[] = [
  {
    id: "add",
    label: "Incomplete add",
    code: `def add(x: int, y: int) -> int

def test():
  print(add(1,2))`,
  },
  {
    id: "multi",
    label: "Add and multiply",
    code: `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(add(1,2))
  print(mul(2,3))`,
  },
  {
    id: "spreadsheet",
    label: "Spreadsheet class",
    code: `class Spreadsheet:
  cells: [[int]]

  def get(self, col: str, row: int) -> int | None
  def set(self, col: str, row: int, val: int) -> None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, 7)
  print(sheet.get("A", 1))`,
  },
  {
    id: "sum-types",
    label: "Dataclass sum types",
    code: `type Op = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Op, Expr, Expr)

def test():
  print(Val(7))`,
  },
  {
    id: "calculated-spreadsheet",
    label: "Calculated spreadsheet",
    code: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
type EvalError = RecursiveError(list) | DivByZero

class Spreadsheet:
  cells: [[Expr]]

  def __init__(self) -> None
  def get(self, col: str, row: int) -> Expr | None
  def set(self, col: str, row: int, expr: Expr) -> None
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None
  def eval(self, col: str, row: int) -> int | EvalError | None
  def eval_inner(self, stack: list, col: str, row: int) -> int | EvalError | None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, Val(7))
  print(sheet.get("A", 1))
  sheet.set("B", 1, BinOp(Add(), Val(2), Val(3)))
  print(sheet.eval().eval("B", 1))
  sheet.set("C", 1, BinOp(Mul(), BinOp(Add(), Cell("B", 1), Cell("A", 1)), Val(4)))
  print(sheet.eval().eval("C", 1))`,
  },
];

const seedCode = samples[0].code;

const app = requiredQuery<HTMLDivElement>("#app");

app.innerHTML = `
  <section class="shell">
    <aside class="code-pane">
      <header class="topbar">
        <div>
          <p class="eyebrow">Interview Tool</p>
          <h1>Python Exercise</h1>
        </div>
        <div class="toolbar-actions">
          <label class="sample-select-label" for="sample-select">Sample</label>
          <select id="sample-select" class="sample-select" aria-label="Sample program">
            ${samples.map((sample) => `<option value="${sample.id}">${sample.label}</option>`).join("")}
          </select>
          <button id="run-button" class="run-button" type="button" aria-label="Run selected runnable">
            <span aria-hidden="true">▶</span>
            Run
          </button>
        </div>
      </header>
      <div id="editor" class="editor" aria-label="Code editor"></div>
    </aside>

    <section class="output-pane">
      <header class="panel-header">
        <div>
          <p class="eyebrow">Program Output</p>
          <h2>Console</h2>
        </div>
        <span id="run-status" class="status">Not run</span>
      </header>
      <div class="tabs" role="tablist" aria-label="Run output views">
        <button id="run-view-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="run-view-panel">
          Run View
        </button>
        <button id="implementation-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="implementation-panel">
          Implementation
        </button>
      </div>
      <pre id="output" class="output tab-panel active" role="tabpanel" aria-labelledby="run-view-tab" aria-live="polite"></pre>
      <pre id="implementation" class="output tab-panel" role="tabpanel" aria-labelledby="implementation-tab"></pre>
    </section>
  </section>
`;

const editorEl = requiredQuery<HTMLDivElement>("#editor");
const outputEl = requiredQuery<HTMLPreElement>("#output");
const implementationEl = requiredQuery<HTMLPreElement>("#implementation");
const runButton = requiredQuery<HTMLButtonElement>("#run-button");
const runStatus = requiredQuery<HTMLSpanElement>("#run-status");
const sampleSelect = requiredQuery<HTMLSelectElement>("#sample-select");
const runViewTab = requiredQuery<HTMLButtonElement>("#run-view-tab");
const implementationTab = requiredQuery<HTMLButtonElement>("#implementation-tab");
let lastRunLabel = "never";

monaco.editor.defineTheme("interview-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editorGutter.background": "#f5f7fa",
    "editorLineNumber.foreground": "#8a97a8",
    "editorLineNumber.activeForeground": "#1f2933",
  },
});

const editor = monaco.editor.create(editorEl, {
  value: seedCode,
  language: "python",
  theme: "interview-light",
  automaticLayout: true,
  fontFamily:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: 14,
  lineHeight: 22,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  glyphMargin: true,
  lineNumbersMinChars: 3,
  padding: { top: 12, bottom: 12 },
});

const runCommandId =
  editor.addCommand(0, (_accessor, runnable?: Runnable) => {
    runCurrentProgram(runnable);
  }) ?? "";

monaco.languages.registerCodeLensProvider("python", {
  provideCodeLenses(model) {
    const lenses = runnables(model.getValue()).map((runnable) => ({
      range: new monaco.Range(runnable.line, 1, runnable.line, 1),
      command: {
        id: runCommandId,
        title: `▶ Run ${runnable.name}`,
        arguments: [runnable.name],
      },
    }));

    return { lenses, dispose: () => undefined };
  },
});

runButton.addEventListener("click", () => runCurrentProgram());
runViewTab.addEventListener("click", () => setActiveTab("run"));
implementationTab.addEventListener("click", () => setActiveTab("implementation"));
sampleSelect.addEventListener("change", () => {
  const sample = samples.find((item) => item.id === sampleSelect.value);
  if (!sample) {
    return;
  }

  editor.setValue(sample.code);
  outputEl.textContent = "";
  implementationEl.textContent = "";
  lastRunLabel = "never";
  runStatus.textContent = "Not run";
  runStatus.dataset.state = "";
  setActiveTab("run");
});

async function runCurrentProgram(requestedRunnable?: Runnable): Promise<void> {
  const source = editor.getValue();
  const runnable = requestedRunnable ?? firstRunnable(source);
  if (!runnable) {
    runStatus.textContent = `No runnable · last run ${lastRunLabel}`;
    runStatus.dataset.state = "error";
    outputEl.textContent = "No zero-argument function found.";
    return;
  }

  runStatus.textContent = `Running ${runnable} · last run ${lastRunLabel}`;
  runStatus.dataset.state = "";
  outputEl.textContent = "";

  const result = await runViaDevApi(source, runnable).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    stdout: [],
    implementation: "",
  }));

  if (result.ok) {
    lastRunLabel = formatRunTime(new Date());
    runStatus.textContent = `Ran ${runnable} · last run ${lastRunLabel}`;
    runStatus.dataset.state = "ok";
    outputEl.textContent = result.stdout.length > 0 ? result.stdout.join("\n") : "(no output)";
    implementationEl.textContent = result.implementation;
    return;
  }

  lastRunLabel = formatRunTime(new Date());
  runStatus.textContent = `Error · last run ${lastRunLabel}`;
  runStatus.dataset.state = "error";
  outputEl.textContent = result.error;
  implementationEl.textContent = result.implementation;
}

function firstRunnable(source: string): Runnable | null {
  return runnables(source)[0]?.name ?? null;
}

function formatRunTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function runViaDevApi(
  sheet: string,
  runnable: Runnable,
): Promise<
  | { ok: true; stdout: string[]; implementation: string }
  | { ok: false; error: string; stdout: string[]; implementation: string }
> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet, runnable }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    stdout?: string[];
    error?: string;
    implementation?: string;
  };

  if (
    !response.ok ||
    typeof payload.ok !== "boolean" ||
    !Array.isArray(payload.stdout) ||
    typeof payload.implementation !== "string"
  ) {
    throw new Error(payload.error ?? "Run request failed");
  }

  if (payload.ok) {
    return { ok: true, stdout: payload.stdout, implementation: payload.implementation };
  }

  return {
    ok: false,
    error: payload.error ?? "Run failed",
    stdout: payload.stdout,
    implementation: payload.implementation,
  };
}

function setActiveTab(tab: "run" | "implementation"): void {
  const runActive = tab === "run";
  runViewTab.classList.toggle("active", runActive);
  implementationTab.classList.toggle("active", !runActive);
  runViewTab.setAttribute("aria-selected", String(runActive));
  implementationTab.setAttribute("aria-selected", String(!runActive));
  outputEl.classList.toggle("active", runActive);
  implementationEl.classList.toggle("active", !runActive);
}

function requiredQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
