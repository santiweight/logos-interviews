import { mkdir, appendFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

type FeedbackPayload = {
  sessionId?: unknown;
  panel?: unknown;
  rating?: unknown;
  url?: unknown;
  loadableSession?: unknown;
  state?: unknown;
};

const maxBodyBytes = 12_000_000;

export async function handleFeedback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJson(req);
    const record = normalizePayload(payload, req);
    await writeFeedbackRecord(record);
    sendJson(res, 200, { ok: true, feedbackId: record.feedbackId });
  } catch (error) {
    const statusCode = error instanceof FeedbackCaptureError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, statusCode, { ok: false, error: message });
  }
}

class FeedbackCaptureError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<FeedbackPayload> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > maxBodyBytes) {
      throw new FeedbackCaptureError(413, "Feedback payload is too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    throw new FeedbackCaptureError(400, "Missing feedback payload");
  }

  return JSON.parse(raw) as FeedbackPayload;
}

function normalizePayload(
  payload: FeedbackPayload,
  req: IncomingMessage,
): Record<string, unknown> & { feedbackId: string } {
  if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
    throw new FeedbackCaptureError(400, "Missing session id");
  }

  if (typeof payload.panel !== "string" || payload.panel.length === 0) {
    throw new FeedbackCaptureError(400, "Missing panel");
  }

  if (payload.rating !== "up" && payload.rating !== "down") {
    throw new FeedbackCaptureError(400, "Missing rating");
  }

  return {
    feedbackId: randomUUID(),
    receivedAt: new Date().toISOString(),
    sessionId: payload.sessionId,
    panel: payload.panel,
    rating: payload.rating,
    url: typeof payload.url === "string" ? payload.url : null,
    loadableSession: sanitizeJson(payload.loadableSession),
    request: {
      userAgent: req.headers["user-agent"] ?? null,
      forwardedFor: req.headers["x-forwarded-for"] ?? null,
      remoteAddress: req.socket.remoteAddress ?? null,
    },
    state: sanitizeJson(payload.state),
  };
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 2_000_000 ? `${value.slice(0, 2_000_000)}...[truncated]` : value;
  }

  if (depth >= 24) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 1000).map((item) => sanitizeJson(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.length > 240) {
        continue;
      }

      result[key] = sanitizeJson(child, depth + 1);
    }

    return result;
  }

  return String(value);
}

async function writeFeedbackRecord(record: Record<string, unknown>): Promise<void> {
  const logDir = resolve(
    process.env.FEEDBACK_CAPTURE_DIR ??
      process.env.SESSION_CAPTURE_DIR ??
      "logs",
  );
  await mkdir(logDir, { recursive: true });
  await appendFile(resolve(logDir, "feedback.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
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
