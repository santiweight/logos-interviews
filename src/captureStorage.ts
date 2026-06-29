import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type CaptureKind = "session-events" | "feedback";

type CaptureS3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  prefix: string;
};

export async function writeSessionCaptureRecords(
  records: Array<Record<string, unknown>>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const body = records.map((record) => JSON.stringify(record)).join("\n");
  const s3Config = captureS3Config("session-events");
  if (s3Config) {
    await putCaptureObject(s3Config, `${body}\n`, "application/x-ndjson");
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
  const s3Config = captureS3Config("feedback");
  if (s3Config) {
    await putCaptureObject(s3Config, body, "application/x-ndjson");
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

function captureS3Config(kind: CaptureKind): CaptureS3Config | null {
  const bucket = kind === "feedback"
    ? process.env.FEEDBACK_CAPTURE_S3_BUCKET ??
      process.env.SESSION_CAPTURE_S3_BUCKET ??
      process.env.CAPTURE_S3_BUCKET ??
      process.env.BUCKET_NAME
    : process.env.SESSION_CAPTURE_S3_BUCKET ??
      process.env.CAPTURE_S3_BUCKET ??
      process.env.BUCKET_NAME;

  if (!bucket) {
    return null;
  }

  return {
    bucket,
    region: envForKind(kind, "REGION") ?? process.env.AWS_REGION ?? "auto",
    endpoint: envForKind(kind, "ENDPOINT"),
    forcePathStyle: envForKind(kind, "FORCE_PATH_STYLE") === "true",
    prefix: captureS3Prefix(kind),
  };
}

function envForKind(kind: CaptureKind, suffix: string): string | undefined {
  const awsSdkEndpoint = suffix === "ENDPOINT" ? process.env.AWS_ENDPOINT_URL_S3 : undefined;
  if (kind === "feedback") {
    return process.env[`FEEDBACK_CAPTURE_S3_${suffix}`] ??
      process.env[`SESSION_CAPTURE_S3_${suffix}`] ??
      awsSdkEndpoint;
  }

  return process.env[`SESSION_CAPTURE_S3_${suffix}`] ?? awsSdkEndpoint;
}

function captureS3Prefix(kind: CaptureKind): string {
  const basePrefix = process.env.SESSION_CAPTURE_S3_PREFIX ?? "session-capture";
  if (kind === "feedback") {
    return trimSlashes(process.env.FEEDBACK_CAPTURE_S3_PREFIX ?? joinPrefix(basePrefix, "feedback"));
  }

  return trimSlashes(joinPrefix(basePrefix, "session-events"));
}

async function putCaptureObject(
  config: CaptureS3Config,
  body: string,
  contentType: string,
): Promise<void> {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });

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
