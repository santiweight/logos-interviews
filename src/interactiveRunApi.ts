import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import ts from "typescript";
import type {
  CodeCache,
  CompleteFunction,
  Runnable,
} from "./codeSheet";
import {
  buildTypeScriptProgram,
  InteractiveTypeScriptRun,
  startInteractiveCodeSheet,
  type CompilationMode,
  type InteractiveRunStatus,
} from "./codeSheetRunner";
import { isCompilationMode } from "./compilationStrategies/types";

type InteractiveRunRecord = {
  session: InteractiveTypeScriptRun;
  runnable: Runnable;
  implementation: string;
  updatedAt: number;
};

type ReactAppRecord = {
  runnable: Runnable;
  implementation: string;
  appCode: string;
  updatedAt: number;
};

type InteractiveRunApiOptions = {
  cache: CodeCache;
  complete?: CompleteFunction;
  compileSheet?: (sheet: string) => Promise<string>;
};

const sessionTtlMs = 10 * 60 * 1000;

export function createInteractiveRunApi(options: InteractiveRunApiOptions) {
  const sessions = new Map<string, InteractiveRunRecord>();
  const reactApps = new Map<string, ReactAppRecord>();

  function cleanupSessions(): void {
    const now = Date.now();
    for (const [sessionId, record] of sessions) {
      if (now - record.updatedAt > sessionTtlMs) {
        record.session.stop();
        sessions.delete(sessionId);
      }
    }
    for (const [runId, record] of reactApps) {
      if (now - record.updatedAt > sessionTtlMs) {
        reactApps.delete(runId);
      }
    }
  }

  function getSession(sessionId: unknown): [string, InteractiveRunRecord] | null {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return null;
    }

    const record = sessions.get(sessionId);
    if (!record) {
      return null;
    }

    record.updatedAt = Date.now();
    return [sessionId, record];
  }

  async function handleStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    cleanupSessions();
    const { sheet, runnable, compilationStrategy } = await readJson(req);
    if (typeof sheet !== "string" || typeof runnable !== "string") {
      sendJson(res, 400, {
        ok: false,
        error: "Missing sheet or runnable",
      });
      return;
    }

    const implementation = options.compileSheet ? await options.compileSheet(sheet) : null;
    if (implementation !== null && isReactAppRunnable(sheet, runnable)) {
      const runId = randomUUID();
      const appCode = transpileReactAppImplementation(implementation);
      reactApps.set(runId, {
        runnable,
        implementation,
        appCode,
        updatedAt: Date.now(),
      });
      sendJson(res, 200, {
        ok: true,
        kind: "react",
        runId,
        runnable,
        implementation,
        appCode,
        status: { state: "exited", code: 0, signal: null },
      });
      return;
    }

    const result = implementation !== null
      ? await startFromCompiledSheet(sheet, runnable, implementation)
      : await startInteractiveCodeSheet(sheet, runnable, {
        cache: options.cache,
        complete: options.complete,
        compilationStrategy: compilationMode(compilationStrategy),
      });
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      session: result.session,
      runnable,
      implementation: result.completed.source,
      updatedAt: Date.now(),
    });

    sendJson(res, 200, {
      ok: true,
      kind: "terminal",
      sessionId,
      runnable,
      implementation: result.completed.source,
      chunks: result.session.drainOutput(),
      status: result.session.status(),
    });
  }

  async function handleInput(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const { sessionId, input } = await readJson(req);
    const entry = getSession(sessionId);
    if (!entry || typeof input !== "string") {
      sendJson(res, 404, {
        ok: false,
        error: "Missing active run session or input",
      });
      return;
    }

    const [, record] = entry;
    const accepted = record.session.writeInput(input);
    sendJson(res, 200, { ok: accepted });
  }

  async function handleResize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const { sessionId, cols, rows } = await readJson(req);
    const entry = getSession(sessionId);
    if (
      !entry ||
      typeof cols !== "number" ||
      typeof rows !== "number" ||
      !Number.isFinite(cols) ||
      !Number.isFinite(rows)
    ) {
      sendJson(res, 404, {
        ok: false,
        error: "Missing active run session or terminal dimensions",
      });
      return;
    }

    const [, record] = entry;
    const accepted = record.session.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    sendJson(res, 200, { ok: accepted });
  }

  async function handlePoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const { sessionId } = await readJson(req);
    const entry = getSession(sessionId);
    if (!entry) {
      sendJson(res, 404, {
        ok: false,
        errorCode: "run_session_not_found",
        error: "Run session not found",
        chunks: [],
      });
      return;
    }

    const [, record] = entry;
    const chunks = record.session.drainOutput();
    const status = record.session.status();

    sendJson(res, 200, {
      ok: true,
      chunks,
      status,
      implementation: record.implementation,
      runnable: record.runnable,
    });
  }

  async function handleStop(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const { sessionId } = await readJson(req);
    const entry = getSession(sessionId);
    if (!entry) {
      sendJson(res, 404, {
        ok: false,
        errorCode: "run_session_not_found",
        error: "Run session not found",
      });
      return;
    }

    const [, record] = entry;
    record.session.stop();
    sendJson(res, 200, {
      ok: true,
      chunks: record.session.drainOutput(),
      status: record.session.status(),
    });
  }

  return {
    handleStart,
    handleInput,
    handleResize,
    handlePoll,
    handleStop,
  };
}

async function startFromCompiledSheet(
  sheet: string,
  runnable: Runnable,
  implementation: string,
) {
  void sheet;
  const source = buildTypeScriptProgram(implementation, runnable);
  return {
    session: await InteractiveTypeScriptRun.start(source),
    completed: { source: implementation },
  };
}

function compilationMode(strategy: unknown): CompilationMode {
  if (isCompilationMode(strategy)) {
    return strategy;
  }

  return "sequential";
}

export type InteractiveRunWireStatus = InteractiveRunStatus;

function isReactAppRunnable(sheet: string, runnable: Runnable): boolean {
  const escaped = escapeRegExp(runnable);
  const pattern = new RegExp(String.raw`function\s+${escaped}\s*\([^)]*\)\s*:\s*ReactApp\b`);
  return pattern.test(sheet);
}

function transpileReactAppImplementation(implementation: string): string {
  const source = implementation
    .split("\n")
    .filter((line) => !/^\s*import\s+.*\bfrom\s+["'](?:react|react-dom|react-dom\/client)["'];?\s*$/.test(line))
    .map((line) => line.replace(/^\s*export\s+/, ""))
    .join("\n");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  if (errors.length > 0) {
    throw new Error(`ReactApp transpile failed: ${errors.join("; ")}`);
  }

  return result.outputText;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
