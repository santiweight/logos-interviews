import "./styles.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import {
  definitionReadiness,
  parse,
  runnables,
  type DefinitionReadiness,
  type Runnable,
} from "./codeSheet";
import type { AgentChatMessage } from "./sheetAgent";

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
# Parse expression strings containing ints, A1 cell refs, +, -, *, /, and parentheses.
# If an expression has one extra trailing ")" but is otherwise parseable, ignore it.

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
  {
    id: "parsed-spreadsheet",
    label: "Parsed spreadsheet",
    code: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.
# Parse expression strings containing ints, A1 cell refs, +, -, *, /, and parentheses.
# If an expression has one extra trailing ")" but is otherwise parseable, ignore it.
# c("A1") returns ("A", 1).

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
type EvalError = RecursiveError(list) | DivByZero
type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def c(str) -> CellAddress

class Spreadsheet:
  cells: [[Expr]]

  def __init__(self) -> None
  def get(self, cell: CellAddress) -> Expr | None
  def set(self, cell: CellAddress, expr: str) -> None
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None
  def eval(self, cell: CellAddress) -> int | EvalError | None
  def eval_inner(self, stack: list, cell: CellAddress) -> int | EvalError | None

def test():
  sheet = Spreadsheet()
  print(sheet.get(c("A1")))
  sheet.set(c("A1"), "7")
  print(sheet.get(c("A1")))
  sheet.set(c("B1"), "2 + 3")
  print(sheet.eval().eval(c("B1")))
  sheet.set(c("C1"), "(B1 + A1) * 4)")
  print(sheet.eval().eval(c("C1")))`,
  },
];

const seedCode = samples[0].code;

const app = requiredQuery<HTMLDivElement>("#app");

app.innerHTML = `
  <section id="shell" class="shell agent-collapsed">
    <aside id="agent-sidebar" class="agent-sidebar">
      <button id="agent-toggle" class="agent-toggle-button" type="button" aria-expanded="false" aria-controls="agent-content">
        Agent
      </button>
      <div id="agent-content" class="agent-content">
        <header class="agent-header">
          <div>
            <p class="eyebrow">Sheet Agent</p>
            <h2>Assistant</h2>
          </div>
        </header>
        <div id="agent-log" class="agent-log" aria-live="polite"></div>
        <form id="agent-form" class="agent-form">
          <textarea id="agent-input" class="agent-input" rows="3" placeholder="Ask the agent to change or explain this sheet"></textarea>
          <button id="agent-send" class="run-button" type="submit">Send</button>
        </form>
      </div>
    </aside>

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
          <button id="clear-cache-button" class="secondary-button" type="button">
            Clear cache
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

const shell = requiredQuery<HTMLElement>("#shell");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const outputEl = requiredQuery<HTMLPreElement>("#output");
const implementationEl = requiredQuery<HTMLPreElement>("#implementation");
const runButton = requiredQuery<HTMLButtonElement>("#run-button");
const clearCacheButton = requiredQuery<HTMLButtonElement>("#clear-cache-button");
const runStatus = requiredQuery<HTMLSpanElement>("#run-status");
const sampleSelect = requiredQuery<HTMLSelectElement>("#sample-select");
const runViewTab = requiredQuery<HTMLButtonElement>("#run-view-tab");
const implementationTab = requiredQuery<HTMLButtonElement>("#implementation-tab");
const agentToggle = requiredQuery<HTMLButtonElement>("#agent-toggle");
const agentLog = requiredQuery<HTMLDivElement>("#agent-log");
const agentForm = requiredQuery<HTMLFormElement>("#agent-form");
const agentInput = requiredQuery<HTMLTextAreaElement>("#agent-input");
const agentSend = requiredQuery<HTMLButtonElement>("#agent-send");
let lastRunLabel = "never";
let agentMessages: AgentChatMessage[] = [];
let agentExpanded = false;
let compileController: AbortController | null = null;
let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileVersion = 0;
let readinessDecorations: string[] = [];

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

editor.onDidChangeModelContent(() => {
  scheduleCompilation(250);
});

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
clearCacheButton.addEventListener("click", () => clearCache());
runViewTab.addEventListener("click", () => setActiveTab("run"));
implementationTab.addEventListener("click", () => setActiveTab("implementation"));
agentToggle.addEventListener("click", () => setAgentExpanded(!agentExpanded));
agentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runAgentTurn();
});
sampleSelect.addEventListener("change", () => {
  const sample = samples.find((item) => item.id === sampleSelect.value);
  if (!sample) {
    return;
  }

  editor.setValue(sample.code);
  outputEl.textContent = "";
  agentMessages = [];
  renderAgentLog();
  lastRunLabel = "never";
  runStatus.textContent = "Not run";
  runStatus.dataset.state = "";
  scheduleCompilation(0);
  setActiveTab("run");
});

renderAgentLog();
scheduleCompilation(0);

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
    return;
  }

  lastRunLabel = formatRunTime(new Date());
  runStatus.textContent = `Error · last run ${lastRunLabel}`;
  runStatus.dataset.state = "error";
  outputEl.textContent = result.error;
}

async function clearCache(): Promise<void> {
  clearCacheButton.disabled = true;
  runStatus.textContent = "Clearing cache";
  runStatus.dataset.state = "";

  try {
    const cleared = await clearCacheViaDevApi();
    scheduleCompilation(0);
    runStatus.textContent = `Cleared ${cleared} cached snippet${cleared === 1 ? "" : "s"}`;
    runStatus.dataset.state = "ok";
  } catch (error) {
    runStatus.textContent = "Cache clear failed";
    runStatus.dataset.state = "error";
    outputEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    clearCacheButton.disabled = false;
  }
}

function scheduleCompilation(delayMs: number): void {
  compileVersion += 1;
  const version = compileVersion;
  const source = editor.getValue();

  compileController?.abort();
  compileController = null;
  implementationEl.textContent = source;
  updateReadinessDecorations(localReadiness(source));

  if (compileTimer) {
    clearTimeout(compileTimer);
  }

  compileTimer = setTimeout(() => {
    compileTimer = null;
    streamImplementation(source, version);
  }, delayMs);
}

async function streamImplementation(source: string, version: number): Promise<void> {
  const controller = new AbortController();
  compileController = controller;

  try {
    for await (const event of compileViaDevApi(source, controller.signal)) {
      if (version !== compileVersion) {
        controller.abort();
        return;
      }

      if (
        (event.kind === "implementation" || event.kind === "compiled") &&
        typeof event.implementation === "string"
      ) {
        implementationEl.textContent = event.implementation;
      }

      if (event.kind === "readiness" && Array.isArray(event.definitions)) {
        updateReadinessDecorations(event.definitions);
      }
    }
  } catch (error) {
    if (controller.signal.aborted || version !== compileVersion) {
      return;
    }

    implementationEl.textContent = source;
    console.error(error);
  } finally {
    if (compileController === controller) {
      compileController = null;
    }
  }
}

function localReadiness(source: string): DefinitionReadiness[] {
  try {
    return definitionReadiness(parse(source), new Map());
  } catch {
    return [];
  }
}

function updateReadinessDecorations(definitions: DefinitionReadiness[]): void {
  const decorations = definitions
    .filter((definition) => !definition.ready)
    .map((definition) => ({
      range: new monaco.Range(definition.line, 1, definition.line, 1),
      options: {
        glyphMarginClassName: "not-ready-glyph-dot",
        hoverMessage: {
          value:
            definition.reason === "implementation"
              ? `${definition.name} is waiting for its implementation.`
              : `${definition.name} is waiting for ${definition.blockingDependencies.join(", ")}.`,
        },
      },
    }));

  readinessDecorations = editor.deltaDecorations(readinessDecorations, decorations);
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

async function runAgentTurn(): Promise<void> {
  const content = agentInput.value.trim();
  if (content.length === 0) {
    return;
  }

  setAgentExpanded(true);
  const nextMessages: AgentChatMessage[] = [
    ...agentMessages,
    { role: "user", content },
  ];
  agentMessages = nextMessages;
  agentInput.value = "";
  agentInput.disabled = true;
  agentSend.disabled = true;
  renderAgentLog("Working...");

  const result = await askAgent(editor.getValue(), nextMessages).catch((error: unknown) => ({
    reply: error instanceof Error ? error.message : String(error),
    sheet: null,
    error: true,
  }));

  agentMessages = [
    ...nextMessages,
    { role: "assistant", content: result.reply },
  ];

  if (!("error" in result) && result.sheet !== null && result.sheet !== editor.getValue()) {
    editor.setValue(result.sheet);
    outputEl.textContent = "";
    agentMessages = [
      ...agentMessages,
      { role: "assistant", content: "Applied the updated sheet to the editor." },
    ];
  }

  agentInput.disabled = false;
  agentSend.disabled = false;
  renderAgentLog();
  agentInput.focus();
}

async function askAgent(
  sheet: string,
  messages: AgentChatMessage[],
): Promise<{ reply: string; sheet: string | null }> {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet, messages }),
  });

  const payload = (await response.json()) as {
    reply?: string;
    sheet?: string | null;
    error?: string;
  };

  if (!response.ok || typeof payload.reply !== "string") {
    throw new Error(payload.error ?? "Agent request failed");
  }
  if (payload.sheet !== null && typeof payload.sheet !== "string") {
    throw new Error("Agent returned an invalid sheet");
  }

  return { reply: payload.reply, sheet: payload.sheet };
}

function renderAgentLog(status?: string): void {
  if (agentMessages.length === 0 && !status) {
    agentLog.innerHTML = `<div class="agent-empty">No agent messages yet.</div>`;
    return;
  }

  agentLog.innerHTML = [
    ...agentMessages.map((message) => {
      const roleClass = message.role === "user" ? "agent-message-user" : "agent-message-assistant";
      return `<div class="agent-message ${roleClass}">
        <div class="agent-message-role">${escapeHtml(message.role)}</div>
        <div class="agent-message-content">${escapeHtml(message.content)}</div>
      </div>`;
    }),
    status ? `<div class="agent-empty">${escapeHtml(status)}</div>` : "",
  ].join("");
  agentLog.scrollTop = agentLog.scrollHeight;
}

function setAgentExpanded(expanded: boolean): void {
  agentExpanded = expanded;
  shell.classList.toggle("agent-collapsed", !expanded);
  agentToggle.setAttribute("aria-expanded", String(expanded));
  agentToggle.textContent = expanded ? "Close" : "Agent";
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function clearCacheViaDevApi(): Promise<number> {
  const response = await fetch("/api/cache", { method: "DELETE" });
  const payload = (await response.json()) as {
    ok?: boolean;
    cleared?: number;
    error?: string;
  };

  if (!response.ok || payload.ok !== true || typeof payload.cleared !== "number") {
    throw new Error(payload.error ?? "Clear cache request failed");
  }

  return payload.cleared;
}

type CompileWireEvent =
  | {
      kind: string;
      implementation?: string;
      error?: string;
      definitions?: DefinitionReadiness[];
    };

async function* compileViaDevApi(
  sheet: string,
  signal: AbortSignal,
): AsyncIterable<CompileWireEvent> {
  const response = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Compile request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      const event = JSON.parse(line) as CompileWireEvent;
      if (event.kind === "error") {
        throw new Error(event.error);
      }

      yield event;
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim().length > 0) {
    const event = JSON.parse(buffer) as CompileWireEvent;
    if (event.kind === "error") {
      throw new Error(event.error);
    }

    yield event;
  }
}

function setActiveTab(tab: "run" | "implementation"): void {
  const runActive = tab === "run";
  const implementationActive = tab === "implementation";
  runViewTab.classList.toggle("active", runActive);
  implementationTab.classList.toggle("active", implementationActive);
  runViewTab.setAttribute("aria-selected", String(runActive));
  implementationTab.setAttribute("aria-selected", String(implementationActive));
  outputEl.classList.toggle("active", runActive);
  implementationEl.classList.toggle("active", implementationActive);
}

function requiredQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
