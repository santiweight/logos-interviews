import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  createObjectStorageClient,
  objectStorageConfig,
  type ObjectStorageConfig,
} from "./objectStorage";

type CaptureKind = "session-events" | "feedback";

type CaptureObjectStorageConfig = ObjectStorageConfig & {
  prefix: string;
};

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
