import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  createObjectStorageClient,
  objectStorageConfig,
  type ObjectStorageConfig,
} from "./objectStorage";

type CaptureKind = "session-events" | "feedback";

type CaptureObjectStorageConfig = ObjectStorageConfig & {
  prefix: string;
};

const maxReadSessionRecords = 20_000;

export async function writeSessionCaptureRecords(
  records: Array<Record<string, unknown>>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const body = records.map((record) => JSON.stringify(record)).join("\n");
  const storageConfig = captureObjectStorageConfig("session-events");
  if (storageConfig) {
    await putCaptureObject(storageConfig, `${body}\n`, "application/x-ndjson");
    return;
  }

  const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
  await mkdir(logDir, { recursive: true });
  await appendFile(resolve(logDir, "session-events.jsonl"), `${body}\n`, "utf8");
}

export async function readSessionCaptureRecords(
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const storageConfig = captureObjectStorageConfig("session-events");
  const records = storageConfig
    ? await readObjectStorageSessionCaptureRecords(storageConfig, sessionId)
    : await readFileSessionCaptureRecords(sessionId);

  return records
    .sort(compareCaptureRecords)
    .slice(0, maxReadSessionRecords);
}

export async function writeFeedbackCaptureRecord(
  record: Record<string, unknown>,
): Promise<void> {
  const body = `${JSON.stringify(record)}\n`;
  const storageConfig = captureObjectStorageConfig("feedback");
  if (storageConfig) {
    await putCaptureObject(storageConfig, body, "application/x-ndjson");
    return;
  }

  const logDir = resolve(
    process.env.FEEDBACK_CAPTURE_DIR ??
      process.env.SESSION_CAPTURE_DIR ??
      "logs",
  );
  await mkdir(logDir, { recursive: true });
  await appendFile(resolve(logDir, "feedback.jsonl"), body, "utf8");
}

function captureObjectStorageConfig(kind: CaptureKind): CaptureObjectStorageConfig | null {
  const config = objectStorageConfig();
  if (!config) {
    return null;
  }

  return {
    ...config,
    prefix: captureObjectPrefix(kind),
  };
}

function captureObjectPrefix(kind: CaptureKind): string {
  const basePrefix = "session-capture";
  if (kind === "feedback") {
    return joinPrefix(basePrefix, "feedback");
  }

  return joinPrefix(basePrefix, "session-events");
}

async function putCaptureObject(
  config: CaptureObjectStorageConfig,
  body: string,
  contentType: string,
): Promise<void> {
  const client = createObjectStorageClient(config);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: captureObjectKey(config.prefix),
    Body: body,
    ContentType: contentType,
  }));
}

async function readFileSessionCaptureRecords(
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
  let raw: string;
  try {
    raw = await readFile(resolve(logDir, "session-events.jsonl"), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  return recordsForSession(raw, sessionId);
}

async function readObjectStorageSessionCaptureRecords(
  config: CaptureObjectStorageConfig,
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const client = createObjectStorageClient(config);
  const records: Array<Record<string, unknown>> = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: config.prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents ?? []) {
      if (!object.Key || records.length >= maxReadSessionRecords) {
        continue;
      }

      const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: object.Key,
      }));
      records.push(...recordsForSession(await bodyToString(response.Body), sessionId));

      if (records.length >= maxReadSessionRecords) {
        break;
      }
    }

    continuationToken = records.length >= maxReadSessionRecords
      ? undefined
      : page.NextContinuationToken;
  } while (continuationToken);

  return records;
}

function recordsForSession(raw: string, sessionId: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.sessionId === sessionId) {
      records.push(record);
    }
  }

  return records;
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

  throw new Error("Capture response body is unreadable");
}

function compareCaptureRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftEventTime = captureRecordEventTimestamp(left);
  const rightEventTime = captureRecordEventTimestamp(right);
  if (leftEventTime !== null && rightEventTime !== null && leftEventTime !== rightEventTime) {
    return leftEventTime - rightEventTime;
  }

  const leftSeq = captureRecordSeq(left);
  const rightSeq = captureRecordSeq(right);
  if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  const leftTime = captureRecordTimestamp(left);
  const rightTime = captureRecordTimestamp(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return (leftSeq ?? 0) - (rightSeq ?? 0);
}

function captureRecordEventTimestamp(record: Record<string, unknown>): number | null {
  const event = record.event;
  if (typeof event === "object" && event !== null && "occurredAt" in event) {
    const occurredAt = (event as { occurredAt?: unknown }).occurredAt;
    if (typeof occurredAt === "string") {
      return Date.parse(occurredAt) || null;
    }
  }

  return null;
}

function captureRecordTimestamp(record: Record<string, unknown>): number {
  return typeof record.receivedAt === "string" ? Date.parse(record.receivedAt) || 0 : 0;
}

function captureRecordSeq(record: Record<string, unknown>): number | null {
  const event = record.event;
  if (typeof event === "object" && event !== null && "seq" in event) {
    const seq = (event as { seq?: unknown }).seq;
    return typeof seq === "number" ? seq : null;
  }

  return null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

function captureObjectKey(prefix: string): string {
  const now = new Date();
  const datePrefix = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
  ].join("/");
  const filename = `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.jsonl`;
  return joinPrefix(prefix, datePrefix, filename);
}

function joinPrefix(...parts: string[]): string {
  return parts.map(trimSlashes).filter((part) => part.length > 0).join("/");
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
