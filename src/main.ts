import "./styles.css";
import "@xterm/xterm/css/xterm.css";
import radixThemesCss from "@radix-ui/themes/styles.css?inline";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip,
} from "@radix-ui/themes";
import {
  conf as typeScriptLanguageConfiguration,
  language as typeScriptLanguage,
} from "monaco-editor/esm/vs/basic-languages/typescript/typescript.js";
import {
  completionSnippetHashes,
  definitionReadiness,
  definitionReadinessFromImplementation,
  hashCompletionInput,
  indentNaturalReplacement,
  implementationBlockForTarget,
  implementationForIncompleteSnippet,
  implementationMatchForIncompleteSnippet,
  implementationMatchForTarget,
  implementationTargetAtLine,
  parse,
  runnables,
  selectionContextAtPosition,
  splitNaturalReplacement,
  type DefinitionReadiness,
  type IncompleteSnippet,
  type ImplementationTarget,
  type Runnable,
  type SnippetHash,
  UNKNOWN_IMPLEMENTATION_MATCH_TEXT,
} from "./codeSheet";
import { createSessionCapture, type JsonObject } from "./sessionCaptureClient";
import { snippetPopupTargetForClick } from "./snippetHitTest";
import {
  defaultProjectIds,
  samples,
  sampleTemplateGroups,
  type SampleGroup,
  type SampleProgram,
} from "./samples";
import type { TypeCheckDiagnostic } from "./typeCheck";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

const logosRadix = {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip,
};

type SourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
  implementation?: string | null;
};

type SourceTabState = {
  tabs: SourceTab[];
  activeTabId: string | null;
};

type CompilationMode = "parallel" | "parallel-methods" | "sequential" | "agentic" | "agentic-methods";

type AppSettings = {
  compilationStrategy: CompilationMode;
};

type AppPageId =
  | "editor"
  | "vision"
  | "alternatives"
  | "spec-driven"
  | "technical"
  | "roadmap";

type AppPage = {
  id: AppPageId;
  title?: string;
  articlePath?: string;
};

type LegacyAgentChatMessage = {
  role: "user" | "assistant";
  content: string;
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
  | { kind: "definition"; line: number; name: string; targetKind: "function" | "class" | "field" | "method"; className?: string }
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
    tabs: LoadableSessionRunTab[];
  };
  agent: {
    expanded: boolean;
    input: string;
    messages: LegacyAgentChatMessage[];
  };
};

declare global {
  interface Window {
    loadLogosSession?: (session: LoadableSession) => Promise<void>;
    createLogosSessionBundle?: () => LoadableSession;
    __logosReact?: typeof React;
    __logosReactCreateRoot?: typeof createRoot;
    __logosRadix?: typeof logosRadix;
  }
}

window.__logosReact = React;
window.__logosReactCreateRoot = createRoot;
window.__logosRadix = logosRadix;

type InteractiveRunStartResponse = InteractiveTerminalRunStartResponse | InteractiveReactRunStartResponse;

type InteractiveTerminalRunStartResponse = {
  ok: true;
  kind: "terminal";
  sessionId: string;
  runnable: Runnable;
  implementation: string;
  chunks: RunChunk[];
  status: RunStatus;
};

type InteractiveReactRunStartResponse = {
  ok: true;
  kind: "react";
  runId: string;
  runnable: Runnable;
  implementation: string;
  appCode: string;
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
const sidebarCollapsedStorageKey = "logos-interviews-sidebar-collapsed";
const experimentalCompilationStrategiesStorageKey = "logos.experimentalCompilationStrategies";
const staleDefaultProjectIdSets = [
  [
    "starter-arithmetic",
    "beyond-basics",
    "formula-spreadsheet",
    "annotated-maze",
  ],
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
const legacySampleLabels = new Map<string, string[]>([
  ["annotated-maze", ["Annotated maze"]],
  ["formula-spreadsheet", ["Formula spreadsheet"]],
]);

const initialSourceTabState = defaultSourceTabState();
let sourceTabs = initialSourceTabState.tabs;
let activeSourceTabId = initialSourceTabState.activeTabId;
const seedCode = activeSourceTab()?.source ?? "";
const seedImplementation = activeSourceTab()?.implementation ?? "";
let appSettings = loadAppSettings();
let sidebarCollapsed = loadSidebarCollapsed();
const appPages: AppPage[] = [
  { id: "editor", title: "Interactive Editor" },
  { id: "vision", articlePath: "/articles/vision.md" },
  { id: "alternatives", articlePath: "/articles/versus-coding-agents.md" },
  { id: "spec-driven", articlePath: "/articles/spec-driven-coding.md" },
  { id: "technical", articlePath: "/articles/compiling-natural-language.md" },
  { id: "roadmap", articlePath: "/articles/roadmap.md" },
];
let activePageId: AppPageId = pageIdFromHash(window.location.hash) ?? "editor";

const app = requiredQuery<HTMLDivElement>("#app");
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
const sidebarToggleIcon = `
  <svg class="sidebar-toggle-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M12.5 5.5 8 10l4.5 4.5" />
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
const feedbackResetTimers = new WeakMap<HTMLElement, number>();
const templateGroups = createTemplateGroups(sampleTemplateGroups);
type ParsedArticle = {
  title: string | null;
  html: string;
};

const articleByPageId = new Map<AppPageId, ParsedArticle>();
const articleLoadByPageId = new Map<AppPageId, Promise<ParsedArticle>>();

function renderAppNav(): string {
  return appPages
    .map(
      (page) => `<button class="app-nav-item" type="button" data-app-page="${page.id}" aria-current="${page.id === activePageId ? "page" : "false"}" aria-label="${escapeHtml(pageDisplayTitle(page))}" title="${escapeHtml(pageDisplayTitle(page))}">
        <span>${escapeHtml(pageDisplayTitle(page))}</span>
      </button>`,
    )
    .join("");
}

function renderArticlePages(): string {
  return appPages
    .filter((page) => page.id !== "editor")
    .map(
      (page) => `<section id="${page.id}-page" class="app-page info-page${page.id === activePageId ? " active" : ""}" data-page-id="${page.id}" aria-label="${escapeHtml(pageDisplayTitle(page))}"${page.id === activePageId ? "" : " hidden"}>
        <div class="info-page-inner">
          <article class="article-content" data-article-content="${page.id}" data-article-path="${escapeHtml(page.articlePath ?? "")}">
            <p class="article-loading">Loading...</p>
          </article>
        </div>
      </section>`,
    )
    .join("");
}

function pageDisplayTitle(page: AppPage): string {
  return page.title ??
    articleByPageId.get(page.id)?.title ??
    articlePathFallbackTitle(page.articlePath) ??
    page.id;
}

function articlePathFallbackTitle(articlePath: string | undefined): string | null {
  if (!articlePath) {
    return null;
  }

  const filename = articlePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "";
  if (!filename) {
    return null;
  }

  return filename.split("-").map((part) => {
    return part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`;
  }).join(" ");
}

function refreshPageTitles(): void {
  for (const page of appPages) {
    const title = pageDisplayTitle(page);
    const button = appNav.querySelector<HTMLButtonElement>(`[data-app-page="${page.id}"]`);
    const label = button?.querySelector("span");
    if (label) {
      label.textContent = title;
    }
    button?.setAttribute("title", title);
    button?.setAttribute("aria-label", title);

    const section = document.querySelector<HTMLElement>(`[data-page-id="${page.id}"]`);
    if (section) {
      section.setAttribute("aria-label", title);
    }
  }
}

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
  <section class="app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}" aria-label="Spreadsheet interview workspace">
    <aside class="app-sidebar" aria-label="Application pages">
      <div class="app-sidebar-brand">
        <span class="logos-wordmark"><span class="logos-mark">λ</span><span class="logos-name">ogos</span></span>
        <button id="sidebar-collapse-button" class="sidebar-collapse-button" type="button" aria-label="${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}" aria-expanded="${sidebarCollapsed ? "false" : "true"}" title="${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}">
          ${sidebarToggleIcon}
        </button>
      </div>
      <nav id="app-nav" class="app-nav" aria-label="Pages">
        ${renderAppNav()}
      </nav>
      <div class="app-sidebar-footer">
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
              <button id="copy-session-id-button" class="menu-item" type="button" role="menuitem">
                Copy session ID
              </button>
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

    <main id="page-host" class="page-host">
      <section id="editor-page" class="app-page editor-page${activePageId === "editor" ? " active" : ""}" data-page-id="editor" aria-label="Interactive Editor"${activePageId === "editor" ? "" : " hidden"}>
        <section id="shell" class="shell">
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
            <section id="snippet-panel" class="snippet-panel" aria-label="Selected implementation preview" aria-hidden="true" hidden>
              <div
                id="snippet-resize-handle"
                class="snippet-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize incomplete implementation panel"
                tabindex="0"
              ></div>
              <header id="snippet-panel-header" class="snippet-panel-header">
                <span id="snippet-status-indicator" class="snippet-status-indicator" aria-hidden="true"></span>
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
                <div class="source-tab-shell output-tab-shell" data-implementation-tab-shell>
                  <button
                    id="implementation-view-tab"
                    class="source-tab output-tab active"
                    type="button"
                    role="tab"
                    data-tool-tab-id="implementation-view"
                    aria-selected="true"
                    aria-controls="implementation-view-panel"
                  >Implementation</button>
                </div>
              </div>
              ${renderFeedbackControls("output")}
            </div>
            <div id="tool-panels" class="tool-panels">
              <div id="implementation-view-panel" class="output implementation-output tab-panel active" role="tabpanel" aria-labelledby="implementation-view-tab" aria-live="polite"></div>
              <pre id="run-placeholder" class="output run-placeholder tab-panel" aria-live="polite">Runs will appear here.</pre>
            </div>
          </section>
        </section>
      </section>
      ${renderArticlePages()}
    </main>
  </section>
`;

const appFrame = requiredQuery<HTMLElement>(".app-frame");
const appNav = requiredQuery<HTMLElement>("#app-nav");
const sidebarCollapseButton = requiredQuery<HTMLButtonElement>("#sidebar-collapse-button");
const shell = requiredQuery<HTMLElement>("#shell");
const sourceTabsEl = requiredQuery<HTMLDivElement>("#source-tabs");
const codePane = requiredQuery<HTMLElement>("#code-pane");
const editorEl = requiredQuery<HTMLDivElement>("#editor");
const codeRunResizeHandle = requiredQuery<HTMLDivElement>("#code-run-resize-handle");
const outputPane = requiredQuery<HTMLElement>("#output-pane");
const toolTabsList = requiredQuery<HTMLDivElement>("#tool-tabs-list");
const toolPanels = requiredQuery<HTMLDivElement>("#tool-panels");
const implementationViewTab = requiredQuery<HTMLButtonElement>("#implementation-view-tab");
const implementationViewPanel = requiredQuery<HTMLDivElement>("#implementation-view-panel");
const runPlaceholder = requiredQuery<HTMLPreElement>("#run-placeholder");
const snippetPanel = requiredQuery<HTMLElement>("#snippet-panel");
const snippetPanelHeader = requiredQuery<HTMLElement>("#snippet-panel-header");
const snippetResizeHandle = requiredQuery<HTMLDivElement>("#snippet-resize-handle");
const snippetStatusIndicator = requiredQuery<HTMLSpanElement>("#snippet-status-indicator");
const snippetTitle = requiredQuery<HTMLHeadingElement>("#snippet-title");
const snippetPreview = requiredQuery<HTMLDivElement>("#snippet-preview");
const sampleMenu = requiredQuery<HTMLDetailsElement>("#sample-menu");
const workspaceMenu = requiredQuery<HTMLDetailsElement>("#workspace-menu");
const copySessionIdButton = requiredQuery<HTMLButtonElement>("#copy-session-id-button");
const clearCodeCacheButton = requiredQuery<HTMLButtonElement>("#clear-code-cache-button");
const resetWorkspaceButton = requiredQuery<HTMLButtonElement>("#reset-workspace-button");
const compilationStrategySelect = requiredQuery<HTMLSelectElement>("#compilation-strategy-select");
const scratchFileButton = requiredQuery<HTMLButtonElement>("#scratch-file-button");
const sampleMenuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".sample-menu-item"),
);
let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileVersion = 0;
let sourceTabSaveTimer: ReturnType<typeof setTimeout> | null = null;
let compilationPending = false;
let applyingSourceTab = false;
let latestReadinessDefinitions: DefinitionReadiness[] = [];
let latestTypeCheckDiagnostics: TypeCheckDiagnostic[] = [];
let readinessDecorations: string[] = [];
let runnableDecorations: string[] = [];
let runnableRunZoneIds: string[] = [];
let incompleteSnippetDecorations: string[] = [];
let selectedDefinitionDecorations: string[] = [];
let implementationSnippetDecorations: string[] = [];
let runnableStateByLine = new Map<number, RunnableState>();
let incompleteSnippetsByLine = new Map<number, IncompleteSnippetTarget[]>();
let incompleteSnippetByHash = new Map<SnippetHash, IncompleteSnippetTarget>();
let snippetPreviewByHash = new Map<SnippetHash, SnippetPreviewState>();
let selectedSnippetHash: SnippetHash | null = null;
let snippetGuideHash: SnippetHash | null = null;
let selectedDefinitionTarget: ImplementationTarget | null = null;
let selectedWholeFileImplementation = false;
let snippetPopupPinned = false;
let snippetPopupDragging = false;
let snippetPopupHoveringPanel = false;
let snippetPopupCloseTimer: ReturnType<typeof setTimeout> | null = null;
let latestImplementationSource = seedImplementation;
let runTabs: RunTab[] = [];
const implementationToolTabId = "implementation-view";
let activeToolTabId: ToolTabId = implementationToolTabId;
let activeCompilationUnsubscribe: (() => void) | null = null;
let draggedSourceTabId: string | null = null;
let terminalFitFrame: number | null = null;

type SourceTabDropSlot = {
  insertIndex: number;
  markerX: number;
  isNoop: boolean;
};

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
  reactRunId: string | null;
  renderMode: "terminal" | "react";
  reactAppCode: string | null;
  reactRoot: ReturnType<typeof createRoot> | null;
  sourceHash: string;
  terminalText: string;
  terminalRenderedLength: number;
  terminalCols: number | null;
  terminalRows: number | null;
  terminal: Terminal | null;
  terminalFitAddon: FitAddon | null;
  terminalInputDisposable: ReturnType<Terminal["onData"]> | null;
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

type SnippetPanelStatus = SnippetPreviewState["status"] | null;

type SheetId = string;
type SourceFingerprint = string;

type CompilationStatus = "idle" | "compiling" | "compiled" | "failed";

type SheetImplementationCacheEntry = {
  sheetId: SheetId;
  sheetCode: string;
  implementation: string;
};

type CompileSession = {
  sheetId: SheetId;
  currentCode: string;
  lastImplementation: string;
  draftImplementation: string | null;
  streamHash: string | null;
};

type CompilationState = {
  sheetId: SheetId;
  source: string;
  sourceFingerprint: SourceFingerprint;
  strategy: CompilationMode;
  status: CompilationStatus;
  session: CompileSession;
  readiness: DefinitionReadiness[];
  diagnostics: TypeCheckDiagnostic[];
  snippetPreviews: Map<SnippetHash, SnippetPreviewState>;
  error: string | null;
};

type CompilationRequest = {
  sheetId: SheetId;
  source: string;
  sourceFingerprint: SourceFingerprint;
  strategy: CompilationMode;
};

type CompilationJob = {
  request: CompilationRequest;
  controller: AbortController;
  promise: Promise<CompilationState>;
};

type CompilationListener = (state: CompilationState) => void;

class CompilationService {
  private readonly states = new Map<SheetId, CompilationState>();
  private readonly jobs = new Map<SheetId, CompilationJob>();
  private readonly listeners = new Map<SheetId, Set<CompilationListener>>();

  compile(sheetId: SheetId): Promise<CompilationState> {
    const request = compilationRequestForSheet(sheetId);
    if (request === null) {
      return Promise.resolve(this.getCompilationState(sheetId));
    }

    const state = this.states.get(sheetId);
    if (state && this.stateMatchesRequest(state, request) && state.status === "compiled") {
      return Promise.resolve(state);
    }

    const job = this.jobs.get(sheetId);
    if (job && this.requestMatches(job.request, request)) {
      return job.promise;
    }

    this.abortJob(sheetId);
    const controller = new AbortController();
    this.setState(initialCompilationState(request, "compiling"));

    const promise = this.runCompile(request, controller);
    this.jobs.set(sheetId, { request, controller, promise });
    return promise;
  }

  getCompilationState(sheetId: SheetId): CompilationState {
    const request = compilationRequestForSheet(sheetId);
    if (request === null) {
      return emptyCompilationState(sheetId);
    }

    const state = this.states.get(sheetId);
    if (state && this.stateMatchesRequest(state, request)) {
      return state;
    }

    return initialCompilationState(request, "idle");
  }

  subscribe(sheetId: SheetId, listener: CompilationListener): () => void {
    const listeners = this.listeners.get(sheetId) ?? new Set<CompilationListener>();
    listeners.add(listener);
    this.listeners.set(sheetId, listeners);
    listener(this.getCompilationState(sheetId));

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(sheetId);
      }
    };
  }

  invalidateCompilation(sheetId: SheetId): void {
    this.abortJob(sheetId);
    this.states.delete(sheetId);
    const request = compilationRequestForSheet(sheetId);
    this.emit(sheetId, request === null ? emptyCompilationState(sheetId) : initialCompilationState(request, "idle"));
    renderSourceTabs();
  }

  invalidateAllCompilations(): void {
    for (const sheetId of Array.from(this.jobs.keys())) {
      this.abortJob(sheetId);
    }
    this.states.clear();

    for (const sheetId of this.listeners.keys()) {
      const request = compilationRequestForSheet(sheetId);
      this.emit(sheetId, request === null ? emptyCompilationState(sheetId) : initialCompilationState(request, "idle"));
    }
    renderSourceTabs();
  }

  rememberCompilationState(state: CompilationState): void {
    this.abortJob(state.sheetId);
    this.setState(state);
  }

  markCompiling(sheetId: SheetId): void {
    const request = compilationRequestForSheet(sheetId);
    if (request === null) {
      this.setState(emptyCompilationState(sheetId));
      return;
    }

    this.abortJob(sheetId);
    this.setState(initialCompilationState(request, "compiling"));
  }

  private async runCompile(request: CompilationRequest, controller: AbortController): Promise<CompilationState> {
    let state = this.getCompilationState(request.sheetId);
    sessionCapture.track("compile_stream_started", { sheetId: request.sheetId, source: request.source }, false);

    try {
      for await (const event of compileViaDevApi(request.source, controller.signal, request.strategy)) {
        if (!this.jobStillCurrent(request, controller)) {
          return this.getCompilationState(request.sheetId);
        }

        state = reduceCompilationEvent(state, event);
        this.setState(state);
      }

      if (state.status !== "compiled") {
        state = { ...state, status: "compiled" };
        this.setState(state);
      }

      sessionCapture.track("compile_stream_completed", { sheetId: request.sheetId }, true);
      return state;
    } catch (error) {
      if (controller.signal.aborted || !this.jobStillCurrent(request, controller)) {
        return this.getCompilationState(request.sheetId);
      }

      const failed = {
        ...state,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      };
      console.error(error);
      sessionCapture.track(
        "compile_stream_failed",
        { sheetId: request.sheetId, error: failed.error },
        true,
      );
      this.setState(failed);
      return failed;
    } finally {
      const job = this.jobs.get(request.sheetId);
      if (job?.controller === controller) {
        this.jobs.delete(request.sheetId);
      }
    }
  }

  private abortJob(sheetId: SheetId): void {
    const job = this.jobs.get(sheetId);
    if (job) {
      job.controller.abort();
      this.jobs.delete(sheetId);
    }
  }

  private jobStillCurrent(request: CompilationRequest, controller: AbortController): boolean {
    const job = this.jobs.get(request.sheetId);
    return job?.controller === controller && this.requestMatches(job.request, request);
  }

  private stateMatchesRequest(state: CompilationState, request: CompilationRequest): boolean {
    return state.sourceFingerprint === request.sourceFingerprint && state.strategy === request.strategy;
  }

  private requestMatches(left: CompilationRequest, right: CompilationRequest): boolean {
    return left.sheetId === right.sheetId &&
      left.sourceFingerprint === right.sourceFingerprint &&
      left.strategy === right.strategy;
  }

  private setState(state: CompilationState): void {
    const previousStatus = this.states.get(state.sheetId)?.status ?? null;
    this.states.set(state.sheetId, state);
    this.emit(state.sheetId, state);
    if (previousStatus !== state.status) {
      renderSourceTabs();
    }
  }

  private emit(sheetId: SheetId, state: CompilationState): void {
    for (const listener of this.listeners.get(sheetId) ?? []) {
      listener(state);
    }
  }
}

const compilationService = new CompilationService();

function compile(sheetId: SheetId): Promise<CompilationState> {
  return compilationService.compile(sheetId);
}

function getCompilationState(sheetId: SheetId): CompilationState {
  return compilationService.getCompilationState(sheetId);
}

function subscribeToCompilation(sheetId: SheetId, listener: CompilationListener): () => void {
  return compilationService.subscribe(sheetId, listener);
}

function invalidateCompilation(sheetId: SheetId): void {
  compilationService.invalidateCompilation(sheetId);
}

function invalidateAllCompilations(): void {
  compilationService.invalidateAllCompilations();
}

function rememberCompilationState(state: CompilationState): void {
  compilationService.rememberCompilationState(state);
}

const logosTypeScriptLanguageId = "logos-typescript";

registerLogosTypeScriptLanguage();

monaco.editor.defineTheme("interview-light", {
  base: "vs",
  inherit: false,
  rules: [
    { token: "", foreground: "20242a" },
    { token: "comment", foreground: "6f7f68" },
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
    { token: "comment.logos-typescript", foreground: "6f7f68" },
    { token: "keyword.logos-typescript", foreground: "7a5268", fontStyle: "normal" },
    { token: "identifier.logos-typescript", foreground: "20242a" },
    { token: "number.logos-typescript", foreground: "3f6f6a" },
    { token: "number.hex.logos-typescript", foreground: "3f6f6a" },
    { token: "string.logos-typescript", foreground: "7a5a3a" },
    { token: "string.escape.logos-typescript", foreground: "8a6844" },
    { token: "delimiter.logos-typescript", foreground: "aca59b" },
    { token: "delimiter.curly.logos-typescript", foreground: "aca59b" },
    { token: "delimiter.bracket.logos-typescript", foreground: "aca59b" },
    { token: "delimiter.parenthesis.logos-typescript", foreground: "aca59b" },
    { token: "operator.logos-typescript", foreground: "8e8375" },
    { token: "type.logos-typescript", foreground: "3f6f6a" },
    { token: "predefined.logos-typescript", foreground: "4f677c" },
    { token: "naturalSnippet.logos-typescript", foreground: "b74716" },
    { token: "naturalSnippet.delimiter.logos-typescript", foreground: "9b4d2e" },
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

installMonacoShortcutGuard(editorEl);
installMonacoShortcutGuard(snippetPreview);
installMonacoShortcutGuard(implementationViewPanel);

const editor = monaco.editor.create(editorEl, {
  value: seedCode,
  language: logosTypeScriptLanguageId,
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
  language: logosTypeScriptLanguageId,
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

const implementationViewEditor = monaco.editor.create(implementationViewPanel, {
  value: implementationViewText(),
  language: logosTypeScriptLanguageId,
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
attachBlockIndentGuideOverlay(implementationViewEditor);
installEditorTypingAssist(editor);

const sessionCapture = createSessionCapture({ getSnapshot: appSnapshot });
let editorCaptureTimer: ReturnType<typeof setTimeout> | null = null;
let isLoadingSession = false;

editor.onDidChangeModelContent(() => {
  if (isLoadingSession || applyingSourceTab) {
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

editor.onMouseMove((event) => {
  if (activeToolTabId === implementationToolTabId) {
    hideSnippetPopup();
    return;
  }

  if (snippetPopupPinned || snippetPopupHoveringPanel || snippetPopupDragging) {
    return;
  }

  const position = event.target.position;
  if (!position) {
    hideSnippetPopup();
    return;
  }

  const target = exactIncompleteSnippetForPosition(position.lineNumber, position.column);
  if (!target || target.kind === "natural") {
    hideSnippetPopup();
    return;
  }

  showSnippetPopupForTarget(target, editorMouseClientPoint(event));
});

editor.onMouseLeave(() => {
  if (!snippetPopupPinned) {
    scheduleSnippetPopupClose();
  }
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
        if (incompleteSnippet.kind === "natural") {
          hideSnippetPopup();
          if (activeToolTabId === implementationToolTabId) {
            revealImplementationForSnippet(incompleteSnippet);
          }
          return;
        }
        if (activeToolTabId === implementationToolTabId) {
          hideSnippetPopup();
          revealImplementationForSnippet(incompleteSnippet);
        } else {
          snippetPopupPinned = true;
          showSnippetPopupForTarget(incompleteSnippet, editorMouseClientPoint(event));
        }
        clearEditorSelectionAt(lineNumber, column);
        return;
      }
    }

    if (context.kind === "implementation") {
      hideSnippetPopup();
      selectDefinitionImplementation(context.target);
      if (activeToolTabId === implementationToolTabId) {
        revealImplementationForDefinition(context.target);
      }
      return;
    }

    hideSnippetPopup();
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
copySessionIdButton.addEventListener("click", () => {
  workspaceMenu.open = false;
  void copyCurrentSessionId();
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
    return;
  }

  const toolTabButton = target.closest<HTMLButtonElement>("[data-tool-tab-id]");
  if (toolTabButton) {
    setActiveTab(toolTabButton.dataset.toolTabId ?? implementationToolTabId);
    sessionCapture.track("tab_changed", { tab: "implementation" }, true);
  }
});
appNav.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-app-page]");
  if (!button) {
    return;
  }

  const pageId = pageIdFromValue(button.dataset.appPage);
  if (!pageId) {
    return;
  }

  setActivePage(pageId, { updateHash: true });
  sessionCapture.track("page_changed", { pageId }, true);
});
sidebarCollapseButton.addEventListener("click", () => {
  setSidebarCollapsed(!sidebarCollapsed, { persist: true });
  sessionCapture.track("sidebar_toggled", { collapsed: sidebarCollapsed }, true);
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
snippetPanel.addEventListener("pointerenter", () => {
  snippetPopupHoveringPanel = true;
  clearSnippetPopupCloseTimer();
});
snippetPanel.addEventListener("pointerleave", () => {
  snippetPopupHoveringPanel = false;
  if (!snippetPopupPinned && !snippetPopupDragging) {
    scheduleSnippetPopupClose();
  }
});
snippetPanelHeader.addEventListener("pointerdown", (event) => {
  beginSnippetPopupDrag(event);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && snippetPopupPinned) {
    snippetPopupPinned = false;
    hideSnippetPopup();
    event.preventDefault();
    return;
  }

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
document.addEventListener("pointerdown", (event) => {
  closeMenusOnOutsidePointerDown(event);

  if (!snippetPopupPinned) {
    return;
  }

  const target = event.target instanceof Node ? event.target : null;
  if (target && (snippetPanel.contains(target) || editorEl.contains(target))) {
    return;
  }

  snippetPopupPinned = false;
  hideSnippetPopup();
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
sourceTabsEl.addEventListener("dragstart", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("[data-close-tab-id]")) {
    event.preventDefault();
    return;
  }

  const shell = target.closest<HTMLElement>("[data-source-tab-shell-id]");
  if (!shell || sourceTabs.length < 2) {
    event.preventDefault();
    return;
  }

  draggedSourceTabId = shell.dataset.sourceTabShellId ?? null;
  if (!draggedSourceTabId || !event.dataTransfer) {
    event.preventDefault();
    return;
  }

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedSourceTabId);
  event.dataTransfer.setDragImage(transparentDragImage(), 0, 0);
  sourceTabsEl.classList.add("source-tabs-dragging");
  shell.classList.add("source-tab-shell-dragging");
});
sourceTabsEl.addEventListener("dragover", (event) => {
  if (!draggedSourceTabId) {
    return;
  }

  const slot = sourceTabDropSlot(event.clientX);
  if (!slot) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }

  renderSourceTabDropSlot(slot);
});
sourceTabsEl.addEventListener("dragleave", (event) => {
  const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (!relatedTarget || !sourceTabsEl.contains(relatedTarget)) {
    clearSourceTabDropMarker();
  }
});
sourceTabsEl.addEventListener("drop", (event) => {
  if (!draggedSourceTabId) {
    return;
  }

  const slot = sourceTabDropSlot(event.clientX);
  if (!slot) {
    clearSourceTabDragState();
    return;
  }

  event.preventDefault();
  moveSourceTab(draggedSourceTabId, slot.insertIndex);
  clearSourceTabDragState();
});
sourceTabsEl.addEventListener("dragend", () => {
  clearSourceTabDragState();
});
window.addEventListener("hashchange", () => {
  setActivePage(pageIdFromHash(window.location.hash) ?? "editor");
});
window.addEventListener("popstate", () => {
  setActivePage(pageIdFromHash(window.location.hash) ?? "editor");
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

function closeMenusOnOutsidePointerDown(event: PointerEvent): void {
  if (!sampleMenu.open && !workspaceMenu.open) {
    return;
  }

  const target = event.target instanceof Node ? event.target : null;
  if (!target) {
    closeOpenMenus();
    return;
  }

  if (sampleMenu.contains(target) || workspaceMenu.contains(target)) {
    return;
  }

  closeOpenMenus();
}

function setSidebarCollapsed(collapsed: boolean, options: { persist?: boolean } = {}): void {
  sidebarCollapsed = collapsed;
  appFrame.classList.toggle("sidebar-collapsed", collapsed);

  const action = collapsed ? "Expand sidebar" : "Collapse sidebar";
  sidebarCollapseButton.setAttribute("aria-label", action);
  sidebarCollapseButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  sidebarCollapseButton.title = action;

  if (options.persist) {
    saveSidebarCollapsed(collapsed);
  }

  requestAnimationFrame(() => {
    editor.layout();
    snippetPreviewEditor.layout();
    implementationViewEditor.layout();
    updateShellResizeHandles();
  });
}

function setActivePage(pageId: AppPageId, options: { updateHash?: boolean } = {}): void {
  activePageId = pageId;
  document.querySelectorAll<HTMLElement>("[data-page-id]").forEach((page) => {
    const active = page.dataset.pageId === pageId;
    page.hidden = !active;
    page.classList.toggle("active", active);
  });
  appNav.querySelectorAll<HTMLButtonElement>("[data-app-page]").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.appPage === pageId ? "page" : "false");
  });

  if (options.updateHash) {
    const nextHash = pageId === "editor" ? "" : `#${pageId}`;
    if (window.location.hash !== nextHash) {
      history.pushState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }

  if (pageId === "editor") {
    requestAnimationFrame(() => {
      editor.layout();
      snippetPreviewEditor.layout();
      implementationViewEditor.layout();
      updateShellResizeHandles();
    });
  } else {
    void loadArticlePage(pageId);
  }
}

async function loadArticlePage(pageId: AppPageId): Promise<void> {
  const page = appPages.find((item) => item.id === pageId);
  if (!page?.articlePath) {
    return;
  }

  const target = document.querySelector<HTMLElement>(`[data-article-content="${pageId}"]`);
  if (!target) {
    return;
  }

  const cachedArticle = articleByPageId.get(pageId);
  if (cachedArticle) {
    target.innerHTML = cachedArticle.html;
    return;
  }

  target.innerHTML = `<p class="article-loading">Loading...</p>`;

  try {
    const article = await loadArticle(page);
    refreshPageTitles();
    target.innerHTML = article.html;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    target.innerHTML = `<p class="article-error">${escapeHtml(message)}</p>`;
  }
}

async function loadArticle(page: AppPage): Promise<ParsedArticle> {
  const cachedArticle = articleByPageId.get(page.id);
  if (cachedArticle) {
    return cachedArticle;
  }

  const cachedLoad = articleLoadByPageId.get(page.id);
  if (cachedLoad) {
    return cachedLoad;
  }

  const load = fetchArticle(page);
  articleLoadByPageId.set(page.id, load);
  try {
    const article = await load;
    articleByPageId.set(page.id, article);
    return article;
  } finally {
    articleLoadByPageId.delete(page.id);
  }
}

async function fetchArticle(page: AppPage): Promise<ParsedArticle> {
  if (!page.articlePath) {
    throw new Error(`Missing article path for ${page.id}`);
  }

  const response = await fetch(page.articlePath, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${page.articlePath}`);
  }

  const markdown = await response.text();
  const frontmatter = parseFrontmatter(markdown);
  return {
    title: frontmatter.attributes.get("title") ?? null,
    html: markdownToHtml(markdown),
  };
}

async function loadArticleTitles(): Promise<void> {
  await Promise.all(appPages
    .filter((page) => page.articlePath)
    .map(async (page) => {
      try {
        await loadArticle(page);
        refreshPageTitles();
      } catch {
        // The article view displays load errors when the user opens the page.
      }
    }));
}

function markdownToHtml(source: string): string {
  const lines = parseFrontmatter(source).body.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  const paragraph: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let codeLines: string[] = [];
  let codeFence: MarkdownCodeFence | null = null;

  const closeParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };

  const closeList = () => {
    if (!listTag) {
      return;
    }

    html.push(`</${listTag}>`);
    listTag = null;
  };

  const openList = (tag: "ul" | "ol") => {
    closeParagraph();
    if (listTag === tag) {
      return;
    }

    closeList();
    html.push(`<${tag}>`);
    listTag = tag;
  };

  for (const line of lines) {
    if (codeFence) {
      if (isClosingCodeFence(line, codeFence)) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        codeFence = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const openingCodeFence = parseOpeningCodeFence(line);
    if (openingCodeFence) {
      closeParagraph();
      closeList();
      codeLines = [];
      codeFence = openingCodeFence;
      continue;
    }

    if (line.trim().length === 0) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^-\s+(.+)$/.exec(line);
    if (unordered) {
      openList("ul");
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      openList("ol");
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeFence) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeParagraph();
  closeList();

  return html.join("\n");
}

type MarkdownCodeFence = {
  marker: "`" | "~";
  length: number;
};

function parseOpeningCodeFence(line: string): MarkdownCodeFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) {
    return null;
  }

  const sequence = match[1];
  return { marker: sequence[0] as MarkdownCodeFence["marker"], length: sequence.length };
}

function isClosingCodeFence(line: string, fence: MarkdownCodeFence): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(fence.marker.repeat(fence.length))) {
    return false;
  }

  return [...trimmed].every((char) => char === fence.marker);
}

function parseFrontmatter(source: string): { attributes: Map<string, string>; body: string } {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return { attributes: new Map(), body: source };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { attributes: new Map(), body: source };
  }

  const rawAttributes = normalized.slice(4, endIndex).split("\n");
  const bodyStart = normalized.startsWith("\n", endIndex + 4) ? endIndex + 5 : endIndex + 4;
  const attributes = new Map<string, string>();
  for (const line of rawAttributes) {
    const match = /^([A-Za-z0-9_-]+):\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(line);
    if (match) {
      attributes.set(match[1], match[2] ?? match[3] ?? match[4] ?? "");
    }
  }

  return { attributes, body: normalized.slice(bodyStart) };
}

function inlineMarkdown(source: string): string {
  return escapeHtml(source)
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label: string, href: string) => {
      return `<a href="${safeArticleHref(href)}">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function safeArticleHref(source: string): string {
  const href = source.trim();
  if (/^(?:https?:\/\/|\/|#)/.test(href)) {
    return escapeHtml(href);
  }

  return "#";
}

function pageIdFromHash(hash: string): AppPageId | null {
  return pageIdFromValue(hash.replace(/^#/, ""));
}

function pageIdFromValue(value: string | undefined): AppPageId | null {
  return appPages.some((page) => page.id === value) ? (value as AppPageId) : null;
}

renderSourceTabs();
renderSourceTabSeparators(toolTabsList);
setActivePage(activePageId);
void loadArticleTitles();
updateShellResizeHandles();
setActiveCompilationSheet(activeSourceTabId);
void bootWorkspace();

const shellResizeObserver = new ResizeObserver(() => {
  updateShellResizeHandles();
  renderSourceTabSeparators();
  renderSourceTabSeparators(toolTabsList);
  scheduleTerminalFit();
});
shellResizeObserver.observe(shell);
shellResizeObserver.observe(codePane);
shellResizeObserver.observe(outputPane);
shellResizeObserver.observe(sourceTabsEl);
shellResizeObserver.observe(toolTabsList);
async function runCurrentProgram(requestedRunnable?: Runnable): Promise<void> {
  const source = editor.getValue();
  const runnable = requestedRunnable ?? firstRunnable(source);
  if (!runnable) {
    sessionCapture.track("run_blocked", { reason: "no_runnable" }, true);
    return;
  }

  const runTab = createRunTab(runnable, source, definitionHash(source));
  sessionCapture.track("run_requested", { runnable, source }, true);
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
    currentTab.terminalText = result.error;
    currentTab.status = { state: "exited", code: null, signal: null, error: result.error };
    renderRunTab(currentTab);
    return;
  }

  rememberActiveCompilationImplementation(result.implementation, source);
  renderSnippetPanel();
  if (result.kind === "react") {
    currentTab.renderMode = "react";
    currentTab.reactRunId = result.runId;
    currentTab.reactAppCode = result.appCode;
    currentTab.implementation = result.implementation;
    currentTab.status = result.status;
    finishInteractiveRun(currentTab, result.status, result.implementation);
    return;
  }

  currentTab.renderMode = "terminal";
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

  try {
    if (sourceTabSaveTimer) {
      clearTimeout(sourceTabSaveTimer);
      sourceTabSaveTimer = null;
    }
    invalidateAllCompilations();
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

    sessionCapture.track("reset_workspace_completed", {
      openProjects: sourceTabs.map((tab) => tab.projectId),
      activeProjectId: activeSourceTab()?.projectId ?? null,
    }, true);
  } catch (error) {
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
  cancelScheduledCompilation();
  invalidateAllCompilations();

  try {
    const response = await fetch("/api/cache", { method: "DELETE" });
    const payload = (await response.json()) as { ok?: boolean; cleared?: unknown; error?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? "Could not clear code cache");
    }

    for (const tab of sourceTabs) {
      tab.implementation = null;
    }
    latestImplementationSource = "";
    invalidateAllCompilations();
    renderImplementationView();
    scheduleSaveSourceTabs();
    scheduleCompilation(0);
    sessionCapture.track("code_cache_clear_completed", {
      cleared: typeof payload.cleared === "number" ? payload.cleared : null,
    }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sessionCapture.track("code_cache_clear_failed", { error: message }, true);
  } finally {
    clearCodeCacheButton.disabled = false;
  }
}

async function copyCurrentSessionId(): Promise<void> {
  copySessionIdButton.disabled = true;

  try {
    await copyTextToClipboard(sessionCapture.sessionId);
    sessionCapture.track("session_id_copied", { sessionId: sessionCapture.sessionId }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sessionCapture.track("session_id_copy_failed", { error: message }, true);
  } finally {
    copySessionIdButton.disabled = false;
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
  invalidateAllCompilations();
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
  const sheetId = activeSourceTabId;
  if (sheetId === null) {
    clearVisibleCompilationState();
    return;
  }

  compilationService.markCompiling(sheetId);
  updateEditorAvailability();

  if (compileTimer) {
    cancelScheduledCompilation();
  }

  compileTimer = setTimeout(() => {
    compileTimer = null;
    void compile(sheetId);
  }, delayMs);
}

function cancelScheduledCompilation(): void {
  if (compileTimer) {
    clearTimeout(compileTimer);
    compileTimer = null;
  }
}

function openProjectTab(sample: SampleProgram): void {
  syncActiveSourceTab();
  const tab: SourceTab = {
    id: createSourceTabId(sample.id),
    projectId: sample.id,
    title: sample.label,
    source: sample.code,
    implementation: null,
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
    implementation: null,
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

function sourceTabDropSlot(clientX: number): SourceTabDropSlot | null {
  if (!draggedSourceTabId) {
    return null;
  }

  const draggedIndex = sourceTabs.findIndex((tab) => tab.id === draggedSourceTabId);
  if (draggedIndex === -1) {
    return null;
  }

  const shells = Array.from(sourceTabsEl.querySelectorAll<HTMLElement>("[data-source-tab-shell-id]"));
  const remainingShells = shells.filter((shell) => shell.dataset.sourceTabShellId !== draggedSourceTabId);
  if (remainingShells.length === 0) {
    return null;
  }

  let insertIndex = remainingShells.length;
  let nonDraggedTabsBefore = 0;

  for (const shell of shells) {
    const rect = shell.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      insertIndex = nonDraggedTabsBefore;
      break;
    }

    if (shell.dataset.sourceTabShellId !== draggedSourceTabId) {
      nonDraggedTabsBefore += 1;
    }
  }

  return {
    insertIndex,
    markerX: sourceTabDropMarkerX(remainingShells, insertIndex),
    isNoop: insertIndex === draggedIndex,
  };
}

function sourceTabDropMarkerX(remainingShells: HTMLElement[], insertIndex: number): number {
  const stripRect = sourceTabsEl.getBoundingClientRect();
  const boundedIndex = Math.min(Math.max(insertIndex, 0), remainingShells.length);
  const markerClientX = boundedIndex === remainingShells.length
    ? remainingShells[remainingShells.length - 1].getBoundingClientRect().right
    : remainingShells[boundedIndex].getBoundingClientRect().left;
  return snapCssPixel(markerClientX - stripRect.left + sourceTabsEl.scrollLeft);
}

function snapCssPixel(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function devicePixelWidth(pixelCount: number): string {
  const ratio = window.devicePixelRatio || 1;
  return `${pixelCount / ratio}px`;
}

function renderSourceTabSeparators(tabList: HTMLElement = sourceTabsEl): void {
  tabList.style.setProperty("--tab-hairline-width", devicePixelWidth(1));
  tabList.closest<HTMLElement>(".source-tabs-bar")?.style.setProperty("--tab-hairline-width", devicePixelWidth(1));
  tabList.querySelectorAll("[data-source-tab-separator]").forEach((separator) => {
    separator.remove();
  });

  const shells = Array.from(tabList.querySelectorAll<HTMLElement>(".source-tab-shell"));
  if (shells.length < 2) {
    const onlyShell = shells[0];
    if (onlyShell) {
      const stripRect = tabList.getBoundingClientRect();
      const fragment = document.createDocumentFragment();
      fragment.append(sourceTabSeparatorAt(onlyShell.getBoundingClientRect().right, stripRect, tabList));
      tabList.append(fragment);
    }
    return;
  }

  const stripRect = tabList.getBoundingClientRect();
  const fragment = document.createDocumentFragment();

  for (let index = 1; index < shells.length; index += 1) {
    const shell = shells[index];
    fragment.append(sourceTabSeparatorAt(shell.getBoundingClientRect().left, stripRect, tabList));
  }

  const lastShell = shells[shells.length - 1];
  fragment.append(sourceTabSeparatorAt(lastShell.getBoundingClientRect().right, stripRect, tabList));

  tabList.append(fragment);
}

function sourceTabSeparatorAt(clientX: number, stripRect: DOMRect, tabList: HTMLElement): HTMLSpanElement {
  const separator = document.createElement("span");
  separator.className = "source-tab-separator";
  separator.dataset.sourceTabSeparator = "true";
  separator.setAttribute("aria-hidden", "true");
  separator.style.left = `${snapCssPixel(clientX - stripRect.left + tabList.scrollLeft)}px`;
  separator.style.width = devicePixelWidth(1);
  return separator;
}

function renderSourceTabDropSlot(slot: SourceTabDropSlot): void {
  if (slot.isNoop) {
    clearSourceTabDropMarker();
    return;
  }

  sourceTabsEl.classList.add("source-tabs-drop-active");
  sourceTabsEl.style.setProperty("--source-tab-drop-x", `${slot.markerX}px`);
  sourceTabsEl.style.setProperty("--source-tab-drop-width", devicePixelWidth(2));
  sourceTabsEl.style.setProperty("--source-tab-drop-offset", `-${devicePixelWidth(1)}`);
}

function clearSourceTabDropMarker(): void {
  sourceTabsEl.classList.remove("source-tabs-drop-active");
  sourceTabsEl.style.removeProperty("--source-tab-drop-x");
  sourceTabsEl.style.removeProperty("--source-tab-drop-width");
  sourceTabsEl.style.removeProperty("--source-tab-drop-offset");
}

function transparentDragImage(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("[data-transparent-drag-image]");
  if (existing) {
    return existing;
  }

  const image = document.createElement("div");
  image.dataset.transparentDragImage = "true";
  image.style.position = "fixed";
  image.style.top = "-1px";
  image.style.left = "-1px";
  image.style.width = "1px";
  image.style.height = "1px";
  image.style.opacity = "0";
  image.style.pointerEvents = "none";
  document.body.append(image);
  return image;
}

function moveSourceTab(draggedTabId: string, insertIndex: number): void {
  const draggedIndex = sourceTabs.findIndex((tab) => tab.id === draggedTabId);
  if (draggedIndex === -1) {
    return;
  }

  syncActiveSourceTab();
  const nextTabs = [...sourceTabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  const boundedInsertIndex = Math.min(Math.max(insertIndex, 0), nextTabs.length);
  nextTabs.splice(boundedInsertIndex, 0, draggedTab);
  if (sameStringList(nextTabs.map((tab) => tab.id), sourceTabs.map((tab) => tab.id))) {
    return;
  }

  sourceTabs = nextTabs;
  renderSourceTabs();
  scheduleSaveSourceTabs();
  sessionCapture.track("source_tab_moved", {
    tabId: draggedTabId,
    fromIndex: draggedIndex,
    toIndex: boundedInsertIndex,
  }, true);
}

function clearSourceTabDragState(): void {
  draggedSourceTabId = null;
  sourceTabsEl.classList.remove("source-tabs-dragging");
  clearSourceTabDropMarker();
  sourceTabsEl.querySelectorAll(".source-tab-shell-dragging").forEach((element) => {
    element.classList.remove("source-tab-shell-dragging");
  });
}

function closeSourceTab(tabId: string): void {
  const closingIndex = sourceTabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex === -1) {
    return;
  }

  syncActiveSourceTab();
  invalidateCompilation(tabId);
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
  applyingSourceTab = true;
  try {
    editor.setValue(active?.source ?? "");
  } finally {
    applyingSourceTab = false;
  }
  latestImplementationSource = sheetImplementationCacheEntry(active?.id ?? "")?.implementation ?? "";
  renderImplementationView();
  setActiveCompilationSheet(active?.id ?? null);
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

function setActiveCompilationSheet(sheetId: SheetId | null): void {
  activeCompilationUnsubscribe?.();
  activeCompilationUnsubscribe = null;

  if (sheetId === null) {
    clearVisibleCompilationState();
    return;
  }

  renderCompilationState(getCompilationState(sheetId));
  activeCompilationUnsubscribe = subscribeToCompilation(sheetId, (state) => {
    if (activeSourceTabId === state.sheetId) {
      renderCompilationState(state);
    }
  });
  void compile(sheetId);
}

function renderCompilationState(state: CompilationState): void {
  const active = activeSourceTab();
  if (!active || active.id !== state.sheetId || sourceFingerprint(active.source) !== state.sourceFingerprint) {
    return;
  }

  compilationPending = state.status === "compiling";
  latestImplementationSource = visibleImplementationForState(state);
  if (state.status === "compiled" && state.session.lastImplementation.trim().length > 0) {
    active.implementation = state.session.lastImplementation;
    scheduleSaveSourceTabs();
  }
  renderImplementationView();
  latestReadinessDefinitions = effectiveReadinessForState(state);
  latestTypeCheckDiagnostics = state.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  snippetPreviewByHash = cloneSnippetPreviewMap(state.snippetPreviews);
  refreshIncompleteSnippets(active.source);
  updateTypeCheckMarkers(latestTypeCheckDiagnostics);
  updateReadinessDecorations(latestReadinessDefinitions);
  renderSnippetPanel();
}

function clearVisibleCompilationState(): void {
  compilationPending = false;
  latestImplementationSource = "";
  latestReadinessDefinitions = [];
  latestTypeCheckDiagnostics = [];
  snippetPreviewByHash = new Map();
  selectedSnippetHash = null;
  selectedDefinitionTarget = null;
  selectedWholeFileImplementation = false;
  incompleteSnippetsByLine = new Map();
  incompleteSnippetByHash = new Map();
  updateTypeCheckMarkers([]);
  updateReadinessDecorations([]);
  updateIncompleteSnippetDecorations();
  updateSelectedDefinitionDecorations();
  renderSnippetPanel();
}

function rememberActiveCompilationImplementation(implementation: string, source: string): void {
  const active = activeSourceTab();
  if (!active) {
    return;
  }

  if (sourceFingerprint(active.source) !== sourceFingerprint(source)) {
    return;
  }

  const state = getCompilationState(active.id);
  if (state.sourceFingerprint !== sourceFingerprint(active.source)) {
    return;
  }

  active.implementation = implementation;
  latestImplementationSource = implementation;
  renderImplementationView();
  scheduleSaveSourceTabs();

  rememberCompilationState({
    ...state,
    status: "compiled",
    session: completeCompileSession(state.session, implementation),
    error: null,
  });
}

function sheetImplementationCacheEntry(sheetId: SheetId): SheetImplementationCacheEntry | null {
  const tab = sourceTabs.find((item) => item.id === sheetId);
  if (!tab || !tab.implementation) {
    return null;
  }

  return {
    sheetId,
    sheetCode: tab.source,
    implementation: tab.implementation,
  };
}

function visibleImplementationForState(state: CompilationState): string {
  if (state.status === "compiling") {
    return state.session.draftImplementation ?? state.session.lastImplementation;
  }

  return state.session.lastImplementation;
}

function effectiveReadinessForState(state: CompilationState): DefinitionReadiness[] {
  const implementation = visibleImplementationForState(state);
  if (implementation.trim().length === 0) {
    return state.readiness.map((definition) => ({ ...definition }));
  }

  return readinessForSource(state.source, implementation);
}

function completeCompileSession(session: CompileSession, implementation: string): CompileSession {
  return {
    ...session,
    lastImplementation: implementation,
    draftImplementation: null,
    streamHash: null,
  };
}

function draftCompileSession(session: CompileSession, implementation: string): CompileSession {
  return {
    ...session,
    draftImplementation: implementation,
  };
}

function streamingCompileSession(session: CompileSession, hash: string): CompileSession {
  return {
    ...session,
    streamHash: hash,
    draftImplementation: null,
  };
}

function compilationRequestForSheet(sheetId: SheetId): CompilationRequest | null {
  const tab = sourceTabs.find((item) => item.id === sheetId);
  if (!tab) {
    return null;
  }

  return {
    sheetId,
    source: tab.source,
    sourceFingerprint: sourceFingerprint(tab.source),
    strategy: appSettings.compilationStrategy,
  };
}

function initialCompilationState(
  request: CompilationRequest,
  status: CompilationStatus,
): CompilationState {
  const targets = incompleteSnippetTargetsForSource(request.source);
  const cached = sheetImplementationCacheEntry(request.sheetId);
  const implementation = cached?.implementation ?? "";
  return {
    sheetId: request.sheetId,
    source: request.source,
    sourceFingerprint: request.sourceFingerprint,
    strategy: request.strategy,
    status,
    session: {
      sheetId: request.sheetId,
      currentCode: request.source,
      lastImplementation: implementation,
      draftImplementation: null,
      streamHash: null,
    },
    readiness: readinessForSource(request.source, implementation),
    diagnostics: [],
    snippetPreviews: new Map(
      targets.map((target) => [
        target.hash,
        {
          snippet: target.snippet,
          streamed: "",
          implementation: null,
          status: "stub" as const,
        },
      ]),
    ),
    error: null,
  };
}

function emptyCompilationState(sheetId: SheetId): CompilationState {
  return {
    sheetId,
    source: "",
    sourceFingerprint: sourceFingerprint(""),
    strategy: appSettings.compilationStrategy,
    status: "idle",
    session: {
      sheetId,
      currentCode: "",
      lastImplementation: "",
      draftImplementation: null,
      streamHash: null,
    },
    readiness: [],
    diagnostics: [],
    snippetPreviews: new Map(),
    error: null,
  };
}

function reduceCompilationEvent(
  state: CompilationState,
  event: CompileWireEvent,
): CompilationState {
  let next: CompilationState = state;

  if (
    event.kind === "llm-start" &&
    typeof event.hash === "string" &&
    event.snippet === state.source
  ) {
    next = { ...next, session: streamingCompileSession(next.session, event.hash) };
  }

  if (
    event.kind === "llm-complete" &&
    typeof event.hash === "string" &&
    typeof event.implementation === "string" &&
    event.hash === next.session.streamHash
  ) {
    next = { ...next, session: draftCompileSession(next.session, event.implementation) };
  }

  if (isCompleteImplementationEvent(event)) {
    next = { ...next, session: completeCompileSession(next.session, event.implementation) };
  } else if (event.kind === "implementation" && typeof event.implementation === "string") {
    next = { ...next, session: draftCompileSession(next.session, event.implementation) };
  }

  if (event.kind === "readiness" && Array.isArray(event.definitions)) {
    next = {
      ...next,
      readiness: event.definitions.map((definition) => ({ ...definition })),
    };
  }

  if (event.kind === "typecheck" && Array.isArray(event.diagnostics)) {
    next = {
      ...next,
      diagnostics: event.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }

  if (typeof event.hash === "string") {
    next = {
      ...next,
      snippetPreviews: reduceSnippetPreviewEvent(next.snippetPreviews, event),
    };
  }

  if (event.kind === "compiled") {
    const completedImplementation = typeof event.implementation === "string"
      ? event.implementation
      : next.session.lastImplementation;
    next = {
      ...next,
      status: "compiled",
      session: completeCompileSession(next.session, completedImplementation),
      error: null,
    };
  }

  return next;
}

function reduceSnippetPreviewEvent(
  previews: Map<SnippetHash, SnippetPreviewState>,
  event: CompileWireEvent,
): Map<SnippetHash, SnippetPreviewState> {
  if (typeof event.hash !== "string") {
    return previews;
  }

  const current = previews.get(event.hash);
  if (!current) {
    return previews;
  }

  const next = cloneSnippetPreviewMap(previews);
  if (event.kind === "llm-start") {
    next.set(event.hash, {
      ...current,
      streamed: "",
      implementation: null,
      status: "generating",
    });
    return next;
  }

  if (event.kind === "llm-token" && typeof event.token === "string") {
    next.set(event.hash, {
      ...current,
      streamed: current.streamed + event.token,
      status: "generating",
    });
    return next;
  }

  if (
    (event.kind === "llm-complete" || event.kind === "cache-hit") &&
    typeof event.implementation === "string"
  ) {
    next.set(event.hash, {
      ...current,
      streamed: "",
      implementation: event.implementation,
      status: event.kind === "cache-hit" ? "cached" : "complete",
    });
  }

  return next;
}

function cloneSnippetPreviewMap(
  previews: Map<SnippetHash, SnippetPreviewState>,
): Map<SnippetHash, SnippetPreviewState> {
  return new Map(Array.from(previews, ([hash, preview]) => [hash, { ...preview }]));
}

function sourceFingerprint(source: string): SourceFingerprint {
  return hashString(source);
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
    const compiling = getCompilationState(tab.id).status === "compiling";
    return `<div
      class="source-tab-shell"
      role="presentation"
      draggable="true"
      data-source-tab-shell-id="${escapeHtml(tab.id)}"
    >
      <button
        class="source-tab${selected ? " active" : ""}${compiling ? " source-tab-compiling" : ""}"
        type="button"
        role="tab"
        aria-selected="${selected}"
        data-source-tab-id="${escapeHtml(tab.id)}"
      >
        ${escapeHtml(tab.title)}
      </button>
      ${compiling
        ? `<button
          class="source-tab-compiling-indicator"
          type="button"
          tabindex="-1"
          aria-label="${escapeHtml(tab.title)} is compiling"
          aria-disabled="true"
          title="Compiling"
        ></button>`
        : ""}
      <button
        class="source-tab-close"
        type="button"
        aria-label="Close ${escapeHtml(tab.title)}"
        data-close-tab-id="${escapeHtml(tab.id)}"
      >&times;</button>
    </div>`;
  }).join("");
  renderSourceTabSeparators();
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
          implementation: null,
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
    tabs: state.tabs.map((tab) => ({
      ...tab,
      implementation: tab.implementation ?? null,
    })),
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
    return (
      sample !== undefined &&
      (tab.title === sample.label || (legacySampleLabels.get(sample.id) ?? []).includes(tab.title)) &&
      tab.source === sample.code
    );
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
      typeof tab.source === "string" &&
      (
        tab.implementation === undefined ||
        tab.implementation === null ||
        typeof tab.implementation === "string"
      )
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

function readinessForSource(source: string, implementation = ""): DefinitionReadiness[] {
  try {
    const parsed = parse(source);
    if (implementation.trim().length === 0) {
      return definitionReadiness(parsed, new Map());
    }

    try {
      return definitionReadinessFromImplementation(parsed, implementation);
    } catch {
      return definitionReadiness(parsed, new Map());
    }
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

function refreshIncompleteSnippets(source: string): void {
  const targets = incompleteSnippetTargetsForSource(source);

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
  updateImplementationSnippetDecorations();
  renderSnippetPanel();
}

function incompleteSnippetTargetsForSource(source: string): IncompleteSnippetTarget[] {
  try {
    const parsed = parse(source);
    const compilerHashes = completionSnippetHashes(parsed);
    return parsed.incompleteSnippets.map((snippet, index) => {
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
    return [];
  }
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
  updateImplementationSnippetDecorations();
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
  updateImplementationSnippetDecorations();
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
  updateImplementationSnippetDecorations();
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
    refreshed.name !== selectedDefinitionTarget.name ||
    refreshed.className !== selectedDefinitionTarget.className
  ) {
    return null;
  }

  return refreshed;
}

function updateIncompleteSnippetDecorations(): void {
  const decorations = Array.from(incompleteSnippetByHash.values()).flatMap((target) => {
    const decorationRanges = [
      new monaco.Range(
        target.startLine,
        target.startColumn,
        target.endLine,
        target.endColumn,
      ),
    ];

    return decorationRanges.map((range) => ({
      range,
      options: {
        isWholeLine: false,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        className: undefined,
        marginClassName: undefined,
        inlineClassName: snippetInlineClassName(target),
      },
    }));
  });

  incompleteSnippetDecorations = editor.deltaDecorations(
    incompleteSnippetDecorations,
    decorations,
  );
}

function snippetInlineClassName(target: IncompleteSnippetTarget): string | undefined {
  const classes: string[] = [];

  if (target.hash === snippetGuideHash || target.hash === selectedSnippetHash) {
    classes.push("snippet-source-inline-selected");
  }

  return classes.length === 0 ? undefined : classes.join(" ");
}



function updateSelectedDefinitionDecorations(): void {
  const target = selectedDefinitionTarget;
  const range = target === null || selectedWholeFileImplementation
    ? null
    : sourceDefinitionHighlightRange(target);
  selectedDefinitionDecorations = editor.deltaDecorations(
    selectedDefinitionDecorations,
    range === null
      ? []
      : [{
          range,
          options: {
            isWholeLine: false,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            inlineClassName: "snippet-source-inline-selected",
            marginClassName: undefined,
          },
        }],
  );
}

function sourceDefinitionHighlightRange(target: ImplementationTarget): monaco.Range | null {
  const line = editor.getModel()?.getLineContent(target.line) ?? "";
  const startColumn = (line.match(/^\s*/)?.[0].length ?? 0) + 1;
  const highlightLength = firstLineLength(target.source.trimStart());
  if (highlightLength <= 0) {
    return null;
  }

  return new monaco.Range(
    target.line,
    startColumn,
    target.line,
    startColumn + highlightLength,
  );
}

function updateImplementationSnippetDecorations(): monaco.Range | null {
  const snippetTarget = selectedSnippetHash === null
    ? null
    : incompleteSnippetByHash.get(selectedSnippetHash) ?? null;
  const range = snippetTarget !== null
    ? implementationRangeForSnippet(snippetTarget)
    : selectedDefinitionTarget !== null
    ? implementationRangeForDefinition(selectedDefinitionTarget)
    : null;

  implementationSnippetDecorations = implementationViewEditor.deltaDecorations(
    implementationSnippetDecorations,
    range === null
      ? []
      : [{
          range,
          options: {
            isWholeLine: false,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            className: "snippet-source-inline-selected",
            inlineClassName: "snippet-source-inline-selected",
          },
        }],
  );

  return range;
}

function revealImplementationForSnippet(target: IncompleteSnippetTarget): void {
  selectedSnippetHash = target.hash;
  selectedDefinitionTarget = null;
  selectedWholeFileImplementation = false;
  snippetGuideHash = target.hash;
  updateIncompleteSnippetDecorations();
  const range = updateImplementationSnippetDecorations();
  if (range === null) {
    return;
  }

  navigateImplementationRangeIfNeeded(range, monaco.editor.ScrollType.Smooth);
}

function revealImplementationForDefinition(target: ImplementationTarget): void {
  selectedDefinitionTarget = target;
  selectedSnippetHash = null;
  selectedWholeFileImplementation = false;
  snippetGuideHash = null;
  updateIncompleteSnippetDecorations();
  const range = updateImplementationSnippetDecorations();
  if (range === null) {
    return;
  }

  navigateImplementationRangeIfNeeded(range, monaco.editor.ScrollType.Smooth);
}

function navigateImplementationRangeIfNeeded(range: monaco.Range, scrollType: monaco.editor.ScrollType): void {
  if (implementationRangeHasFullyVisibleLine(range)) {
    return;
  }

  implementationViewEditor.revealRangeInCenter(range, scrollType);
  implementationViewEditor.setSelection(range);
}

function implementationRangeHasFullyVisibleLine(range: monaco.Range): boolean {
  const model = implementationViewEditor.getModel();
  if (!model) {
    return false;
  }

  const lineCount = model.getLineCount();
  const startLineNumber = Math.max(1, Math.min(range.startLineNumber, lineCount));
  const endLineNumber = Math.max(
    startLineNumber,
    Math.min(range.endColumn <= 1 && range.endLineNumber > startLineNumber
      ? range.endLineNumber - 1
      : range.endLineNumber, lineCount),
  );
  const viewportTop = implementationViewEditor.getScrollTop();
  const viewportBottom = viewportTop + implementationViewEditor.getLayoutInfo().height;
  const tolerance = 0.5;

  for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
    const lineTop = implementationViewEditor.getTopForLineNumber(lineNumber);
    const lineBottom = implementationViewEditor.getBottomForLineNumber(lineNumber);
    if (lineTop >= viewportTop - tolerance && lineBottom <= viewportBottom + tolerance) {
      return true;
    }
  }

  return false;
}

function implementationRangeForDefinition(target: ImplementationTarget): monaco.Range | null {
  const implementation = implementationViewText();
  const match = implementationMatchForTarget(implementation, target);
  if (
    match === null ||
    match.code === UNKNOWN_IMPLEMENTATION_MATCH_TEXT ||
    match.code.trim().length === 0 ||
    match.range === null
  ) {
    return null;
  }

  return implementationOffsetRangeToMonacoRange(implementation, match.range);
}

function implementationRangeForSnippet(target: IncompleteSnippetTarget): monaco.Range | null {
  const implementation = implementationViewText();
  const match = implementationMatchForIncompleteSnippet(
    editor.getValue(),
    implementation,
    {
      kind: target.kind,
      line: target.startLine,
      column: target.startColumn,
      snippet: target.snippet,
    },
  );

  if (
    match === null ||
    match.code === UNKNOWN_IMPLEMENTATION_MATCH_TEXT ||
    match.code.trim().length === 0 ||
    match.range === null
  ) {
    return null;
  }

  return implementationOffsetRangeToMonacoRange(implementation, match.range);
}

function implementationOffsetRangeToMonacoRange(
  implementation: string,
  range: { start: number; end: number },
): monaco.Range {
  const lineStarts = sourceLineStartOffsets(implementation);
  const startPosition = offsetToEditorPosition(lineStarts, range.start);
  const endPosition = offsetToEditorPosition(lineStarts, range.end);

  return new monaco.Range(
    startPosition.line,
    startPosition.column,
    endPosition.line,
    endPosition.column,
  );
}

function renderSnippetPanel(): void {
  if (selectedDefinitionTarget !== null) {
    const text =
      directPreviewForDefinitionTarget(selectedDefinitionTarget) ??
      implementationBlockForTarget(previewImplementationSource(), selectedDefinitionTarget) ??
      implementationBlockForTarget(latestImplementationSource, selectedDefinitionTarget) ??
      selectedDefinitionTarget.source;

    setSnippetPanelTitle(
      selectedDefinitionTarget.name,
      definitionPanelStatus(selectedDefinitionTarget),
    );
    setSnippetPreviewSource(text);
    return;
  }

  if (selectedWholeFileImplementation) {
    setSnippetPanelTitle("Whole file", null);
    setSnippetPreviewSource(previewImplementationSource());
    return;
  }

  const target = selectedSnippetHash === null
    ? null
    : incompleteSnippetByHash.get(selectedSnippetHash) ?? null;

  if (!target) {
    setSnippetPanelTitle(null, null);
    setSnippetPreviewSource("");
    return;
  }

  const preview = snippetPreviewByHash.get(target.hash);
  const inferredImplementation = preview?.implementation === undefined || preview.implementation === null
    ? inferredImplementationForSnippet(target)
    : null;
  const text =
    preview?.implementation ??
    (preview?.streamed.length ? preview.streamed : null) ??
    inferredImplementation ??
    preview?.snippet ??
    target.snippet;

  setSnippetPanelTitle(target.label, snippetPanelStatus(preview));
  setSnippetPreviewSource(text);
}

function showSnippetPopupForTarget(target: IncompleteSnippetTarget, point: { x: number; y: number }): void {
  clearSnippetPopupCloseTimer();
  selectedDefinitionTarget = null;
  selectedWholeFileImplementation = false;
  selectedSnippetHash = target.hash;
  snippetGuideHash = target.hash;
  updateSelectedDefinitionDecorations();
  updateIncompleteSnippetDecorations();
  renderSnippetPanel();
  positionSnippetPopup(point);
  snippetPanel.hidden = false;
  snippetPanel.setAttribute("aria-hidden", "false");
  snippetPanel.classList.add("snippet-panel-open");
  requestAnimationFrame(() => {
    snippetPreviewEditor.layout();
  });
}

function clearEditorSelectionAt(lineNumber: number, column: number): void {
  requestAnimationFrame(() => {
    editor.setSelection(new monaco.Selection(lineNumber, column, lineNumber, column));
  });
}

function hideSnippetPopup(): void {
  clearSnippetPopupCloseTimer();
  snippetPopupHoveringPanel = false;
  snippetPopupDragging = false;
  snippetGuideHash = null;
  updateIncompleteSnippetDecorations();
  snippetPanel.classList.remove("snippet-panel-open");
  snippetPanel.hidden = true;
  snippetPanel.setAttribute("aria-hidden", "true");
}

function positionSnippetPopup(point: { x: number; y: number }): void {
  const width = Math.min(520, window.innerWidth - 24);
  const height = Math.min(360, window.innerHeight - 24);
  const left = Math.min(Math.max(12, point.x + 14), window.innerWidth - width - 12);
  const top = Math.min(Math.max(12, point.y + 14), window.innerHeight - height - 12);

  snippetPanel.style.left = `${Math.round(left)}px`;
  snippetPanel.style.top = `${Math.round(top)}px`;
  snippetPanel.style.width = `${Math.round(width)}px`;
  snippetPanel.style.height = `${Math.round(height)}px`;
}

function scheduleSnippetPopupClose(): void {
  clearSnippetPopupCloseTimer();
  snippetPopupCloseTimer = setTimeout(() => {
    snippetPopupCloseTimer = null;
    if (!snippetPopupPinned && !snippetPopupHoveringPanel && !snippetPopupDragging) {
      hideSnippetPopup();
    }
  }, 120);
}

function clearSnippetPopupCloseTimer(): void {
  if (snippetPopupCloseTimer !== null) {
    clearTimeout(snippetPopupCloseTimer);
    snippetPopupCloseTimer = null;
  }
}

function beginSnippetPopupDrag(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, select, input, textarea, a")) {
    return;
  }

  event.preventDefault();
  snippetPopupPinned = true;
  snippetPopupDragging = true;
  clearSnippetPopupCloseTimer();
  snippetPanelHeader.setPointerCapture(event.pointerId);

  const rect = snippetPanel.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    moveSnippetPopupTo(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
  };

  const onPointerUp = (upEvent: PointerEvent): void => {
    snippetPopupDragging = false;
    snippetPanelHeader.releasePointerCapture(upEvent.pointerId);
    snippetPanelHeader.removeEventListener("pointermove", onPointerMove);
    snippetPanelHeader.removeEventListener("pointerup", onPointerUp);
    snippetPanelHeader.removeEventListener("pointercancel", onPointerUp);
  };

  snippetPanelHeader.addEventListener("pointermove", onPointerMove);
  snippetPanelHeader.addEventListener("pointerup", onPointerUp);
  snippetPanelHeader.addEventListener("pointercancel", onPointerUp);
}

function moveSnippetPopupTo(left: number, top: number): void {
  const rect = snippetPanel.getBoundingClientRect();
  const nextLeft = Math.min(Math.max(12, left), window.innerWidth - rect.width - 12);
  const nextTop = Math.min(Math.max(12, top), window.innerHeight - rect.height - 12);
  snippetPanel.style.left = `${Math.round(nextLeft)}px`;
  snippetPanel.style.top = `${Math.round(nextTop)}px`;
}

function editorMouseClientPoint(event: monaco.editor.IEditorMouseEvent): { x: number; y: number } {
  return {
    x: event.event.browserEvent.clientX,
    y: event.event.browserEvent.clientY,
  };
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
  const imports: string[] = [];
  const seenImports = new Set<string>();
  const replacements = Array.from(incompleteSnippetByHash.values())
    .map((target) => {
      const replacement = previewReplacementForSnippet(target);
      if (replacement === null) {
        return null;
      }

      const start = editorPositionToOffset(lineStarts, target.startLine, target.startColumn);
      const renderedReplacement = previewRenderedReplacement(source, start, target, replacement, imports, seenImports);

      return {
        start,
        end: editorPositionToOffset(lineStarts, target.endLine, target.endColumn),
        replacement: renderedReplacement,
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

  if (imports.length > 0) {
    preview = `${imports.join("\n")}\n\n${preview}`;
  }

  return preview;
}

function previewRenderedReplacement(
  source: string,
  start: number,
  target: IncompleteSnippetTarget,
  replacement: string,
  imports: string[],
  seenImports: Set<string>,
): string {
  if (target.kind !== "natural") {
    return replacement;
  }

  const splitReplacement = splitNaturalReplacement(replacement);
  for (const importLine of splitReplacement.imports) {
    if (!seenImports.has(importLine)) {
      seenImports.add(importLine);
      imports.push(importLine);
    }
  }

  return indentNaturalReplacement(splitReplacement.body, indentationBeforeOffset(source, start));
}

function indentationBeforeOffset(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return source.slice(lineStart, offset).match(/^\s*/)?.[0] ?? "";
}

function previewReplacementForSnippet(target: IncompleteSnippetTarget): string | null {
  const preview = snippetPreviewByHash.get(target.hash);
  if (!preview) {
    return null;
  }

  return preview.implementation ??
    (preview.streamed.length > 0 ? preview.streamed : null);
}

function inferredImplementationForSnippet(target: IncompleteSnippetTarget): string | null {
  return implementationForIncompleteSnippet(
    editor.getValue(),
    previewImplementationSource(),
    {
      kind: target.kind,
      line: target.startLine,
      column: target.startColumn,
      snippet: target.snippet,
    },
  );
}

function snippetPanelStatus(preview: SnippetPreviewState | undefined): SnippetPanelStatus {
  if (preview?.status === "complete" || preview?.status === "cached") {
    return preview.status;
  }

  if (preview?.status === "generating" || compilationPending) {
    return "generating";
  }

  return null;
}

function definitionPanelStatus(target: ImplementationTarget): SnippetPanelStatus {
  if (compilationPending) {
    return "generating";
  }

  const matchingReadiness = latestReadinessDefinitions.filter((definition) => (
    target.kind === "function"
      ? definition.kind === "function" && definition.name === target.name
      : target.kind === "method"
      ? definition.kind === "method" && definition.name === `${target.className}.${target.name}`
      : definition.kind === "method" && definition.name.startsWith(`${target.name}.`)
  ));

  if (matchingReadiness.length === 0) {
    return null;
  }

  return matchingReadiness.every((definition) => definition.ready) ? "complete" : null;
}

function setSnippetPanelTitle(label: string | null, status: SnippetPanelStatus): void {
  snippetTitle.textContent = label === null ? "Implementation" : `Implementation: ${label}`;
  snippetTitle.title = snippetTitle.textContent;
  snippetStatusIndicator.dataset.state = status ?? "hidden";
  snippetStatusIndicator.title = snippetStatusTitle(status);
}

function snippetStatusTitle(status: SnippetPanelStatus): string {
  switch (status) {
    case "generating":
      return "Compiling";
    case "complete":
    case "cached":
      return "Ready";
    case "stub":
    case null:
      return "";
  }
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

function registerLogosTypeScriptLanguage(): void {
  monaco.languages.register({
    id: logosTypeScriptLanguageId,
    aliases: ["Logos TypeScript", "logos-typescript"],
    mimetypes: ["text/x-logos-typescript"],
  });
  monaco.languages.setLanguageConfiguration(logosTypeScriptLanguageId, typeScriptLanguageConfiguration);
  monaco.languages.setMonarchTokensProvider(logosTypeScriptLanguageId, {
    ...typeScriptLanguage,
    tokenPostfix: ".logos-typescript",
    tokenizer: {
      ...typeScriptLanguage.tokenizer,
      root: [
        typeScriptLanguage.tokenizer.root[0],
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"],
        [/\bl`/, "naturalSnippet.delimiter", "@logosNaturalSnippet"],
        ...typeScriptLanguage.tokenizer.root.slice(1),
      ],
      logosNaturalSnippet: [
        [/[^`]+/, "naturalSnippet"],
        [/`/, "naturalSnippet.delimiter", "@pop"],
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

function installMonacoShortcutGuard(target: HTMLElement): void {
  target.addEventListener("keydown", (event) => {
    if (shouldMonacoHandleKeydown(event)) {
      return;
    }

    event.stopImmediatePropagation();
  }, { capture: true });
}

function shouldMonacoHandleKeydown(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return true;
  }

  if (event.ctrlKey && event.altKey && !event.metaKey) {
    return true;
  }

  return !isBrowserLocationBarShortcut(event);
}

function isBrowserLocationBarShortcut(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  return key === "l" || event.code === "KeyL";
}

function expandOpeningTripleBacktick(
  targetEditor: monaco.editor.IStandaloneCodeEditor,
  position: monaco.IPosition,
): void {
  void targetEditor;
  void position;
}

function insertAssistedNewLine(targetEditor: monaco.editor.IStandaloneCodeEditor): boolean {
  const model = targetEditor.getModel();
  const position = targetEditor.getPosition();
  const selection = targetEditor.getSelection();
  if (!model || !position || !selection?.isEmpty()) {
    return false;
  }

  const line = model.getLineContent(position.lineNumber);
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

function incompleteSnippetLabel(snippet: IncompleteSnippet): string {
  const firstLine = snippet.snippet.trim().split("\n")[0] ?? "";
  if (snippet.kind === "natural") {
    const inner = naturalSnippetLabelText(snippet.snippet);
    return inner.length > 0 ? inner : "Logos snippet";
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
  const body = snippet.trim().replace(/^l`|`$/g, "");
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
  const lineMaxColumn = editor.getModel()?.getLineMaxColumn(lineNumber);
  return snippetPopupTargetForClick(snippets, lineNumber, column, lineMaxColumn);
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
  const minCodeWidth = 500;
  const minOutputWidth = 340;
  const maxCodeWidth = Math.max(
    minCodeWidth,
    shellRect.right - codeRect.left - minOutputWidth,
  );
  const nextWidth = Math.min(maxCodeWidth, Math.max(minCodeWidth, width));
  setCodePaneBasis(nextWidth);
  editor.layout();
}

function updateShellResizeHandles(): void {
  const shellRect = shell.getBoundingClientRect();
  const outputRect = outputPane.getBoundingClientRect();

  codeRunResizeHandle.style.left = `${Math.round(outputRect.left - shellRect.left)}px`;
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
  renderSnippetPanel();
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
    const ready = !compilationPending && (readiness?.ready ?? true);
    return {
      name: runnable.name,
      line: runnable.line,
      ready,
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
        glyphMarginHoverMessage: {
          value: runnable.ready
            ? `Run ${runnable.name}`
            : disabledRunnableHoverMessage(runnable),
        },
      },
    })),
  );
  updateRunnableRunWidgets(runnablesState);
}

function updateRunnableRunWidgets(runnablesState: Array<RunnableState & { line: number }>): void {
  editor.changeViewZones((accessor) => {
    for (const id of runnableRunZoneIds) {
      accessor.removeZone(id);
    }

    runnableRunZoneIds = runnablesState.map((runnable) =>
      accessor.addZone({
        afterLineNumber: Math.max(0, runnable.line - 1),
        heightInPx: 22,
        domNode: createRunnableRunWidget(runnable),
        suppressMouseDown: true,
      }),
    );
  });
}

function createRunnableRunWidget(
  runnable: RunnableState & { line: number },
): HTMLElement {
  const zone = document.createElement("div");
  zone.className = "runnable-run-zone";

  const node = document.createElement("button");
  node.className = runnable.ready
    ? "runnable-run-widget"
    : "runnable-run-widget runnable-run-widget-disabled";
  node.type = "button";
  node.textContent = `▶ Run ${runnableDisplayName(runnable.name)}`;
  node.title = runnable.ready ? `Run ${runnable.name}` : disabledRunnableHoverMessage(runnable);
  node.dataset.ready = runnable.ready ? "true" : "false";
  node.setAttribute("aria-disabled", runnable.ready ? "false" : "true");
  node.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  node.addEventListener("click", () => {
    if (!runnable.ready) {
      return;
    }

    runCurrentProgram(runnable.name);
  });

  zone.append(node);
  return zone;
}

function runnableDisplayName(name: string): string {
  return name.length === 0 ? name : `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
}

function disabledRunnableHoverMessage(runnable: RunnableState): string {
  if (runnable.compiling) {
    return "Claude is still compiling this sheet.";
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
  latestTypeCheckDiagnostics = diagnostics;

  const model = editor.getModel();
  if (!model) {
    return;
  }

  monaco.editor.setModelMarkers(model, "logos-typecheck", []);
}

function firstRunnable(source: string): Runnable | null {
  return runnables(source)[0]?.name ?? null;
}

function createRunTab(runnable: Runnable, source: string, sourceHash: string): RunTab {
  const tab: RunTab = {
    id: createRunTabId(runnable),
    runnable,
    source,
    sessionId: null,
    reactRunId: null,
    renderMode: "terminal",
    reactAppCode: null,
    reactRoot: null,
    sourceHash,
    terminalText: "",
    terminalRenderedLength: 0,
    terminalCols: null,
    terminalRows: null,
    terminal: null,
    terminalFitAddon: null,
    terminalInputDisposable: null,
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

  const implementationActive = activeToolTabId === implementationToolTabId;
  implementationViewTab.classList.toggle("active", implementationActive);
  implementationViewTab.setAttribute("aria-selected", String(implementationActive));
  implementationViewPanel.classList.toggle("active", implementationActive);
  renderImplementationView();

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
  renderSourceTabSeparators(toolTabsList);

  const activeIds = new Set(runTabs.map((tab) => tab.id));
  for (const panel of Array.from(toolPanels.querySelectorAll<HTMLElement>("[data-run-panel-id]"))) {
    if (!activeIds.has(panel.dataset.runPanelId ?? "")) {
      const tab = runTabs.find((item) => item.id === panel.dataset.runPanelId);
      if (tab) {
        disposeRunTabTerminal(tab);
      }
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

  const xtermHost = document.createElement("div");
  xtermHost.className = "terminal-xterm-host";
  xtermHost.dataset.runXtermId = tab.id;

  const reactHost = document.createElement("div");
  reactHost.className = "react-app-run-host";
  reactHost.dataset.reactRunHostId = tab.id;

  panel.append(xtermHost, reactHost);
  toolPanels.append(panel);
}

function renderRunTab(tab: RunTab): void {
  const panel = document.getElementById(runPanelId(tab.id));
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  const xtermHost = panel.querySelector<HTMLElement>("[data-run-xterm-id]");
  const reactHost = panel.querySelector<HTMLElement>("[data-react-run-host-id]");
  const running = tab.status?.state === "running";

  panel.classList.toggle("active", activeToolTabId === tab.id);
  panel.classList.toggle("terminal-running", running);
  panel.classList.toggle("terminal-xterm-mode", tab.renderMode === "terminal");
  panel.classList.toggle("react-app-mode", tab.renderMode === "react");
  if (xtermHost) {
    xtermHost.hidden = tab.renderMode !== "terminal";
  }
  if (reactHost) {
    reactHost.hidden = tab.renderMode !== "react";
  }
  if (xtermHost && tab.renderMode === "terminal") {
    renderXtermTerminal(tab, xtermHost);
  }
  if (reactHost && tab.renderMode === "react") {
    renderReactApp(tab, reactHost);
  }

  panel.scrollTop = panel.scrollHeight;
}

function scheduleTerminalFit(): void {
  if (terminalFitFrame !== null) {
    cancelAnimationFrame(terminalFitFrame);
  }

  terminalFitFrame = requestAnimationFrame(() => {
    terminalFitFrame = null;
    fitVisibleRunTerminals();
  });
}

function renderXtermTerminal(tab: RunTab, host: HTMLElement): void {
  if (!tab.terminal) {
    tab.terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      convertEol: false,
      fontFamily: terminalFontFamily(),
      fontSize: 14,
      lineHeight: 1.12,
      theme: {
        background: "#111827",
        foreground: "#f9fafb",
        cursor: "#f9fafb",
        selectionBackground: "#2563eb",
      },
    });
    tab.terminalFitAddon = new FitAddon();
    tab.terminal.loadAddon(tab.terminalFitAddon);
    tab.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown" || event.key !== "Tab") {
        return true;
      }

      event.preventDefault();
      event.stopPropagation();
      void sendRawTerminalInput(tab.id, event.shiftKey ? "\x1b[Z" : "\t");
      return false;
    });
    tab.terminal.open(host);
    tab.terminalInputDisposable = tab.terminal.onData((input) => {
      void sendRawTerminalInput(tab.id, input);
    });
    tab.terminalRenderedLength = 0;
  }

  fitRunTabTerminal(tab);
  if (tab.terminalText.length > tab.terminalRenderedLength) {
    tab.terminal.write(tab.terminalText.slice(tab.terminalRenderedLength));
    tab.terminalRenderedLength = tab.terminalText.length;
  }
}

function fitRunTabTerminal(tab: RunTab): void {
  if (!tab.terminal || !tab.terminalFitAddon) {
    return;
  }

  try {
    tab.terminalFitAddon.fit();
    const cols = tab.terminal.cols;
    const rows = tab.terminal.rows;
    if (tab.terminalCols !== cols || tab.terminalRows !== rows) {
      tab.terminalCols = cols;
      tab.terminalRows = rows;
      if (tab.sessionId) {
        void sendInteractiveRunResizeViaDevApi(tab.sessionId, cols, rows).catch(() => undefined);
      }
    }
  } catch {
    // xterm can reject fitting before the host is measurable; the resize observer
    // will retry after layout settles.
  }
}

function fitVisibleRunTerminals(): void {
  for (const tab of runTabs) {
    if (activeToolTabId === tab.id) {
      fitRunTabTerminal(tab);
    }
  }
}

function renderReactApp(tab: RunTab, host: HTMLElement): void {
  const appCode = tab.reactAppCode;
  if (appCode === null) {
    host.textContent = "React app is waiting for its implementation.";
    return;
  }

  if (!tab.reactRoot) {
    host.replaceChildren();
    const mount = document.createElement("div");
    mount.className = "react-app-run-mount";
    host.append(mount);
    tab.reactRoot = createRoot(mount);
  }

  tab.reactRoot.render(React.createElement(ReactAppFrame, {
    appCode,
    runnable: tab.runnable,
  }));
}

function ReactAppFrame(props: { appCode: string; runnable: Runnable }): React.ReactElement {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [iframeBody, setIframeBody] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) {
      return;
    }

    doc.open();
    doc.write(`<!doctype html><html><head><style>
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
body {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: auto;
}
body > * {
  min-height: 100%;
}
${styleTagContent(radixThemesCss)}
</style></head><body></body></html>`);
    doc.close();
    setIframeBody(doc.body);
  }, [props.appCode]);

  let element: React.ReactNode = null;
  try {
    const run = new Function("React", "radix", `${props.appCode}\nreturn ${props.runnable}();`);
    element = run(React, logosRadix) as React.ReactNode;
  } catch (error) {
    element = React.createElement("pre", {
      style: {
        boxSizing: "border-box",
        minHeight: "100vh",
        margin: 0,
        padding: 16,
        color: "#991b1b",
        background: "#fef2f2",
        whiteSpace: "pre-wrap",
        font: "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      },
    }, error instanceof Error && error.stack ? error.stack : String(error));
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("iframe", {
      ref: iframeRef,
      className: "react-app-run-frame",
      title: `Run ${props.runnable}`,
    }),
    iframeBody
      ? createPortal(React.createElement(Theme, { appearance: "light", accentColor: "blue", grayColor: "slate" }, element), iframeBody)
      : null,
  );
}

function styleTagContent(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function terminalFontFamily(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--terminal-font")
    .trim() || "monospace";
}

function disposeRunTabTerminal(tab: RunTab): void {
  tab.terminalInputDisposable?.dispose();
  tab.terminalInputDisposable = null;
  tab.terminal?.dispose();
  tab.terminal = null;
  tab.terminalFitAddon = null;
  tab.terminalCols = null;
  tab.terminalRows = null;
  tab.terminalRenderedLength = 0;
}

function disposeRunTabReactRoot(tab: RunTab): void {
  tab.reactRoot?.unmount();
  tab.reactRoot = null;
}

function renderImplementationView(): void {
  const text = implementationViewText();
  if (implementationViewEditor.getValue() !== text) {
    implementationViewEditor.setValue(text);
  }
  const selectedRange = updateImplementationSnippetDecorations();
  if (selectedRange !== null && activeToolTabId === implementationToolTabId) {
    navigateImplementationRangeIfNeeded(selectedRange, monaco.editor.ScrollType.Immediate);
    return;
  }

  implementationViewEditor.setScrollTop(implementationViewEditor.getScrollHeight());
}

function implementationViewText(): string {
  return latestImplementationSource.trim().length > 0
    ? latestImplementationSource
    : compilationPending
    ? "Code is being generated..."
    : "No implementation yet.";
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

  tab.terminal?.focus();
}

async function sendRawTerminalInput(runTabId: string, input: string): Promise<void> {
  const tab = runTabById(runTabId);
  if (!tab?.sessionId || tab.status?.state !== "running") {
    return;
  }

  sessionCapture.track("run_raw_input_submitted", { input, runTabId, runnable: tab.runnable }, true);

  try {
    await sendInteractiveRunInputViaDevApi(tab.sessionId, input);
  } catch (error) {
    appendTerminalChunks(tab, [{
      stream: "stderr",
      text: `\r\n${error instanceof Error ? error.message : String(error)}\r\n`,
    }]);
    tab.status = { state: "exited", code: null, signal: null };
    renderRunTab(tab);
  }
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
    appendTerminalChunks(currentTab, [{ stream: "stderr", text: `\n${result.error}\n` }]);
    renderRunTabs();
    return;
  }

  currentTab.implementation = result.implementation;
  rememberActiveCompilationImplementation(result.implementation, currentTab.source);
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
    appendTerminalChunks(currentTab, [{ stream: "stderr", text: result.error }]);
    return;
  }

  currentTab.implementation = result.implementation;
  currentTab.status = result.status;
  rememberActiveCompilationImplementation(result.implementation, currentTab.source);
  renderSnippetPanel();
  if (result.kind === "react") {
    currentTab.renderMode = "react";
    currentTab.reactRunId = result.runId;
    currentTab.reactAppCode = result.appCode;
    finishInteractiveRun(currentTab, result.status, result.implementation);
    return;
  }

  currentTab.renderMode = "terminal";
  currentTab.sessionId = result.sessionId;
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
  rememberActiveCompilationImplementation(implementation, tab.source);
  renderSnippetPanel();

  if (status.state === "exited" && status.code === 0) {
    sessionCapture.track(
      "run_completed",
      { runnable: tab.runnable, output: tab.terminalText, implementation },
      true,
    );
  } else {
    const stopped = status.state === "exited" && status.signal === "SIGTERM";
    void stopped;
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
  disposeRunTabTerminal(tab);
  disposeRunTabReactRoot(tab);
  runTabs = runTabs.filter((item) => item.id !== runTabId);

  if (activeToolTabId === runTabId) {
    activeToolTabId = runTabs[index]?.id ?? runTabs[index - 1]?.id ?? implementationToolTabId;
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
    disposeRunTabTerminal(tab);
    disposeRunTabReactRoot(tab);
  }
  runTabs = [];
  activeToolTabId = implementationToolTabId;
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
    throw new Error("Could not copy text");
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
    kind?: string;
    sessionId?: string;
    runId?: string;
    runnable?: string;
    chunks?: RunChunk[];
    status?: RunStatus;
    error?: string;
    implementation?: string;
    appCode?: string;
  };

  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run/start",
    status: response.status,
    body: payload,
  });

  if (!response.ok || payload.ok !== true || typeof payload.runnable !== "string" || !isRunStatus(payload.status) || typeof payload.implementation !== "string") {
    throw new Error(payload.error ?? "Run request failed");
  }

  if (payload.kind === "react") {
    if (typeof payload.runId !== "string" || typeof payload.appCode !== "string") {
      throw new Error(payload.error ?? "React run request failed");
    }

    return {
      ok: true,
      kind: "react",
      runId: payload.runId,
      runnable: payload.runnable,
      status: payload.status,
      implementation: payload.implementation,
      appCode: payload.appCode,
    };
  }

  if (typeof payload.sessionId !== "string" || !Array.isArray(payload.chunks)) {
    throw new Error(payload.error ?? "Run request failed");
  }

  return {
    ok: true,
    kind: "terminal",
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

async function sendInteractiveRunResizeViaDevApi(sessionId: string, cols: number, rows: number): Promise<void> {
  const body = { sessionId, cols, rows };
  sessionCapture.track("api_request", {
    method: "POST",
    path: "/api/run/resize",
    body,
  });
  const response = await fetch("/api/run/resize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  sessionCapture.track("api_response", {
    method: "POST",
    path: "/api/run/resize",
    status: response.status,
    body: payload,
  });

  if (!response.ok) {
    throw new Error(payload.error ?? "Resize request failed");
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
      completedSnippets?: number;
      totalSnippets?: number;
      error?: string;
      definitions?: DefinitionReadiness[];
      diagnostics?: TypeCheckDiagnostic[];
    };

function isCompleteImplementationEvent(event: CompileWireEvent): event is CompileWireEvent & {
  implementation: string;
  completedSnippets: number;
  totalSnippets: number;
} {
  return (
    event.kind === "implementation" &&
    typeof event.implementation === "string" &&
    typeof event.completedSnippets === "number" &&
    typeof event.totalSnippets === "number" &&
    event.completedSnippets >= event.totalSnippets
  ) || (
    event.kind === "compiled" &&
    typeof event.implementation === "string" &&
    typeof event.completedSnippets === "number" &&
    typeof event.totalSnippets === "number" &&
    event.completedSnippets >= event.totalSnippets
  );
}

async function* compileViaDevApi(
  sheet: string,
  signal: AbortSignal,
  compilationStrategy = appSettings.compilationStrategy,
): AsyncIterable<CompileWireEvent> {
  const body = {
    sheet,
    compilationStrategy,
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
  activeToolTabId = tab === implementationToolTabId || (tab && runTabById(tab))
    ? tab
    : implementationToolTabId;
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
      expanded: false,
      input: "",
      messages: [],
    },
  };
}

export async function loadSession(session: LoadableSession): Promise<void> {
  if (!isLoadableSession(session)) {
    throw new Error("Invalid loadable session");
  }

  isLoadingSession = true;
  try {
    invalidateAllCompilations();
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
    latestImplementationSource = active?.implementation ??
      session.compilation.latestImplementationSource ??
      "";
    if (active && latestImplementationSource.trim().length > 0) {
      active.implementation = latestImplementationSource;
    }
    renderImplementationView();
    compileVersion = Math.max(compileVersion + 1, session.compilation.compileVersion);

    runTabs = session.run.tabs.map((tab) => {
      const implementation = tab.implementation;
      const status = restoredRunStatus(tab.status);
      return {
        id: tab.id,
        runnable: tab.runnable,
        source: active?.source ?? session.editor.value,
        sessionId: null,
        reactRunId: null,
        renderMode: "terminal",
        reactAppCode: null,
        reactRoot: null,
        sourceHash: tab.sourceHash,
        terminalText: tab.terminalText.length > 0
          ? tab.terminalText
          : status?.state === "exited" && status.error
          ? `${status.error}\r\n`
          : "",
        terminalRenderedLength: 0,
        terminalCols: null,
        terminalRows: null,
        terminal: null,
        terminalFitAddon: null,
        terminalInputDisposable: null,
        implementation,
        status,
        pollTimer: null,
      };
    });
    activeToolTabId = session.run.activeToolTabId === implementationToolTabId
      ? implementationToolTabId
      : runTabs.some((tab) => tab.id === session.run.activeToolTabId)
      ? session.run.activeToolTabId
      : implementationToolTabId;

    renderSourceTabs();
    renderRunTabs();
    updateEditorAvailability();
    updateActiveProjectMenuItem();
    updateTypeCheckMarkers([]);
    updateReadinessDecorations(readinessForSource(editor.getValue(), latestImplementationSource));
    refreshIncompleteSnippets(editor.getValue());
    if (active) {
      const request = compilationRequestForSheet(active.id);
      if (request) {
        const restoredCompilationState = initialCompilationState(request, "compiled");
        rememberCompilationState({
          ...restoredCompilationState,
          session: completeCompileSession(restoredCompilationState.session, latestImplementationSource),
          readiness: latestReadinessDefinitions,
          diagnostics: latestTypeCheckDiagnostics,
          snippetPreviews: cloneSnippetPreviewMap(snippetPreviewByHash),
        });
      }
      setActiveCompilationSheet(active.id);
    } else {
      setActiveCompilationSheet(null);
    }
    restoreLoadableSelection(session.compilation.selection);
    renderSnippetPanel();

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
      ...(selectedDefinitionTarget.className === undefined ? {} : { className: selectedDefinitionTarget.className }),
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
      target.name === selection.name &&
      target.className === selection.className
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
      (
        selection.targetKind === "function" ||
        selection.targetKind === "class" ||
        selection.targetKind === "field" ||
        selection.targetKind === "method"
      ) &&
      (selection.className === undefined || typeof selection.className === "string")
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

function loadSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? "true" : "false");
  } catch (error) {
    console.error("Failed to save sidebar state", error);
  }
}

function defaultAppSettings(): AppSettings {
  return {
    compilationStrategy: "parallel",
  };
}

function renderCompilationStrategyOptions(selected: CompilationMode): string {
  const stableOptions: Array<{ value: CompilationMode; label: string }> = [
    { value: "parallel", label: "Parallel (default)" },
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
    value === "agentic-methods"
    ? value
    : "parallel";
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
        implementation: tab.implementation ?? null,
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
      activePageId,
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
