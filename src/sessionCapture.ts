import type { IncomingMessage, ServerResponse } from "node:http";
import { writeSessionCaptureRecords } from "./captureStorage";

type SessionCapturePayload = {
  sessionId?: unknown;
  events?: unknown;
};

const maxBodyBytes = 10_000_000;
const maxEventsPerRequest = 100;

export async function handleSessionEvents(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJson(req);
    const records = normalizePayload(payload, req);
    await writeSessionCaptureRecords(records);
    sendJson(res, 200, { ok: true, captured: records.length });
  } catch (error) {
    const statusCode = error instanceof SessionCaptureError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, statusCode, { ok: false, error: message });
  }
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
    event: sanitizeJson(event),
  }));
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 2_000_000 ? `${value.slice(0, 2_000_000)}...[truncated]` : value;
  }

  if (depth >= 20) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeJson(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.length > 200) {
        continue;
      }

      result[key] = sanitizeJson(child, depth + 1);
    }

    return result;
  }

  return String(value);
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
