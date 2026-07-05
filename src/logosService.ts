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
  source: LogosSheet;
  currentSessionId: CompileSessionId | null;
};

export type LogosServiceOptions = {
  model: CompilerModel;
};

export class LogosService {
  private readonly model: CompilerModel;
  private readonly sheets = new Map<LogosSheetId, SheetState>();
  private readonly sessions = new Map<CompileSessionId, CompileSession>();
  private sessionCounter = 0;

  constructor(options: LogosServiceOptions) {
    this.model = options.model;
  }

  updateSheet(sheetId: LogosSheetId, source: LogosSheet): void {
    const existing = this.sheets.get(sheetId);
    if (existing && existing.source === source) return;

    this.sheets.set(sheetId, {
      source,
      currentSessionId: existing?.currentSessionId ?? null,
    });
  }

  sheetState(sheetId: LogosSheetId): SheetState {
    return this.sheets.get(sheetId) ?? { source: "", currentSessionId: null };
  }

  session(sessionId: CompileSessionId): CompileSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  isCompiling(sessionId: CompileSessionId): boolean {
    for (const state of this.sheets.values()) {
      if (state.currentSessionId === sessionId) return true;
    }
    return false;
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
    state.currentSessionId = sessionId;

    void this.runCompile(sheetId, sessionId, session, state.source, previousSession);

    return sessionId;
  }

  async compileSheet(sheetId: LogosSheetId): Promise<CompileSessionId | null> {
    const sessionId = this.startCompile(sheetId);
    if (!sessionId) return null;

    const state = this.sheets.get(sheetId)!;
    while (state.currentSessionId === sessionId) {
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
    }

    if (state && state.currentSessionId === sessionId) {
      state.currentSessionId = null;
    }
  }

  clear(): void {
    this.sheets.clear();
    this.sessions.clear();
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
