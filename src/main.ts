import "./styles.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  conf as pythonLanguageConfiguration,
  language as pythonLanguage,
} from "monaco-editor/esm/vs/basic-languages/python/python.js";
import {
  completionSnippetHashes,
  definitionReadiness,
  hashCompletionInput,
  implementationBlockForTarget,
  implementationTargetAtLine,
  parse,
  runnables,
  selectionContextAtPosition,
  type DefinitionReadiness,
  type IncompleteSnippet,
  type ImplementationTarget,
  type Runnable,
  type SnippetHash,
} from "./codeSheet";
import { renderAnsiTerminalText } from "./ansiTerminal";
import { createSessionCapture, type JsonObject } from "./sessionCaptureClient";
import {
  defaultProjectIds,
  samples,
  sampleTemplateGroups,
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

type CompilationMode = "auto" | "parallel" | "parallel-methods" | "sequential" | "agentic" | "agentic-methods";

type AppSettings = {
  compilationStrategy: CompilationMode;
};

type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

type RunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: string | null; error?: string };

export type LoadableSessionSourceTab = SourceTab;

export type LoadableSessionRunTab = {
  id: string;
  runnable: Runnable;
  sourceHash: string;
  terminalText: string;
  implementation: string;
  status: RunStatus | null;
};

export type LoadableSessionSelection =
  | { kind: "snippet"; hash: string | null }
  | { kind: "definition"; line: number; name: string; targetKind: "function" | "class" }
  | { kind: "whole-file" }
  | { kind: "none" };

export type LoadableSession = {
  schemaVersion: 1;
  capturedAt: string;
  sessionId: string;
  workspaceId: string;
  sourceTabs: LoadableSessionSourceTab[];
  activeSourceTabId: string | null;
  editor: {
    value: string;
    cursor: { lineNumber: number; column: number } | null;
    scrollTop: number;
    scrollLeft: number;
  };
  compilation: {
    compileVersion: number;
    latestImplementationSource: string;
    selection: LoadableSessionSelection;
  };
  run: {
    activeToolTabId: string | null;
    lastRunLabel: string;
    lastRunStatusText: string;
    lastRunCompletedAtMs?: number | null;
    lastRunStatusPrefix?: string;
    lastRunStatusState?: string;
    lastRunDefinitionHash: string | null;
    runStatus: { text: string; state: string };
    tabs: LoadableSessionRunTab[];
  };
  agent: {
    expanded: boolean;
    input: string;
    messages: AgentChatMessage[];
  };
};

declare global {
  interface Window {
    loadLogosSession?: (session: LoadableSession) => Promise<void>;
    createLogosSessionBundle?: () => LoadableSession;
  }
}

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
const workspaceIdStorageKey = "logos-interviews-workspace-id";
const appSettingsStorageKey = "logos-interviews-settings-v1";
const experimentalCompilationStrategiesStorageKey = "logos.experimentalCompilationStrategies";
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
let appSettings = loadAppSettings();

const app = requiredQuery<HTMLDivElement>("#app");
const lambdaMark = `<span class="lambda-mark" aria-hidden="true">λ</span>`;
const sendIcon = `
  <svg class="send-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3.4 5.4 8l1.1 1.1 2.7-2.7v10.2h1.6V6.4l2.7 2.7L14.6 8z" />
  </svg>
`;
const plusIcon = `
  <svg class="plus-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
`;
const workspaceMenuIcon = `
  <svg class="workspace-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 7.5h10M5 12.5h10" />
    <circle cx="8" cy="7.5" r="1.4" />
    <circle cx="12" cy="12.5" r="1.4" />
  </svg>
`;
const thumbUpIcon = `
  <svg class="feedback-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M6.2 15.2h6.7c.8 0 1.5-.5 1.7-1.3L15.7 9c.2-.9-.5-1.7-1.4-1.7h-3.1V4.1c0-.9-1.2-1.2-1.6-.4L6.2 10z" />
  </svg>
`;
const thumbDownIcon = `
  <svg class="feedback-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M6.2 4.8h6.7c.8 0 1.5.5 1.7 1.3l1.1 4.9c.2.9-.5 1.7-1.4 1.7h-3.1v3.2c0 .9-1.2 1.2-1.6.4l-3.4-6.3z" />
  </svg>
`;
const shareIcon = `
  <svg class="feedback-icon share-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
`;
const logosWordmark = `<span class="logos-wordmark" aria-hidden="true">λogos</span>`;
const feedbackResetTimers = new WeakMap<HTMLElement, number>();
const templateGroups = createTemplateGroups(sampleTemplateGroups);

function renderFeedbackControls(panel: string, options: { includeShare?: boolean } = {}): string {
  return `
    <div class="feedback-controls" data-feedback-controls="${panel}" aria-label="${panel} feedback">
      <span class="feedback-receipt" data-feedback-receipt aria-live="polite"></span>
      ${options.includeShare
        ? `<button class="feedback-button share-button" type="button" data-share-session aria-label="Share session link" title="Share link">
          ${shareIcon}
        </button>`
        : ""}
      ${options.includeShare ? `<span class="feedback-separator" aria-hidden="true"></span>` : ""}
      <button class="feedback-button" type="button" data-feedback-panel="${panel}" data-feedback-rating="up" aria-label="Mark ${panel} helpful" title="Helpful">
        ${thumbUpIcon}
      </button>
      <button class="feedback-button" type="button" data-feedback-panel="${panel}" data-feedback-rating="down" aria-label="Mark ${panel} not helpful" title="Not helpful">
        ${thumbDownIcon}
      </button>
    </div>
  `;
}

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

function createTemplateGroups(groups: Array<{ label: string; sampleIds: string[] }>): SampleGroup[] {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
  const groupedSampleIds = new Set<string>();

  const templateGroups = groups.map((group) => ({
    label: group.label,
    samples: group.sampleIds.map((sampleId) => {
      const sample = sampleById.get(sampleId);
      if (!sample) {
        throw new Error(`Missing template sample: ${sampleId}`);
      }
      if (groupedSampleIds.has(sampleId)) {
        throw new Error(`Duplicate template sample: ${sampleId}`);
      }

      groupedSampleIds.add(sampleId);

      return sample;
    }),
  }));

  const ungroupedSample = samples.find((sample) => !groupedSampleIds.has(sample.id));
  if (ungroupedSample) {
    throw new Error(`Ungrouped template sample: ${ungroupedSample.id}`);
  }

  return templateGroups;
}

app.innerHTML = `
  <section class="app-frame" aria-label="Spreadsheet interview workspace">
    <section id="shell" class="shell agent-collapsed">
      <aside id="agent-sidebar" class="agent-sidebar">
        <button id="agent-toggle" class="agent-toggle-button" type="button" aria-label="Open edit panel" aria-expanded="false" aria-controls="agent-content">
          ${lambdaMark}
        </button>
        <div id="agent-content" class="agent-content">
          ${renderFeedbackControls("agent")}
          <div id="agent-log" class="agent-log" aria-live="polite"></div>
          <form id="agent-form" class="agent-form">
            <textarea id="agent-input" class="agent-input" rows="3" placeholder="Describe a change"></textarea>
            <button id="agent-send" class="send-button" type="submit" aria-label="Send message" title="Send">
              ${sendIcon}
            </button>
          </form>
        </div>
        <div class="agent-sidebar-footer">
          <details id="workspace-menu" class="workspace-menu">
            <summary class="sidebar-menu-trigger" aria-label="Open settings menu" title="Settings">
              ${workspaceMenuIcon}
              <span class="sidebar-menu-label">Settings</span>
            </summary>
            <div class="menu-popover workspace-popover" role="menu">
              <label class="settings-toggle menu-setting-row" for="compilation-strategy-select">
                <span class="settings-toggle-copy">
                  <span class="settings-toggle-title">Code generation strategy</span>
                  <span class="settings-toggle-description">Auto tries fast generation first, then falls back when needed.</span>
                </span>
                <select id="compilation-strategy-select" class="settings-select">
                  ${renderCompilationStrategyOptions(appSettings.compilationStrategy)}
                </select>
              </label>
              <div class="menu-separator" role="separator"></div>
              <button id="clear-code-cache-button" class="menu-item" type="button" role="menuitem">
                Clear code cache
              </button>
              <button id="reset-workspace-button" class="menu-item menu-item-danger" type="button" role="menuitem">
                Reset workspace
              </button>
            </div>
          </details>
        </div>
      </aside>

      <div id="agent-code-resize-handle" class="agent-code-resize-handle" aria-hidden="true"></div>

      <section id="code-pane" class="code-pane" aria-label="Code editor panel">
        <div class="source-tabs-bar">
          <div id="source-tabs" class="source-tabs" role="tablist" aria-label="Open source projects"></div>
          <details id="sample-menu" class="sample-menu">
            <summary class="source-add-tab" aria-label="Add file" title="Add file">
              ${plusIcon}
            </summary>
            <div class="menu-popover sample-popover" role="menu">
              <div class="menu-section">
                <button id="scratch-file-button" class="menu-item scratch-file-menu-item" type="button" role="menuitem">
                  <span class="menu-item-icon">${plusIcon}</span>
                  <span>Scratch new file</span>
                </button>
                <div class="menu-separator" role="separator"></div>
                <div class="menu-section-title">Templates</div>
                ${templateGroups.map(renderSampleGroup).join("")}
              </div>
            </div>
          </details>
        </div>
        <div id="editor" class="editor" aria-label="Code editor"></div>
        <div class="code-feedback-overlay">
          ${renderFeedbackControls("code", { includeShare: true })}
        </div>
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
            <h2 id="snippet-title">Compilation View</h2>
            ${renderFeedbackControls("compilation")}
          </header>
          <div id="snippet-preview" class="snippet-preview" aria-label="Compilation preview"></div>
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
        <div class="source-tabs-bar output-tabs-bar">
          <div id="tool-tabs-list" class="source-tabs output-tabs" role="tablist" aria-label="Run output views">
          </div>
          <span id="run-status" class="status"></span>
          ${renderFeedbackControls("output")}
        </div>
        <div id="tool-panels" class="tool-panels">
          <pre id="run-placeholder" class="output run-placeholder tab-panel active" aria-live="polite">Runs will appear here.</pre>
        </div>
      </section>
    </section>
  </section>
`;

const shell = requiredQuery<HTMLElement>("#shell");
const agentSidebar = requiredQuery<HTMLElement>("#agent-sidebar");
const agentCodeResizeHandle = requiredQuery<HTMLDivElement>("#agent-code-resize-handle");
const sourceTabsEl = requiredQuery<HTMLDivElement>("#source-tabs");
const codePane = requiredQuery<HTMLElement>("#code-pane");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const codeRunResizeHandle = requiredQuery<HTMLDivElement>("#code-run-resize-handle");
const outputPane = requiredQuery<HTMLElement>("#output-pane");
const toolTabsList = requiredQuery<HTMLDivElement>("#tool-tabs-list");
const toolPanels = requiredQuery<HTMLDivElement>("#tool-panels");
const runPlaceholder = requiredQuery<HTMLPreElement>("#run-placeholder");
const snippetPanel = requiredQuery<HTMLElement>("#snippet-panel");
const snippetResizeHandle = requiredQuery<HTMLDivElement>("#snippet-resize-handle");
const snippetTitle = requiredQuery<HTMLHeadingElement>("#snippet-title");
const snippetPreview = requiredQuery<HTMLDivElement>("#snippet-preview");
const runStatus = requiredQuery<HTMLSpanElement>("#run-status");
const sampleMenu = requiredQuery<HTMLDetailsElement>("#sample-menu");
const workspaceMenu = requiredQuery<HTMLDetailsElement>("#workspace-menu");
const clearCodeCacheButton = requiredQuery<HTMLButtonElement>("#clear-code-cache-button");
const resetWorkspaceButton = requiredQuery<HTMLButtonElement>("#reset-workspace-button");
const compilationStrategySelect = requiredQuery<HTMLSelectElement>("#compilation-strategy-select");
const scratchFileButton = requiredQuery<HTMLButtonElement>("#scratch-file-button");
const sampleMenuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".sample-menu-item"),
);
const agentToggle = requiredQuery<HTMLButtonElement>("#agent-toggle");
const agentLog = requiredQuery<HTMLDivElement>("#agent-log");
const agentForm = requiredQuery<HTMLFormElement>("#agent-form");
const agentInput = requiredQuery<HTMLTextAreaElement>("#agent-input");
const agentSend = requiredQuery<HTMLButtonElement>("#agent-send");
let lastRunLabel = "never";
let lastRunStatusText = "";
let lastRunCompletedAtMs: number | null = null;
let lastRunStatusPrefix = "";
let lastRunStatusState = "";
let lastRunDefinitionHash: string | null = null;
let agentMessages: AgentChatMessage[] = [];
let agentExpanded = false;
let compileController: AbortController | null = null;
let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileVersion = 0;
let sourceTabSaveTimer: ReturnType<typeof setTimeout> | null = null;
let compilationPending = false;
let latestReadinessDefinitions: DefinitionReadiness[] = [];
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
let selectedWholeFileImplementation = false;
let naturalSnippetEditorMode: "python" | "natural" = "python";
let latestImplementationSource = seedCode;
let runTabs: RunTab[] = [];
let activeToolTabId: ToolTabId = null;

type RunnableState = {
  name: Runnable;
  ready: boolean;
  blockingDependencies: string[];
  compiling: boolean;
};

type ToolTabId = string | null;

type RunTab = {
  id: string;
  runnable: Runnable;
  source: string;
  sessionId: string | null;
  sourceHash: string;
  terminalText: string;
  implementation: string;
  status: RunStatus | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
};

type IncompleteSnippetTarget = {
  hash: SnippetHash;
  startLine: number;
  startColumn: number;
  endLine: number;
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

const logosPythonLanguageId = "logos-python";

registerLogosPythonLanguage();

monaco.editor.defineTheme("interview-light", {
  base: "vs",
  inherit: false,
  rules: [
    { token: "", foreground: "20242a" },
    { token: "comment", foreground: "607fa0" },
    { token: "keyword", foreground: "7a5268", fontStyle: "normal" },
    { token: "identifier", foreground: "20242a" },
    { token: "number", foreground: "3f6f6a" },
    { token: "number.hex", foreground: "3f6f6a" },
    { token: "string", foreground: "7a5a3a" },
    { token: "string.escape", foreground: "8a6844" },
    { token: "delimiter", foreground: "aca59b" },
    { token: "delimiter.curly", foreground: "aca59b" },
    { token: "delimiter.bracket", foreground: "aca59b" },
    { token: "delimiter.parenthesis", foreground: "aca59b" },
    { token: "operator", foreground: "8e8375" },
    { token: "type", foreground: "3f6f6a" },
    { token: "predefined", foreground: "4f677c" },
    { token: "naturalSnippet", foreground: "b74716" },
    { token: "naturalSnippet.delimiter", foreground: "9b4d2e" },
    { token: "comment.logos-python", foreground: "607fa0" },
    { token: "keyword.logos-python", foreground: "7a5268", fontStyle: "normal" },
    { token: "identifier.logos-python", foreground: "20242a" },
    { token: "number.logos-python", foreground: "3f6f6a" },
    { token: "number.hex.logos-python", foreground: "3f6f6a" },
    { token: "string.logos-python", foreground: "7a5a3a" },
    { token: "string.escape.logos-python", foreground: "8a6844" },
    { token: "delimiter.logos-python", foreground: "aca59b" },
    { token: "delimiter.curly.logos-python", foreground: "aca59b" },
    { token: "delimiter.bracket.logos-python", foreground: "aca59b" },
    { token: "delimiter.parenthesis.logos-python", foreground: "aca59b" },
    { token: "operator.logos-python", foreground: "8e8375" },
    { token: "type.logos-python", foreground: "3f6f6a" },
    { token: "predefined.logos-python", foreground: "4f677c" },
    { token: "naturalSnippet.logos-python", foreground: "b74716" },
    { token: "naturalSnippet.delimiter.logos-python", foreground: "9b4d2e" },
  ],
  colors: {
    "editor.background": "#fbfaf6",
    "editorGutter.background": "#fbfaf6",
    "editor.foreground": "#20242a",
    "editorLineNumber.foreground": "#74767a",
    "editorLineNumber.activeForeground": "#07080a",
    "editor.selectionBackground": "#d8e3eb",
    "editor.lineHighlightBackground": "#f1eee7",
    "editor.wordHighlightBackground": "#00000000",
    "editor.wordHighlightStrongBackground": "#00000000",
    "editor.wordHighlightTextBackground": "#00000000",
    "editorBracketMatch.background": "#00000000",
    "editorBracketMatch.border": "#00000000",
    "editorBracketHighlight.foreground1": "#aca59b",
    "editorBracketHighlight.foreground2": "#aca59b",
    "editorBracketHighlight.foreground3": "#aca59b",
    "editorBracketHighlight.foreground4": "#aca59b",
    "editorBracketHighlight.foreground5": "#aca59b",
    "editorBracketHighlight.foreground6": "#aca59b",
    "editorBracketHighlight.unexpectedBracket.foreground": "#aca59b",
    "editorIndentGuide.background1": "#e2ddd4",
    "editorIndentGuide.activeBackground1": "#adc0d6",
  },
});

const editor = monaco.editor.create(editorEl, {
  value: seedCode,
  language: logosPythonLanguageId,
  theme: "interview-light",
  automaticLayout: true,
  fontFamily:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: 14,
  lineHeight: 22,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  renderLineHighlight: "none",
  tabSize: 2,
  insertSpaces: true,
  glyphMargin: true,
  lineNumbers: "off",
  lineNumbersMinChars: 0,
  lineDecorationsWidth: 8,
  folding: false,
  matchBrackets: "never",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  bracketPairColorization: { enabled: false },
  "semanticHighlighting.enabled": false,
  guides: {
    indentation: false,
    highlightActiveIndentation: false,
  },
  padding: { top: 12, bottom: 12 },
});

const snippetPreviewEditor = monaco.editor.create(snippetPreview, {
  value: "",
  language: logosPythonLanguageId,
  theme: "interview-light",
  automaticLayout: true,
  fontFamily:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: 14,
  lineHeight: 22,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  renderLineHighlight: "none",
  tabSize: 2,
  insertSpaces: true,
  glyphMargin: true,
  lineNumbers: "off",
  lineNumbersMinChars: 0,
  lineDecorationsWidth: 8,
  folding: false,
  readOnly: true,
  domReadOnly: true,
  matchBrackets: "never",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  bracketPairColorization: { enabled: false },
  "semanticHighlighting.enabled": false,
  guides: {
    indentation: false,
    highlightActiveIndentation: false,
  },
  padding: { top: 12, bottom: 12 },
});

attachBlockIndentGuideOverlay(editor);
attachBlockIndentGuideOverlay(snippetPreviewEditor);
installEditorTypingAssist(editor);

const sessionCapture = createSessionCapture({ getSnapshot: appSnapshot });
let editorCaptureTimer: ReturnType<typeof setTimeout> | null = null;
let isLoadingSession = false;

editor.onDidChangeModelContent(() => {
  if (isLoadingSession) {
    return;
  }

  const active = activeSourceTab();
  if (active) {
    active.source = editor.getValue();
    scheduleSaveSourceTabs();
  }

  scheduleCompilation(250);
  scheduleEditorCapture();
});

editor.onDidChangeCursorPosition(() => {
  updateNaturalSnippetEditorMode();
});

editor.onMouseDown((event) => {
  const lineNumber = event.target.position?.lineNumber;

  if (lineNumber !== undefined && event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
    const column = event.target.position?.column ?? 1;
    const context = selectionContextAtPosition(editor.getValue(), lineNumber, column);

    if (context.kind === "snippet") {
      const incompleteSnippet = exactIncompleteSnippetForPosition(lineNumber, column);
      if (incompleteSnippet) {
        selectIncompleteSnippet(incompleteSnippet.hash, "editor_click");
        return;
      }
    }

    if (context.kind === "implementation") {
      selectDefinitionImplementation(context.target);
      return;
    }

    const nearbyNaturalSnippet = nearbyNaturalSnippetForLine(lineNumber);
    if (nearbyNaturalSnippet) {
      selectIncompleteSnippet(nearbyNaturalSnippet.hash, "editor_click");
      return;
    }

    selectWholeFileImplementation(lineNumber);
    return;
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
    runStatus.textContent = compilationPending
      ? "Dependencies still compiling"
      : `${runnable.name} is blocked`;
    runStatus.dataset.state = "error";
    return;
  }

  runCurrentProgram(runnable.name);
});

resetWorkspaceButton.addEventListener("click", () => {
  workspaceMenu.open = false;
  if (!window.confirm("Reset workspace? This removes your open files and restores the default templates.")) {
    sessionCapture.track("reset_workspace_cancelled", undefined, true);
    return;
  }

  sessionCapture.track("reset_workspace_requested", undefined, true);
  void resetWorkspace();
});
compilationStrategySelect.addEventListener("change", () => {
  setCompilationStrategy(compilationMode(compilationStrategySelect.value));
});
clearCodeCacheButton.addEventListener("click", () => {
  workspaceMenu.open = false;
  sessionCapture.track("code_cache_clear_requested", undefined, true);
  void clearCodeCache();
});
app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const runPanel = target?.closest<HTMLElement>("[data-run-panel-id]") ?? null;
  if (runPanel) {
    focusTerminalInput(runPanel.dataset.runPanelId ?? "");
  }

  const shareButton = target?.closest<HTMLButtonElement>("[data-share-session]") ?? null;
  if (shareButton) {
    void shareCurrentSessionFromButton(shareButton);
    return;
  }

  const button = target
    ? target.closest<HTMLButtonElement>("[data-feedback-rating]")
    : null;
  if (!button) {
    return;
  }

  void submitFeedbackFromButton(button);
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
    setActiveTab(runTabButton.dataset.runTabId ?? null);
    sessionCapture.track("tab_changed", { tab: "run", runTabId: runTabButton.dataset.runTabId }, true);
  }
});
agentToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const expanded = !agentExpanded;
  setAgentExpanded(expanded);
  sessionCapture.track("agent_toggle", { expanded }, true);
});
agentSidebar.addEventListener("click", (event) => {
  if (agentExpanded) {
    return;
  }

  const target = event.target;
  if (target instanceof Element && target.closest("#workspace-menu")) {
    return;
  }

  setAgentExpanded(true);
  sessionCapture.track("agent_sidebar_expand", undefined, true);
});
agentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sessionCapture.track("agent_submit", { input: agentInput.value }, true);
  runAgentTurn();
});
codeRunResizeHandle.addEventListener("pointerdown", (event) => {
  beginCodeRunResize(event);
});
agentCodeResizeHandle.addEventListener("pointerdown", (event) => {
  beginAgentCodeResize(event);
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
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || (!sampleMenu.open && !workspaceMenu.open)) {
    return;
  }

  const activeElement = document.activeElement;
  const openMenu = sampleMenu.open ? sampleMenu : workspaceMenu;
  const restoreFocus =
    activeElement instanceof Element &&
    (sampleMenu.contains(activeElement) || workspaceMenu.contains(activeElement));

  event.preventDefault();
  closeOpenMenus();

  if (restoreFocus) {
    openMenu.querySelector<HTMLElement>("summary")?.focus();
  }
});
scratchFileButton.addEventListener("click", () => {
  openScratchFile();
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

function closeOpenMenus(): void {
  sampleMenu.open = false;
  workspaceMenu.open = false;
}

renderSourceTabs();
renderAgentLog();
updateShellResizeHandles();
scheduleCompilation(0);
void bootWorkspace();

const shellResizeObserver = new ResizeObserver(() => {
  updateShellResizeHandles();
});
shellResizeObserver.observe(shell);
shellResizeObserver.observe(agentSidebar);
shellResizeObserver.observe(codePane);
shellResizeObserver.observe(outputPane);
window.setInterval(() => {
  updateRunStaleness();
}, 1000);

async function runCurrentProgram(requestedRunnable?: Runnable): Promise<void> {
  const source = editor.getValue();
  const runnable = requestedRunnable ?? firstRunnable(source);
  if (!runnable) {
    sessionCapture.track("run_blocked", { reason: "no_runnable" }, true);
    runStatus.textContent = `No runnable · last run ${lastRunAgeLabel()}`;
    runStatus.dataset.state = "error";
    return;
  }

  const runTab = createRunTab(runnable, source, definitionHash(source));
  sessionCapture.track("run_requested", { runnable, source }, true);
  runStatus.textContent = `Running ${runnable} · last run ${lastRunAgeLabel()}`;
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
    markLastRunCompleted();
    lastRunDefinitionHash = definitionHash(source);
    setLastRunStatus("Error", "error");
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
  appendTerminalChunks(currentTab, result.chunks);

  if (result.status.state === "running") {
    scheduleRunPoll(currentTab.id, 80);
    return;
  }

  finishInteractiveRun(currentTab, result.status, result.implementation);
}

async function resetWorkspace(): Promise<void> {
  resetWorkspaceButton.disabled = true;
  runStatus.textContent = "Resetting workspace";
  runStatus.dataset.state = "";

  try {
    if (sourceTabSaveTimer) {
      clearTimeout(sourceTabSaveTimer);
      sourceTabSaveTimer = null;
    }
    compileController?.abort();
    compileController = null;
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }

    await clearUserState();
    const defaultState = defaultSourceTabState();
    sourceTabs = defaultState.tabs;
    activeSourceTabId = defaultState.activeTabId;
    applyActiveSourceTab();
    renderSourceTabs();
    scheduleSaveSourceTabs();

    runStatus.textContent = "Workspace reset";
    runStatus.dataset.state = "ok";
    sessionCapture.track("reset_workspace_completed", {
      openProjects: sourceTabs.map((tab) => tab.projectId),
      activeProjectId: activeSourceTab()?.projectId ?? null,
    }, true);
  } catch (error) {
    runStatus.textContent = "Workspace reset failed";
    runStatus.dataset.state = "error";
    sessionCapture.track(
      "reset_workspace_failed",
      { error: error instanceof Error ? error.message : String(error) },
      true,
    );
  } finally {
    resetWorkspaceButton.disabled = false;
  }
}

async function clearCodeCache(): Promise<void> {
  clearCodeCacheButton.disabled = true;
  runStatus.textContent = "Clearing code cache";
  runStatus.dataset.state = "";

  try {
    const response = await fetch("/api/cache", { method: "DELETE" });
    const payload = (await response.json()) as { ok?: boolean; cleared?: unknown; error?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? "Could not clear code cache");
    }

    runStatus.textContent = "Code cache cleared";
    runStatus.dataset.state = "ok";
    sessionCapture.track("code_cache_clear_completed", {
      cleared: typeof payload.cleared === "number" ? payload.cleared : null,
    }, true);
    scheduleCompilation(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runStatus.textContent = "Code cache clear failed";
    runStatus.dataset.state = "error";
    sessionCapture.track("code_cache_clear_failed", { error: message }, true);
  } finally {
    clearCodeCacheButton.disabled = false;
  }
}

function setCompilationStrategy(strategy: CompilationMode): void {
  if (appSettings.compilationStrategy === strategy) {
    compilationStrategySelect.value = strategy;
    return;
  }

  appSettings = {
    ...appSettings,
    compilationStrategy: strategy,
  };
  saveAppSettings(appSettings);
  compilationStrategySelect.value = strategy;
  sessionCapture.track("setting_changed", {
    setting: "compilationStrategy",
    strategy,
  }, true);
  scheduleCompilation(0);
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
  compilationPending = true;
  latestImplementationSource = source;
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

function openScratchFile(): void {
  syncActiveSourceTab();
  sampleMenu.open = false;

  const tab: SourceTab = {
    id: createSourceTabId("scratch"),
    projectId: "scratch",
    title: nextScratchFileTitle(),
    source: "",
  };

  sourceTabs = [...sourceTabs, tab];
  activeSourceTabId = tab.id;
  applyActiveSourceTab();
  renderSourceTabs();
  scheduleSaveSourceTabs();
  updateActiveProjectMenuItem();
  sessionCapture.track("scratch_file_opened", { tabId: tab.id, title: tab.title }, true);
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
  lastRunCompletedAtMs = null;
  lastRunStatusPrefix = "";
  lastRunStatusState = "";
  lastRunStatusText = active ? "" : "No open file";
  lastRunDefinitionHash = null;
  runStatus.textContent = lastRunStatusText;
  runStatus.dataset.state = active ? "" : "error";
  updateRunStaleness(active?.source ?? "");
  scheduleCompilation(0);
  setActiveTab(null);
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
    sourceTabsEl.innerHTML = `<div class="source-tabs-empty">No open files</div>`;
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
  sampleMenuItems.forEach((item) => {
    item.classList.remove("active");
  });
}

function nextScratchFileTitle(): string {
  const scratchCount = sourceTabs.filter((tab) => tab.projectId === "scratch").length;
  return scratchCount === 0 ? "Scratch" : `Scratch ${scratchCount + 1}`;
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

async function bootWorkspace(): Promise<void> {
  await hydrateSourceTabsFromDatabase();
  await loadSharedSessionFromUrl();
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

async function clearUserState(): Promise<void> {
  const db = await openUserDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(sourceTabStoreName, "readwrite");
    const store = transaction.objectStore(sourceTabStoreName);
    const request = store.delete(sourceTabStateKey);
    request.onerror = () => reject(request.error ?? new Error("Could not reset source tab state"));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not reset source tab state"));
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

    latestImplementationSource = source;
    renderSnippetPanel();
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
    if (version === compileVersion) {
      compilationPending = false;
      updateReadinessDecorations(latestReadinessDefinitions);
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
  lastRunLabel = lastRunAgeLabel();
  const stale = lastRunDefinitionHash !== null && definitionHash(source) !== lastRunDefinitionHash;

  if (stale && (runStatus.dataset.state === "ok" || runStatus.dataset.state === "error" || runStatus.dataset.state === "stale")) {
    runStatus.textContent = `Run is out of date · last run ${lastRunLabel}`;
    runStatus.dataset.state = "stale";
    return;
  }

  if (!stale && runStatus.dataset.state === "stale") {
    refreshLastRunStatus();
  } else if (
    !stale &&
    lastRunStatusPrefix &&
    runStatus.textContent === lastRunStatusText &&
    (runStatus.dataset.state === "ok" || runStatus.dataset.state === "error")
  ) {
    refreshLastRunStatus();
  }
}

function refreshIncompleteSnippets(source: string): void {
  let targets: IncompleteSnippetTarget[] = [];

  try {
    const parsed = parse(source);
    const compilerHashes = completionSnippetHashes(parsed);
    targets = parsed.incompleteSnippets.map((snippet, index) => {
      const range = snippetRange(source, snippet);
      return {
        hash: compilerHashes[index] ?? hashCompletionInput(parsed, snippet.snippet),
        startLine: range.startLine,
        startColumn: range.startColumn,
        endLine: range.endLine,
        endColumn: range.endColumn,
        kind: snippet.kind,
        snippet: snippet.snippet,
        label: incompleteSnippetLabel(snippet),
      };
    });
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
    for (let line = target.startLine; line <= target.endLine; line += 1) {
      const existing = byLine.get(line) ?? [];
      byLine.set(line, [...existing, target]);
    }

    return byLine;
  }, new Map<number, IncompleteSnippetTarget[]>());
  incompleteSnippetByHash = new Map(targets.map((target) => [target.hash, target]));
  snippetPreviewByHash = nextPreviewByHash;
  selectedDefinitionTarget = refreshedDefinitionTarget(source);

  if (
    selectedDefinitionTarget === null &&
    !selectedWholeFileImplementation &&
    (selectedSnippetHash === null || !incompleteSnippetByHash.has(selectedSnippetHash))
  ) {
    selectedSnippetHash = targets[0]?.hash ?? null;
  } else if (selectedDefinitionTarget !== null) {
    selectedWholeFileImplementation = false;
    selectedSnippetHash = null;
  }

  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  updateNaturalSnippetEditorMode();
  renderSnippetPanel();
}

function selectIncompleteSnippet(hash: SnippetHash, source: "editor_click" | "auto"): void {
  if (!incompleteSnippetByHash.has(hash)) {
    return;
  }

  selectedDefinitionTarget = null;
  selectedWholeFileImplementation = false;
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
  selectedWholeFileImplementation = false;
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

function selectWholeFileImplementation(lineNumber: number): void {
  selectedDefinitionTarget = null;
  selectedSnippetHash = null;
  selectedWholeFileImplementation = true;
  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
  sessionCapture.track("whole_file_implementation_selected", {
    line: lineNumber,
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
  const decorations = Array.from(incompleteSnippetByHash.values()).map((target) => {
    const decorationRange = target.kind === "natural"
      ? naturalSnippetBodyRange(target)
      : new monaco.Range(
        target.startLine,
        target.startColumn,
        target.endLine,
        target.endColumn,
      );

    return {
      range: decorationRange,
      options: {
        isWholeLine: false,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        className: undefined,
        marginClassName: undefined,
        inlineClassName: target.kind === "natural"
          ? target.hash === selectedSnippetHash
            ? "natural-snippet-inline natural-snippet-plain natural-snippet-inline-selected"
            : "natural-snippet-inline natural-snippet-plain"
          : undefined,
      },
    };
  });

  incompleteSnippetDecorations = editor.deltaDecorations(
    incompleteSnippetDecorations,
    decorations,
  );
}

function naturalSnippetBodyRange(target: IncompleteSnippetTarget): monaco.Range {
  const delimiterLength = target.snippet.startsWith("```") ? 3 : 1;
  const bodyStartOffset = delimiterLength;
  const bodyEndOffset = Math.max(bodyStartOffset, target.snippet.length - delimiterLength);
  return snippetOffsetRangeToEditorRange(target, bodyStartOffset, bodyEndOffset);
}

function snippetOffsetRangeToEditorRange(
  target: IncompleteSnippetTarget,
  startOffset: number,
  endOffset: number,
): monaco.Range {
  const lineStarts = sourceLineStartOffsets(target.snippet);
  const start = offsetToEditorPosition(lineStarts, startOffset);
  const end = offsetToEditorPosition(lineStarts, endOffset);

  return new monaco.Range(
    target.startLine + start.line - 1,
    start.line === 1 ? target.startColumn + start.column - 1 : start.column,
    target.startLine + end.line - 1,
    end.line === 1 ? target.startColumn + end.column - 1 : end.column,
  );
}

function updateSelectedDefinitionDecorations(): void {
  const target = selectedDefinitionTarget;
  selectedDefinitionDecorations = editor.deltaDecorations(
    selectedDefinitionDecorations,
    selectedWholeFileImplementation
      ? []
      : target === null
      ? []
      : [{
          range: new monaco.Range(target.line, 1, target.endLine, Number.MAX_SAFE_INTEGER),
          options: {
            isWholeLine: true,
            className: "definition-implementation-line-selected",
            marginClassName: undefined,
          },
        }],
  );
}

function renderSnippetPanel(): void {
  if (selectedDefinitionTarget !== null) {
    const text =
      directPreviewForDefinitionTarget(selectedDefinitionTarget) ??
      implementationBlockForTarget(previewImplementationSource(), selectedDefinitionTarget) ??
      implementationBlockForTarget(latestImplementationSource, selectedDefinitionTarget) ??
      selectedDefinitionTarget.source;

    setSnippetPanelTitle(selectedDefinitionTarget.name);
    setSnippetPreviewSource(text);
    return;
  }

  if (selectedWholeFileImplementation) {
    setSnippetPanelTitle("Whole file");
    setSnippetPreviewSource(previewImplementationSource());
    return;
  }

  const target = selectedSnippetHash === null
    ? null
    : incompleteSnippetByHash.get(selectedSnippetHash) ?? null;

  if (!target) {
    setSnippetPanelTitle(null);
    setSnippetPreviewSource("");
    return;
  }

  const preview = snippetPreviewByHash.get(target.hash);
  const text =
    preview?.implementation ??
    (preview?.streamed.length ? preview.streamed : null) ??
    preview?.snippet ??
    target.snippet;

  setSnippetPanelTitle(target.label);
  setSnippetPreviewSource(text);
}

function directPreviewForDefinitionTarget(target: ImplementationTarget): string | null {
  const snippet = Array.from(incompleteSnippetByHash.values()).find((candidate) => {
    return candidate.kind === target.kind &&
      candidate.label === target.name &&
      candidate.startLine === target.line;
  });

  return snippet === undefined ? null : previewReplacementForSnippet(snippet);
}

function previewImplementationSource(): string {
  const source = editor.getValue();
  const lineStarts = sourceLineStartOffsets(source);
  const replacements = Array.from(incompleteSnippetByHash.values())
    .map((target) => {
      const replacement = previewReplacementForSnippet(target);
      if (replacement === null) {
        return null;
      }

      return {
        start: editorPositionToOffset(lineStarts, target.startLine, target.startColumn),
        end: editorPositionToOffset(lineStarts, target.endLine, target.endColumn),
        replacement,
      };
    })
    .filter((item): item is { start: number; end: number; replacement: string } => item !== null)
    .sort((left, right) => right.start - left.start);

  if (replacements.length === 0) {
    return latestImplementationSource;
  }

  let preview = source;
  for (const replacement of replacements) {
    preview = `${preview.slice(0, replacement.start)}${replacement.replacement}${preview.slice(replacement.end)}`;
  }

  return preview;
}

function previewReplacementForSnippet(target: IncompleteSnippetTarget): string | null {
  const preview = snippetPreviewByHash.get(target.hash);
  if (!preview) {
    return null;
  }

  return preview.implementation ??
    (preview.streamed.length > 0 ? preview.streamed : null);
}

function setSnippetPanelTitle(label: string | null): void {
  snippetTitle.textContent = label === null ? "Compilation View" : `Compilation View: ${label}`;
  snippetTitle.title = snippetTitle.textContent;
}

function setSnippetPreviewSource(source: string): void {
  if (snippetPreviewEditor.getValue() !== source) {
    snippetPreviewEditor.setValue(source);
  }
}

function attachBlockIndentGuideOverlay(targetEditor: monaco.editor.IStandaloneCodeEditor): void {
  const overlay = document.createElement("div");
  overlay.className = "block-indent-guide-overlay";
  targetEditor.getContainerDomNode().append(overlay);

  let animationFrame = 0;
  const scheduleRender = (): void => {
    if (animationFrame !== 0) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
      renderBlockIndentGuides(targetEditor, overlay);
    });
  };

  targetEditor.onDidChangeModelContent(scheduleRender);
  targetEditor.onDidScrollChange(scheduleRender);
  targetEditor.onDidLayoutChange(scheduleRender);
  targetEditor.onDidContentSizeChange(scheduleRender);
  targetEditor.onDidChangeModel(scheduleRender);
  targetEditor.onDidChangeModelOptions(scheduleRender);
  scheduleRender();
  window.setTimeout(scheduleRender, 0);
  window.setTimeout(scheduleRender, 100);
  window.setTimeout(scheduleRender, 500);
}

function renderBlockIndentGuides(
  targetEditor: monaco.editor.IStandaloneCodeEditor,
  overlay: HTMLDivElement,
): void {
  const model = targetEditor.getModel();
  if (model === null) {
    overlay.replaceChildren();
    return;
  }

  const tabSize = model.getOptions().tabSize;
  const scrollTop = targetEditor.getScrollTop();
  const fragment = document.createDocumentFragment();
  const endpointInset = 6;

  for (const block of indentGuideBlocks(model, tabSize)) {
    appendIndentGuideBlock({
      editor: targetEditor,
      fragment,
      model,
      ...block,
      tabSize,
      scrollTop,
      endpointInset,
    });
  }

  overlay.replaceChildren(fragment);
}

function indentGuideBlocks(
  model: monaco.editor.ITextModel,
  tabSize: number,
): Array<{ level: number; startLine: number; endLine: number }> {
  const blocks: Array<{ level: number; startLine: number; endLine: number }> = [];
  const activeStarts = new Map<number, number>();
  let previousContentLine: number | null = null;
  let previousLevel = 0;

  for (let line = 1; line <= model.getLineCount(); line += 1) {
    const content = model.getLineContent(line);
    if (content.trim().length === 0) {
      continue;
    }

    const level = indentGuideLevel(content, tabSize);
    for (const [activeLevel, startLine] of [...activeStarts.entries()]) {
      if (activeLevel > level) {
        blocks.push({ level: activeLevel, startLine, endLine: line - 1 });
        activeStarts.delete(activeLevel);
      }
    }

    if (previousContentLine !== null && level > previousLevel) {
      for (let activeLevel = previousLevel + 1; activeLevel <= level; activeLevel += 1) {
        if (!activeStarts.has(activeLevel)) {
          activeStarts.set(activeLevel, previousContentLine);
        }
      }
    }

    previousContentLine = line;
    previousLevel = level;
  }

  const finalLine = model.getLineCount();
  for (const [level, startLine] of activeStarts.entries()) {
    blocks.push({ level, startLine, endLine: finalLine });
  }

  return blocks;
}

function appendIndentGuideBlock({
  editor: targetEditor,
  fragment,
  model,
  level,
  startLine,
  endLine,
  tabSize,
  scrollTop,
  endpointInset,
}: {
  editor: monaco.editor.IStandaloneCodeEditor;
  fragment: DocumentFragment;
  model: monaco.editor.ITextModel;
  level: number;
  startLine: number;
  endLine: number;
  tabSize: number;
  scrollTop: number;
  endpointInset: number;
}): void {
  const anchorLine = indentGuideAnchorLine(model, level, startLine, endLine, tabSize);
  const guideColumn = Math.max(1, level * tabSize);
  const visiblePosition = targetEditor.getScrolledVisiblePosition({
    lineNumber: anchorLine,
    column: guideColumn,
  });
  if (visiblePosition === null) {
    return;
  }

  const top =
    targetEditor.getTopForLineNumber(startLine) -
    scrollTop +
    endpointInset;
  const bottom =
    targetEditor.getBottomForLineNumber(endLine) -
    scrollTop -
    endpointInset;
  const height = Math.max(0, bottom - top);
  if (height <= 0) {
    return;
  }

  const guide = document.createElement("div");
  guide.className = "block-indent-guide";
  guide.style.left = `${Math.round(visiblePosition.left)}px`;
  guide.style.top = `${Math.round(top)}px`;
  guide.style.height = `${Math.round(height)}px`;
  fragment.append(guide);
}

function indentGuideAnchorLine(
  model: monaco.editor.ITextModel,
  level: number,
  startLine: number,
  endLine: number,
  tabSize: number,
): number {
  for (let line = startLine; line <= endLine; line += 1) {
    if (indentGuideLevel(model.getLineContent(line), tabSize) >= level) {
      return line;
    }
  }

  return startLine;
}

function indentGuideLevel(line: string, tabSize: number): number {
  if (line.trim().length === 0) {
    return 0;
  }

  let width = 0;
  for (const character of line) {
    if (character === " ") {
      width += 1;
      continue;
    }

    if (character === "\t") {
      width += tabSize;
      continue;
    }

    break;
  }

  return Math.floor(width / tabSize);
}

function registerLogosPythonLanguage(): void {
  monaco.languages.register({
    id: logosPythonLanguageId,
    aliases: ["Logos Python", "logos-python"],
    mimetypes: ["text/x-logos-python"],
  });
  monaco.languages.setLanguageConfiguration(logosPythonLanguageId, pythonLanguageConfiguration);
  monaco.languages.setMonarchTokensProvider(logosPythonLanguageId, {
    ...pythonLanguage,
    tokenPostfix: ".logos-python",
    tokenizer: {
      ...pythonLanguage.tokenizer,
      root: [
        pythonLanguage.tokenizer.root[0],
        [/#.*$/, "comment"],
        [/```/, "naturalSnippet.delimiter", "@logosTripleNaturalSnippet"],
        [/`/, "naturalSnippet.delimiter", "@logosInlineNaturalSnippet"],
        ...pythonLanguage.tokenizer.root.slice(1),
      ],
      logosInlineNaturalSnippet: [
        [/[^`]+/, "naturalSnippet"],
        [/`/, "naturalSnippet.delimiter", "@pop"],
      ],
      logosTripleNaturalSnippet: [
        [/[^`]+/, "naturalSnippet"],
        [/```/, "naturalSnippet.delimiter", "@pop"],
        [/`+/, "naturalSnippet"],
      ],
    },
  });
}

function installEditorTypingAssist(targetEditor: monaco.editor.IStandaloneCodeEditor): void {
  let applyingTypingAssist = false;

  targetEditor.onDidChangeModelContent((event) => {
    if (applyingTypingAssist || event.isUndoing || event.isRedoing || event.isFlush) {
      return;
    }

    const change = event.changes[0];
    if (
      event.changes.length !== 1 ||
      !change ||
      change.text !== "`" ||
      change.rangeLength !== 0
    ) {
      return;
    }

    applyingTypingAssist = true;
    try {
      expandOpeningTripleBacktick(targetEditor, {
        lineNumber: change.range.startLineNumber,
        column: change.range.startColumn + 1,
      });
    } finally {
      applyingTypingAssist = false;
    }
  });

  targetEditor.onKeyDown((event) => {
    const browserEvent = event.browserEvent;
    if (
      browserEvent.key !== "Enter" ||
      browserEvent.altKey ||
      browserEvent.ctrlKey ||
      browserEvent.metaKey ||
      browserEvent.shiftKey
    ) {
      return;
    }

    if (!insertAssistedNewLine(targetEditor)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  });
}

function expandOpeningTripleBacktick(
  targetEditor: monaco.editor.IStandaloneCodeEditor,
  position: monaco.IPosition,
): void {
  const model = targetEditor.getModel();
  if (!model) {
    return;
  }

  const line = model.getLineContent(position.lineNumber);
  const beforeCursor = line.slice(0, position.column - 1);
  const afterCursor = line.slice(position.column - 1);
  const delimiterStartColumn = position.column - 3;
  if (
    delimiterStartColumn < 1 ||
    !beforeCursor.endsWith("```") ||
    afterCursor.trim().length > 0
  ) {
    return;
  }

  const indent = line.slice(0, delimiterStartColumn - 1);
  if (indent.trim().length > 0) {
    return;
  }

  const delimiterOffset = model.getOffsetAt({
    lineNumber: position.lineNumber,
    column: delimiterStartColumn,
  });
  if (standaloneTripleBacktickStateBefore(model.getValue(), delimiterOffset) !== "outside") {
    return;
  }

  const cursorLine = position.lineNumber + 1;
  const cursorColumn = indent.length + 1;
  targetEditor.executeEdits(
    "logos-triple-backtick",
    [{
      range: new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        model.getLineMaxColumn(position.lineNumber),
      ),
      text: `\n${indent}\n${indent}\`\`\``,
      forceMoveMarkers: true,
    }],
    [new monaco.Selection(cursorLine, cursorColumn, cursorLine, cursorColumn)],
  );
}

function insertAssistedNewLine(targetEditor: monaco.editor.IStandaloneCodeEditor): boolean {
  const model = targetEditor.getModel();
  const position = targetEditor.getPosition();
  const selection = targetEditor.getSelection();
  if (!model || !position || !selection?.isEmpty()) {
    return false;
  }

  const line = model.getLineContent(position.lineNumber);
  const offset = model.getOffsetAt(position);
  const tripleBacktickIndent = openStandaloneTripleBacktickIndentAt(model.getValue(), offset);
  if (tripleBacktickIndent !== null) {
    insertTextAtCursor(targetEditor, `\n${tripleBacktickIndent}`);
    return true;
  }

  const commentPrefix = commentContinuationPrefix(line);
  if (commentPrefix === null) {
    return false;
  }

  insertTextAtCursor(targetEditor, `\n${commentPrefix}`);
  return true;
}

function insertTextAtCursor(targetEditor: monaco.editor.IStandaloneCodeEditor, text: string): void {
  const selection = targetEditor.getSelection();
  if (!selection) {
    return;
  }

  const endLineNumber = selection.startLineNumber + text.split("\n").length - 1;
  const lastLine = text.split("\n").at(-1) ?? "";
  const endColumn = endLineNumber === selection.startLineNumber
    ? selection.startColumn + text.length
    : lastLine.length + 1;

  targetEditor.executeEdits(
    "logos-newline-assist",
    [{
      range: selection,
      text,
      forceMoveMarkers: true,
    }],
    [new monaco.Selection(endLineNumber, endColumn, endLineNumber, endColumn)],
  );
}

function commentContinuationPrefix(line: string): string | null {
  const match = line.match(/^(\s*)# ?/);
  if (!match) {
    return null;
  }

  return `${match[1]}# `;
}

function openStandaloneTripleBacktickIndentAt(source: string, offset: number): string | null {
  const state = scanStandaloneTripleBackticks(source, offset);
  return state.kind === "inside" ? state.indent : null;
}

function standaloneTripleBacktickStateBefore(source: string, offset: number): "inside" | "outside" {
  return scanStandaloneTripleBackticks(source, offset).kind;
}

function scanStandaloneTripleBackticks(
  source: string,
  offset: number,
): { kind: "inside"; indent: string } | { kind: "outside" } {
  let state: { kind: "inside"; indent: string } | { kind: "outside" } = { kind: "outside" };
  let searchStart = 0;

  while (searchStart < offset) {
    const delimiterOffset = source.indexOf("```", searchStart);
    if (delimiterOffset === -1 || delimiterOffset >= offset) {
      break;
    }

    const lineStart = source.lastIndexOf("\n", delimiterOffset - 1) + 1;
    const beforeDelimiter = source.slice(lineStart, delimiterOffset);
    if (beforeDelimiter.trim().length === 0) {
      state = state.kind === "outside"
        ? { kind: "inside", indent: beforeDelimiter }
        : { kind: "outside" };
    }

    searchStart = delimiterOffset + 3;
  }

  return state;
}

function incompleteSnippetLabel(snippet: IncompleteSnippet): string {
  const firstLine = snippet.snippet.trim().split("\n")[0] ?? "";
  if (snippet.kind === "natural") {
    const inner = naturalSnippetLabelText(snippet.snippet);
    return inner.length > 0 ? inner : "backtick snippet";
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

function naturalSnippetLabelText(snippet: string): string {
  const body = snippet.trim().replace(/^```|```$/g, "").replace(/^`|`$/g, "");
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  const previewLines = lines
    .slice(0, 2)
    .map((line) => truncateText(line, 28));
  const suffix = lines.length > previewLines.length ? "..." : "";
  return truncateLabel(`${previewLines.join(", ")}${suffix}`);
}

function exactIncompleteSnippetForPosition(
  lineNumber: number,
  column: number,
): IncompleteSnippetTarget | null {
  const snippets = incompleteSnippetsByLine.get(lineNumber) ?? [];
  return snippets.find((snippet) => targetContainsPosition(snippet, lineNumber, column)) ?? null;
}

function nearbyNaturalSnippetForLine(lineNumber: number): IncompleteSnippetTarget | null {
  const maxContextLines = 2;
  const definitionTarget = implementationTargetForLine(lineNumber);
  let closest: { distance: number; target: IncompleteSnippetTarget } | null = null;

  if (definitionTarget?.line === lineNumber) {
    return null;
  }

  for (const target of incompleteSnippetByHash.values()) {
    if (target.kind !== "natural") {
      continue;
    }

    const distance = lineNumber < target.startLine
      ? target.startLine - lineNumber
      : lineNumber > target.endLine
        ? lineNumber - target.endLine
        : 0;

    if (distance > maxContextLines) {
      continue;
    }

    if (closest === null || distance < closest.distance) {
      closest = { distance, target };
    }
  }

  return closest?.target ?? null;
}

function targetContainsPosition(
  target: IncompleteSnippetTarget,
  lineNumber: number,
  column: number,
): boolean {
  if (lineNumber < target.startLine || lineNumber > target.endLine) {
    return false;
  }

  if (lineNumber === target.startLine && column < target.startColumn) {
    return false;
  }

  return lineNumber !== target.endLine || column <= target.endColumn;
}

function updateNaturalSnippetEditorMode(): void {
  const position = editor.getPosition();
  const inNaturalSnippet = position !== null && Array.from(incompleteSnippetByHash.values()).some((target) => {
    return target.kind === "natural" && targetContainsPosition(target, position.lineNumber, position.column);
  });
  const mode = inNaturalSnippet ? "natural" : "python";

  if (mode === naturalSnippetEditorMode) {
    return;
  }

  naturalSnippetEditorMode = mode;
  editor.updateOptions({
    matchBrackets: "never",
  });
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

function snippetRange(source: string, snippet: IncompleteSnippet): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  if (snippet.range) {
    return offsetRangeToEditorRange(source, snippet.range.start, snippet.range.end);
  }

  const lines = snippet.snippet.split("\n");
  const startLine = snippet.line;
  const startColumn = snippet.column ?? 1;
  const endLine = startLine + lines.length - 1;
  const endColumn = lines.length === 1
    ? startColumn + firstLineLength(snippet.snippet)
    : (lines.at(-1)?.length ?? 0) + 1;

  return { startLine, startColumn, endLine, endColumn };
}

function offsetRangeToEditorRange(source: string, start: number, end: number): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  const lineStarts = sourceLineStartOffsets(source);
  const startPosition = offsetToEditorPosition(lineStarts, start);
  const endPosition = offsetToEditorPosition(lineStarts, end);

  return {
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}

function sourceLineStartOffsets(source: string): number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function editorPositionToOffset(lineStarts: number[], line: number, column: number): number {
  const lineStart = lineStarts[line - 1] ?? 0;
  return lineStart + Math.max(0, column - 1);
}

function offsetToEditorPosition(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;

    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return { line: lineIndex + 1, column: offset - lineStart + 1 };
}

function truncateLabel(label: string): string {
  return label.length <= 44 ? label : `${label.slice(0, 41)}...`;
}

function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function beginCodeRunResize(event: PointerEvent): void {
  if (window.matchMedia("(max-width: 1080px)").matches) {
    return;
  }

  event.preventDefault();
  codeRunResizeHandle.setPointerCapture(event.pointerId);
  shell.classList.add("resizing-code-run");

  const startX = event.clientX;
  const startWidth = codePane.getBoundingClientRect().width;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    setCodePaneWidth(startWidth + moveEvent.clientX - startX);
    requestAnimationFrame(updateShellResizeHandles);
  };
  const onPointerUp = (): void => {
    shell.classList.remove("resizing-code-run");
    codeRunResizeHandle.removeEventListener("pointermove", onPointerMove);
    codeRunResizeHandle.removeEventListener("pointerup", onPointerUp);
    codeRunResizeHandle.removeEventListener("pointercancel", onPointerUp);
    requestAnimationFrame(updateShellResizeHandles);
  };

  codeRunResizeHandle.addEventListener("pointermove", onPointerMove);
  codeRunResizeHandle.addEventListener("pointerup", onPointerUp);
  codeRunResizeHandle.addEventListener("pointercancel", onPointerUp);
}

function setCodePaneWidth(width: number): void {
  const shellRect = shell.getBoundingClientRect();
  const codeRect = codePane.getBoundingClientRect();
  const minCodeWidth = agentExpanded ? 420 : 500;
  const minOutputWidth = 340;
  const maxCodeWidth = Math.max(
    minCodeWidth,
    shellRect.right - codeRect.left - minOutputWidth,
  );
  const nextWidth = Math.min(maxCodeWidth, Math.max(minCodeWidth, width));
  setCodePaneBasis(nextWidth);
  editor.layout();
}

function beginAgentCodeResize(event: PointerEvent): void {
  if (window.matchMedia("(max-width: 1080px)").matches || !agentExpanded) {
    return;
  }

  event.preventDefault();
  agentCodeResizeHandle.setPointerCapture(event.pointerId);
  shell.classList.add("resizing-code-run");

  const startX = event.clientX;
  const startAgentWidth = agentSidebar.getBoundingClientRect().width;
  const startCodeWidth = codePane.getBoundingClientRect().width;
  const minAgentWidth = 188;
  const maxAgentWidth = 460;
  const minCodeWidth = 420;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    const delta = moveEvent.clientX - startX;
    const minDelta = minAgentWidth - startAgentWidth;
    const maxDelta = Math.min(
      maxAgentWidth - startAgentWidth,
      startCodeWidth - minCodeWidth,
    );
    const nextDelta = clamp(delta, minDelta, maxDelta);
    shell.style.setProperty("--agent-pane-width", `${Math.round(startAgentWidth + nextDelta)}px`);
    setCodePaneBasis(startCodeWidth - nextDelta);
    editor.layout();
    requestAnimationFrame(updateShellResizeHandles);
  };
  const onPointerUp = (): void => {
    shell.classList.remove("resizing-code-run");
    agentCodeResizeHandle.removeEventListener("pointermove", onPointerMove);
    agentCodeResizeHandle.removeEventListener("pointerup", onPointerUp);
    agentCodeResizeHandle.removeEventListener("pointercancel", onPointerUp);
    requestAnimationFrame(updateShellResizeHandles);
  };

  agentCodeResizeHandle.addEventListener("pointermove", onPointerMove);
  agentCodeResizeHandle.addEventListener("pointerup", onPointerUp);
  agentCodeResizeHandle.addEventListener("pointercancel", onPointerUp);
}

function updateShellResizeHandles(): void {
  const shellRect = shell.getBoundingClientRect();
  const codeRect = codePane.getBoundingClientRect();
  const outputRect = outputPane.getBoundingClientRect();

  agentCodeResizeHandle.style.left = `${Math.round(codeRect.left - shellRect.left)}px`;
  codeRunResizeHandle.style.left = `${Math.round(outputRect.left - shellRect.left)}px`;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function setCodePaneBasis(width: number): void {
  shell.style.setProperty("--code-pane-basis", `${Math.round(width)}px`);
  shell.style.setProperty("--code-pane-grow", "0");
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
  latestReadinessDefinitions = definitions;
  const runnableStates = runnableStatesFor(editor.getValue(), definitions);
  const runnableLines = new Set(runnableStates.map((runnable) => runnable.line));
  const decorations = aggregatedReadinessDecorations(definitions, runnableLines)
    .map((item) => ({
      range: new monaco.Range(item.line, 1, item.line, 1),
      options: {
        glyphMarginClassName: "not-ready-glyph-spinner",
        hoverMessage: { value: item.hoverMessage },
      },
    }));

  readinessDecorations = editor.deltaDecorations(readinessDecorations, decorations);
  updateRunnableDecorations(runnableStates);
  updateToolbarRunState(runnableStates);
}

type ReadinessDecoration = {
  line: number;
  hoverMessage: string;
};

function aggregatedReadinessDecorations(
  definitions: DefinitionReadiness[],
  runnableLines: Set<number>,
): ReadinessDecoration[] {
  const pending = definitions.filter((definition) => !definition.ready && !runnableLines.has(definition.line));
  const pendingMethodsByClass = new Map<string, DefinitionReadiness[]>();

  for (const definition of pending) {
    const className = classNameForMethodDefinition(definition);
    if (className === null) {
      continue;
    }

    pendingMethodsByClass.set(className, [
      ...(pendingMethodsByClass.get(className) ?? []),
      definition,
    ]);
  }

  const aggregatedClassLines = classLinesForAggregatedMethods(pendingMethodsByClass);
  const aggregatedClassNames = new Set(aggregatedClassLines.keys());

  return [
    ...Array.from(aggregatedClassLines, ([className, line]) => ({
      line,
      hoverMessage: aggregatedClassHoverMessage(className, pendingMethodsByClass.get(className) ?? []),
    })),
    ...pending.flatMap((definition) => {
      const className = classNameForMethodDefinition(definition);
      if (className !== null && aggregatedClassNames.has(className)) {
        return [];
      }

      return [{
        line: definition.line,
        hoverMessage: definitionHoverMessage(definition),
      }];
    }),
  ].sort((left, right) => left.line - right.line);
}

function classLinesForAggregatedMethods(
  pendingMethodsByClass: Map<string, DefinitionReadiness[]>,
): Map<string, number> {
  let classDecls: Array<{ name: string; line: number }> = [];
  try {
    classDecls = parse(editor.getValue()).classDecls.map((decl) => ({
      name: decl.name,
      line: decl.line,
    }));
  } catch {
    return new Map();
  }

  const classLineByName = new Map(classDecls.map((decl) => [decl.name, decl.line]));
  const aggregated = new Map<string, number>();

  for (const [className, methods] of pendingMethodsByClass) {
    const classLine = classLineByName.get(className);
    if (methods.length > 1 && classLine !== undefined) {
      aggregated.set(className, classLine);
    }
  }

  return aggregated;
}

function classNameForMethodDefinition(definition: DefinitionReadiness): string | null {
  if (definition.kind !== "method") {
    return null;
  }

  const separator = definition.name.indexOf(".");
  return separator === -1 ? null : definition.name.slice(0, separator);
}

function definitionHoverMessage(definition: DefinitionReadiness): string {
  return definition.reason === "implementation"
    ? `${definition.name} is waiting for its implementation.`
    : `${definition.name} is waiting for ${definition.blockingDependencies.join(", ")}.`;
}

function aggregatedClassHoverMessage(className: string, methods: DefinitionReadiness[]): string {
  const methodNames = methods.map((method) => method.name).join(", ");
  return `${className} has ${methods.length} pending methods: ${methodNames}.`;
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
      compiling: compilationPending,
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
        compiling: compilationPending,
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
            : disabledRunnableHoverMessage(runnable),
        },
      },
    })),
  );
}

function disabledRunnableHoverMessage(runnable: RunnableState): string {
  if (runnable.compiling) {
    return "Dependencies still compiling.";
  }

  if (runnable.blockingDependencies.length > 0) {
    return `${runnable.name} is waiting for ${runnable.blockingDependencies.join(", ")}.`;
  }

  return `${runnable.name} is waiting for its implementation.`;
}

function updateToolbarRunState(runnablesState: Array<RunnableState & { line: number }>): void {
  void runnablesState;
}

function updateTypeCheckMarkers(diagnostics: TypeCheckDiagnostic[]): void {
  void diagnostics;

  const model = editor.getModel();
  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(model, "logos-typecheck", []);
}

function firstRunnable(source: string): Runnable | null {
  return runnables(source)[0]?.name ?? null;
}

function markLastRunCompleted(): void {
  lastRunCompletedAtMs = Date.now();
  lastRunLabel = lastRunAgeLabel();
}

function lastRunAgeLabel(nowMs = Date.now()): string {
  if (lastRunCompletedAtMs === null) {
    return lastRunLabel === "never" ? "never" : "previously";
  }

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - lastRunCompletedAtMs) / 1000));
  if (elapsedSeconds < 10) {
    return "just now";
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} ${elapsedSeconds === 1 ? "second" : "seconds"} ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
}

function setLastRunStatus(prefix: string, state: "ok" | "error"): void {
  lastRunStatusPrefix = prefix;
  lastRunStatusState = state;
  refreshLastRunStatus();
}

function refreshLastRunStatus(): void {
  if (!lastRunStatusPrefix) {
    lastRunStatusText = "";
    return;
  }

  lastRunLabel = lastRunAgeLabel();
  lastRunStatusText = `${lastRunStatusPrefix} · last run ${lastRunLabel}`;
  runStatus.textContent = lastRunStatusText;
  runStatus.dataset.state = lastRunStatusState;
}

function runStatusPrefixFromText(text: string): string {
  return text.split(" · last run ")[0] ?? text;
}

function runStatusStateFromPrefix(prefix: string): string {
  if (!prefix) {
    return "";
  }

  return prefix.startsWith("Ran ") ? "ok" : "error";
}

function createRunTab(runnable: Runnable, source: string, sourceHash: string): RunTab {
  const tab: RunTab = {
    id: createRunTabId(runnable),
    runnable,
    source,
    sessionId: null,
    sourceHash,
    terminalText: "",
    implementation: latestImplementationSource,
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
    shell.className = "source-tab-shell output-tab-shell";
    shell.dataset.runTabShellId = tab.id;

    const button = document.createElement("button");
    button.id = runTabButtonId(tab.id);
    button.className = `source-tab output-tab${activeToolTabId === tab.id ? " active" : ""}`;
    button.type = "button";
    button.role = "tab";
    button.dataset.runTabId = tab.id;
    button.setAttribute("aria-selected", String(activeToolTabId === tab.id));
    button.setAttribute("aria-controls", runPanelId(tab.id));
    button.textContent = `Run ${tab.runnable}`;

    const close = document.createElement("button");
    close.className = "source-tab-close output-tab-close";
    close.type = "button";
    close.dataset.closeRunTabId = tab.id;
    close.setAttribute("aria-label", `Close run ${tab.runnable}`);
    close.textContent = "×";

    shell.append(button, close);
    toolTabsList.append(shell);
  }

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

  runPlaceholder.classList.toggle("active", activeToolTabId === null);
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
  toolPanels.append(panel);
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
    renderAnsiTerminalText(output, terminalDisplayText(tab));
  }
  if (form) {
    form.hidden = !running;
  }
  if (input) {
    input.disabled = !running;
  }

  panel.scrollTop = panel.scrollHeight;
}

function terminalDisplayText(tab: RunTab): string {
  if (tab.terminalText.length > 0) {
    return tab.terminalText;
  }

  if (tab.status?.state === "exited" && tab.status.error) {
    return `${tab.status.error}\n`;
  }

  return "";
}

function appendTerminalChunks(tab: RunTab, chunks: RunChunk[]): void {
  if (chunks.length === 0) {
    return;
  }

  tab.terminalText += chunks.map((chunk) => chunk.text).join("");
  renderRunTab(tab);
}

function focusTerminalInput(runTabId: string): void {
  const tab = runTabById(runTabId);
  if (!tab || activeToolTabId !== runTabId || tab.status?.state !== "running") {
    return;
  }

  const input = document.querySelector<HTMLInputElement>(
    `[data-run-input-id="${cssEscape(runTabId)}"]`,
  );
  if (!input || input.disabled || input.hidden) {
    return;
  }

  input.focus();
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
  latestImplementationSource = result.implementation;
  renderSnippetPanel();
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

  const result = await pollInteractiveRunViaDevApi(tab.sessionId).catch(async (error: unknown) => {
    if (error instanceof RunSessionNotFoundError) {
      await recoverMissingRunSession(runTabId);
      return null;
    }

    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  });
  if (result === null) {
    return;
  }
  const currentTab = runTabById(runTabId);
  if (!currentTab) {
    return;
  }

  if (!result.ok) {
    currentTab.status = { state: "exited", code: null, signal: null, error: result.error };
    markLastRunCompleted();
    lastRunDefinitionHash = currentTab.sourceHash;
    setLastRunStatus("Error", "error");
    appendTerminalChunks(currentTab, [{ stream: "stderr", text: `\n${result.error}\n` }]);
    updateRunStaleness();
    renderRunTabs();
    return;
  }

  currentTab.implementation = result.implementation;
  latestImplementationSource = result.implementation;
  renderSnippetPanel();
  appendTerminalChunks(currentTab, result.chunks);

  if (result.status.state === "running") {
    currentTab.status = result.status;
    scheduleRunPoll(currentTab.id, 120);
    return;
  }

  finishInteractiveRun(currentTab, result.status, result.implementation);
}

async function recoverMissingRunSession(runTabId: string): Promise<void> {
  const tab = runTabById(runTabId);
  if (!tab) {
    return;
  }

  tab.sessionId = null;
  tab.terminalText = "";
  runStatus.textContent = `Recovering ${tab.runnable} · last run ${lastRunLabel}`;
  runStatus.dataset.state = "";
  renderRunTab(tab);

  const result = await startInteractiveRunViaDevApi(tab.source, tab.runnable).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  const currentTab = runTabById(runTabId);
  if (!currentTab) {
    return;
  }

  if (!result.ok) {
    currentTab.status = { state: "exited", code: null, signal: null, error: result.error };
    markLastRunCompleted();
    lastRunDefinitionHash = currentTab.sourceHash;
    setLastRunStatus("Error", "error");
    appendTerminalChunks(currentTab, [{ stream: "stderr", text: result.error }]);
    updateRunStaleness();
    return;
  }

  currentTab.sessionId = result.sessionId;
  currentTab.implementation = result.implementation;
  currentTab.status = result.status;
  latestImplementationSource = result.implementation;
  renderSnippetPanel();
  appendTerminalChunks(currentTab, result.chunks);

  if (result.status.state === "running") {
    scheduleRunPoll(currentTab.id, 120);
    return;
  }

  finishInteractiveRun(currentTab, result.status, result.implementation);
}

function finishInteractiveRun(tab: RunTab, status: RunStatus, implementation: string): void {
  tab.status = status;
  tab.implementation = implementation;
  latestImplementationSource = implementation;
  renderSnippetPanel();
  markLastRunCompleted();
  lastRunDefinitionHash = tab.sourceHash;

  if (status.state === "exited" && status.code === 0) {
    setLastRunStatus(`Ran ${tab.runnable}`, "ok");
    sessionCapture.track(
      "run_completed",
      { runnable: tab.runnable, output: tab.terminalText, implementation },
      true,
    );
  } else {
    const stopped = status.state === "exited" && status.signal === "SIGTERM";
    setLastRunStatus(stopped ? "Stopped" : "Error", "error");
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
    activeToolTabId = runTabs[index]?.id ?? runTabs[index - 1]?.id ?? null;
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
  activeToolTabId = null;
  renderRunTabs();
}

function runTabById(runTabId: string | null): RunTab | undefined {
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

async function submitFeedbackFromButton(button: HTMLButtonElement): Promise<void> {
  const panel = button.dataset.feedbackPanel;
  const rating = button.dataset.feedbackRating;
  if (!panel || (rating !== "up" && rating !== "down") || button.disabled) {
    return;
  }

  const controls = button.closest<HTMLElement>("[data-feedback-controls]");
  const buttons = controls
    ? Array.from(controls.querySelectorAll<HTMLButtonElement>("[data-feedback-rating]"))
    : [button];
  const receipt = controls?.querySelector<HTMLElement>("[data-feedback-receipt]") ?? null;
  clearFeedbackResetTimer(controls);
  buttons.forEach((item) => {
    item.disabled = true;
    item.dataset.state = item === button ? "sent" : "";
  });

  sessionCapture.track("feedback_submitted", { panel, rating }, true);

  try {
    const result = await sendFeedbackViaDevApi(panel, rating);
    buttons.forEach((item) => {
      item.disabled = false;
      item.dataset.state = item === button ? "sent" : "";
    });
    button.dataset.state = "sent";
    button.title = `Feedback sent: ${result.feedbackId}`;
    if (receipt) {
      receipt.textContent = "Feedback received";
      receipt.dataset.state = "sent";
    }
    const resetTimer = window.setTimeout(() => {
      buttons.forEach((item) => {
        item.dataset.state = "";
      });
      if (receipt) {
        receipt.textContent = "";
        receipt.dataset.state = "";
      }
      if (controls) {
        feedbackResetTimers.delete(controls);
      }
    }, 3600);
    if (controls) {
      feedbackResetTimers.set(controls, resetTimer);
    }
  } catch (error) {
    buttons.forEach((item) => {
      item.disabled = false;
      if (item !== button) {
        item.dataset.state = "";
      }
    });
    button.dataset.state = "error";
    button.title = error instanceof Error ? error.message : "Feedback failed";
    if (receipt) {
      receipt.textContent = "Feedback failed";
      receipt.dataset.state = "error";
    }
  }
}

async function shareCurrentSessionFromButton(button: HTMLButtonElement): Promise<void> {
  if (button.disabled) {
    return;
  }

  const controls = button.closest<HTMLElement>("[data-feedback-controls]");
  const receipt = controls?.querySelector<HTMLElement>("[data-feedback-receipt]") ?? null;
  clearFeedbackResetTimer(controls);
  button.disabled = true;
  button.dataset.state = "sending";
  if (receipt) {
    receipt.textContent = "Sharing";
    receipt.dataset.state = "sending";
  }

  sessionCapture.track("share_session_requested", undefined, true);

  try {
    const result = await sendSharedSessionViaDevApi();
    const shareUrl = shareUrlForId(result.shareId);
    await copyTextToClipboard(shareUrl);
    button.disabled = false;
    button.dataset.state = "sent";
    button.title = "Share link copied";
    if (receipt) {
      receipt.textContent = "Link copied";
      receipt.dataset.state = "sent";
    }

    const resetTimer = window.setTimeout(() => {
      button.dataset.state = "";
      button.title = "Share";
      if (receipt) {
        receipt.textContent = "";
        receipt.dataset.state = "";
      }
      if (controls) {
        feedbackResetTimers.delete(controls);
      }
    }, 3600);
    if (controls) {
      feedbackResetTimers.set(controls, resetTimer);
    }

    sessionCapture.track("share_session_created", { shareId: result.shareId, url: shareUrl }, true);
  } catch (error) {
    button.disabled = false;
    button.dataset.state = "error";
    button.title = error instanceof Error ? error.message : "Share failed";
    if (receipt) {
      receipt.textContent = "Share failed";
      receipt.dataset.state = "error";
    }
  }
}

function clearFeedbackResetTimer(controls: HTMLElement | null | undefined): void {
  if (!controls) {
    return;
  }

  const existingTimer = feedbackResetTimers.get(controls);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
    feedbackResetTimers.delete(controls);
  }
}

async function sendFeedbackViaDevApi(
  panel: string,
  rating: "up" | "down",
): Promise<{ ok: true; feedbackId: string }> {
  const loadableSession = createLoadableSession();
  const body = {
    sessionId: sessionCapture.sessionId,
    panel,
    rating,
    url: window.location.href,
    loadableSession,
    state: appSnapshot(),
  };

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    feedbackId?: string;
    error?: string;
  };

  if (!response.ok || payload.ok !== true || typeof payload.feedbackId !== "string") {
    throw new Error(payload.error ?? "Feedback request failed");
  }

  return { ok: true, feedbackId: payload.feedbackId };
}

async function sendSharedSessionViaDevApi(): Promise<{ ok: true; shareId: string }> {
  const response = await fetch("/api/shared-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loadableSession: createLoadableSession() }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    shareId?: string;
    error?: string;
  };

  if (!response.ok || payload.ok !== true || typeof payload.shareId !== "string") {
    throw new Error(payload.error ?? "Share request failed");
  }

  return { ok: true, shareId: payload.shareId };
}

function shareUrlForId(shareId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("session", shareId);
  url.hash = "";
  return url.toString();
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection-based copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Could not copy share link");
  }
}

async function startInteractiveRunViaDevApi(
  sheet: string,
  runnable: Runnable,
): Promise<InteractiveRunStartResponse> {
  const body = {
    sheet,
    runnable,
    compilationStrategy: appSettings.compilationStrategy,
  };
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run/start",
    body,
  });
  const response = await fetch("/api/run/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    errorCode?: string;
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
    if (response.status === 404 && payload.errorCode === "run_session_not_found") {
      throw new RunSessionNotFoundError(payload.error ?? "Run session not found");
    }

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

class RunSessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunSessionNotFoundError";
  }
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
      { role: "assistant", content: "Applied the updated sheet." },
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
    throw new Error(payload.error ?? "Request failed");
  }
  if (payload.sheet !== null && typeof payload.sheet !== "string") {
    throw new Error("Response returned an invalid sheet");
  }

  return { reply: payload.reply, sheet: payload.sheet };
}

function renderAgentLog(status?: string): void {
  if (agentMessages.length === 0 && !status) {
    agentLog.innerHTML = "";
    return;
  }

  agentLog.innerHTML = [
    ...agentMessages.map((message) => {
      const roleClass = message.role === "user" ? "agent-message-user" : "agent-message-assistant";
      return `<div class="agent-message ${roleClass}">
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
  agentToggle.setAttribute("aria-label", expanded ? "Close edit panel" : "Open edit panel");
  agentToggle.innerHTML = expanded ? logosWordmark : lambdaMark;
  requestAnimationFrame(updateShellResizeHandles);
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  const body = {
    sheet,
    compilationStrategy: appSettings.compilationStrategy,
  };
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/compile",
    body,
  });
  const response = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  activeToolTabId = tab && runTabById(tab) ? tab : null;
  renderRunTabs();
}

export function createLoadableSession(): LoadableSession {
  syncActiveSourceTab();
  const position = editor.getPosition();

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sessionId: sessionCapture.sessionId,
    workspaceId: getOrCreateWorkspaceId(),
    sourceTabs: sourceTabs.map((tab) => ({ ...tab })),
    activeSourceTabId,
    editor: {
      value: editor.getValue(),
      cursor: position === null
        ? null
        : {
            lineNumber: position.lineNumber,
            column: position.column,
          },
      scrollTop: editor.getScrollTop(),
      scrollLeft: editor.getScrollLeft(),
    },
    compilation: {
      compileVersion,
      latestImplementationSource,
      selection: currentLoadableSelection(),
    },
    run: {
      activeToolTabId,
      lastRunLabel,
      lastRunStatusText,
      lastRunCompletedAtMs,
      lastRunStatusPrefix,
      lastRunStatusState,
      lastRunDefinitionHash,
      runStatus: {
        text: runStatus.textContent ?? "",
        state: runStatus.dataset.state ?? "",
      },
      tabs: runTabs.map((tab) => ({
        id: tab.id,
        runnable: tab.runnable,
        sourceHash: tab.sourceHash,
        terminalText: tab.terminalText,
        implementation: tab.implementation,
        status: tab.status,
      })),
    },
    agent: {
      expanded: agentExpanded,
      input: agentInput.value,
      messages: agentMessages.map((message) => ({ ...message })),
    },
  };
}

export async function loadSession(session: LoadableSession): Promise<void> {
  if (!isLoadableSession(session)) {
    throw new Error("Invalid loadable session");
  }

  isLoadingSession = true;
  try {
    compileController?.abort();
    compileController = null;
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }
    compilationPending = false;
    if (editorCaptureTimer) {
      clearTimeout(editorCaptureTimer);
      editorCaptureTimer = null;
    }

    closeAllRunTabs();
    const restoredState = normalizeSourceTabState({
      tabs: session.sourceTabs.map((tab) => ({ ...tab })),
      activeTabId: session.activeSourceTabId,
    });
    sourceTabs = restoredState.tabs;
    activeSourceTabId = restoredState.activeTabId;

    const active = activeSourceTab();
    editor.setValue(active?.source ?? session.editor.value);
    latestImplementationSource = session.compilation.latestImplementationSource || editor.getValue();
    compileVersion = Math.max(compileVersion + 1, session.compilation.compileVersion);
    lastRunCompletedAtMs = typeof session.run.lastRunCompletedAtMs === "number"
      ? session.run.lastRunCompletedAtMs
      : null;
    lastRunLabel = lastRunCompletedAtMs === null
      ? (session.run.lastRunLabel === "never" ? "never" : "previously")
      : lastRunAgeLabel();
    lastRunStatusPrefix = session.run.lastRunStatusPrefix ?? runStatusPrefixFromText(session.run.lastRunStatusText);
    lastRunStatusState = session.run.lastRunStatusState ?? runStatusStateFromPrefix(lastRunStatusPrefix);
    lastRunStatusText = lastRunStatusPrefix ? `${lastRunStatusPrefix} · last run ${lastRunLabel}` : "";
    lastRunDefinitionHash = session.run.lastRunDefinitionHash;
    runStatus.textContent = lastRunStatusText || session.run.runStatus.text;
    runStatus.dataset.state = lastRunStatusState;
    agentMessages = session.agent.messages.map((message) => ({ ...message }));
    agentInput.value = session.agent.input;
    setAgentExpanded(session.agent.expanded);

    runTabs = session.run.tabs.map((tab) => ({
      id: tab.id,
      runnable: tab.runnable,
      source: active?.source ?? session.editor.value,
      sessionId: null,
      sourceHash: tab.sourceHash,
      terminalText: tab.terminalText,
      implementation: tab.implementation,
      status: restoredRunStatus(tab.status),
      pollTimer: null,
    }));
    activeToolTabId = runTabs.some((tab) => tab.id === session.run.activeToolTabId)
      ? session.run.activeToolTabId
      : runTabs[0]?.id ?? null;

    renderSourceTabs();
    renderRunTabs();
    updateEditorAvailability();
    updateActiveProjectMenuItem();
    updateTypeCheckMarkers([]);
    updateReadinessDecorations(localReadiness(editor.getValue()));
    updateRunStaleness(editor.getValue());
    refreshIncompleteSnippets(editor.getValue());
    restoreLoadableSelection(session.compilation.selection);
    renderSnippetPanel();
    renderAgentLog("Session loaded");

    if (session.editor.cursor) {
      editor.setPosition(session.editor.cursor);
      editor.revealPositionInCenterIfOutsideViewport(session.editor.cursor);
    }
    editor.setScrollTop(session.editor.scrollTop);
    editor.setScrollLeft(session.editor.scrollLeft);
    scheduleSaveSourceTabs();

    sessionCapture.track("load_session", {
      restoredSessionId: session.sessionId,
      workspaceId: session.workspaceId,
      capturedAt: session.capturedAt,
    }, true);
  } finally {
    isLoadingSession = false;
  }
}

async function loadSharedSessionFromUrl(): Promise<void> {
  const shareId = new URLSearchParams(window.location.search).get("session");
  if (!shareId) {
    return;
  }

  try {
    const session = await fetchSharedSessionViaDevApi(shareId);
    await loadSession(session);
    sessionCapture.track("shared_session_loaded", { shareId }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runStatus.textContent = `Could not load shared session: ${message}`;
    runStatus.dataset.state = "error";
    sessionCapture.track("shared_session_load_failed", { shareId, error: message }, true);
  }
}

async function fetchSharedSessionViaDevApi(shareId: string): Promise<LoadableSession> {
  const response = await fetch(`/api/shared-sessions/${encodeURIComponent(shareId)}`);
  const payload = (await response.json()) as {
    ok?: boolean;
    loadableSession?: unknown;
    error?: string;
  };

  if (!response.ok || payload.ok !== true || !isLoadableSession(payload.loadableSession)) {
    throw new Error(payload.error ?? "Shared session request failed");
  }

  return payload.loadableSession;
}

function currentLoadableSelection(): LoadableSessionSelection {
  if (selectedDefinitionTarget !== null) {
    return {
      kind: "definition",
      line: selectedDefinitionTarget.line,
      name: selectedDefinitionTarget.name,
      targetKind: selectedDefinitionTarget.kind,
    };
  }

  if (selectedWholeFileImplementation) {
    return { kind: "whole-file" };
  }

  if (selectedSnippetHash !== null) {
    return { kind: "snippet", hash: selectedSnippetHash };
  }

  return { kind: "none" };
}

function restoreLoadableSelection(selection: LoadableSessionSelection): void {
  selectedDefinitionTarget = null;
  selectedWholeFileImplementation = false;
  selectedSnippetHash = null;

  if (selection.kind === "snippet" && selection.hash && incompleteSnippetByHash.has(selection.hash)) {
    selectedSnippetHash = selection.hash;
  } else if (selection.kind === "whole-file") {
    selectedWholeFileImplementation = true;
  } else if (selection.kind === "definition") {
    const target = implementationTargetAtLine(editor.getValue(), selection.line);
    if (
      target !== null &&
      target.kind === selection.targetKind &&
      target.name === selection.name
    ) {
      selectedDefinitionTarget = target;
    }
  }

  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
}

function restoredRunStatus(status: RunStatus | null): RunStatus | null {
  if (status?.state !== "running") {
    return status;
  }

  return {
    state: "exited",
    code: null,
    signal: null,
    error: "Run was in progress when the session was captured and was not resumed.",
  };
}

function isLoadableSession(value: unknown): value is LoadableSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const session = value as LoadableSession;
  return (
    session.schemaVersion === 1 &&
    typeof session.capturedAt === "string" &&
    typeof session.sessionId === "string" &&
    typeof session.workspaceId === "string" &&
    Array.isArray(session.sourceTabs) &&
    isSourceTabState({ tabs: session.sourceTabs, activeTabId: session.activeSourceTabId }) &&
    typeof session.editor === "object" &&
    session.editor !== null &&
    typeof session.editor.value === "string" &&
    typeof session.compilation === "object" &&
    session.compilation !== null &&
    typeof session.compilation.latestImplementationSource === "string" &&
    isLoadableSessionSelection(session.compilation.selection) &&
    typeof session.run === "object" &&
    session.run !== null &&
    Array.isArray(session.run.tabs) &&
    typeof session.agent === "object" &&
    session.agent !== null &&
    Array.isArray(session.agent.messages)
  );
}

function isLoadableSessionSelection(value: unknown): value is LoadableSessionSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const selection = value as LoadableSessionSelection;
  return (
    selection.kind === "none" ||
    selection.kind === "whole-file" ||
    (selection.kind === "snippet" && (typeof selection.hash === "string" || selection.hash === null)) ||
    (
      selection.kind === "definition" &&
      typeof selection.line === "number" &&
      typeof selection.name === "string" &&
      (selection.targetKind === "function" || selection.targetKind === "class")
    )
  );
}

function getOrCreateWorkspaceId(): string {
  try {
    const existing = window.localStorage.getItem(workspaceIdStorageKey);
    if (existing) {
      return existing;
    }

    const next = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(workspaceIdStorageKey, next);
    return next;
  } catch {
    return `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function loadAppSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(appSettingsStorageKey);
    if (!raw) {
      return defaultAppSettings();
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      compilationStrategy: compilationMode(parsed.compilationStrategy),
    };
  } catch {
    return defaultAppSettings();
  }
}

function saveAppSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings", error);
  }
}

function defaultAppSettings(): AppSettings {
  return {
    compilationStrategy: "auto",
  };
}

function renderCompilationStrategyOptions(selected: CompilationMode): string {
  const stableOptions: Array<{ value: CompilationMode; label: string }> = [
    { value: "auto", label: "Auto" },
    { value: "parallel", label: "Parallel" },
    { value: "sequential", label: "Sequential" },
    { value: "agentic", label: "Agentic" },
  ];
  const experimentalOptions: Array<{ value: CompilationMode; label: string }> = [
    { value: "parallel-methods", label: "Parallel methods" },
    { value: "agentic-methods", label: "Agentic methods" },
  ];
  const options = shouldShowExperimentalCompilationStrategies(selected)
    ? [...stableOptions, ...experimentalOptions]
    : stableOptions;
  return options.map((option) => {
    return `<option value="${option.value}"${selected === option.value ? " selected" : ""}>${option.label}</option>`;
  }).join("");
}

function shouldShowExperimentalCompilationStrategies(selected: CompilationMode): boolean {
  return isExperimentalCompilationMode(selected) || window.localStorage.getItem(
    experimentalCompilationStrategiesStorageKey,
  ) === "true";
}

function compilationMode(value: unknown): CompilationMode {
  return value === "parallel" ||
    value === "parallel-methods" ||
    value === "sequential" ||
    value === "agentic" ||
    value === "agentic-methods" ||
    value === "auto"
    ? value
    : "auto";
}

function isExperimentalCompilationMode(value: CompilationMode): boolean {
  return value === "parallel-methods" || value === "agentic-methods";
}

window.loadLogosSession = loadSession;
window.createLogosSessionBundle = createLoadableSession;

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
    workspace: {
      activeSourceTabId,
      sourceTabs: sourceTabs.map((tab) => ({
        id: tab.id,
        projectId: tab.projectId,
        title: tab.title,
        source: tab.source,
      })),
      compileVersion,
      latestImplementationSource,
    },
    ui: {
      settings: {
        compilationStrategy: appSettings.compilationStrategy,
      },
      selectedSampleId: activeSampleItem()?.dataset.sampleId ?? null,
      selectedSampleLabel: activeSampleItem()?.textContent ?? null,
      sampleMenuOpen: sampleMenu.open,
      activeTab: activeToolTabId,
      lastRunLabel,
      runStatus: {
        text: runStatus.textContent ?? "",
        state: runStatus.dataset.state ?? "",
      },
      runStale: lastRunDefinitionHash !== null && definitionHash(editor.getValue()) !== lastRunDefinitionHash,
      output: runTabById(activeToolTabId)?.terminalText ?? "",
      runTabs: runTabs.map((tab) => ({
        id: tab.id,
        runnable: tab.runnable,
        status: tab.status,
        output: tab.terminalText,
      })),
      implementation: latestImplementationSource,
      selectedSnippet: selectedSnippetHash === null
        ? null
        : {
            hash: selectedSnippetHash,
            label: incompleteSnippetByHash.get(selectedSnippetHash)?.label ?? null,
            preview: snippetPreviewEditor.getValue(),
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
  const active = activeSourceTab();
  if (!active) {
    return null;
  }

  return sampleMenuItems.find((item) => item.dataset.sampleId === active.projectId) ?? null;
}

function requiredQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
