import type { Runnable } from "../codeSheet";

export type CompilationMode =
  | "parallel"
  | "parallel-methods"
  | "sequential"
  | "agentic"
  | "agentic-methods";

export type SourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
  implementation?: string | null;
  implSheetId?: string | null;
  compileSessionId?: string | null;
};

export type SourceTabState = {
  tabs: SourceTab[];
  activeTabId: string | null;
};

export type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type RunStatus =
  | { state: "running" }
  | {
      state: "exited";
      code: number | null;
      signal: string | null;
      error?: string;
    };

export type RunTab = {
  id: string;
  sheetId: string;
  implSheetId: string;
  runnable: Runnable;
  source: string;
  sourceHash: string;
  implementation: string;
  terminalText: string;
  chunks: RunChunk[];
  status: RunStatus | null;
  sessionId: string | null;
  reactRunId: string | null;
  renderMode: "terminal" | "react";
  reactAppCode: string | null;
};

export type AgentEvent = {
  kind: string;
  code?: string;
  text?: string;
  name?: string;
  tool?: string;
  input?: unknown;
  message?: string;
};

export type LoadableSessionRunTab = {
  id: string;
  sheetId: string;
  implSheetId: string;
  runnable: Runnable;
  sourceHash: string;
  terminalText: string;
  implementation: string;
  status: RunStatus | null;
};

export type LoadableSessionSelection =
  | { kind: "snippet"; hash: string | null }
  | {
      kind: "definition";
      line: number;
      name: string;
      targetKind: "function" | "class" | "field" | "method";
      className?: string;
    }
  | { kind: "whole-file" }
  | { kind: "none" };

export type LoadableSession = {
  schemaVersion: 1;
  capturedAt: string;
  sessionId: string;
  workspaceId: string;
  sourceTabs: SourceTab[];
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
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
};

export type EditorSnapshot = {
  value: string;
  cursor: { lineNumber: number; column: number } | null;
  scrollTop: number;
  scrollLeft: number;
};
