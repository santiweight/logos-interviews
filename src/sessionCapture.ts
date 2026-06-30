import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import {
  listSessionCaptureSummariesWithLimit,
  readSessionCaptureRecords,
  writeSessionCaptureRecords,
} from "./captureStorage";

type SessionCapturePayload = {
  sessionId?: unknown;
  events?: unknown;
};

const maxBodyBytes = 10_000_000;
const maxEventsPerRequest = 100;
const sessionListCacheTtlMs = 10_000;
let sessionListCache: {
  limit: number;
  expiresAt: number;
  sessions: Awaited<ReturnType<typeof listSessionCaptureSummariesWithLimit>>;
} | null = null;

export async function handleSessionEvents(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sessionId = sessionIdFromPath(url.pathname);

    if (req.method === "POST" && sessionId === null) {
      const payload = await readJson(req);
      const records = normalizePayload(payload, req);
      await writeSessionCaptureRecords(records);
      sendJson(req, res, 200, { ok: true, captured: records.length });
      return;
    }

    if (req.method === "GET" && sessionId !== null) {
      await readSessionEvents(req, sessionId, res);
      return;
    }

    if (req.method === "GET" && sessionId === null) {
      await listSessionEvents(req, url, res);
      return;
    }

    sendJson(req, res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    const statusCode = error instanceof SessionCaptureError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(req, res, statusCode, { ok: false, error: message });
  }
}

async function listSessionEvents(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  if (process.env.SESSION_CAPTURE_READ_ENABLED !== "true") {
    throw new SessionCaptureError(404, "Session capture replay is not enabled");
  }

  const limit = boundedInteger(url.searchParams.get("limit"), 1, 100, 50);
  const refresh = url.searchParams.get("refresh") === "1";
  const now = Date.now();
  const sessions = !refresh && sessionListCache && sessionListCache.limit === limit && sessionListCache.expiresAt > now
    ? sessionListCache.sessions
    : await listSessionCaptureSummariesWithLimit(limit);
  sessionListCache = {
    limit,
    expiresAt: now + sessionListCacheTtlMs,
    sessions,
  };

  sendJson(req, res, 200, {
    ok: true,
    sessions,
  });
}

function boundedInteger(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

async function readSessionEvents(req: IncomingMessage, sessionId: string, res: ServerResponse): Promise<void> {
  if (process.env.SESSION_CAPTURE_READ_ENABLED !== "true") {
    throw new SessionCaptureError(404, "Session capture replay is not enabled");
  }

  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(sessionId)) {
    throw new SessionCaptureError(404, "Session capture not found");
  }

  const records = await readSessionCaptureRecords(sessionId);
  const replayEvents = replayEventsFromRecords(records);
  sendJson(req, res, 200, {
    ok: true,
    sessionId,
    records: traceRecordsFromRecords(records),
    replayEvents,
  });
}

class SessionCaptureError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<SessionCapturePayload> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > maxBodyBytes) {
      throw new SessionCaptureError(413, "Session capture payload is too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    throw new SessionCaptureError(400, "Missing session capture payload");
  }

  return JSON.parse(raw) as SessionCapturePayload;
}

function normalizePayload(
  payload: SessionCapturePayload,
  req: IncomingMessage,
): Array<Record<string, unknown>> {
  if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
    throw new SessionCaptureError(400, "Missing session id");
  }

  if (!Array.isArray(payload.events)) {
    throw new SessionCaptureError(400, "Missing session events");
  }

  if (payload.events.length > maxEventsPerRequest) {
    throw new SessionCaptureError(413, "Too many session events in one request");
  }

  return payload.events.map((event) => ({
    receivedAt: new Date().toISOString(),
    sessionId: payload.sessionId,
    request: {
      userAgent: req.headers["user-agent"] ?? null,
      forwardedFor: req.headers["x-forwarded-for"] ?? null,
      remoteAddress: req.socket.remoteAddress ?? null,
    },
    event: sanitizeCaptureEvent(event),
  }));
}

function sessionIdFromPath(pathname: string): string | null {
  const normalized = pathname.replace(/^\/api\/session-events\/?/, "/");
  if (normalized === "/" || normalized === "") {
    return null;
  }

  const sessionId = decodeURIComponent(normalized.replace(/^\//, "").split("/")[0] ?? "");
  return sessionId.length > 0 ? sessionId : null;
}

function replayEventsFromRecords(records: Array<Record<string, unknown>>): unknown[] {
  const replayEvents: unknown[] = [];

  for (const record of records) {
    const event = record.event;
    if (!isJsonObject(event) || event.type !== "dom_replay" || !isJsonObject(event.details)) {
      continue;
    }

    replayEvents.push(event.details.event ?? null);
  }

  return replayEvents.filter((event) => event !== null);
}

function traceRecordsFromRecords(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.map((record) => {
    const event = record.event;
    if (!isJsonObject(event) || event.type !== "dom_replay") {
      return record;
    }

    return {
      ...record,
      event: {
        ...event,
        details: {
          schema: isJsonObject(event.details) ? event.details.schema ?? null : null,
          checkout: isJsonObject(event.details) ? event.details.checkout ?? null : null,
        },
      },
    };
  });
}

function sanitizeCaptureEvent(event: unknown): unknown {
  const maxDepth = isJsonObject(event) && event.type === "dom_replay" ? 120 : 20;
  const maxArrayLength = isJsonObject(event) && event.type === "dom_replay" ? 20_000 : 500;
  return sanitizeJson(event, { maxDepth, maxArrayLength });
}

function sanitizeJson(
  value: unknown,
  options: { maxDepth: number; maxArrayLength: number },
  depth = 0,
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 2_000_000 ? `${value.slice(0, 2_000_000)}...[truncated]` : value;
  }

  if (depth >= options.maxDepth) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArrayLength)
      .map((item) => sanitizeJson(item, options, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.length > 200) {
        continue;
      }

      result[key] = sanitizeJson(child, options, depth + 1);
    }

    return result;
  }

  return String(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  if (body.length > 1_024 && acceptsGzip(req)) {
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.end(gzipSync(body));
    return;
  }

  res.end(body);
}

function acceptsGzip(req: IncomingMessage): boolean {
  const encoding = req.headers["accept-encoding"];
  return typeof encoding === "string" && /\bgzip\b/i.test(encoding);
}
