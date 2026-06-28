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
import { createSessionCapture, type JsonObject } from "./sessionCaptureClient";
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
const logosMark = `
  <svg class="logos-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M6.5 26.5 Q9.2 10.8 14.4 5.4 Q15.8 4.1 17.1 5.4 L22.4 16 L27.7 5.4" />
  </svg>
`;
const assistantMark = `
  <svg class="assistant-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 3.8l2.9 8.5 8.9 3.7-8.9 3.7L16 28.2l-2.9-8.5L4.2 16l8.9-3.7z" />
  </svg>
`;
const sendIcon = `
  <svg class="send-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3.4 5.4 8l1.1 1.1 2.7-2.7v10.2h1.6V6.4l2.7 2.7L14.6 8z" />
  </svg>
`;
const menuIcon = `
  <svg class="menu-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 6.25h12M4 10h12M4 13.75h12" />
  </svg>
`;

app.innerHTML = `
  <section class="app-frame" aria-label="Spreadsheet interview workspace">
    <header class="app-header">
      <div class="app-header-left">
        <a class="brand-mark" href="/" aria-label="Logos">
          ${logosMark}
        </a>
        <details id="project-menu" class="project-menu">
          <summary class="menu-trigger" aria-label="Open project menu">
            ${menuIcon}
          </summary>
          <div class="menu-popover" role="menu">
            <div class="menu-section">
              <div class="menu-section-title">Samples</div>
              <div class="sample-menu-list">
                ${samples
                  .map(
                    (sample) =>
                      `<button class="menu-item sample-menu-item" type="button" role="menuitem" data-sample-id="${sample.id}">${sample.label}</button>`,
                  )
                  .join("")}
              </div>
            </div>
            <div class="menu-separator" aria-hidden="true"></div>
            <button id="clear-cache-button" class="menu-item" type="button" role="menuitem">
              Clear coding cache
            </button>
          </div>
        </details>
      </div>
      <div class="workspace-title" aria-hidden="true"></div>
    </header>

    <section id="shell" class="shell agent-collapsed">
      <aside id="agent-sidebar" class="agent-sidebar">
        <button id="agent-toggle" class="agent-toggle-button" type="button" aria-label="Open assistant" aria-expanded="false" aria-controls="agent-content">
          ${assistantMark}
          <span class="toggle-chevron" aria-hidden="true">›</span>
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
            <button id="agent-send" class="send-button" type="submit" aria-label="Send message" title="Send">
              ${sendIcon}
            </button>
          </form>
        </div>
      </aside>

      <section class="code-pane" aria-label="Code editor panel">
        <header class="panel-header code-header">
          <div>
            <p class="eyebrow">Source</p>
            <h2>Editor</h2>
          </div>
        </header>
        <div id="editor" class="editor" aria-label="Code editor"></div>
      </section>

      <section class="output-pane" aria-label="Program output panel">
        <div class="tool-tabs">
          <div class="tabs" role="tablist" aria-label="Run output views">
            <button id="run-view-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="run-view-panel">
              Run View
            </button>
            <button id="implementation-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="implementation">
              Implementation
            </button>
          </div>
          <span id="run-status" class="status">Not run</span>
        </div>
        <div id="run-view-panel" class="run-view tab-panel active" role="tabpanel" aria-labelledby="run-view-tab">
          <pre id="output" class="output" aria-live="polite"></pre>
          <footer id="run-stale-footer" class="run-stale-footer" hidden>
            <span class="run-stale-pill">Changes since last run</span>
            <span class="run-stale-copy">Run a function to refresh this output.</span>
          </footer>
        </div>
        <pre id="implementation" class="output tab-panel" role="tabpanel" aria-labelledby="implementation-tab"></pre>
      </section>
    </section>
  </section>
`;

const shell = requiredQuery<HTMLElement>("#shell");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const runViewPanel = requiredQuery<HTMLDivElement>("#run-view-panel");
const outputEl = requiredQuery<HTMLPreElement>("#output");
const implementationEl = requiredQuery<HTMLPreElement>("#implementation");
const runStaleFooter = requiredQuery<HTMLElement>("#run-stale-footer");
const clearCacheButton = requiredQuery<HTMLButtonElement>("#clear-cache-button");
const runStatus = requiredQuery<HTMLSpanElement>("#run-status");
const projectMenu = requiredQuery<HTMLDetailsElement>("#project-menu");
const sampleMenuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".sample-menu-item"),
);
const runViewTab = requiredQuery<HTMLButtonElement>("#run-view-tab");
const implementationTab = requiredQuery<HTMLButtonElement>("#implementation-tab");
const agentToggle = requiredQuery<HTMLButtonElement>("#agent-toggle");
const agentLog = requiredQuery<HTMLDivElement>("#agent-log");
const agentForm = requiredQuery<HTMLFormElement>("#agent-form");
const agentInput = requiredQuery<HTMLTextAreaElement>("#agent-input");
const agentSend = requiredQuery<HTMLButtonElement>("#agent-send");
let lastRunLabel = "never";
let lastRunStatusText = "Not run";
let lastRunDefinitionHash: string | null = null;
let agentMessages: AgentChatMessage[] = [];
let agentExpanded = false;
let compileController: AbortController | null = null;
let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileVersion = 0;
let readinessDecorations: string[] = [];
let runnableDecorations: string[] = [];
let runnableStateByLine = new Map<number, RunnableState>();

type RunnableState = {
  name: Runnable;
  ready: boolean;
  blockingDependencies: string[];
};

monaco.editor.defineTheme("interview-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#fbfcfe",
    "editorGutter.background": "#f4f7fb",
    "editorLineNumber.foreground": "#98a3b3",
    "editorLineNumber.activeForeground": "#202b3a",
    "editor.selectionBackground": "#dbeafe",
    "editor.lineHighlightBackground": "#eef4fb",
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

const sessionCapture = createSessionCapture({ getSnapshot: appSnapshot });
let editorCaptureTimer: ReturnType<typeof setTimeout> | null = null;

editor.onDidChangeModelContent(() => {
  scheduleCompilation(250);
  scheduleEditorCapture();
});

editor.onMouseDown((event) => {
  if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
    return;
  }

  const lineNumber = event.target.position?.lineNumber;
  if (lineNumber === undefined) {
    return;
  }

  const runnable = runnableStateByLine.get(lineNumber);
  if (!runnable) {
    return;
  }

  sessionCapture.track(
    "gutter_run_click",
    { lineNumber, runnable: runnable.name, ready: runnable.ready },
    true,
  );

  if (!runnable.ready) {
    runStatus.textContent = `${runnable.name} is blocked`;
    runStatus.dataset.state = "error";
    return;
  }

  runCurrentProgram(runnable.name);
});

clearCacheButton.addEventListener("click", () => {
  projectMenu.open = false;
  sessionCapture.track("clear_cache_requested", undefined, true);
  clearCache();
});
runViewTab.addEventListener("click", () => {
  setActiveTab("run");
  sessionCapture.track("tab_changed", { tab: "run" }, true);
});
implementationTab.addEventListener("click", () => {
  setActiveTab("implementation");
  sessionCapture.track("tab_changed", { tab: "implementation" }, true);
});
agentToggle.addEventListener("click", () => {
  const expanded = !agentExpanded;
  setAgentExpanded(expanded);
  sessionCapture.track("agent_toggle", { expanded }, true);
});
agentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sessionCapture.track("agent_submit", { input: agentInput.value }, true);
  runAgentTurn();
});
sampleMenuItems.forEach((item) => {
  item.addEventListener("click", () => {
    loadSample(item.dataset.sampleId ?? "");
  });
});

function loadSample(sampleId: string): void {
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) {
    return;
  }

  editor.setValue(sample.code);
  sampleMenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.sampleId === sample.id);
  });
  projectMenu.open = false;
  outputEl.textContent = "";
  agentMessages = [];
  renderAgentLog();
  lastRunLabel = "never";
  lastRunStatusText = "Not run";
  runStatus.textContent = "Not run";
  runStatus.dataset.state = "";
  lastRunDefinitionHash = null;
  updateRunStaleness();
  scheduleCompilation(0);
  setActiveTab("run");
  sessionCapture.track("sample_changed", { sampleId: sample.id, sampleLabel: sample.label }, true);
}

sampleMenuItems[0]?.classList.add("active");

renderAgentLog();
scheduleCompilation(0);

async function runCurrentProgram(requestedRunnable?: Runnable): Promise<void> {
  const source = editor.getValue();
  const runnable = requestedRunnable ?? firstRunnable(source);
  if (!runnable) {
    sessionCapture.track("run_blocked", { reason: "no_runnable" }, true);
    runStatus.textContent = `No runnable · last run ${lastRunLabel}`;
    runStatus.dataset.state = "error";
    outputEl.textContent = "No zero-argument function found.";
    return;
  }

  sessionCapture.track("run_requested", { runnable, source }, true);
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
    lastRunDefinitionHash = definitionHash(source);
    lastRunStatusText = `Ran ${runnable} · last run ${lastRunLabel}`;
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = "ok";
    outputEl.textContent = result.stdout.length > 0 ? result.stdout.join("\n") : "(no output)";
    sessionCapture.track(
      "run_completed",
      { runnable, stdout: result.stdout, implementation: result.implementation },
      true,
    );
    updateRunStaleness();
    return;
  }

  lastRunLabel = formatRunTime(new Date());
  lastRunDefinitionHash = definitionHash(source);
  lastRunStatusText = `Error · last run ${lastRunLabel}`;
  runStatus.textContent = lastRunStatusText;
  runStatus.dataset.state = "error";
  outputEl.textContent = result.error;
  sessionCapture.track(
    "run_failed",
    {
      runnable,
      error: result.error,
      stdout: result.stdout,
      implementation: result.implementation,
    },
    true,
  );
  updateRunStaleness();
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
    sessionCapture.track("clear_cache_completed", { cleared }, true);
  } catch (error) {
    runStatus.textContent = "Cache clear failed";
    runStatus.dataset.state = "error";
    outputEl.textContent = error instanceof Error ? error.message : String(error);
    sessionCapture.track(
      "clear_cache_failed",
      { error: error instanceof Error ? error.message : String(error) },
      true,
    );
  } finally {
    clearCacheButton.disabled = false;
  }
}

function scheduleEditorCapture(): void {
  if (editorCaptureTimer) {
    clearTimeout(editorCaptureTimer);
  }

  editorCaptureTimer = setTimeout(() => {
    editorCaptureTimer = null;
    sessionCapture.track(
      "editor_snapshot",
      { modelVersionId: editor.getModel()?.getVersionId() ?? null },
      true,
    );
  }, 750);
}

function scheduleCompilation(delayMs: number): void {
  compileVersion += 1;
  const version = compileVersion;
  const source = editor.getValue();

  compileController?.abort();
  compileController = null;
  implementationEl.textContent = source;
  updateReadinessDecorations(localReadiness(source));
  updateRunStaleness(source);

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
  sessionCapture.track("compile_stream_started", { version, source }, false);

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
    sessionCapture.track("compile_stream_completed", { version }, true);
  } catch (error) {
    if (controller.signal.aborted || version !== compileVersion) {
      return;
    }

    implementationEl.textContent = source;
    console.error(error);
    sessionCapture.track(
      "compile_stream_failed",
      { version, error: error instanceof Error ? error.message : String(error) },
      true,
    );
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

function definitionHash(source: string): string {
  try {
    const parsed = parse(source);
    return hashString(JSON.stringify({
      definitions: definitionBlocks(parsed.source),
      runnables: parsed.runnables,
    }));
  } catch {
    return hashString(source);
  }
}

function definitionBlocks(source: string): string[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isTopLevelDefinition = /^(class|def|type)\s+/.test(line);
    if (isTopLevelDefinition && current.length > 0) {
      blocks.push(current.join("\n").trimEnd());
      current = [];
    }

    if (isTopLevelDefinition || current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(current.join("\n").trimEnd());
  }

  return blocks;
}

function hashString(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function updateRunStaleness(source = editor.getValue()): void {
  const stale = lastRunDefinitionHash !== null && definitionHash(source) !== lastRunDefinitionHash;
  runStaleFooter.hidden = !stale;
  runViewPanel.classList.toggle("run-view-stale", stale);

  if (stale && (runStatus.dataset.state === "ok" || runStatus.dataset.state === "error")) {
    runStatus.textContent = `Stale · last run ${lastRunLabel}`;
    runStatus.dataset.state = "stale";
    return;
  }

  if (!stale && runStatus.dataset.state === "stale") {
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = lastRunStatusText.startsWith("Error") ? "error" : "ok";
  }
}

function updateReadinessDecorations(definitions: DefinitionReadiness[]): void {
  const runnableStates = runnableStatesFor(editor.getValue(), definitions);
  const runnableLines = new Set(runnableStates.map((runnable) => runnable.line));
  const decorations = definitions
    .filter((definition) => !definition.ready && !runnableLines.has(definition.line))
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
  updateRunnableDecorations(runnableStates);
  updateToolbarRunState(runnableStates);
}

function runnableStatesFor(
  source: string,
  definitions: DefinitionReadiness[],
): Array<RunnableState & { line: number }> {
  const readinessByName = new Map(definitions.map((definition) => [definition.name, definition]));

  return runnables(source).map((runnable) => {
    const readiness = readinessByName.get(runnable.name);
    return {
      name: runnable.name,
      line: runnable.line,
      ready: readiness?.ready ?? true,
      blockingDependencies: readiness?.blockingDependencies ?? [],
    };
  });
}

function updateRunnableDecorations(runnablesState: Array<RunnableState & { line: number }>): void {
  runnableStateByLine = new Map(
    runnablesState.map((runnable) => [
      runnable.line,
      {
        name: runnable.name,
        ready: runnable.ready,
        blockingDependencies: runnable.blockingDependencies,
      },
    ]),
  );

  runnableDecorations = editor.deltaDecorations(
    runnableDecorations,
    runnablesState.map((runnable) => ({
      range: new monaco.Range(runnable.line, 1, runnable.line, 1),
      options: {
        glyphMarginClassName: runnable.ready
          ? "runnable-play-glyph"
          : "runnable-play-glyph runnable-play-glyph-disabled",
        glyphMarginHoverMessage: {
          value: runnable.ready
            ? `Run ${runnable.name}`
            : `${runnable.name} is waiting for ${runnable.blockingDependencies.join(", ")}.`,
        },
      },
    })),
  );
}

function updateToolbarRunState(runnablesState: Array<RunnableState & { line: number }>): void {
  void runnablesState;
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
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run",
    body: { sheet, runnable },
  });
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

  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run",
    status: response.status,
    body: payload,
  });

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
  sessionCapture.track(
    "agent_turn_completed",
    {
      reply: result.reply,
      sheet: result.sheet,
      error: "error" in result,
    },
    true,
  );
  agentInput.focus();
}

async function askAgent(
  sheet: string,
  messages: AgentChatMessage[],
): Promise<{ reply: string; sheet: string | null }> {
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/agent/chat",
    body: { sheet, messages },
  });
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

  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/agent/chat",
    status: response.status,
    body: payload,
  });

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
  agentToggle.setAttribute("aria-label", expanded ? "Close assistant" : "Open assistant");
  agentToggle.innerHTML = `${assistantMark}<span class="toggle-chevron" aria-hidden="true">${expanded ? "‹" : "›"}</span>`;
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
  sessionCapture.track("api_request", { method: "DELETE", path: "/api/cache" });
  const response = await fetch("/api/cache", { method: "DELETE" });
  const payload = (await response.json()) as {
    ok?: boolean;
    cleared?: number;
    error?: string;
  };

  sessionCapture.track("api_response", {
    method: "DELETE",
    path: "/api/cache",
    status: response.status,
    body: payload,
  });

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
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/compile",
    body: { sheet },
  });
  const response = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
    signal,
  });

  sessionCapture.track("api_response_started", {
    method: "POST",
    path: "/api/compile",
    status: response.status,
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
  runViewPanel.classList.toggle("active", runActive);
  implementationEl.classList.toggle("active", implementationActive);
}

function appSnapshot(): JsonObject {
  const position = editor.getPosition();
  return {
    browser: {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      url: window.location.href,
    },
    editor: {
      value: editor.getValue(),
      modelVersionId: editor.getModel()?.getVersionId() ?? null,
      cursor:
        position === null
          ? null
          : {
              lineNumber: position.lineNumber,
              column: position.column,
            },
      scrollTop: editor.getScrollTop(),
      scrollLeft: editor.getScrollLeft(),
    },
    ui: {
      selectedSampleId: activeSampleItem()?.dataset.sampleId ?? null,
      selectedSampleLabel: activeSampleItem()?.textContent ?? null,
      projectMenuOpen: projectMenu.open,
      activeTab: runViewPanel.classList.contains("active") ? "run" : "implementation",
      lastRunLabel,
      runStatus: {
        text: runStatus.textContent ?? "",
        state: runStatus.dataset.state ?? "",
      },
      runStale: !runStaleFooter.hidden,
      output: outputEl.textContent ?? "",
      implementation: implementationEl.textContent ?? "",
    },
    agent: {
      expanded: agentExpanded,
      input: agentInput.value,
      inputDisabled: agentInput.disabled,
      sendDisabled: agentSend.disabled,
      messages: agentMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    },
  };
}

function activeSampleItem(): HTMLButtonElement | null {
  return sampleMenuItems.find((item) => item.classList.contains("active")) ?? null;
}

function requiredQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
