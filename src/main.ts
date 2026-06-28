import "./styles.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import {
  definitionReadiness,
  hashCompletionInput,
  parse,
  runnables,
  type DefinitionReadiness,
  type IncompleteSnippet,
  type Runnable,
  type SnippetHash,
} from "./codeSheet";
import { createSessionCapture, type JsonObject } from "./sessionCaptureClient";
import type { AgentChatMessage } from "./sheetAgent";
import type { TypeCheckDiagnostic } from "./typeCheck";

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

type SourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
};

type SourceTabState = {
  tabs: SourceTab[];
  activeTabId: string | null;
};

const sourceTabDbName = "logos-interviews-user";
const sourceTabDbVersion = 1;
const sourceTabStoreName = "state";
const sourceTabStateKey = "source-tabs-v2";
const defaultProjectIds = ["multi", "natural-language", "spreadsheet"];

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
    id: "natural-language",
    label: "Natural language",
    code: `def test():
  subtotal = \`add 19 and 23\`
  tax = \`calculate 8 percent of subtotal\`
  print(subtotal)
  print(round(tax, 2))
  print(round(subtotal + tax, 2))`,
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
  {
    id: "parking-lot",
    label: "Parking lot",
    code: `# Parking lot spots and vehicles have sizes: small < medium < large.
# A vehicle must be assigned the smallest available spot that fits it.
# Vehicle types: motorcycle fits small, car fits medium, truck fits large.
# park returns an opaque ticket id or None when no spot fits.
# unpark returns the vehicle id for a valid active ticket, otherwise None.
# active_vehicle_ids returns sorted active vehicle ids.

class ParkingLot:
  layout: dict
  occupied: dict
  tickets: dict
  next_ticket_id: int

  def __init__(self, layout: dict) -> None
  def park(self, vehicle_id: str, vehicle_type: str) -> str | None
  def unpark(self, ticket_id: str) -> str | None
  def available(self, spot_size: str) -> int
  def active_vehicle_ids(self) -> list

def test():
  lot = ParkingLot({"small": 1, "medium": 1, "large": 1})
  print(lot.available("medium"))
  motorcycle_ticket = lot.park("m1", "motorcycle")
  car_ticket = lot.park("c1", "car")
  truck_ticket = lot.park("t1", "truck")
  print(motorcycle_ticket is not None, car_ticket is not None, truck_ticket is not None)
  print(lot.available("small"), lot.available("medium"), lot.available("large"))
  print(lot.park("c2", "car"))
  print(lot.unpark(car_ticket))
  print(lot.available("medium"))
  replacement_ticket = lot.park("c2", "car")
  print(replacement_ticket is not None and replacement_ticket != car_ticket)
  print(lot.active_vehicle_ids())`,
  },
  {
    id: "email-dispatcher",
    label: "Email dispatcher",
    code: `# Structured events are dicts with id, type, email, and payload fields.
# templates maps event type to subject/body format strings.
# handle_event returns "sent", "duplicate", "ignored", or "dead_letter".
# Duplicate event ids are never sent twice.
# Unknown event types are ignored.
# TransientEmailError should be retried up to max_attempts.
# PermanentEmailError should go directly to dead letters.
# sent and dead_letters return event ids in the order they reach that state.

class TransientEmailError(Exception):
  pass

class PermanentEmailError(Exception):
  pass

class FakeSender:
  def __init__(self):
    self.attempts = {}

  def send(self, to: str, subject: str, body: str) -> None:
    key = (to, subject)
    self.attempts[key] = self.attempts.get(key, 0) + 1
    if to == "retry@example.com" and self.attempts[key] == 1:
      raise TransientEmailError("try again")
    if to == "bad@example.com":
      raise PermanentEmailError("blocked")

  def attempts_for(self, to: str, subject: str) -> int:
    return self.attempts.get((to, subject), 0)

class EmailDispatcher:
  sender: FakeSender
  templates: dict
  max_attempts: int
  seen_event_ids: set
  sent_event_ids: list
  dead_letter_event_ids: list

  def __init__(self, sender: FakeSender, templates: dict, max_attempts: int) -> None
  def handle_event(self, event: dict) -> str
  def sent(self) -> list
  def dead_letters(self) -> list

def test():
  templates = {
    "signup": {"subject": "Welcome {name}", "body": "Hi {name}"},
    "reset": {"subject": "Reset {name}", "body": "Code {code}"},
  }
  sender = FakeSender()
  dispatcher = EmailDispatcher(sender, templates, 2)
  print(dispatcher.handle_event({
    "id": "e1", "type": "signup", "email": "ada@example.com", "payload": {"name": "Ada"}
  }))
  print(dispatcher.handle_event({
    "id": "e1", "type": "signup", "email": "ada@example.com", "payload": {"name": "Ada"}
  }))
  print(dispatcher.handle_event({
    "id": "e2", "type": "reset", "email": "retry@example.com", "payload": {"name": "Ada", "code": "123"}
  }))
  print(dispatcher.handle_event({
    "id": "e3", "type": "invoice", "email": "ada@example.com", "payload": {}
  }))
  print(dispatcher.handle_event({
    "id": "e4", "type": "signup", "email": "bad@example.com", "payload": {"name": "Bad"}
  }))
  print(dispatcher.sent())
  print(dispatcher.dead_letters())
  print(sender.attempts_for("retry@example.com", "Reset Ada"))`,
  },
  {
    id: "kv-store",
    label: "KV store",
    code: `# In-memory key/value store with an injectable clock.
# clock.now is an integer timestamp.
# set stores string values. ttl is optional seconds from the current time.
# A key expires when clock.now is greater than or equal to its expiration time.
# begin starts a transaction; reads inside the transaction see staged writes/deletes.
# rollback discards staged changes; commit applies them.
# items returns sorted live (key, value) pairs.

class Clock:
  def __init__(self):
    self.now = 0

class KVStore:
  clock: Clock
  data: dict
  transaction: dict

  def __init__(self, clock: Clock) -> None
  def set(self, key: str, value: str, ttl: int | None = None) -> None
  def get(self, key: str) -> str | None
  def delete(self, key: str) -> None
  def begin(self) -> None
  def rollback(self) -> None
  def commit(self) -> None
  def items(self) -> list

def test():
  clock = Clock()
  store = KVStore(clock)
  store.set("a", "1", ttl=10)
  print(store.get("a"))
  clock.now = 10
  print(store.get("a"))
  store.set("a", "1")
  store.begin()
  store.set("a", "2")
  store.set("b", "3", ttl=5)
  print(store.get("a"), store.get("b"))
  store.rollback()
  print(store.get("a"), store.get("b"))
  store.begin()
  store.delete("a")
  store.set("c", "4")
  store.commit()
  print(store.get("a"), store.get("c"))
  print(store.items())`,
  },
];

const initialSourceTabState = defaultSourceTabState();
let sourceTabs = initialSourceTabState.tabs;
let activeSourceTabId = initialSourceTabState.activeTabId;
const seedCode = activeSourceTab()?.source ?? "";

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
        <div class="source-tabs-bar">
          <div id="source-tabs" class="source-tabs" role="tablist" aria-label="Open source projects"></div>
        </div>
        <div id="editor" class="editor" aria-label="Code editor"></div>
      </section>

      <section id="output-pane" class="output-pane" aria-label="Program output panel">
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
        <section id="snippet-panel" class="snippet-panel" aria-label="Selected incomplete implementation">
          <div
            id="snippet-resize-handle"
            class="snippet-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize incomplete implementation panel"
            tabindex="0"
          ></div>
          <header class="snippet-panel-header">
            <div class="snippet-panel-title">
              <p class="eyebrow">Incomplete Snippet</p>
              <h2 id="snippet-title">No snippet selected</h2>
            </div>
            <span id="snippet-status" class="snippet-status">Idle</span>
          </header>
          <pre id="snippet-preview" class="output snippet-preview">Click an incomplete definition in the worksheet.</pre>
        </section>
      </section>
    </section>
  </section>
`;

const shell = requiredQuery<HTMLElement>("#shell");
const sourceTabsEl = requiredQuery<HTMLDivElement>("#source-tabs");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const outputPane = requiredQuery<HTMLElement>("#output-pane");
const runViewPanel = requiredQuery<HTMLDivElement>("#run-view-panel");
const outputEl = requiredQuery<HTMLPreElement>("#output");
const implementationEl = requiredQuery<HTMLPreElement>("#implementation");
const snippetPanel = requiredQuery<HTMLElement>("#snippet-panel");
const snippetResizeHandle = requiredQuery<HTMLDivElement>("#snippet-resize-handle");
const snippetTitle = requiredQuery<HTMLHeadingElement>("#snippet-title");
const snippetStatus = requiredQuery<HTMLSpanElement>("#snippet-status");
const snippetPreview = requiredQuery<HTMLPreElement>("#snippet-preview");
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
let sourceTabSaveTimer: ReturnType<typeof setTimeout> | null = null;
let readinessDecorations: string[] = [];
let runnableDecorations: string[] = [];
let incompleteSnippetDecorations: string[] = [];
let runnableStateByLine = new Map<number, RunnableState>();
let incompleteSnippetsByLine = new Map<number, IncompleteSnippetTarget[]>();
let incompleteSnippetByHash = new Map<SnippetHash, IncompleteSnippetTarget>();
let snippetPreviewByHash = new Map<SnippetHash, SnippetPreviewState>();
let selectedSnippetHash: SnippetHash | null = null;

type RunnableState = {
  name: Runnable;
  ready: boolean;
  blockingDependencies: string[];
};

type IncompleteSnippetTarget = {
  hash: SnippetHash;
  line: number;
  startColumn: number;
  endColumn: number;
  kind: IncompleteSnippet["kind"];
  snippet: string;
  label: string;
};

type SnippetPreviewState = {
  snippet: string;
  streamed: string;
  implementation: string | null;
  status: "stub" | "generating" | "cached" | "complete";
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
  const active = activeSourceTab();
  if (active) {
    active.source = editor.getValue();
    scheduleSaveSourceTabs();
  }

  scheduleCompilation(250);
  scheduleEditorCapture();
});

editor.onMouseDown((event) => {
  const lineNumber = event.target.position?.lineNumber;

  if (lineNumber !== undefined && event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
    const column = event.target.position?.column ?? 1;
    const incompleteSnippet = incompleteSnippetForPosition(lineNumber, column);
    if (incompleteSnippet) {
      selectIncompleteSnippet(incompleteSnippet.hash, "editor_click");
      return;
    }
  }

  if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
    return;
  }

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
snippetResizeHandle.addEventListener("pointerdown", (event) => {
  beginSnippetPanelResize(event);
});
snippetResizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return;
  }

  event.preventDefault();
  const currentHeight = snippetPanel.getBoundingClientRect().height;
  setSnippetPanelHeight(currentHeight + (event.key === "ArrowUp" ? 24 : -24));
});
sampleMenuItems.forEach((item) => {
  item.addEventListener("click", () => {
    openProject(item.dataset.sampleId ?? "");
  });
});
sourceTabsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const closeButton = target.closest<HTMLButtonElement>("[data-close-tab-id]");
  if (closeButton) {
    closeSourceTab(closeButton.dataset.closeTabId ?? "");
    return;
  }

  const tabButton = target.closest<HTMLButtonElement>("[data-source-tab-id]");
  if (tabButton) {
    activateSourceTab(tabButton.dataset.sourceTabId ?? "");
  }
});

function openProject(sampleId: string): void {
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) {
    return;
  }

  projectMenu.open = false;
  openProjectTab(sample);
  sessionCapture.track("project_opened", { sampleId: sample.id, sampleLabel: sample.label }, true);
}

renderSourceTabs();
renderAgentLog();
scheduleCompilation(0);
void hydrateSourceTabsFromDatabase();

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
  setHighlightedPythonCode(implementationEl, source);
  refreshIncompleteSnippets(source);
  updateTypeCheckMarkers([]);
  updateReadinessDecorations(localReadiness(source));
  updateRunStaleness(source);
  updateEditorAvailability();

  if (compileTimer) {
    clearTimeout(compileTimer);
  }

  compileTimer = setTimeout(() => {
    compileTimer = null;
    streamImplementation(source, version);
  }, delayMs);
}

function openProjectTab(sample: SampleProgram): void {
  syncActiveSourceTab();
  const tab: SourceTab = {
    id: createSourceTabId(sample.id),
    projectId: sample.id,
    title: sample.label,
    source: sample.code,
  };
  sourceTabs = [...sourceTabs, tab];
  activeSourceTabId = tab.id;
  applyActiveSourceTab();
  renderSourceTabs();
  scheduleSaveSourceTabs();
  updateActiveProjectMenuItem();
}

function activateSourceTab(tabId: string): void {
  if (tabId === activeSourceTabId || !sourceTabs.some((tab) => tab.id === tabId)) {
    return;
  }

  syncActiveSourceTab();
  activeSourceTabId = tabId;
  applyActiveSourceTab();
  renderSourceTabs();
  scheduleSaveSourceTabs();
  updateActiveProjectMenuItem();
}

function closeSourceTab(tabId: string): void {
  const closingIndex = sourceTabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex === -1) {
    return;
  }

  syncActiveSourceTab();
  sourceTabs = sourceTabs.filter((tab) => tab.id !== tabId);

  if (activeSourceTabId === tabId) {
    activeSourceTabId = sourceTabs[closingIndex]?.id ?? sourceTabs[closingIndex - 1]?.id ?? null;
    applyActiveSourceTab();
  } else if (!sourceTabs.some((tab) => tab.id === activeSourceTabId)) {
    activeSourceTabId = sourceTabs[0]?.id ?? null;
  }

  renderSourceTabs();
  scheduleSaveSourceTabs();
  updateEditorAvailability();
  updateActiveProjectMenuItem();
}

function applyActiveSourceTab(): void {
  const active = activeSourceTab();
  editor.setValue(active?.source ?? "");
  outputEl.textContent = "";
  agentMessages = [];
  renderAgentLog();
  lastRunLabel = "never";
  lastRunStatusText = active ? "Not run" : "No open project";
  lastRunDefinitionHash = null;
  runStatus.textContent = active ? "Not run" : "No open project";
  runStatus.dataset.state = active ? "" : "error";
  updateRunStaleness(active?.source ?? "");
  scheduleCompilation(0);
  setActiveTab("run");
  updateEditorAvailability();
  updateActiveProjectMenuItem();
}

function syncActiveSourceTab(): void {
  const active = activeSourceTab();
  if (active) {
    active.source = editor.getValue();
  }
}

function activeSourceTab(): SourceTab | null {
  return sourceTabs.find((tab) => tab.id === activeSourceTabId) ?? null;
}

function renderSourceTabs(): void {
  if (sourceTabs.length === 0) {
    sourceTabsEl.innerHTML = `<div class="source-tabs-empty">No open projects</div>`;
    return;
  }

  sourceTabsEl.innerHTML = sourceTabs.map((tab) => {
    const selected = tab.id === activeSourceTabId;
    return `<div class="source-tab-shell" role="presentation">
      <button
        class="source-tab${selected ? " active" : ""}"
        type="button"
        role="tab"
        aria-selected="${selected}"
        data-source-tab-id="${escapeHtml(tab.id)}"
      >
        ${escapeHtml(tab.title)}
      </button>
      <button
        class="source-tab-close"
        type="button"
        aria-label="Close ${escapeHtml(tab.title)}"
        data-close-tab-id="${escapeHtml(tab.id)}"
      >&times;</button>
    </div>`;
  }).join("");
}

function updateEditorAvailability(): void {
  const hasActiveTab = activeSourceTab() !== null;
  editor.updateOptions({ readOnly: !hasActiveTab });
}

function updateActiveProjectMenuItem(): void {
  const active = activeSourceTab();
  sampleMenuItems.forEach((item) => {
    item.classList.toggle("active", active !== null && item.dataset.sampleId === active.projectId);
  });
}

function scheduleSaveSourceTabs(): void {
  if (sourceTabSaveTimer) {
    clearTimeout(sourceTabSaveTimer);
  }

  sourceTabSaveTimer = setTimeout(() => {
    sourceTabSaveTimer = null;
    void saveSourceTabState();
  }, 200);
}

async function saveSourceTabState(): Promise<void> {
  try {
    await writeUserState({
      tabs: sourceTabs,
      activeTabId: activeSourceTabId,
    });
  } catch (error) {
    console.error("Failed to save source tabs", error);
  }
}

async function hydrateSourceTabsFromDatabase(): Promise<void> {
  const loadedState = await loadSourceTabState();
  sourceTabs = loadedState.tabs;
  activeSourceTabId = loadedState.activeTabId;
  applyActiveSourceTab();
  renderSourceTabs();
}

async function loadSourceTabState(): Promise<SourceTabState> {
  const defaultState = defaultSourceTabState();

  try {
    const stored = await readUserState();
    if (isSourceTabState(stored)) {
      return normalizeSourceTabState(stored);
    }
  } catch (error) {
    console.error("Failed to load source tabs", error);
  }

  return defaultState;
}

function defaultSourceTabState(): SourceTabState {
  const tabs = defaultProjectIds.flatMap((projectId) => {
    const sample = samples.find((item) => item.id === projectId);
    return sample
      ? [{
          id: createSourceTabId(sample.id),
          projectId: sample.id,
          title: sample.label,
          source: sample.code,
        }]
      : [];
  });

  return {
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

function normalizeSourceTabState(state: SourceTabState): SourceTabState {
  const activeTabId = state.tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : state.tabs[0]?.id ?? null;

  return {
    tabs: state.tabs,
    activeTabId,
  };
}

function isSourceTabState(value: unknown): value is SourceTabState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const state = value as SourceTabState;
  return (
    Array.isArray(state.tabs) &&
    (typeof state.activeTabId === "string" || state.activeTabId === null) &&
    state.tabs.every((tab) => (
      typeof tab === "object" &&
      tab !== null &&
      typeof tab.id === "string" &&
      typeof tab.projectId === "string" &&
      typeof tab.title === "string" &&
      typeof tab.source === "string"
    ))
  );
}

function createSourceTabId(projectId: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${projectId}-${crypto.randomUUID()}`;
  }

  return `${projectId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readUserState(): Promise<unknown> {
  const db = await openUserDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(sourceTabStoreName, "readonly");
    const store = transaction.objectStore(sourceTabStoreName);
    const request = store.get(sourceTabStateKey);
    request.onerror = () => reject(request.error ?? new Error("Could not read source tab state"));
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not read source tab state"));
    };
  });
}

async function writeUserState(state: SourceTabState): Promise<void> {
  const db = await openUserDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(sourceTabStoreName, "readwrite");
    const store = transaction.objectStore(sourceTabStoreName);
    const request = store.put(state, sourceTabStateKey);
    request.onerror = () => reject(request.error ?? new Error("Could not save source tab state"));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not save source tab state"));
    };
  });
}

function openUserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(sourceTabDbName, sourceTabDbVersion);
    request.onerror = () => reject(request.error ?? new Error("Could not open user database"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sourceTabStoreName)) {
        db.createObjectStore(sourceTabStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
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
        setHighlightedPythonCode(implementationEl, event.implementation);
      }

      updateSnippetPreviewFromCompileEvent(event);

      if (event.kind === "readiness" && Array.isArray(event.definitions)) {
        updateReadinessDecorations(event.definitions);
      }

      if (event.kind === "typecheck" && Array.isArray(event.diagnostics)) {
        updateTypeCheckMarkers(event.diagnostics);
      }
    }
    sessionCapture.track("compile_stream_completed", { version }, true);
  } catch (error) {
    if (controller.signal.aborted || version !== compileVersion) {
      return;
    }

    setHighlightedPythonCode(implementationEl, source);
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

function refreshIncompleteSnippets(source: string): void {
  let targets: IncompleteSnippetTarget[] = [];

  try {
    const parsed = parse(source);
    targets = parsed.incompleteSnippets.map((snippet) => ({
      hash: hashCompletionInput(parsed, snippet.snippet),
      line: snippet.line,
      startColumn: snippet.column ?? 1,
      endColumn: snippet.column === undefined
        ? Number.MAX_SAFE_INTEGER
        : snippet.column + firstLineLength(snippet.snippet),
      kind: snippet.kind,
      snippet: snippet.snippet,
      label: incompleteSnippetLabel(snippet),
    }));
  } catch {
    targets = [];
  }

  const nextPreviewByHash = new Map<SnippetHash, SnippetPreviewState>();
  for (const target of targets) {
    const existing = snippetPreviewByHash.get(target.hash);
    nextPreviewByHash.set(target.hash, {
      snippet: target.snippet,
      streamed: existing?.streamed ?? "",
      implementation: existing?.implementation ?? null,
      status: existing?.status ?? "stub",
    });
  }

  incompleteSnippetsByLine = targets.reduce((byLine, target) => {
    const existing = byLine.get(target.line) ?? [];
    byLine.set(target.line, [...existing, target]);
    return byLine;
  }, new Map<number, IncompleteSnippetTarget[]>());
  incompleteSnippetByHash = new Map(targets.map((target) => [target.hash, target]));
  snippetPreviewByHash = nextPreviewByHash;

  if (selectedSnippetHash === null || !incompleteSnippetByHash.has(selectedSnippetHash)) {
    selectedSnippetHash = targets[0]?.hash ?? null;
  }

  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
}

function selectIncompleteSnippet(hash: SnippetHash, source: "editor_click" | "auto"): void {
  if (!incompleteSnippetByHash.has(hash)) {
    return;
  }

  selectedSnippetHash = hash;
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
  sessionCapture.track("incomplete_snippet_selected", {
    hash,
    source,
    label: incompleteSnippetByHash.get(hash)?.label ?? null,
  }, true);
}

function updateSnippetPreviewFromCompileEvent(event: CompileWireEvent): void {
  if (typeof event.hash !== "string") {
    return;
  }

  const current = snippetPreviewByHash.get(event.hash);
  if (!current) {
    return;
  }

  if (event.kind === "llm-start") {
    snippetPreviewByHash.set(event.hash, {
      ...current,
      streamed: "",
      implementation: null,
      status: "generating",
    });
    renderSnippetPanel();
    return;
  }

  if (event.kind === "llm-token" && typeof event.token === "string") {
    snippetPreviewByHash.set(event.hash, {
      ...current,
      streamed: current.streamed + event.token,
      status: "generating",
    });
    renderSnippetPanel();
    return;
  }

  if (
    (event.kind === "llm-complete" || event.kind === "cache-hit") &&
    typeof event.implementation === "string"
  ) {
    snippetPreviewByHash.set(event.hash, {
      ...current,
      streamed: "",
      implementation: event.implementation,
      status: event.kind === "cache-hit" ? "cached" : "complete",
    });
    renderSnippetPanel();
  }
}

function updateIncompleteSnippetDecorations(): void {
  const decorations = Array.from(incompleteSnippetByHash.values()).map((target) => ({
    range: new monaco.Range(
      target.line,
      target.startColumn,
      target.line,
      target.endColumn,
    ),
    options: {
      isWholeLine: target.kind !== "natural",
      className: target.kind === "natural"
        ? undefined
        : target.hash === selectedSnippetHash
          ? "incomplete-snippet-line incomplete-snippet-line-selected"
          : "incomplete-snippet-line",
      inlineClassName: target.kind !== "natural"
        ? undefined
        : target.hash === selectedSnippetHash
          ? "natural-snippet-inline natural-snippet-inline-selected"
          : "natural-snippet-inline",
      hoverMessage: {
        value: `Show generated implementation for ${target.label}.`,
      },
    },
  }));

  incompleteSnippetDecorations = editor.deltaDecorations(
    incompleteSnippetDecorations,
    decorations,
  );
}

function renderSnippetPanel(): void {
  const target = selectedSnippetHash === null
    ? null
    : incompleteSnippetByHash.get(selectedSnippetHash) ?? null;

  if (!target) {
    snippetTitle.textContent = "No snippet selected";
    snippetStatus.textContent = "Idle";
    snippetStatus.dataset.state = "";
    snippetPreview.textContent = "Click an incomplete definition in the worksheet.";
    return;
  }

  const preview = snippetPreviewByHash.get(target.hash);
  const status = preview?.status ?? "stub";
  const text =
    preview?.implementation ??
    (preview?.streamed.length ? preview.streamed : null) ??
    preview?.snippet ??
    target.snippet;

  snippetTitle.textContent = target.label;
  snippetStatus.textContent = snippetStatusLabel(status);
  snippetStatus.dataset.state = status;
  setHighlightedPythonCode(snippetPreview, text);
}

function setHighlightedPythonCode(element: HTMLPreElement, source: string): void {
  const version = Number(element.dataset.highlightVersion ?? "0") + 1;
  element.dataset.highlightVersion = String(version);
  element.textContent = source;
  const colorized = document.createElement("pre");
  colorized.textContent = source;

  void monaco.editor.colorizeElement(colorized, {
    mimeType: "text/x-python",
    tabSize: 2,
    theme: "vs-dark",
  }).then(() => {
    if (element.dataset.highlightVersion === String(version)) {
      element.innerHTML = colorized.innerHTML;
    }
  }).catch(() => {
    if (element.dataset.highlightVersion === String(version)) {
      element.textContent = source;
    }
  });
}

function incompleteSnippetLabel(snippet: IncompleteSnippet): string {
  const firstLine = snippet.snippet.trim().split("\n")[0] ?? "";
  if (snippet.kind === "natural") {
    const inner = firstLine.replace(/^`|`$/g, "").trim();
    return inner.length > 0 ? truncateLabel(inner) : "backtick snippet";
  }

  const functionMatch = firstLine.match(/^(?:async\s+)?(?:def|fn|function)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (functionMatch) {
    return functionMatch[1];
  }

  const classMatch = firstLine.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (classMatch) {
    return classMatch[1];
  }

  return snippet.kind === "class" ? "class snippet" : "function snippet";
}

function incompleteSnippetForPosition(
  lineNumber: number,
  column: number,
): IncompleteSnippetTarget | null {
  const snippets = incompleteSnippetsByLine.get(lineNumber) ?? [];
  const exact = snippets.find((snippet) => {
    return column >= snippet.startColumn && column <= snippet.endColumn;
  });

  return exact ?? snippets[0] ?? null;
}

function firstLineLength(source: string): number {
  return source.split("\n")[0]?.length ?? source.length;
}

function truncateLabel(label: string): string {
  return label.length <= 44 ? label : `${label.slice(0, 41)}...`;
}

function snippetStatusLabel(status: SnippetPreviewState["status"]): string {
  switch (status) {
    case "generating":
      return "Generating";
    case "cached":
      return "Cached";
    case "complete":
      return "Complete";
    case "stub":
      return "Stub";
  }
}

function beginSnippetPanelResize(event: PointerEvent): void {
  event.preventDefault();
  snippetResizeHandle.setPointerCapture(event.pointerId);

  const startY = event.clientY;
  const startHeight = snippetPanel.getBoundingClientRect().height;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    setSnippetPanelHeight(startHeight + startY - moveEvent.clientY);
  };
  const onPointerUp = (): void => {
    snippetResizeHandle.removeEventListener("pointermove", onPointerMove);
    snippetResizeHandle.removeEventListener("pointerup", onPointerUp);
    snippetResizeHandle.removeEventListener("pointercancel", onPointerUp);
  };

  snippetResizeHandle.addEventListener("pointermove", onPointerMove);
  snippetResizeHandle.addEventListener("pointerup", onPointerUp);
  snippetResizeHandle.addEventListener("pointercancel", onPointerUp);
}

function setSnippetPanelHeight(height: number): void {
  const outputHeight = outputPane.getBoundingClientRect().height;
  const minHeight = 132;
  const maxHeight = Math.max(minHeight, Math.floor(outputHeight * 0.72));
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, height));
  snippetPanel.style.flexBasis = `${nextHeight}px`;
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

function updateTypeCheckMarkers(diagnostics: TypeCheckDiagnostic[]): void {
  const model = editor.getModel();
  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(
    model,
    "logos-typecheck",
    diagnostics.map((diagnostic) => ({
      startLineNumber: diagnostic.line,
      startColumn: diagnostic.column,
      endLineNumber: diagnostic.endLine,
      endColumn: diagnostic.endColumn,
      severity:
        diagnostic.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Error,
      message: diagnostic.message,
      source: "Logos type check",
    })),
  );
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
      hash?: string;
      snippet?: string;
      token?: string;
      implementation?: string;
      error?: string;
      definitions?: DefinitionReadiness[];
      diagnostics?: TypeCheckDiagnostic[];
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
      selectedSnippet: selectedSnippetHash === null
        ? null
        : {
            hash: selectedSnippetHash,
            label: incompleteSnippetByHash.get(selectedSnippetHash)?.label ?? null,
            preview: snippetPreview.textContent ?? "",
            status: snippetStatus.textContent ?? "",
          },
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
