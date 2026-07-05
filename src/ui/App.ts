import * as React from "react";
import { buildCompilationIR, parse, renderImplementation, type Runnable } from "../codeSheet";
import { defaultProjectIds, samples } from "../samples";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { OutputPane } from "./OutputPane";
import { SheetTabBar } from "./SheetTabBar";
import { Sidebar, type PageEntry } from "./Sidebar";
import type {
  AgentEvent,
  CompilationMode,
  LoadableSession,
  LoadableSessionSelection,
  RunChunk,
  RunStatus,
  RunTab,
  SourceTab,
  SourceTabState,
} from "./types";

const e = React.createElement;

const pages: PageEntry[] = [
  { id: "editor", title: "Interactive Editor" },
  { id: "vision", title: "Logos: The Vision" },
  { id: "alternatives", title: "Vs. Coding Agents" },
  { id: "spec-driven", title: "Vs. Spec-Driven Development?" },
  { id: "technical", title: "Technical: Compiling Natural Language" },
  { id: "roadmap", title: "Roadmap" },
];

const articlePaths = new Map([
  ["vision", "/articles/vision.md"],
  ["alternatives", "/articles/versus-coding-agents.md"],
  ["spec-driven", "/articles/spec-driven-coding.md"],
  ["technical", "/articles/compiling-natural-language.md"],
  ["roadmap", "/articles/roadmap.md"],
]);

const sourceTabDbName = "logos-interviews-user";
const sourceTabDbVersion = 1;
const sourceTabStoreName = "state";
const sourceTabStateKey = "source-tabs-v2";
const workspaceIdStorageKey = "logos-interviews-workspace-id";
const appSettingsStorageKey = "logos-interviews-settings-v1";
const sidebarCollapsedStorageKey = "logos-interviews-sidebar-collapsed";
const implementationTabId = "implementation-view";
const agentTabId = "agent-view";

type CompileSessionState = {
  sheetId: string;
  sessionId: string;
  source: string;
  controller: AbortController;
};

declare global {
  interface Window {
    loadLogosSession?: (session: LoadableSession) => Promise<void>;
    createLogosSessionBundle?: () => LoadableSession;
  }
}

export function App() {
  const [sourceTabs, setSourceTabs] = React.useState<SourceTab[]>(() => defaultSourceTabState().tabs);
  const [activeSourceTabId, setActiveSourceTabId] = React.useState<string | null>(() => defaultSourceTabState().activeTabId);
  const [activePageId, setActivePageId] = React.useState(() => pageIdFromHash(window.location.hash) ?? "editor");
  const [sidebarCollapsed, setSidebarCollapsedState] = React.useState(loadSidebarCollapsed);
  const [compilationStrategy, setCompilationStrategy] = React.useState<CompilationMode>(loadCompilationStrategy);
  const [implementation, setImplementation] = React.useState("");
  const [compilingSheetIds, setCompilingSheetIds] = React.useState<Set<string>>(() => new Set());
  const [compileVersion, setCompileVersion] = React.useState(0);
  const [runTabs, setRunTabs] = React.useState<RunTab[]>([]);
  const [activeToolTabId, setActiveToolTabId] = React.useState<string | null>(implementationTabId);
  const [runStatusText, setRunStatusText] = React.useState("");
  const [runStatusState, setRunStatusState] = React.useState("");
  const [selection, setSelection] = React.useState<LoadableSessionSelection>({ kind: "none" });
  const [articleHtmlById, setArticleHtmlById] = React.useState<Record<string, string>>({});

  const editorRef = React.useRef<CodeEditorHandle | null>(null);
  const compileTimerRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const compileControllerRef = React.useRef(new Map<string, AbortController>());
  const compileSessionRef = React.useRef(new Map<string, CompileSessionState>());
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = React.useRef(false);
  const explicitSessionLoadedRef = React.useRef(false);
  const workspaceIdRef = React.useRef(getOrCreateWorkspaceId());
  const runTabsRef = React.useRef(runTabs);
  const activeToolTabRef = React.useRef(activeToolTabId);
  const activeSourceTabIdRef = React.useRef(activeSourceTabId);
  const activeSourceTab = sourceTabs.find((tab) => tab.id === activeSourceTabId) ?? null;
  const activeSource = activeSourceTab?.source ?? "";
  const activeCompileSessionId = activeSourceTab?.compileSessionId ?? null;
  const activeCompiling = activeSourceTabId !== null && compilingSheetIds.has(activeSourceTabId);

  runTabsRef.current = runTabs;
  activeToolTabRef.current = activeToolTabId;
  activeSourceTabIdRef.current = activeSourceTabId;

  React.useEffect(() => {
    sessionStorageId();
    void bootWorkspace();

    async function bootWorkspace() {
      const state = await loadDefaultProjectFromBackend();
      hydratedRef.current = true;
      if (explicitSessionLoadedRef.current) {
        return;
      }
      setSourceTabs(state.tabs);
      setActiveSourceTabId(state.activeTabId);
      const active = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
      setImplementation(active?.implementation ?? scaffoldForSource(active?.source ?? ""));
      editorRef.current?.setValue(active?.source ?? "");
      await loadSharedSessionFromUrl();
    }
  }, []);

  React.useEffect(() => {
    if (!hydratedRef.current) return;
    scheduleSaveSourceTabs({ tabs: sourceTabs, activeTabId: activeSourceTabId }, saveTimerRef);
  }, [sourceTabs, activeSourceTabId]);

  React.useEffect(() => {
    if (!activeSourceTabId || !activeCompileSessionId) return;
    const existing = compileSessionRef.current.get(activeSourceTabId);
    if (existing?.sessionId === activeCompileSessionId) return;
    const source = activeSourceTab?.source ?? "";
    const controller = new AbortController();
    setCompilingSheetIds((ids) => new Set(ids).add(activeSourceTabId));
    void pollCompileSession(activeSourceTabId, activeCompileSessionId, source, controller, { quietStatus: true });
    return () => {
      controller.abort();
    };
  }, [activeSourceTabId, activeCompileSessionId]);

  React.useEffect(() => {
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);

    function handleHashChange() {
      const next = pageIdFromHash(window.location.hash);
      if (next) setActivePageId(next);
    }
  }, []);

  React.useEffect(() => {
    if (activePageId !== "editor") {
      void loadArticle(activePageId, articleHtmlById, setArticleHtmlById);
    }
  }, [activePageId, articleHtmlById]);

  React.useEffect(() => {
    window.createLogosSessionBundle = createLoadableSession;
    window.loadLogosSession = loadSession;
    return () => {
      delete window.createLogosSessionBundle;
      delete window.loadLogosSession;
    };
  });

  React.useEffect(() => {
    const shell = document.querySelector<HTMLElement>("#shell");
    const handle = document.querySelector<HTMLElement>("#code-run-resize-handle");
    if (!shell || !handle) return;

    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const rect = shell.getBoundingClientRect();
      const width = Math.max(320, Math.min(rect.width - 320, event.clientX - rect.left));
      shell.style.setProperty("--code-pane-basis", `${width}px`);
      shell.style.setProperty("--code-pane-grow", "0");
      editorRef.current?.layout();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    handle.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const setActivePage = React.useCallback((pageId: string) => {
    setActivePageId(pageId);
    window.location.hash = pageId === "editor" ? "" : pageId;
  }, []);

  const selectSheet = React.useCallback((sheetId: string) => {
    const next = sourceTabs.find((tab) => tab.id === sheetId);
    if (!next) return;
    setActiveSourceTabId(sheetId);
    setImplementation(next.implementation ?? scaffoldForSource(next.source));
    setSelection({ kind: "none" });
    editorRef.current?.setValue(next.source);
  }, [sourceTabs]);

  const updateActiveSource = React.useCallback((source: string) => {
    if (!activeSourceTabId) return;
    setSourceTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === activeSourceTabId ? { ...tab, source, implementation: tab.implementation ?? null } : tab,
      ),
    );
    scheduleCompilation(activeSourceTabId, source);
  }, [activeSourceTabId]);

  const addScratch = React.useCallback(() => {
    const tab: SourceTab = {
      id: createSourceTabId("scratch"),
      projectId: "scratch",
      title: nextScratchTitle(sourceTabs),
      source: "",
      implementation: "",
    };
    setSourceTabs((tabs) => [...tabs, tab]);
    setActiveSourceTabId(tab.id);
    setImplementation("");
    editorRef.current?.setValue("");
    void createBackendSheet(tab);
    closeDetails("#sample-menu");
  }, [sourceTabs]);

  const openTemplate = React.useCallback((sampleId: string) => {
    const sample = samples.find((item) => item.id === sampleId);
    if (!sample) return;
    const tab: SourceTab = {
      id: createSourceTabId(sample.id),
      projectId: sample.id,
      title: sample.label,
      source: sample.code,
      implementation: scaffoldForSource(sample.code),
    };
    setSourceTabs((tabs) => [...tabs, tab]);
    setActiveSourceTabId(tab.id);
    setImplementation(tab.implementation ?? "");
    editorRef.current?.setValue(tab.source);
    void createBackendSheet(tab);
    closeDetails("#sample-menu");
  }, []);

  const closeSheet = React.useCallback((sheetId: string) => {
    stopSheetCompilation(sheetId);
    setSourceTabs((tabs) => {
      const index = tabs.findIndex((tab) => tab.id === sheetId);
      const nextTabs = tabs.filter((tab) => tab.id !== sheetId);
      if (activeSourceTabId === sheetId) {
        const next = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[0] ?? null;
        setActiveSourceTabId(next?.id ?? null);
        setImplementation(next?.implementation ?? scaffoldForSource(next?.source ?? ""));
        editorRef.current?.setValue(next?.source ?? "");
      }
      return nextTabs;
    });
    void deleteBackendSheet(sheetId);
  }, [activeSourceTabId]);

  const startRun = React.useCallback((runnable: Runnable) => {
    if (!activeSourceTab) return;
    const implSheetId = activeSourceTab.implSheetId;
    if (!implSheetId) {
      setRunStatus(`${runnable} is missing an implementation id`, "error");
      return;
    }
    const runTab = createRunTab(runnable, activeSourceTab.id, activeSourceTab.source, implementation, implSheetId);
    setRunTabs((tabs) => [...tabs, runTab]);
    setActiveToolTabId(runTab.id);
    setRunStatus(`Running ${runnable}`, "");
    void startRunRequest(runTab, activeSourceTab.source, runnable, implementation, implSheetId);
  }, [activeSourceTab, implementation]);

  const sendRunInput = React.useCallback((runTabId: string, input: string) => {
    const tab = runTabsRef.current.find((item) => item.id === runTabId);
    if (!tab?.sessionId || tab.status?.state !== "running") return;
    void postJson("/api/run/input", { sessionId: tab.sessionId, input }).catch(() => undefined);
  }, []);

  const sendRunResize = React.useCallback((runTabId: string, cols: number, rows: number) => {
    const tab = runTabsRef.current.find((item) => item.id === runTabId);
    if (!tab?.sessionId || tab.status?.state !== "running") return;
    void postJson("/api/run/resize", { sessionId: tab.sessionId, cols, rows }).catch(() => undefined);
  }, []);

  const closeRunTab = React.useCallback((runTabId: string) => {
    setRunTabs((tabs) => {
      const tab = tabs.find((item) => item.id === runTabId);
      if (tab?.sessionId && tab.status?.state === "running") {
        void postJson("/api/run/stop", { sessionId: tab.sessionId }).catch(() => undefined);
      }
      const index = tabs.findIndex((item) => item.id === runTabId);
      const next = tabs.filter((item) => item.id !== runTabId);
      if (activeToolTabRef.current === runTabId) {
        setActiveToolTabId(next[index]?.id ?? next[index - 1]?.id ?? implementationTabId);
      }
      return next;
    });
  }, []);

  function setRunStatus(text: string, state: string) {
    setRunStatusText(text);
    setRunStatusState(state);
  }

  function scheduleCompilation(
    sheetId: string,
    source: string,
    options: { quietStatus?: boolean } = {},
  ) {
    setCompileVersion((version) => version + 1);
    setCompilingSheetIds((ids) => new Set(ids).add(sheetId));
    if (!options.quietStatus && activeSourceTabIdRef.current === sheetId) {
      setRunStatus("Code is being generated...", "");
    }
    const existingTimer = compileTimerRef.current.get(sheetId);
    if (existingTimer) clearTimeout(existingTimer);
    compileControllerRef.current.get(sheetId)?.abort();
    const controller = new AbortController();
    compileControllerRef.current.set(sheetId, controller);
    const timer = setTimeout(() => {
      compileTimerRef.current.delete(sheetId);
      if (!controller.signal.aborted) {
        void updateSheetAndPoll(sheetId, source, controller, options);
      }
    }, 250);
    compileTimerRef.current.set(sheetId, timer);
  }

  async function updateSheetAndPoll(
    sheetId: string,
    source: string,
    controller: AbortController,
    options: { quietStatus?: boolean } = {},
  ): Promise<void> {
    compileSessionRef.current.get(sheetId)?.controller.abort();
    try {
      const start = await fetch("/api/v2/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId, source }),
        signal: controller.signal,
      });
      const startPayload = await start.json() as { sessionId?: string; error?: string };
      if (!start.ok || !startPayload.sessionId) {
        throw new Error(startPayload.error ?? "Compilation failed to start");
      }

      setSourceTabs((tabs) =>
        tabs.map((tab) =>
          tab.id === sheetId
            ? { ...tab, compileSessionId: startPayload.sessionId ?? null, implSheetId: null }
            : tab
        ),
      );
      await pollCompileSession(sheetId, startPayload.sessionId, source, controller, options);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        if (activeSourceTabIdRef.current === sheetId) {
          setRunStatus(message, "error");
        }
      }
    } finally {
      if (compileControllerRef.current.get(sheetId) === controller) {
        compileControllerRef.current.delete(sheetId);
      }
    }
  }

  async function pollCompileSession(
    sheetId: string,
    sessionId: string,
    source: string,
    controller: AbortController,
    options: { quietStatus?: boolean } = {},
  ): Promise<void> {
    compileSessionRef.current.set(sheetId, { sheetId, sessionId, source, controller });
    let after = 0;
    try {
      while (!controller.signal.aborted) {
      const response = await fetch(
        `/api/v2/session?id=${encodeURIComponent(sessionId)}&after=${after}`,
        { signal: controller.signal },
      );
        if (!response.ok) {
          throw new Error(`Compile session ${sessionId} was not found`);
        }
        const payload = await response.json() as {
          events?: AgentEvent[];
          done?: boolean;
          total?: number;
          implementation?: string;
        };
        const events = payload.events ?? [];
        after = typeof payload.total === "number" ? payload.total : after + events.length;
        const activeSheet = activeSourceTabIdRef.current === sheetId;

        for (const event of events) {
          if (event.kind === "implementation" || event.kind === "scaffold" || event.kind === "done") {
            const code = typeof event.code === "string"
              ? event.code
              : payload.implementation ?? "";
            if (activeSheet) setImplementation(code);
            setSourceTabs((tabs) => tabs.map((tab) => tab.id === sheetId ? { ...tab, implementation: code } : tab));
          }
        }

        if (payload.done) {
          const finalImplementation = payload.implementation;
          if (typeof finalImplementation === "string" && finalImplementation.length > 0) {
            if (activeSheet) setImplementation(finalImplementation);
            setSourceTabs((tabs) =>
              tabs.map((tab) =>
                tab.id === sheetId
                  ? { ...tab, implementation: finalImplementation, implSheetId: sessionId }
                  : tab
              ),
            );
          }
          if (activeSheet && !options.quietStatus) setRunStatus("Compiled", "ok");
          break;
        }
        await sleep(200);
      }
    } finally {
      setCompilingSheetIds((ids) => {
        const next = new Set(ids);
        next.delete(sheetId);
        return next;
      });
      if (compileSessionRef.current.get(sheetId)?.sessionId === sessionId) {
        compileSessionRef.current.delete(sheetId);
      }
    }
  }

  async function startRunRequest(
    runTab: RunTab,
    source: string,
    runnable: Runnable,
    runImplementation: string,
    implSheetId: string,
  ): Promise<void> {
    try {
      const payload = await postJson("/api/run/start", {
        sheetId: runTab.sheetId,
        implSheetId,
        sheet: source,
        runnable,
        implementation: runImplementation,
      }) as {
        ok?: boolean;
        kind?: "terminal" | "react";
        sessionId?: string;
        runId?: string;
        runnable?: string;
        implementation?: string;
        appCode?: string;
        chunks?: RunChunk[];
        status?: RunStatus;
        error?: string;
      };
      if (!payload.ok) throw new Error(payload.error ?? "Run failed");

      setRunTabs((tabs) =>
        tabs.map((tab) => {
          if (tab.id !== runTab.id) return tab;
          const chunks = payload.chunks ?? [];
          return {
            ...tab,
            sessionId: payload.sessionId ?? null,
            reactRunId: payload.runId ?? null,
            renderMode: payload.kind === "react" ? "react" : "terminal",
            reactAppCode: payload.appCode ?? null,
            implementation: payload.implementation ?? tab.implementation,
            status: payload.status ?? { state: "running" },
            chunks,
            terminalText: chunks.map((chunk) => chunk.text).join(""),
          };
        }),
      );
      if (payload.kind === "react" || payload.status?.state === "exited") {
        setRunStatus(`Ran ${runnable}`, "ok");
        return;
      }
      if (payload.sessionId) scheduleRunPoll(runTab.id, payload.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunStatus(message, "error");
      appendRunChunks(runTab.id, [{ stream: "stderr", text: `${message}\n` }], { state: "exited", code: 1, signal: null, error: message });
    }
  }

  function scheduleRunPoll(runTabId: string, sessionId: string) {
    window.setTimeout(() => void pollRun(runTabId, sessionId), 120);
  }

  async function pollRun(runTabId: string, sessionId: string): Promise<void> {
    const current = runTabsRef.current.find((tab) => tab.id === runTabId);
    if (!current || current.sessionId !== sessionId) return;
    try {
      const payload = await postJson("/api/run/poll", { sessionId }) as {
        ok?: boolean;
        chunks?: RunChunk[];
        status?: RunStatus;
        implementation?: string;
        error?: string;
      };
      if (!payload.ok) throw new Error(payload.error ?? "Run polling failed");
      appendRunChunks(runTabId, payload.chunks ?? [], payload.status ?? { state: "running" }, payload.implementation);
      if (payload.status?.state === "running") {
        scheduleRunPoll(runTabId, sessionId);
      } else {
        setRunStatus(`Ran ${current.runnable}`, payload.status?.state === "exited" && payload.status.code === 0 ? "ok" : "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendRunChunks(runTabId, [{ stream: "stderr", text: `${message}\n` }], { state: "exited", code: 1, signal: null, error: message });
      setRunStatus(message, "error");
    }
  }

  function appendRunChunks(runTabId: string, chunks: RunChunk[], status: RunStatus, nextImplementation?: string) {
    setRunTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === runTabId
          ? {
              ...tab,
              status,
              implementation: nextImplementation ?? tab.implementation,
              chunks: [...tab.chunks, ...chunks],
              terminalText: `${tab.terminalText}${chunks.map((chunk) => chunk.text).join("")}`,
            }
          : tab,
      ),
    );
  }

  async function createBackendSheet(
    tab: SourceTab,
    options: { poll?: boolean } = {},
  ): Promise<void> {
    try {
      const payload = await postJson("/api/v2/sheet/new", {
        id: tab.id,
        projectId: tab.projectId,
        title: tab.title,
        source: tab.source,
      }) as { sheet?: BackendSheet };
      const sessionId = payload.sheet?.currentSessionId ?? null;
      setSourceTabs((tabs) =>
        tabs.map((item) => item.id === tab.id ? { ...item, compileSessionId: sessionId } : item),
      );
      if (options.poll !== false && sessionId) {
        setCompilingSheetIds((ids) => new Set(ids).add(tab.id));
        await pollCompileSession(tab.id, sessionId, tab.source, new AbortController(), { quietStatus: true });
      }
    } catch {
      // Sheet registration is best-effort for local/session-loaded sheets; source edits retry through updateSheet.
    }
  }

  function createLoadableSession(): LoadableSession {
    const snapshot = editorRef.current?.snapshot() ?? {
      value: activeSource,
      cursor: null,
      scrollTop: 0,
      scrollLeft: 0,
    };
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      sessionId: sessionStorageId(),
      workspaceId: workspaceIdRef.current,
      sourceTabs,
      activeSourceTabId,
      editor: snapshot,
      compilation: {
        compileVersion,
        latestImplementationSource: implementation,
        selection,
      },
      run: {
        activeToolTabId,
        lastRunLabel: runStatusText ? "recently" : "never",
        lastRunStatusText: runStatusText,
        lastRunCompletedAtMs: Date.now(),
        lastRunStatusPrefix: runStatusText,
        lastRunStatusState: runStatusState,
        lastRunDefinitionHash: activeSource ? hashString(activeSource) : null,
        runStatus: { text: runStatusText, state: runStatusState },
        tabs: runTabs.map((tab) => ({
          id: tab.id,
          sheetId: tab.sheetId,
          implSheetId: tab.implSheetId,
          runnable: tab.runnable,
          sourceHash: tab.sourceHash,
          terminalText: tab.terminalText,
          implementation: tab.implementation,
          status: tab.status,
        })),
      },
      agent: { expanded: false, input: "", messages: [] },
    };
  }

  async function loadSession(session: LoadableSession): Promise<void> {
    explicitSessionLoadedRef.current = true;
    stopAllSheetCompilations();
    const tabs = session.sourceTabs.length > 0 ? session.sourceTabs : defaultSourceTabState().tabs;
    const activeId = session.activeSourceTabId ?? tabs[0]?.id ?? null;
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
    const latestImplementation = session.compilation.latestImplementationSource ?? active?.implementation ?? "";
    const tabsWithImplementation = tabs.map((tab) =>
      tab.id === active?.id && tab.implementation == null && latestImplementation.length > 0
        ? { ...tab, implementation: latestImplementation }
        : tab,
    );
    setSourceTabs(tabsWithImplementation);
    setActiveSourceTabId(active?.id ?? null);
    setImplementation(latestImplementation);
    setCompilingSheetIds(new Set());
    setCompileVersion(session.compilation.compileVersion);
    setSelection(session.compilation.selection ?? { kind: "none" });
    setRunStatusText(session.run.runStatus.text ?? session.run.lastRunStatusText ?? "");
    setRunStatusState(session.run.runStatus.state ?? "");
    setRunTabs(session.run.tabs.map((tab) => {
      const sheetId = tab.sheetId;
      const implSheetId = tab.implSheetId;
      const runSheet = tabsWithImplementation.find((item) => item.id === sheetId) ?? active;
      return {
        id: tab.id,
        sheetId,
        implSheetId,
        runnable: tab.runnable,
        source: runSheet?.source ?? session.editor.value,
        sessionId: null,
        reactRunId: null,
        renderMode: "terminal" as const,
        reactAppCode: null,
        sourceHash: tab.sourceHash,
        terminalText: tab.status?.state === "running" && tab.terminalText.length === 0
          ? "Run was in progress when the session was captured and was not resumed.\n"
          : tab.terminalText,
        chunks: [],
        implementation: tab.implementation,
        status: tab.status?.state === "running"
          ? { state: "exited" as const, code: null, signal: null, error: "Restored running sessions are not resumed." }
          : tab.status,
      };
    }));
    setActiveToolTabId(
      session.run.activeToolTabId === implementationTabId ||
      session.run.activeToolTabId === agentTabId ||
      session.run.tabs.some((tab) => tab.id === session.run.activeToolTabId)
        ? session.run.activeToolTabId
        : implementationTabId,
    );
    editorRef.current?.setValue(active?.source ?? session.editor.value);
    requestAnimationFrame(() => editorRef.current?.restoreSnapshot(session.editor));
    await writeUserState({ tabs: tabsWithImplementation, activeTabId: active?.id ?? null });
  }

  async function loadSharedSessionFromUrl(): Promise<void> {
    const shareId = new URLSearchParams(window.location.search).get("session");
    if (!shareId) return;
    try {
      const response = await fetch(`/api/shared-sessions/${encodeURIComponent(shareId)}`);
      const payload = await response.json() as { loadableSession?: LoadableSession; ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Shared session request failed");
      if (!payload.loadableSession) throw new Error("Shared session response is missing session data");
      await loadSession(payload.loadableSession);
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function shareSession(): Promise<void> {
    try {
      const response = await fetch("/api/shared-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadableSession: createLoadableSession() }),
      });
      const payload = await response.json() as { ok?: boolean; shareId?: string; error?: string };
      if (!response.ok || !payload.shareId) throw new Error(payload.error ?? "Could not share session");
      const url = new URL(window.location.href);
      url.searchParams.set("session", payload.shareId);
      await navigator.clipboard?.writeText(url.toString());
      setRunStatus("Share link copied", "ok");
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function clearCodeCache(): Promise<void> {
    try {
      await fetch("/api/cache", { method: "DELETE" });
      setRunStatus("Code cache cleared", "ok");
      if (activeSourceTabId) scheduleCompilation(activeSourceTabId, activeSource, { quietStatus: true });
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function copySessionId(): Promise<void> {
    const id = sessionStorageId();
    setRunStatus("Session ID copied", "ok");
    try {
      await navigator.clipboard?.writeText(id);
    } catch {
      // Clipboard permission is optional; the session id still exists for replay/debugging.
    }
  }

  async function resetWorkspace(): Promise<void> {
    stopAllSheetCompilations();
    const next = defaultSourceTabState();
    setSourceTabs(next.tabs);
    setActiveSourceTabId(next.activeTabId);
    const active = next.tabs.find((tab) => tab.id === next.activeTabId) ?? null;
    setImplementation(active?.implementation ?? scaffoldForSource(active?.source ?? ""));
    editorRef.current?.setValue(active?.source ?? "");
    setRunStatus("Resetting workspace", "");
    try {
      const persisted = await replaceBackendProject(next);
      setSourceTabs(persisted.tabs);
      setActiveSourceTabId(persisted.activeTabId);
      const persistedActive = persisted.tabs.find((tab) => tab.id === persisted.activeTabId) ?? null;
      setImplementation(persistedActive?.implementation ?? scaffoldForSource(persistedActive?.source ?? ""));
      editorRef.current?.setValue(persistedActive?.source ?? "");
      await writeUserState(persisted);
      setRunStatus("Workspace reset", "ok");
    } catch (error) {
      await writeUserState(next);
      setRunStatus(error instanceof Error ? `Workspace reset locally: ${error.message}` : "Workspace reset locally", "error");
    }
  }

  function stopSheetCompilation(sheetId: string): void {
    const timer = compileTimerRef.current.get(sheetId);
    if (timer) clearTimeout(timer);
    compileTimerRef.current.delete(sheetId);
    compileControllerRef.current.get(sheetId)?.abort();
    compileControllerRef.current.delete(sheetId);
    compileSessionRef.current.get(sheetId)?.controller.abort();
    compileSessionRef.current.delete(sheetId);
    setCompilingSheetIds((ids) => {
      if (!ids.has(sheetId)) return ids;
      const next = new Set(ids);
      next.delete(sheetId);
      return next;
    });
  }

  function stopAllSheetCompilations(): void {
    for (const timer of compileTimerRef.current.values()) {
      clearTimeout(timer);
    }
    compileTimerRef.current.clear();
    for (const controller of compileControllerRef.current.values()) {
      controller.abort();
    }
    compileControllerRef.current.clear();
    for (const compileSession of compileSessionRef.current.values()) {
      compileSession.controller.abort();
    }
    compileSessionRef.current.clear();
    setCompilingSheetIds(new Set());
  }

  function changeCompilationStrategy(strategy: CompilationMode) {
    setCompilationStrategy(strategy);
    saveCompilationStrategy(strategy);
  }

  function toggleSidebar() {
    setSidebarCollapsedState((collapsed) => {
      saveSidebarCollapsed(!collapsed);
      return !collapsed;
    });
  }

  return e(
    "section",
    {
      className: `app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`,
      "aria-label": "Spreadsheet interview workspace",
    },
    e(Sidebar, {
      pages,
      activePageId,
      collapsed: sidebarCollapsed,
      compilationStrategy,
      onSelectPage: setActivePage,
      onToggleCollapse: toggleSidebar,
      onChangeCompilationStrategy: changeCompilationStrategy,
      onCopySessionId: () => void copySessionId(),
      onClearCodeCache: () => void clearCodeCache(),
      onResetWorkspace: () => void resetWorkspace(),
    }),
    e(
      "main",
      { id: "page-host", className: "page-host" },
      e(
        "section",
        {
          id: "editor-page",
          className: `app-page editor-page${activePageId === "editor" ? " active" : ""}`,
          "data-page-id": "editor",
          "aria-label": "Interactive Editor",
          hidden: activePageId !== "editor",
        },
        e(
          "section",
          { id: "shell", className: "shell" },
          e(
            "section",
            { id: "code-pane", className: "code-pane", "aria-label": "Code editor panel" },
            e(SheetTabBar, {
              sheets: sourceTabs,
              activeSheetId: activeSourceTabId,
              compilingSheetIds,
              onSelectSheet: selectSheet,
              onCloseSheet: closeSheet,
              onAddScratch: addScratch,
              onOpenTemplate: openTemplate,
            }),
            e(CodeEditor, {
              ref: editorRef,
              source: activeSource,
              implementation,
              compiling: activeCompiling,
              onChange: updateActiveSource,
              onRun: startRun,
              onPointerDown: () => {
                closeDetails("#sample-menu");
                closeDetails("#workspace-menu");
              },
            }),
            e("div", { className: "code-feedback-overlay" },
              e("div", { className: "feedback-controls", "data-feedback-controls": "code" },
                e("button", {
                  className: "feedback-button share-button",
                  type: "button",
                  "data-share-session": true,
                  "aria-label": "Share session link",
                  title: "Share link",
                  onClick: () => void shareSession(),
                }, "Share"),
              ),
            ),
          ),
          e("div", {
            id: "code-run-resize-handle",
            className: "code-run-resize-handle",
            role: "separator",
            "aria-orientation": "vertical",
            "aria-label": "Resize code and run views",
            tabIndex: 0,
          }),
          e(OutputPane, {
            implementation,
            compileSessionId: activeCompileSessionId,
            compiling: activeCompiling,
            runTabs,
            activeTabId: activeToolTabId,
            runStatusText,
            runStatusState,
            onSelectTab: setActiveToolTabId,
            onCloseRunTab: closeRunTab,
            onRunInput: sendRunInput,
            onRunResize: sendRunResize,
            onShareSession: () => void shareSession(),
          }),
        ),
      ),
      pages.filter((page) => page.id !== "editor").map((page) =>
        e(
          "section",
          {
            key: page.id,
            className: `app-page article-page${activePageId === page.id ? " active" : ""}`,
            "data-page-id": page.id,
            hidden: activePageId !== page.id,
          },
          e("article", {
            className: "article-content",
            "data-article-content": page.id,
            dangerouslySetInnerHTML: { __html: articleHtmlById[page.id] ?? "<p class=\"article-loading\">Loading...</p>" },
          }),
        ),
      ),
    ),
  );
}

function createRunTab(
  runnable: Runnable,
  sheetId: string,
  source: string,
  implementation: string,
  implSheetId: string,
): RunTab {
  const id = `run-${runnable.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    sheetId,
    implSheetId,
    runnable,
    source,
    sourceHash: hashString(source),
    implementation,
    terminalText: "",
    chunks: [],
    status: { state: "running" },
    sessionId: null,
    reactRunId: null,
    renderMode: "terminal",
    reactAppCode: null,
  };
}

function defaultSourceTabState(): SourceTabState {
  const selected = defaultProjectIds.map((id) => samples.find((sample) => sample.id === id)).filter(Boolean) as typeof samples;
  const sourceSamples = selected.length > 0 ? selected : samples.slice(0, 1);
    const tabs = sourceSamples.map((sample) => ({
    id: createSourceTabId(sample.id),
    projectId: sample.id,
    title: sample.label,
    source: sample.code,
    implementation: scaffoldForSource(sample.code),
    implSheetId: null,
  }));
  return { tabs, activeTabId: tabs[0]?.id ?? null };
}

type BackendSheet = SourceTab & {
  currentSessionId?: string | null;
};

async function loadDefaultProjectFromBackend(): Promise<SourceTabState> {
  try {
    const response = await fetch("/api/v2/project/default");
    const payload = await response.json() as {
      ok?: boolean;
      sheets?: BackendSheet[];
      activeSheetId?: string | null;
      error?: string;
    };
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.sheets)) {
      throw new Error(payload.error ?? "Could not load default project");
    }

    const tabs = payload.sheets.map(sourceTabFromBackendSheet);
    return { tabs, activeTabId: payload.activeSheetId ?? tabs[0]?.id ?? null };
  } catch {
    return hydrateSourceTabsFromDatabase();
  }
}

async function replaceBackendProject(state: SourceTabState): Promise<SourceTabState> {
  const response = await fetch("/api/v2/project/default", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sheets: state.tabs.map(sourceTabToBackendInput),
      activeSheetId: state.activeTabId,
    }),
  });
  const payload = await response.json() as {
    ok?: boolean;
    sheets?: BackendSheet[];
    activeSheetId?: string | null;
    error?: string;
  };
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.sheets)) {
    throw new Error(payload.error ?? "Could not reset backend project");
  }

  const tabs = payload.sheets.map(sourceTabFromBackendSheet);
  return { tabs, activeTabId: payload.activeSheetId ?? tabs[0]?.id ?? null };
}

async function deleteBackendSheet(sheetId: string): Promise<void> {
  try {
    const response = await fetch(`/api/v2/sheet?id=${encodeURIComponent(sheetId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Could not delete backend sheet");
  } catch {
    // Keep tab closing responsive; reset can still replace backend state if a delete fails.
  }
}

function sourceTabFromBackendSheet(sheet: BackendSheet): SourceTab {
  return {
    id: sheet.id,
    projectId: sheet.projectId,
    title: sheet.title,
    source: sheet.source,
    implementation: sheet.implementation ?? scaffoldForSource(sheet.source),
    implSheetId: sheet.implSheetId ?? null,
    compileSessionId: sheet.currentSessionId ?? sheet.compileSessionId ?? null,
  };
}

function sourceTabToBackendInput(tab: SourceTab): Pick<SourceTab, "id" | "projectId" | "title" | "source"> {
  return {
    id: tab.id,
    projectId: tab.projectId,
    title: tab.title,
    source: tab.source,
  };
}

function scaffoldForSource(source: string): string {
  if (source.trim().length === 0) return "";
  try {
    return renderImplementation(buildCompilationIR(parse(source)));
  } catch {
    return source;
  }
}

async function hydrateSourceTabsFromDatabase(): Promise<SourceTabState> {
  const value = await readUserState();
  if (isSourceTabState(value)) return value;
  const state = defaultSourceTabState();
  await writeUserState(state);
  return state;
}

function isSourceTabState(value: unknown): value is SourceTabState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as SourceTabState;
  return Array.isArray(state.tabs) && (typeof state.activeTabId === "string" || state.activeTabId === null);
}

function scheduleSaveSourceTabs(state: SourceTabState, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    void writeUserState(state);
  }, 200);
}

async function readUserState(): Promise<unknown> {
  const db = await openUserDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(sourceTabStoreName, "readonly");
    const request = tx.objectStore(sourceTabStoreName).get(sourceTabStateKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    tx.oncomplete = () => db.close();
  });
}

async function writeUserState(state: SourceTabState): Promise<void> {
  const db = await openUserDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(sourceTabStoreName, "readwrite");
    tx.objectStore(sourceTabStoreName).put(state, sourceTabStateKey);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

function openUserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(sourceTabDbName, sourceTabDbVersion);
    request.onerror = () => reject(request.error ?? new Error("Could not open user database"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sourceTabStoreName)) db.createObjectStore(sourceTabStoreName);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Request failed: ${path}`;
    throw new Error(message);
  }
  return payload;
}

async function loadArticle(
  pageId: string,
  cache: Record<string, string>,
  setCache: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): Promise<void> {
  if (cache[pageId]) return;
  const path = articlePaths.get(pageId);
  if (!path) return;
  try {
    const response = await fetch(path, { cache: "no-cache" });
    const markdown = await response.text();
    setCache((current) => ({ ...current, [pageId]: markdownToHtml(markdown) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCache((current) => ({ ...current, [pageId]: `<p class="article-error">${escapeHtml(message)}</p>` }));
  }
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith("# ")) return `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
      if (trimmed.startsWith("## ")) return `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
      if (trimmed.startsWith("### ")) return `<h3>${escapeHtml(trimmed.slice(4))}</h3>`;
      return `<p>${inlineMarkdown(trimmed)}</p>`;
    })
    .join("");
}

function inlineMarkdown(source: string): string {
  return escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(source: string): string {
  return source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function loadCompilationStrategy(): CompilationMode {
  try {
    const raw = window.localStorage.getItem(appSettingsStorageKey);
    const parsed = raw ? JSON.parse(raw) as { compilationStrategy?: unknown } : {};
    return compilationMode(parsed.compilationStrategy);
  } catch {
    return "parallel";
  }
}

function saveCompilationStrategy(strategy: CompilationMode): void {
  window.localStorage.setItem(appSettingsStorageKey, JSON.stringify({ compilationStrategy: strategy }));
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

function loadSidebarCollapsed(): boolean {
  return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
}

function saveSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? "true" : "false");
}

function getOrCreateWorkspaceId(): string {
  const existing = window.localStorage.getItem(workspaceIdStorageKey);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(workspaceIdStorageKey, next);
  return next;
}

function createSourceTabId(projectId: string): string {
  return `${projectId}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function nextScratchTitle(tabs: SourceTab[]): string {
  const count = tabs.filter((tab) => tab.projectId === "scratch").length;
  return count === 0 ? "Scratch" : `Scratch ${count + 1}`;
}

function pageIdFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, "");
  return pages.some((page) => page.id === id) ? id : null;
}

function closeDetails(selector: string): void {
  const details = document.querySelector<HTMLDetailsElement>(selector);
  if (details) details.open = false;
}

function sessionStorageId(): string {
  const key = "logos-interviews-session-id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

function hashString(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
