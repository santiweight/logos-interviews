import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  CodeCache,
  CompleteFunction,
  Runnable,
} from "./codeSheet";
import {
  startInteractiveCodeSheet,
  type CompilationMode,
  type InteractivePythonRun,
  type InteractiveRunStatus,
} from "./codeSheetRunner";

type InteractiveRunRecord = {
  session: InteractivePythonRun;
  runnable: Runnable;
  implementation: string;
  updatedAt: number;
};

type InteractiveRunApiOptions = {
  cache: CodeCache;
  complete?: CompleteFunction;
};

const sessionTtlMs = 10 * 60 * 1000;

export function createInteractiveRunApi(options: InteractiveRunApiOptions) {
  const sessions = new Map<string, InteractiveRunRecord>();

  function cleanupSessions(): void {
    const now = Date.now();
    for (const [sessionId, record] of sessions) {
      if (now - record.updatedAt > sessionTtlMs) {
        record.session.stop();
        sessions.delete(sessionId);
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
    const { sheet, runnable, compilationStrategy, experimentalParallelCompletions } = await readJson(req);
    if (typeof sheet !== "string" || typeof runnable !== "string") {
      sendJson(res, 400, {
        ok: false,
        error: "Missing sheet or runnable",
      });
      return;
    }

    const result = await startInteractiveCodeSheet(sheet, runnable, {
      cache: options.cache,
      complete: options.complete,
      compilationStrategy: compilationMode(compilationStrategy, experimentalParallelCompletions),
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
    handlePoll,
    handleStop,
  };
}

function compilationMode(strategy: unknown, experimentalParallelCompletions: unknown): CompilationMode {
  if (
    strategy === "auto" ||
    strategy === "parallel" ||
    strategy === "sequential" ||
    strategy === "agentic" ||
    strategy === "agentic-methods"
  ) {
    return strategy;
  }

  return experimentalParallelCompletions === true ? "parallel" : "sequential";
}

export type InteractiveRunWireStatus = InteractiveRunStatus;

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
