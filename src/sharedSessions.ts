import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { GetObjectCommand, NoSuchKey, PutObjectCommand } from "@aws-sdk/client-s3";
import { createObjectStorageClient, objectStorageConfig } from "./objectStorage";

type SharedSessionPayload = {
  loadableSession?: unknown;
};

type SharedSessionRecord = {
  shareId: string;
  createdAt: string;
  loadableSession: unknown;
};

type SharedSessionStore = {
  read: (shareId: string) => Promise<string>;
  write: (shareId: string, record: SharedSessionRecord) => Promise<void>;
};

const maxBodyBytes = 12_000_000;
const shareIdPattern = /^[a-zA-Z0-9_-]{8,80}$/;

export async function handleSharedSessions(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const shareId = shareIdFromPath(url.pathname);

    if (req.method === "POST" && shareId === null) {
      await createSharedSession(req, res);
      return;
    }

    if (req.method === "GET" && shareId !== null) {
      await readSharedSession(shareId, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    const statusCode = error instanceof SharedSessionError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, statusCode, { ok: false, error: message });
  }
}

class SharedSessionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function createSharedSession(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const payload = await readJson(req);
  if (!isJsonObject(payload.loadableSession)) {
    throw new SharedSessionError(400, "Missing loadable session");
  }

  const shareId = randomUUID();
  const record: SharedSessionRecord = {
    shareId,
    createdAt: new Date().toISOString(),
    loadableSession: sanitizeJson(payload.loadableSession),
  };

  await sharedSessionStore().write(shareId, record);
  sendJson(res, 200, { ok: true, shareId });
}

async function readSharedSession(shareId: string, res: ServerResponse): Promise<void> {
  if (!shareIdPattern.test(shareId)) {
    throw new SharedSessionError(404, "Shared session not found");
  }

  try {
    const raw = await sharedSessionStore().read(shareId);
    const record = JSON.parse(raw) as {
      shareId?: unknown;
      createdAt?: unknown;
      loadableSession?: unknown;
    };

    if (record.shareId !== shareId || !isJsonObject(record.loadableSession)) {
      throw new SharedSessionError(500, "Shared session is invalid");
    }

    sendJson(res, 200, {
      ok: true,
      shareId,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      loadableSession: record.loadableSession,
    });
  } catch (error) {
    if (error instanceof SharedSessionError) {
      throw error;
    }

    if (isMissingSharedSessionError(error)) {
      throw new SharedSessionError(404, "Shared session not found");
    }

    throw error;
  }
}

async function readJson(req: IncomingMessage): Promise<SharedSessionPayload> {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > maxBodyBytes) {
      throw new SharedSessionError(413, "Shared session payload is too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    throw new SharedSessionError(400, "Missing shared session payload");
  }

  return JSON.parse(raw) as SharedSessionPayload;
}

function shareIdFromPath(pathname: string): string | null {
  const normalized = pathname.replace(/^\/api\/shared-sessions\/?/, "/");
  if (normalized === "/" || normalized === "") {
    return null;
  }

  const shareId = decodeURIComponent(normalized.replace(/^\//, "").split("/")[0] ?? "");
  return shareId.length > 0 ? shareId : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function sharedSessionStore(): SharedSessionStore {
  const storageConfig = objectStorageConfig();
  if (storageConfig) {
    return s3SharedSessionStore(storageConfig);
  }

  return fileSharedSessionStore();
}

function fileSharedSessionStore(): SharedSessionStore {
  return {
    async read(shareId) {
      return await readFile(sharedSessionPath(shareId), "utf8");
    },
    async write(shareId, record) {
      const dir = sharedSessionDir();
      await mkdir(dir, { recursive: true });
      await writeFile(sharedSessionPath(shareId), JSON.stringify(record), "utf8");
    },
  };
}

function s3SharedSessionStore(config: NonNullable<ReturnType<typeof objectStorageConfig>>): SharedSessionStore {
  const client = createObjectStorageClient(config);

  return {
    async read(shareId) {
      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: sharedSessionObjectKey(shareId),
      }));
      return await bodyToString(response.Body);
    },
    async write(shareId, record) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: sharedSessionObjectKey(shareId),
        Body: JSON.stringify(record),
        ContentType: "application/json",
      }));
    },
  };
}

function sharedSessionObjectKey(shareId: string): string {
  return `shared-sessions/${shareId}.json`;
}

async function bodyToString(body: unknown): Promise<string> {
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return await body.transformToString();
  }

  throw new SharedSessionError(500, "Shared session response body is unreadable");
}

function isMissingSharedSessionError(error: unknown): boolean {
  if (error instanceof NoSuchKey) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : null;
  const name = "name" in error ? (error as { name?: unknown }).name : null;
  return code === "ENOENT" || name === "NoSuchKey" || name === "NotFound";
}

function sharedSessionPath(shareId: string): string {
  return resolve(sharedSessionDir(), `${shareId}.json`);
}

function sharedSessionDir(): string {
  return resolve(
    process.env.SHARED_SESSION_DIR ??
      process.env.SESSION_CAPTURE_DIR ??
      "logs/shared-sessions",
  );
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
