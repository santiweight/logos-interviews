import "./styles.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import {
  definitionReadiness,
  hashCompletionInput,
  implementationBlockForTarget,
  implementationTargetAtLine,
  parse,
  runnables,
  type DefinitionReadiness,
  type IncompleteSnippet,
  type ImplementationTarget,
  type Runnable,
  type SnippetHash,
} from "./codeSheet";
import { createSessionCapture, type JsonObject } from "./sessionCaptureClient";
import {
  defaultProjectIds,
  sampleGroups,
  samples,
  type SampleGroup,
  type SampleProgram,
} from "./samples";
import type { AgentChatMessage } from "./sheetAgent";
import type { TypeCheckDiagnostic } from "./typeCheck";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
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

type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

type RunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: string | null; error?: string };

type InteractiveRunStartResponse = {
  ok: true;
  sessionId: string;
  runnable: Runnable;
  implementation: string;
  chunks: RunChunk[];
  status: RunStatus;
};

type InteractiveRunPollResponse = {
  ok: true;
  runnable: Runnable;
  implementation: string;
  chunks: RunChunk[];
  status: RunStatus;
};

const sourceTabDbName = "logos-interviews-user";
const sourceTabDbVersion = 1;
const sourceTabStoreName = "state";
const sourceTabStateKey = "source-tabs-v2";
const staleDefaultProjectIdSets = [
  [
    "notification-retries",
    "feature-flag-rollout",
    "rate-limiter",
    "cart-promotions",
  ],
  [
    "add-multiply",
    "natural-snippet",
    "ascii-fractal",
    "formula-spreadsheet",
  ],
  [
    "starter-arithmetic",
    "ascii-fractal",
    "formula-spreadsheet",
  ],
];

const initialSourceTabState = defaultSourceTabState();
let sourceTabs = initialSourceTabState.tabs;
let activeSourceTabId = initialSourceTabState.activeTabId;
const seedCode = activeSourceTab()?.source ?? "";

const app = requiredQuery<HTMLDivElement>("#app");
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
const settingsIcon = `
  <svg class="menu-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8.6 3.6h2.8l.5 2 1.8.8 1.8-1.1 2 2-1.1 1.8.8 1.8 2 .5v2.8l-2 .5-.8 1.8 1.1 1.8-2 2-1.8-1.1-1.8.8-.5 2H8.6l-.5-2-1.8-.8-1.8 1.1-2-2 1.1-1.8-.8-1.8-2-.5v-2.8l2-.5.8-1.8-1.1-1.8 2-2 1.8 1.1 1.8-.8.5-2Z" />
    <circle cx="10" cy="10" r="2.4" />
  </svg>
`;
const plusIcon = `
  <svg class="plus-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
`;

function renderSampleGroup(group: SampleGroup): string {
  return `
    <details class="sample-menu-group">
      <summary class="sample-menu-group-title">
        <span>${group.label}</span>
        <span class="sample-menu-group-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="sample-menu-list">
        ${group.samples
          .map(
            (sample) =>
              `<button class="menu-item sample-menu-item" type="button" role="menuitem" data-sample-id="${sample.id}">${sample.label}</button>`,
          )
          .join("")}
      </div>
    </details>
  `;
}

app.innerHTML = `
  <section class="app-frame" aria-label="Spreadsheet interview workspace">
    <header class="app-header">
      <div class="app-header-left">
        <a class="brand-mark" href="/" aria-label="Logos">
          <img class="logos-wordmark" src="/logos-wordmark.png" alt="" />
        </a>
      </div>
      <div class="workspace-title" aria-hidden="true"></div>
      <div class="app-header-right">
        <details id="settings-menu" class="settings-menu">
          <summary class="menu-trigger" aria-label="Open settings menu" title="Settings">
            ${settingsIcon}
          </summary>
          <div class="menu-popover menu-popover-right" role="menu">
            <button id="clear-cache-button" class="menu-item" type="button" role="menuitem">
              Clear coding cache
            </button>
          </div>
        </details>
      </div>
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

      <section id="code-pane" class="code-pane" aria-label="Code editor panel">
        <div class="source-tabs-bar">
          <div id="source-tabs" class="source-tabs" role="tablist" aria-label="Open source projects"></div>
          <details id="sample-menu" class="sample-menu">
            <summary class="source-add-tab" aria-label="Add sample" title="Add sample">
              ${plusIcon}
            </summary>
            <div class="menu-popover sample-popover" role="menu">
              <div class="menu-section">
                <div class="menu-section-title">Samples</div>
                ${sampleGroups.map(renderSampleGroup).join("")}
              </div>
            </div>
          </details>
        </div>
        <div id="editor" class="editor" aria-label="Code editor"></div>
        <section id="snippet-panel" class="snippet-panel" aria-label="Selected implementation preview">
          <div
            id="snippet-resize-handle"
            class="snippet-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize incomplete implementation panel"
            tabindex="0"
          ></div>
          <header class="snippet-panel-header">
            <h2>Agent Code</h2>
          </header>
          <pre id="snippet-preview" class="output snippet-preview">Click a function, class, or incomplete snippet in the worksheet.</pre>
        </section>
      </section>

      <div
        id="code-run-resize-handle"
        class="code-run-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize code and run views"
        tabindex="0"
      ></div>

      <section id="output-pane" class="output-pane" aria-label="Program output panel">
        <div class="tool-tabs">
          <div id="tool-tabs-list" class="tabs" role="tablist" aria-label="Run output views">
            <button id="implementation-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="implementation">
              Implementation
            </button>
          </div>
          <span id="run-status" class="status">Not run</span>
        </div>
        <div id="tool-panels" class="tool-panels">
          <pre id="implementation" class="output tab-panel active" role="tabpanel" aria-labelledby="implementation-tab"></pre>
        </div>
      </section>
    </section>
  </section>
`;

const shell = requiredQuery<HTMLElement>("#shell");
const sourceTabsEl = requiredQuery<HTMLDivElement>("#source-tabs");
const codePane = requiredQuery<HTMLElement>("#code-pane");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const codeRunResizeHandle = requiredQuery<HTMLDivElement>("#code-run-resize-handle");
const outputPane = requiredQuery<HTMLElement>("#output-pane");
const toolTabsList = requiredQuery<HTMLDivElement>("#tool-tabs-list");
const toolPanels = requiredQuery<HTMLDivElement>("#tool-panels");
const implementationEl = requiredQuery<HTMLPreElement>("#implementation");
const snippetPanel = requiredQuery<HTMLElement>("#snippet-panel");
const snippetResizeHandle = requiredQuery<HTMLDivElement>("#snippet-resize-handle");
const snippetPreview = requiredQuery<HTMLPreElement>("#snippet-preview");
const clearCacheButton = requiredQuery<HTMLButtonElement>("#clear-cache-button");
const runStatus = requiredQuery<HTMLSpanElement>("#run-status");
const sampleMenu = requiredQuery<HTMLDetailsElement>("#sample-menu");
const settingsMenu = requiredQuery<HTMLDetailsElement>("#settings-menu");
const sampleMenuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".sample-menu-item"),
);
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
let selectedDefinitionDecorations: string[] = [];
let runnableStateByLine = new Map<number, RunnableState>();
let incompleteSnippetsByLine = new Map<number, IncompleteSnippetTarget[]>();
let incompleteSnippetByHash = new Map<SnippetHash, IncompleteSnippetTarget>();
let snippetPreviewByHash = new Map<SnippetHash, SnippetPreviewState>();
let selectedSnippetHash: SnippetHash | null = null;
let selectedDefinitionTarget: ImplementationTarget | null = null;
let latestImplementationSource = seedCode;
let runTabs: RunTab[] = [];
let activeToolTabId: ToolTabId = "implementation";

type RunnableState = {
  name: Runnable;
  ready: boolean;
  blockingDependencies: string[];
};

type ToolTabId = "implementation" | string;

type RunTab = {
  id: string;
  runnable: Runnable;
  sessionId: string | null;
  sourceHash: string;
  terminalText: string;
  implementation: string;
  status: RunStatus | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
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

    const definitionTarget = implementationTargetForLine(lineNumber);
    if (definitionTarget) {
      selectDefinitionImplementation(definitionTarget);
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
  settingsMenu.open = false;
  sessionCapture.track("clear_cache_requested", undefined, true);
  clearCache();
});
toolTabsList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const closeButton = target.closest<HTMLButtonElement>("[data-close-run-tab-id]");
  if (closeButton) {
    closeRunTab(closeButton.dataset.closeRunTabId ?? "");
    return;
  }

  const runTabButton = target.closest<HTMLButtonElement>("[data-run-tab-id]");
  if (runTabButton) {
    setActiveTab(runTabButton.dataset.runTabId ?? "implementation");
    sessionCapture.track("tab_changed", { tab: "run", runTabId: runTabButton.dataset.runTabId }, true);
    return;
  }

  if (target.closest("#implementation-tab")) {
    setActiveTab("implementation");
    sessionCapture.track("tab_changed", { tab: "implementation" }, true);
  }
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
codeRunResizeHandle.addEventListener("pointerdown", (event) => {
  beginCodeRunResize(event);
});
codeRunResizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  event.preventDefault();
  const currentWidth = codePane.getBoundingClientRect().width;
  setCodePaneWidth(currentWidth + (event.key === "ArrowLeft" ? -32 : 32));
});
toolPanels.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  sendTerminalInput(form.dataset.runInputFormId ?? "");
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

  sampleMenu.open = false;
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
    return;
  }

  const runTab = createRunTab(runnable, definitionHash(source));
  sessionCapture.track("run_requested", { runnable, source }, true);
  runStatus.textContent = `Running ${runnable} · last run ${lastRunLabel}`;
  runStatus.dataset.state = "";
  setActiveTab(runTab.id);
  renderRunTabs();

  const result = await startInteractiveRunViaDevApi(source, runnable).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  const currentTab = runTabById(runTab.id);
  if (!currentTab) {
    return;
  }

  if (!result.ok) {
    lastRunLabel = formatRunTime(new Date());
    lastRunDefinitionHash = definitionHash(source);
    lastRunStatusText = `Error · last run ${lastRunLabel}`;
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = "error";
    currentTab.terminalText = result.error;
    currentTab.status = { state: "exited", code: null, signal: null, error: result.error };
    renderRunTab(currentTab);
    updateRunStaleness();
    return;
  }

  latestImplementationSource = result.implementation;
  renderSnippetPanel();
  currentTab.sessionId = result.sessionId;
  currentTab.implementation = result.implementation;
  currentTab.status = result.status;
  implementationEl.textContent = result.implementation;
  appendTerminalChunks(currentTab, result.chunks);

  if (result.status.state === "running") {
    scheduleRunPoll(currentTab.id, 80);
    focusRunInput(currentTab.id);
    return;
  }

  finishInteractiveRun(currentTab, result.status, result.implementation);
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
  latestImplementationSource = source;
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
  closeAllRunTabs();
  const active = activeSourceTab();
  editor.setValue(active?.source ?? "");
  agentMessages = [];
  renderAgentLog();
  lastRunLabel = "never";
  lastRunStatusText = active ? "Not run" : "No open project";
  lastRunDefinitionHash = null;
  runStatus.textContent = active ? "Not run" : "No open project";
  runStatus.dataset.state = active ? "" : "error";
  updateRunStaleness(active?.source ?? "");
  scheduleCompilation(0);
  setActiveTab("implementation");
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
  if (isStaleDefaultSourceTabState(state)) {
    return defaultSourceTabState();
  }

  const activeTabId = state.tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : state.tabs[0]?.id ?? null;

  return {
    tabs: state.tabs,
    activeTabId,
  };
}

function isStaleDefaultSourceTabState(state: SourceTabState): boolean {
  const projectIds = state.tabs.map((tab) => tab.projectId);
  if (!staleDefaultProjectIdSets.some((staleProjectIds) => sameStringList(projectIds, staleProjectIds))) {
    return false;
  }

  if (projectIds.some((projectId) => samples.every((sample) => sample.id !== projectId))) {
    return true;
  }

  return state.tabs.every((tab) => {
    const sample = samples.find((item) => item.id === tab.projectId);
    return sample !== undefined && tab.title === sample.label && tab.source === sample.code;
  });
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
        latestImplementationSource = event.implementation;
        setHighlightedPythonCode(implementationEl, event.implementation);
        renderSnippetPanel();
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
  selectedDefinitionTarget = refreshedDefinitionTarget(source);

  if (
    selectedDefinitionTarget === null &&
    (selectedSnippetHash === null || !incompleteSnippetByHash.has(selectedSnippetHash))
  ) {
    selectedSnippetHash = targets[0]?.hash ?? null;
  } else if (selectedDefinitionTarget !== null) {
    selectedSnippetHash = null;
  }

  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
}

function selectIncompleteSnippet(hash: SnippetHash, source: "editor_click" | "auto"): void {
  if (!incompleteSnippetByHash.has(hash)) {
    return;
  }

  selectedDefinitionTarget = null;
  selectedSnippetHash = hash;
  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
  sessionCapture.track("incomplete_snippet_selected", {
    hash,
    source,
    label: incompleteSnippetByHash.get(hash)?.label ?? null,
  }, true);
}

function selectDefinitionImplementation(target: ImplementationTarget): void {
  selectedDefinitionTarget = target;
  selectedSnippetHash = null;
  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
  sessionCapture.track("definition_implementation_selected", {
    kind: target.kind,
    name: target.name,
    line: target.line,
  }, true);
}

function refreshedDefinitionTarget(source: string): ImplementationTarget | null {
  if (selectedDefinitionTarget === null) {
    return null;
  }

  const refreshed = implementationTargetForLine(selectedDefinitionTarget.line, source);
  if (
    refreshed === null ||
    refreshed.kind !== selectedDefinitionTarget.kind ||
    refreshed.name !== selectedDefinitionTarget.name
  ) {
    return null;
  }

  return refreshed;
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

function updateSelectedDefinitionDecorations(): void {
  const target = selectedDefinitionTarget;
  selectedDefinitionDecorations = editor.deltaDecorations(
    selectedDefinitionDecorations,
    target === null
      ? []
      : [{
          range: new monaco.Range(target.line, 1, target.endLine, Number.MAX_SAFE_INTEGER),
          options: {
            isWholeLine: true,
            className: "definition-implementation-line-selected",
            hoverMessage: {
              value: `Showing generated implementation for ${target.name}.`,
            },
          },
        }],
  );
}

function renderSnippetPanel(): void {
  if (selectedDefinitionTarget !== null) {
    const text =
      implementationBlockForTarget(latestImplementationSource, selectedDefinitionTarget) ??
      selectedDefinitionTarget.source;

    setHighlightedPythonCode(snippetPreview, text);
    return;
  }

  const target = selectedSnippetHash === null
    ? null
    : incompleteSnippetByHash.get(selectedSnippetHash) ?? null;

  if (!target) {
    snippetPreview.textContent = "Click a function, class, or incomplete snippet in the worksheet.";
    return;
  }

  const preview = snippetPreviewByHash.get(target.hash);
  const text =
    preview?.implementation ??
    (preview?.streamed.length ? preview.streamed : null) ??
    preview?.snippet ??
    target.snippet;

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

function implementationTargetForLine(
  lineNumber: number,
  source = editor.getValue(),
): ImplementationTarget | null {
  try {
    return implementationTargetAtLine(source, lineNumber);
  } catch {
    return null;
  }
}

function firstLineLength(source: string): number {
  return source.split("\n")[0]?.length ?? source.length;
}

function truncateLabel(label: string): string {
  return label.length <= 44 ? label : `${label.slice(0, 41)}...`;
}

function beginCodeRunResize(event: PointerEvent): void {
  event.preventDefault();
  codeRunResizeHandle.setPointerCapture(event.pointerId);
  shell.classList.add("resizing-code-run");

  const startX = event.clientX;
  const startWidth = codePane.getBoundingClientRect().width;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    setCodePaneWidth(startWidth + moveEvent.clientX - startX);
  };
  const onPointerUp = (): void => {
    shell.classList.remove("resizing-code-run");
    codeRunResizeHandle.removeEventListener("pointermove", onPointerMove);
    codeRunResizeHandle.removeEventListener("pointerup", onPointerUp);
    codeRunResizeHandle.removeEventListener("pointercancel", onPointerUp);
  };

  codeRunResizeHandle.addEventListener("pointermove", onPointerMove);
  codeRunResizeHandle.addEventListener("pointerup", onPointerUp);
  codeRunResizeHandle.addEventListener("pointercancel", onPointerUp);
}

function setCodePaneWidth(width: number): void {
  const shellRect = shell.getBoundingClientRect();
  const codeRect = codePane.getBoundingClientRect();
  const minCodeWidth = 360;
  const minOutputWidth = 300;
  const dividerAndGapWidth = 18;
  const maxCodeWidth = Math.max(
    minCodeWidth,
    shellRect.right - codeRect.left - minOutputWidth - dividerAndGapWidth,
  );
  const nextWidth = Math.min(maxCodeWidth, Math.max(minCodeWidth, width));
  shell.style.setProperty("--code-pane-width", `${Math.round(nextWidth)}px`);
  editor.layout();
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
  const codePaneHeight = codePane.getBoundingClientRect().height;
  const minHeight = 132;
  const maxHeight = Math.max(minHeight, Math.floor(codePaneHeight * 0.72));
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

function createRunTab(runnable: Runnable, sourceHash: string): RunTab {
  const tab: RunTab = {
    id: createRunTabId(runnable),
    runnable,
    sessionId: null,
    sourceHash,
    terminalText: "",
    implementation: implementationEl.textContent ?? "",
    status: { state: "running" },
    pollTimer: null,
  };
  runTabs = [...runTabs, tab];
  return tab;
}

function renderRunTabs(): void {
  for (const shell of Array.from(toolTabsList.querySelectorAll("[data-run-tab-shell-id]"))) {
    shell.remove();
  }

  for (const tab of runTabs) {
    const shell = document.createElement("div");
    shell.className = "tool-tab-shell";
    shell.dataset.runTabShellId = tab.id;

    const button = document.createElement("button");
    button.id = runTabButtonId(tab.id);
    button.className = `tab${activeToolTabId === tab.id ? " active" : ""}`;
    button.type = "button";
    button.role = "tab";
    button.dataset.runTabId = tab.id;
    button.setAttribute("aria-selected", String(activeToolTabId === tab.id));
    button.setAttribute("aria-controls", runPanelId(tab.id));
    button.textContent = `Run \`${tab.runnable}\``;

    const close = document.createElement("button");
    close.className = "tool-tab-close";
    close.type = "button";
    close.dataset.closeRunTabId = tab.id;
    close.setAttribute("aria-label", `Close run ${tab.runnable}`);
    close.textContent = "×";

    shell.append(button, close);
    toolTabsList.insertBefore(shell, implementationTab);
  }

  implementationTab.classList.toggle("active", activeToolTabId === "implementation");
  implementationTab.setAttribute("aria-selected", String(activeToolTabId === "implementation"));

  const activeIds = new Set(runTabs.map((tab) => tab.id));
  for (const panel of Array.from(toolPanels.querySelectorAll<HTMLElement>("[data-run-panel-id]"))) {
    if (!activeIds.has(panel.dataset.runPanelId ?? "")) {
      panel.remove();
    }
  }

  for (const tab of runTabs) {
    ensureRunPanel(tab);
    renderRunTab(tab);
  }
}

function ensureRunPanel(tab: RunTab): void {
  if (document.getElementById(runPanelId(tab.id))) {
    return;
  }

  const panel = document.createElement("div");
  panel.id = runPanelId(tab.id);
  panel.className = "output terminal-output tab-panel";
  panel.role = "tabpanel";
  panel.dataset.runPanelId = tab.id;
  panel.setAttribute("aria-labelledby", runTabButtonId(tab.id));
  panel.setAttribute("aria-live", "polite");

  const output = document.createElement("span");
  output.className = "terminal-output-text";
  output.dataset.runOutputId = tab.id;

  const form = document.createElement("form");
  form.className = "terminal-form";
  form.dataset.runInputFormId = tab.id;

  const input = document.createElement("input");
  input.className = "terminal-input";
  input.dataset.runInputId = tab.id;
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", `stdin for ${tab.runnable}`);

  form.append(input);
  panel.append(output, form);
  toolPanels.insertBefore(panel, implementationEl);
}

function renderRunTab(tab: RunTab): void {
  const panel = document.getElementById(runPanelId(tab.id));
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  const output = panel.querySelector<HTMLElement>("[data-run-output-id]");
  const form = panel.querySelector<HTMLFormElement>("[data-run-input-form-id]");
  const input = panel.querySelector<HTMLInputElement>("[data-run-input-id]");
  const running = tab.status?.state === "running";

  panel.classList.toggle("active", activeToolTabId === tab.id);
  panel.classList.toggle("terminal-running", running);
  if (output) {
    output.textContent = tab.terminalText;
  }
  if (form) {
    form.hidden = !running;
  }
  if (input) {
    input.disabled = !running;
  }

  panel.scrollTop = panel.scrollHeight;
}

function appendTerminalChunks(tab: RunTab, chunks: RunChunk[]): void {
  if (chunks.length === 0) {
    return;
  }

  tab.terminalText += chunks.map((chunk) => chunk.text).join("");
  renderRunTab(tab);
}

async function sendTerminalInput(runTabId: string): Promise<void> {
  const tab = runTabById(runTabId);
  if (!tab?.sessionId || tab.status?.state !== "running") {
    return;
  }

  const inputEl = document.querySelector<HTMLInputElement>(
    `[data-run-input-id="${cssEscape(runTabId)}"]`,
  );
  if (!inputEl) {
    return;
  }

  const input = `${inputEl.value}\n`;
  inputEl.value = "";
  const canSend = await drainRunOutputBeforeInput(tab);
  if (!canSend || !runTabById(runTabId)) {
    return;
  }

  tab.terminalText += input;
  renderRunTab(tab);
  sessionCapture.track("run_input_submitted", { input, runTabId, runnable: tab.runnable }, true);

  try {
    await sendInteractiveRunInputViaDevApi(tab.sessionId, input);
    focusRunInput(tab.id);
  } catch (error) {
    appendTerminalChunks(tab, [{
      stream: "stderr",
      text: `\n${error instanceof Error ? error.message : String(error)}\n`,
    }]);
    tab.status = { state: "exited", code: null, signal: null };
    renderRunTab(tab);
  }
}

async function drainRunOutputBeforeInput(tab: RunTab): Promise<boolean> {
  if (!tab.sessionId) {
    return false;
  }

  const result = await pollInteractiveRunViaDevApi(tab.sessionId).catch(() => null);
  if (!result || !runTabById(tab.id)) {
    return runTabById(tab.id) !== undefined;
  }

  tab.implementation = result.implementation;
  implementationEl.textContent = result.implementation;
  appendTerminalChunks(tab, result.chunks);
  if (result.status.state === "running") {
    return true;
  }

  finishInteractiveRun(tab, result.status, result.implementation);
  return false;
}

function scheduleRunPoll(runTabId: string, delayMs: number): void {
  const tab = runTabById(runTabId);
  if (!tab) {
    return;
  }

  if (tab.pollTimer) {
    clearTimeout(tab.pollTimer);
  }

  tab.pollTimer = setTimeout(() => {
    const currentTab = runTabById(runTabId);
    if (currentTab) {
      currentTab.pollTimer = null;
    }
    void pollRunTab(runTabId);
  }, delayMs);
}

async function pollRunTab(runTabId: string): Promise<void> {
  const tab = runTabById(runTabId);
  if (!tab?.sessionId) {
    return;
  }

  const result = await pollInteractiveRunViaDevApi(tab.sessionId).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  const currentTab = runTabById(runTabId);
  if (!currentTab) {
    return;
  }

  if (!result.ok) {
    currentTab.status = { state: "exited", code: null, signal: null, error: result.error };
    lastRunLabel = formatRunTime(new Date());
    lastRunDefinitionHash = currentTab.sourceHash;
    lastRunStatusText = `Error · last run ${lastRunLabel}`;
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = "error";
    appendTerminalChunks(currentTab, [{ stream: "stderr", text: `\n${result.error}\n` }]);
    updateRunStaleness();
    renderRunTabs();
    return;
  }

  currentTab.implementation = result.implementation;
  implementationEl.textContent = result.implementation;
  appendTerminalChunks(currentTab, result.chunks);

  if (result.status.state === "running") {
    currentTab.status = result.status;
    scheduleRunPoll(currentTab.id, 120);
    return;
  }

  finishInteractiveRun(currentTab, result.status, result.implementation);
}

function finishInteractiveRun(tab: RunTab, status: RunStatus, implementation: string): void {
  tab.status = status;
  tab.implementation = implementation;
  implementationEl.textContent = implementation;
  lastRunLabel = formatRunTime(new Date());
  lastRunDefinitionHash = tab.sourceHash;

  if (status.state === "exited" && status.code === 0) {
    lastRunStatusText = `Ran ${tab.runnable} · last run ${lastRunLabel}`;
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = "ok";
    sessionCapture.track(
      "run_completed",
      { runnable: tab.runnable, output: tab.terminalText, implementation },
      true,
    );
  } else {
    const stopped = status.state === "exited" && status.signal === "SIGTERM";
    lastRunStatusText = `${stopped ? "Stopped" : "Error"} · last run ${lastRunLabel}`;
    runStatus.textContent = lastRunStatusText;
    runStatus.dataset.state = "error";
    if (status.state === "exited" && status.error) {
      appendTerminalChunks(tab, [{ stream: "stderr", text: `\n${status.error}\n` }]);
    }
    sessionCapture.track(
      "run_failed",
      { runnable: tab.runnable, output: tab.terminalText, implementation, status },
      true,
    );
  }

  renderRunTabs();
  updateRunStaleness();
}

function closeRunTab(runTabId: string): void {
  const tab = runTabById(runTabId);
  if (!tab) {
    return;
  }

  if (tab.pollTimer) {
    clearTimeout(tab.pollTimer);
  }
  const sessionId = tab.sessionId;
  const running = tab.status?.state === "running";
  const index = runTabs.findIndex((item) => item.id === runTabId);
  runTabs = runTabs.filter((item) => item.id !== runTabId);

  if (activeToolTabId === runTabId) {
    activeToolTabId = runTabs[index]?.id ?? runTabs[index - 1]?.id ?? "implementation";
  }
  renderRunTabs();
  setActiveTab(activeToolTabId);

  if (sessionId && running) {
    void stopInteractiveRunViaDevApi(sessionId).catch(() => undefined);
  }
}

function closeAllRunTabs(): void {
  for (const tab of runTabs) {
    if (tab.pollTimer) {
      clearTimeout(tab.pollTimer);
    }
    if (tab.sessionId && tab.status?.state === "running") {
      void stopInteractiveRunViaDevApi(tab.sessionId).catch(() => undefined);
    }
  }
  runTabs = [];
  activeToolTabId = "implementation";
  renderRunTabs();
}

function focusRunInput(runTabId: string): void {
  if (activeToolTabId !== runTabId) {
    return;
  }

  document.querySelector<HTMLInputElement>(`[data-run-input-id="${cssEscape(runTabId)}"]`)?.focus();
}

function runTabById(runTabId: string): RunTab | undefined {
  return runTabs.find((tab) => tab.id === runTabId);
}

function runTabButtonId(runTabId: string): string {
  return `${runTabId}-tab`;
}

function runPanelId(runTabId: string): string {
  return `${runTabId}-panel`;
}

function createRunTabId(runnable: Runnable): string {
  return `run-${runnable.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replaceAll(/["\\]/g, "\\$&");
}

async function startInteractiveRunViaDevApi(
  sheet: string,
  runnable: Runnable,
): Promise<InteractiveRunStartResponse> {
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run/start",
    body: { sheet, runnable },
  });
  const response = await fetch("/api/run/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet, runnable }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    sessionId?: string;
    runnable?: string;
    chunks?: RunChunk[];
    status?: RunStatus;
    error?: string;
    implementation?: string;
  };

  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run/start",
    status: response.status,
    body: payload,
  });

  if (
    !response.ok ||
    payload.ok !== true ||
    typeof payload.sessionId !== "string" ||
    typeof payload.runnable !== "string" ||
    !Array.isArray(payload.chunks) ||
    !isRunStatus(payload.status) ||
    typeof payload.implementation !== "string"
  ) {
    throw new Error(payload.error ?? "Run request failed");
  }

  return {
    ok: true,
    sessionId: payload.sessionId,
    runnable: payload.runnable,
    chunks: payload.chunks,
    status: payload.status,
    implementation: payload.implementation,
  };
}

async function sendInteractiveRunInputViaDevApi(sessionId: string, input: string): Promise<void> {
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run/input",
    body: { sessionId, input },
  });
  const response = await fetch("/api/run/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, input }),
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run/input",
    status: response.status,
    body: payload,
  });

  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? "Input was not accepted");
  }
}

async function pollInteractiveRunViaDevApi(
  sessionId: string,
): Promise<InteractiveRunPollResponse> {
  const response = await fetch("/api/run/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    runnable?: string;
    chunks?: RunChunk[];
    status?: RunStatus;
    error?: string;
    implementation?: string;
  };

  if (
    !response.ok ||
    payload.ok !== true ||
    typeof payload.runnable !== "string" ||
    !Array.isArray(payload.chunks) ||
    !isRunStatus(payload.status) ||
    typeof payload.implementation !== "string"
  ) {
    throw new Error(payload.error ?? "Run poll failed");
  }

  return {
    ok: true,
    runnable: payload.runnable,
    chunks: payload.chunks,
    status: payload.status,
    implementation: payload.implementation,
  };
}

async function stopInteractiveRunViaDevApi(
  sessionId: string,
): Promise<{ ok: true; chunks: RunChunk[]; status: RunStatus }> {
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run/stop",
    body: { sessionId },
  });
  const response = await fetch("/api/run/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    chunks?: RunChunk[];
    status?: RunStatus;
    error?: string;
  };
  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run/stop",
    status: response.status,
    body: payload,
  });

  if (!response.ok || payload.ok !== true || !Array.isArray(payload.chunks)) {
    throw new Error(payload.error ?? "Stop request failed");
  }

  return {
    ok: true,
    chunks: payload.chunks,
    status: isRunStatus(payload.status) ? payload.status : { state: "running" },
  };
}

function isRunStatus(value: unknown): value is RunStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const status = value as RunStatus;
  return status.state === "running" || (
    status.state === "exited" &&
    (typeof status.code === "number" || status.code === null) &&
    (typeof status.signal === "string" || status.signal === null)
  );
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
    closeAllRunTabs();
    editor.setValue(result.sheet);
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

function setActiveTab(tab: ToolTabId): void {
  activeToolTabId = tab === "implementation" || runTabById(tab) ? tab : "implementation";
  const implementationActive = activeToolTabId === "implementation";
  implementationTab.classList.toggle("active", implementationActive);
  implementationTab.setAttribute("aria-selected", String(implementationActive));
  implementationEl.classList.toggle("active", implementationActive);
  outputPane.classList.toggle("snippet-open", implementationActive);
  renderRunTabs();
  if (activeToolTabId !== "implementation") {
    focusRunInput(activeToolTabId);
  }
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
      sampleMenuOpen: sampleMenu.open,
      settingsMenuOpen: settingsMenu.open,
      activeTab: activeToolTabId,
      lastRunLabel,
      runStatus: {
        text: runStatus.textContent ?? "",
        state: runStatus.dataset.state ?? "",
      },
      runStale: lastRunDefinitionHash !== null && definitionHash(editor.getValue()) !== lastRunDefinitionHash,
      output: activeToolTabId === "implementation"
        ? ""
        : runTabById(activeToolTabId)?.terminalText ?? "",
      runTabs: runTabs.map((tab) => ({
        id: tab.id,
        runnable: tab.runnable,
        status: tab.status,
        output: tab.terminalText,
      })),
      implementation: implementationEl.textContent ?? "",
      selectedSnippet: selectedSnippetHash === null
        ? null
        : {
            hash: selectedSnippetHash,
            label: incompleteSnippetByHash.get(selectedSnippetHash)?.label ?? null,
            preview: snippetPreview.textContent ?? "",
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
