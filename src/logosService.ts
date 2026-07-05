import type {
  LogosSheet,
  LogosSheetId,
  LogosImplSheet,
  CompilerModel,
  CompilerEvent,
} from "./compiler/codegen";
import { compileFresh, compileUpdate } from "./compiler/codegen";

export type CompileSessionId = string;

export type CompileSession = {
  source: LogosSheet;
  implementation: LogosImplSheet;
  events: CompilerEvent[];
};

export type SheetState = {
  id: LogosSheetId;
  projectId: string;
  title: string;
  source: LogosSheet;
  currentSessionId: CompileSessionId | null;
};

export type NewSheetInput = {
  id: LogosSheetId;
  projectId: string;
  title: string;
  source: LogosSheet;
};

export type LogosServiceOptions = {
  model: CompilerModel;
};

export class LogosService {
  private readonly model: CompilerModel;
  private readonly sheets = new Map<LogosSheetId, SheetState>();
  private readonly sessions = new Map<CompileSessionId, CompileSession>();
  private readonly compilingSessionIds = new Set<CompileSessionId>();
  private readonly watchedSheetIds = new Set<LogosSheetId>();
  private defaultProjectInitialized = false;
  private sessionCounter = 0;

  constructor(options: LogosServiceOptions) {
    this.model = options.model;
  }

  initializeDefaultProject(sheets: NewSheetInput[]): SheetState[] {
    if (!this.defaultProjectInitialized) {
      for (const sheet of sheets) {
        this.newSheet(sheet);
        this.watchSheet(sheet.id);
      }
      this.defaultProjectInitialized = true;
    }
    return this.allSheets();
  }

  replaceDefaultProject(sheets: NewSheetInput[]): SheetState[] {
    this.clearSheets();
    this.defaultProjectInitialized = true;
    for (const sheet of sheets) {
      this.newSheet(sheet);
    }
    return this.allSheets();
  }

  allSheets(): SheetState[] {
    return [...this.sheets.values()];
  }

  newSheet(sheet: NewSheetInput): SheetState {
    const existing = this.sheets.get(sheet.id);
    const state: SheetState = {
      id: sheet.id,
      projectId: sheet.projectId,
      title: sheet.title,
      source: sheet.source,
      currentSessionId: existing?.currentSessionId ?? null,
    };
    this.sheets.set(sheet.id, state);
    this.watchSheet(sheet.id);
    return state;
  }

  updateSheet(sheetId: LogosSheetId, source: LogosSheet): CompileSessionId | null {
    const existing = this.sheets.get(sheetId);
    if (existing && existing.source === source) {
      return this.watchedSheetIds.has(sheetId) ? this.ensureCompiled(sheetId) : existing.currentSessionId;
    }

    this.sheets.set(sheetId, {
      id: sheetId,
      projectId: existing?.projectId ?? sheetId,
      title: existing?.title ?? sheetId,
      source,
      currentSessionId: existing?.currentSessionId ?? null,
    });
    return this.watchedSheetIds.has(sheetId) ? this.ensureCompiled(sheetId) : null;
  }

  watchSheet(sheetId: LogosSheetId): CompileSessionId | null {
    this.watchedSheetIds.add(sheetId);
    return this.ensureCompiled(sheetId);
  }

  unwatchSheet(sheetId: LogosSheetId): void {
    this.watchedSheetIds.delete(sheetId);
  }

  deleteSheet(sheetId: LogosSheetId): boolean {
    const existing = this.sheets.get(sheetId);
    this.watchedSheetIds.delete(sheetId);
    if (existing?.currentSessionId) {
      this.sessions.delete(existing.currentSessionId);
      this.compilingSessionIds.delete(existing.currentSessionId);
    }
    return this.sheets.delete(sheetId);
  }

  private ensureCompiled(sheetId: LogosSheetId): CompileSessionId | null {
    const state = this.sheets.get(sheetId);
    if (!state) return null;
    if (state.source.trim().length === 0) return state.currentSessionId;

    if (state.currentSessionId) {
      const session = this.sessions.get(state.currentSessionId);
      if (session?.source === state.source) {
        return state.currentSessionId;
      }
    }

    return this.startCompile(sheetId);
  }

  sheetState(sheetId: LogosSheetId): SheetState {
    return this.sheets.get(sheetId) ?? {
      id: sheetId,
      projectId: sheetId,
      title: sheetId,
      source: "",
      currentSessionId: null,
    };
  }

  session(sessionId: CompileSessionId): CompileSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  isCompiling(sessionId: CompileSessionId): boolean {
    return this.compilingSessionIds.has(sessionId);
  }

  startCompile(sheetId: LogosSheetId): CompileSessionId | null {
    const state = this.sheets.get(sheetId);
    if (!state) return null;

    const sessionId = this.nextSessionId();
    const previousSession = state.currentSessionId
      ? this.sessions.get(state.currentSessionId) ?? null
      : null;

    const session: CompileSession = {
      source: state.source,
      implementation: state.source,
      events: [],
    };
    this.sessions.set(sessionId, session);
    this.compilingSessionIds.add(sessionId);
    state.currentSessionId = sessionId;

    void this.runCompile(sheetId, sessionId, session, state.source, previousSession);

    return sessionId;
  }

  async compileSheet(sheetId: LogosSheetId): Promise<CompileSessionId | null> {
    const sessionId = this.startCompile(sheetId);
    if (!sessionId) return null;

    while (this.isCompiling(sessionId)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return sessionId;
  }

  private async runCompile(
    sheetId: LogosSheetId,
    sessionId: CompileSessionId,
    session: CompileSession,
    source: LogosSheet,
    previousSession: CompileSession | null,
  ): Promise<void> {
    const state = this.sheets.get(sheetId);

    try {
      const events = previousSession
        ? compileUpdate(source, diffLines(previousSession.source, source), previousSession.implementation, { model: this.model })
        : compileFresh(source, { model: this.model });

      for await (const event of events) {
        if (!state || state.currentSessionId !== sessionId) return;

        session.events.push(event);
        if (event.kind === "implementation" || event.kind === "done") {
          session.implementation = event.code;
        }
      }
    } catch (error) {
      session.events.push({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.compilingSessionIds.delete(sessionId);
    }
  }

  clear(): void {
    this.clearSheets();
    this.defaultProjectInitialized = false;
  }

  private clearSheets(): void {
    this.sheets.clear();
    this.sessions.clear();
    this.compilingSessionIds.clear();
    this.watchedSheetIds.clear();
  }

  private nextSessionId(): CompileSessionId {
    return `session-${++this.sessionCounter}`;
  }
}

function diffLines(previous: string, next: string): string {
  const prevLines = previous.replaceAll("\r\n", "\n").split("\n");
  const nextLines = next.replaceAll("\r\n", "\n").split("\n");
  const max = Math.max(prevLines.length, nextLines.length);
  const diff: string[] = [];
  for (let i = 0; i < max; i++) {
    if (prevLines[i] === nextLines[i]) continue;
    if (prevLines[i] !== undefined) diff.push(`-${prevLines[i]}`);
    if (nextLines[i] !== undefined) diff.push(`+${nextLines[i]}`);
  }
  return diff.join("\n");
}
