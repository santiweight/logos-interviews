import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  createObjectStorageClient,
  objectStorageConfig,
  type ObjectStorageConfig,
} from "./objectStorage";

type CaptureKind = "session-events" | "session-index";

type CaptureObjectStorageConfig = ObjectStorageConfig & {
  prefix: string;
};

const maxReadSessionRecords = 20_000;
const maxListSessionRecords = 25_000;
const maxListSessionLogBytes = 8_000_000;
const maxListCaptureObjects = 40;
const maxListIndexObjects = 200;
const maxListIndexLogBytes = 2_000_000;
const defaultMaxSessionSummaries = 100;

export type SessionCaptureSummary = {
  sessionId: string;
  firstAt: string | null;
  lastAt: string | null;
  durationMs: number | null;
  records: number;
  replayEvents: number;
  activeWithin5Minutes: boolean;
  url: string | null;
  referrer: string | null;
  browser: {
    userAgent: string | null;
    platform: string | null;
    language: string | null;
    timezone: string | null;
    timezoneOffsetMinutes: number | null;
    localTime: string | null;
    deviceType: string | null;
    touchCapable: boolean | null;
    viewport: unknown;
    screen: unknown;
    connection: unknown;
  };
  request: {
    forwardedFor: string | null;
    remoteAddress: string | null;
  };
  attribution: {
    utm: unknown;
    identity: unknown;
    searchKeys: string[];
  };
  eventTypes: Array<{ type: string; count: number }>;
};

type SessionCaptureIndexRecord = {
  indexedAt: string;
  eventObjectKey?: string;
  summary: SessionCaptureSummary;
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
    const eventObjectKey = await putCaptureObject(storageConfig, `${body}\n`, "application/x-ndjson");
    await writeSessionCaptureIndexRecords(records, eventObjectKey);
    return;
  }

  const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
  await mkdir(logDir, { recursive: true });
  await appendFile(resolve(logDir, "session-events.jsonl"), `${body}\n`, "utf8");
  await writeSessionCaptureIndexRecords(records);
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

export async function listSessionCaptureSummaries(): Promise<SessionCaptureSummary[]> {
  return listSessionCaptureSummariesWithLimit(defaultMaxSessionSummaries);
}

export async function listSessionCaptureSummariesWithLimit(
  maxSessions: number,
): Promise<SessionCaptureSummary[]> {
  const indexedSummaries = await readSessionCaptureIndexSummaries();
  if (indexedSummaries.length > 0) {
    return mergeSessionCaptureSummaries(indexedSummaries).slice(0, maxSessions);
  }

  const storageConfig = captureObjectStorageConfig("session-events");
  const records = storageConfig
    ? await readObjectStorageCaptureRecords(storageConfig, maxListSessionRecords)
    : await readFileCaptureRecords(maxListSessionRecords);

  return summarizeSessionCaptureRecords(records).slice(0, maxSessions);
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
  if (kind === "session-index") {
    return joinPrefix(basePrefix, "session-index");
  }

  return joinPrefix(basePrefix, "session-events");
}

async function putCaptureObject(
  config: CaptureObjectStorageConfig,
  body: string,
  contentType: string,
): Promise<string> {
  const client = createObjectStorageClient(config);
  const key = captureObjectKey(config.prefix);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return key;
}

async function writeSessionCaptureIndexRecords(
  records: Array<Record<string, unknown>>,
  eventObjectKey?: string,
): Promise<void> {
  const summaries = summarizeSessionCaptureRecords(records);
  if (summaries.length === 0) {
    return;
  }

  const indexedAt = new Date().toISOString();
  const body = summaries
    .map((summary) => JSON.stringify({ indexedAt, eventObjectKey, summary }))
    .join("\n");
  const storageConfig = captureObjectStorageConfig("session-index");

  try {
    if (storageConfig) {
      await putCaptureObject(storageConfig, `${body}\n`, "application/x-ndjson");
      return;
    }

    const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
    await mkdir(logDir, { recursive: true });
    await appendFile(resolve(logDir, "session-index.jsonl"), `${body}\n`, "utf8");
  } catch (error) {
    console.error("Session capture index write failed", error);
  }
}

async function readSessionCaptureIndexSummaries(): Promise<SessionCaptureSummary[]> {
  return (await readSessionCaptureIndexRecords())
    .map((record) => record.summary)
    .filter((summary): summary is SessionCaptureSummary => summary !== null);
}

async function readSessionCaptureIndexRecords(): Promise<SessionCaptureIndexRecord[]> {
  const storageConfig = captureObjectStorageConfig("session-index");
  const rawRecords = storageConfig
    ? await readObjectStorageIndexRecords(storageConfig)
    : parseCaptureRecords(await readFileCaptureIndexLog(maxListIndexLogBytes));

  return preferKeyedIndexRecords(rawRecords
    .map(sessionCaptureIndexRecordFromUnknown)
    .filter((record): record is SessionCaptureIndexRecord => record !== null));
}

function preferKeyedIndexRecords(records: SessionCaptureIndexRecord[]): SessionCaptureIndexRecord[] {
  const sessionsWithKeyedRecords = new Set(
    records
      .filter((record) => record.eventObjectKey)
      .map((record) => record.summary.sessionId),
  );

  return records.filter((record) => {
    return record.eventObjectKey || !sessionsWithKeyedRecords.has(record.summary.sessionId);
  });
}

function sessionCaptureIndexRecordFromUnknown(record: Record<string, unknown>): SessionCaptureIndexRecord | null {
  const summary = sessionSummaryFromUnknown(isRecord(record.summary) ? record.summary : record);
  if (!summary) {
    return null;
  }

  return {
    indexedAt: stringValue(record.indexedAt) ?? summary.lastAt ?? summary.firstAt ?? "",
    eventObjectKey: stringValue(record.eventObjectKey) ?? undefined,
    summary,
  };
}

type SessionCaptureLookup = {
  keys: string[];
  expectedRecords: number;
};

async function readSessionCaptureLookup(sessionId: string): Promise<SessionCaptureLookup> {
  const records = await readSessionCaptureIndexRecords();
  const keys = new Set<string>();
  const summaries: SessionCaptureSummary[] = [];

  records
    .filter((record) => record.summary.sessionId === sessionId)
    .sort((left, right) => left.indexedAt.localeCompare(right.indexedAt))
    .forEach((record) => {
      summaries.push(record.summary);
      if (record.eventObjectKey) {
        keys.add(record.eventObjectKey);
      }
    });

  return {
    keys: [...keys],
    expectedRecords: mergeSessionCaptureSummaries(summaries)[0]?.records ?? 0,
  };
}

async function readFileCaptureIndexLog(maxBytes: number): Promise<string> {
  const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
  const filePath = resolve(logDir, "session-index.jsonl");
  try {
    const info = await stat(filePath);
    const start = Math.max(0, info.size - maxBytes);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    const file = await open(filePath, "r");
    try {
      await file.read(buffer, 0, length, start);
    } finally {
      await file.close();
    }

    const raw = buffer.toString("utf8");
    if (start === 0) {
      return raw;
    }

    const firstLineEnd = raw.indexOf("\n");
    return firstLineEnd === -1 ? "" : raw.slice(firstLineEnd + 1);
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }

    throw error;
  }
}

async function readObjectStorageIndexRecords(
  config: CaptureObjectStorageConfig,
): Promise<Array<Record<string, unknown>>> {
  const client = createObjectStorageClient(config);
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: config.prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  const records: Array<Record<string, unknown>> = [];
  for (const key of keys.sort().reverse().slice(0, maxListIndexObjects)) {
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    records.push(...parseCaptureRecords(await bodyToString(response.Body)));
  }

  return records;
}

async function readFileSessionCaptureRecords(
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  return recordsForSession(await readFileCaptureLog(), sessionId);
}

async function readFileCaptureRecords(maxRecords: number): Promise<Array<Record<string, unknown>>> {
  return parseCaptureRecords(await readFileCaptureLog(maxListSessionLogBytes)).slice(-maxRecords);
}

async function readFileCaptureLog(maxBytes?: number): Promise<string> {
  const logDir = resolve(process.env.SESSION_CAPTURE_DIR ?? "logs");
  const filePath = resolve(logDir, "session-events.jsonl");
  try {
    if (maxBytes === undefined) {
      return await readFile(filePath, "utf8");
    }

    const info = await stat(filePath);
    const start = Math.max(0, info.size - maxBytes);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    const file = await open(filePath, "r");
    try {
      await file.read(buffer, 0, length, start);
    } finally {
      await file.close();
    }

    const raw = buffer.toString("utf8");
    if (start === 0) {
      return raw;
    }

    const firstLineEnd = raw.indexOf("\n");
    return firstLineEnd === -1 ? "" : raw.slice(firstLineEnd + 1);
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }

    throw error;
  }
}

async function readObjectStorageCaptureRecords(
  config: CaptureObjectStorageConfig,
  maxRecords: number,
): Promise<Array<Record<string, unknown>>> {
  const client = createObjectStorageClient(config);
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: config.prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  const records: Array<Record<string, unknown>> = [];
  for (const key of keys.sort().reverse().slice(0, maxListCaptureObjects)) {
    if (records.length >= maxRecords) {
      break;
    }

    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    records.push(...parseCaptureRecords(await bodyToString(response.Body)));
  }

  return records.slice(0, maxRecords);
}

async function readObjectStorageSessionCaptureRecords(
  config: CaptureObjectStorageConfig,
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const lookup = await readSessionCaptureLookup(sessionId);
  if (lookup.keys.length > 0) {
    const records = await readObjectStorageSessionCaptureRecordsByKeys(config, sessionId, lookup.keys);
    if (lookup.expectedRecords === 0 || records.length >= Math.min(lookup.expectedRecords, maxReadSessionRecords)) {
      return records;
    }

    const legacyRecords = await readObjectStorageSessionCaptureRecordsByRecentScan(
      config,
      sessionId,
      new Set(lookup.keys),
    );
    return mergeCaptureRecords(records, legacyRecords);
  }

  return readObjectStorageSessionCaptureRecordsByRecentScan(config, sessionId);
}

async function readObjectStorageSessionCaptureRecordsByRecentScan(
  config: CaptureObjectStorageConfig,
  sessionId: string,
  skipKeys = new Set<string>(),
): Promise<Array<Record<string, unknown>>> {
  const client = createObjectStorageClient(config);
  const records: Array<Record<string, unknown>> = [];
  let continuationToken: string | undefined;
  const keys: string[] = [];

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: config.prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  for (const key of keys.sort().reverse().filter((key) => !skipKeys.has(key)).slice(0, maxListCaptureObjects)) {
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    records.push(...recordsForSession(await bodyToString(response.Body), sessionId));

    if (records.length >= maxReadSessionRecords) {
      break;
    }
  }

  return records;
}

function mergeCaptureRecords(
  ...groups: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const records: Array<Record<string, unknown>> = [];

  for (const group of groups) {
    for (const record of group) {
      const key = captureRecordIdentity(record);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      records.push(record);
    }
  }

  return records;
}

function captureRecordIdentity(record: Record<string, unknown>): string {
  const event = isRecord(record.event) ? record.event : {};
  return [
    record.sessionId,
    event.seq,
    event.type,
    event.occurredAt,
    record.receivedAt,
  ].map((part) => String(part ?? "")).join("|");
}

async function readObjectStorageSessionCaptureRecordsByKeys(
  config: CaptureObjectStorageConfig,
  sessionId: string,
  keys: string[],
): Promise<Array<Record<string, unknown>>> {
  const client = createObjectStorageClient(config);
  const records: Array<Record<string, unknown>> = [];

  for (const key of keys) {
    if (records.length >= maxReadSessionRecords) {
      break;
    }

    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
    records.push(...recordsForSession(await bodyToString(response.Body), sessionId));
  }

  return records;
}

function recordsForSession(raw: string, sessionId: string): Array<Record<string, unknown>> {
  return parseCaptureRecords(raw).filter((record) => record.sessionId === sessionId);
}

function parseCaptureRecords(raw: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      records.push(record);
    } catch {
      continue;
    }
  }

  return records;
}

function summarizeSessionCaptureRecords(
  records: Array<Record<string, unknown>>,
): SessionCaptureSummary[] {
  const now = Date.now();
  const summaries = new Map<string, SessionSummaryAccumulator>();

  for (const record of records) {
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (!sessionId) {
      continue;
    }

    const event = isRecord(record.event) ? record.event : {};
    const request = isRecord(record.request) ? record.request : {};
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    const occurredAt = eventTime(event, record);
    const summary = summaries.get(sessionId) ?? emptySummary(sessionId);

    summary.records += 1;
    if (eventType === "dom_replay") {
      summary.replayEvents += 1;
    }
    summary.eventTypes.set(eventType, (summary.eventTypes.get(eventType) ?? 0) + 1);

    if (occurredAt !== null) {
      if (summary.firstMs === null || occurredAt < summary.firstMs) {
        summary.firstMs = occurredAt;
        summary.firstAt = new Date(occurredAt).toISOString();
      }
      if (summary.lastMs === null || occurredAt > summary.lastMs) {
        summary.lastMs = occurredAt;
        summary.lastAt = new Date(occurredAt).toISOString();
      }
    }

    summary.request.forwardedFor ??= stringValue(request.forwardedFor);
    summary.request.remoteAddress ??= stringValue(request.remoteAddress);
    applyEventMetadata(summary, event);
    summaries.set(sessionId, summary);
  }

  return [...summaries.values()]
    .sort((left, right) => (right.lastMs ?? 0) - (left.lastMs ?? 0))
    .map((summary) => ({
      sessionId: summary.sessionId,
      firstAt: summary.firstAt,
      lastAt: summary.lastAt,
      durationMs: summary.firstMs !== null && summary.lastMs !== null
        ? summary.lastMs - summary.firstMs
        : null,
      records: summary.records,
      replayEvents: summary.replayEvents,
      activeWithin5Minutes: summary.lastMs !== null && now - summary.lastMs < 5 * 60_000,
      url: summary.url,
      referrer: summary.referrer,
      browser: summary.browser,
      request: summary.request,
      attribution: summary.attribution,
      eventTypes: [...summary.eventTypes.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([type, count]) => ({ type, count })),
    }));
}

function mergeSessionCaptureSummaries(summaries: SessionCaptureSummary[]): SessionCaptureSummary[] {
  const now = Date.now();
  const merged = new Map<string, SessionSummaryAccumulator>();

  for (const summary of summaries) {
    const accumulator = merged.get(summary.sessionId) ?? emptySummary(summary.sessionId);
    accumulator.records += summary.records;
    accumulator.replayEvents += summary.replayEvents;

    const firstMs = summary.firstAt ? Date.parse(summary.firstAt) : NaN;
    if (Number.isFinite(firstMs) && (accumulator.firstMs === null || firstMs < accumulator.firstMs)) {
      accumulator.firstMs = firstMs;
      accumulator.firstAt = new Date(firstMs).toISOString();
    }

    const lastMs = summary.lastAt ? Date.parse(summary.lastAt) : NaN;
    if (Number.isFinite(lastMs) && (accumulator.lastMs === null || lastMs > accumulator.lastMs)) {
      accumulator.lastMs = lastMs;
      accumulator.lastAt = new Date(lastMs).toISOString();
    }

    accumulator.url ??= summary.url;
    accumulator.referrer ??= summary.referrer;
    accumulator.browser.userAgent ??= summary.browser.userAgent;
    accumulator.browser.platform ??= summary.browser.platform;
    accumulator.browser.language ??= summary.browser.language;
    accumulator.browser.timezone ??= summary.browser.timezone;
    accumulator.browser.timezoneOffsetMinutes ??= summary.browser.timezoneOffsetMinutes;
    accumulator.browser.localTime ??= summary.browser.localTime;
    accumulator.browser.deviceType ??= summary.browser.deviceType;
    accumulator.browser.touchCapable ??= summary.browser.touchCapable;
    accumulator.browser.viewport ??= summary.browser.viewport;
    accumulator.browser.screen ??= summary.browser.screen;
    accumulator.browser.connection ??= summary.browser.connection;
    accumulator.request.forwardedFor ??= summary.request.forwardedFor;
    accumulator.request.remoteAddress ??= summary.request.remoteAddress;
    accumulator.attribution.utm ??= summary.attribution.utm;
    accumulator.attribution.identity ??= summary.attribution.identity;
    if (accumulator.attribution.searchKeys.length === 0 && summary.attribution.searchKeys.length > 0) {
      accumulator.attribution.searchKeys = summary.attribution.searchKeys;
    }

    for (const eventType of summary.eventTypes) {
      accumulator.eventTypes.set(
        eventType.type,
        (accumulator.eventTypes.get(eventType.type) ?? 0) + eventType.count,
      );
    }

    merged.set(summary.sessionId, accumulator);
  }

  return [...merged.values()]
    .sort((left, right) => (right.lastMs ?? 0) - (left.lastMs ?? 0))
    .map((summary) => ({
      sessionId: summary.sessionId,
      firstAt: summary.firstAt,
      lastAt: summary.lastAt,
      durationMs: summary.firstMs !== null && summary.lastMs !== null
        ? summary.lastMs - summary.firstMs
        : null,
      records: summary.records,
      replayEvents: summary.replayEvents,
      activeWithin5Minutes: summary.lastMs !== null && now - summary.lastMs < 5 * 60_000,
      url: summary.url,
      referrer: summary.referrer,
      browser: summary.browser,
      request: summary.request,
      attribution: summary.attribution,
      eventTypes: [...summary.eventTypes.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([type, count]) => ({ type, count })),
    }));
}

function sessionSummaryFromUnknown(value: Record<string, unknown>): SessionCaptureSummary | null {
  if (typeof value.sessionId !== "string") {
    return null;
  }

  const browser = isRecord(value.browser) ? value.browser : {};
  const request = isRecord(value.request) ? value.request : {};
  const attribution = isRecord(value.attribution) ? value.attribution : {};
  const eventTypes = Array.isArray(value.eventTypes)
    ? value.eventTypes.flatMap((item): Array<{ type: string; count: number }> => {
        if (!isRecord(item) || typeof item.type !== "string" || typeof item.count !== "number") {
          return [];
        }

        return [{ type: item.type, count: item.count }];
      })
    : [];

  return {
    sessionId: value.sessionId,
    firstAt: stringValue(value.firstAt),
    lastAt: stringValue(value.lastAt),
    durationMs: numberValue(value.durationMs),
    records: numberValue(value.records) ?? 0,
    replayEvents: numberValue(value.replayEvents) ?? 0,
    activeWithin5Minutes: booleanValue(value.activeWithin5Minutes) ?? false,
    url: stringValue(value.url),
    referrer: stringValue(value.referrer),
    browser: {
      userAgent: stringValue(browser.userAgent),
      platform: stringValue(browser.platform),
      language: stringValue(browser.language),
      timezone: stringValue(browser.timezone),
      timezoneOffsetMinutes: numberValue(browser.timezoneOffsetMinutes),
      localTime: stringValue(browser.localTime),
      deviceType: stringValue(browser.deviceType),
      touchCapable: booleanValue(browser.touchCapable),
      viewport: browser.viewport ?? null,
      screen: browser.screen ?? null,
      connection: browser.connection ?? null,
    },
    request: {
      forwardedFor: stringValue(request.forwardedFor),
      remoteAddress: stringValue(request.remoteAddress),
    },
    attribution: {
      utm: attribution.utm ?? null,
      identity: attribution.identity ?? null,
      searchKeys: stringArray(attribution.searchKeys),
    },
    eventTypes,
  };
}

type SessionSummaryAccumulator = Omit<SessionCaptureSummary, "durationMs" | "activeWithin5Minutes" | "eventTypes"> & {
  firstMs: number | null;
  lastMs: number | null;
  eventTypes: Map<string, number>;
};

function emptySummary(sessionId: string): SessionSummaryAccumulator {
  return {
    sessionId,
    firstAt: null,
    lastAt: null,
    firstMs: null,
    lastMs: null,
    records: 0,
    replayEvents: 0,
    url: null,
    referrer: null,
    browser: {
      userAgent: null,
      platform: null,
      language: null,
      timezone: null,
      timezoneOffsetMinutes: null,
      localTime: null,
      deviceType: null,
      touchCapable: null,
      viewport: null,
      screen: null,
      connection: null,
    },
    request: {
      forwardedFor: null,
      remoteAddress: null,
    },
    attribution: {
      utm: null,
      identity: null,
      searchKeys: [],
    },
    eventTypes: new Map(),
  };
}

function applyEventMetadata(summary: SessionSummaryAccumulator, event: Record<string, unknown>): void {
  if (typeof event.url === "string") {
    summary.url ??= event.url;
  }

  const details = isRecord(event.details) ? event.details : {};
  const state = isRecord(event.state) ? event.state : {};
  const browser = isRecord(details) ? details : {};
  const stateBrowser = isRecord(state.browser) ? state.browser : {};
  const attribution = isRecord(browser.attribution) ? browser.attribution : {};

  summary.url ??= stringValue(browser.url) ?? stringValue(attribution.url) ?? stringValue(stateBrowser.url);
  summary.referrer ??= stringValue(browser.referrer) ?? stringValue(attribution.referrer);
  summary.browser.userAgent ??= stringValue(browser.userAgent);
  summary.browser.platform ??= stringValue(browser.platform);
  summary.browser.language ??= stringValue(browser.language);
  summary.browser.timezone ??= stringValue(browser.timezone);
  summary.browser.timezoneOffsetMinutes ??= numberValue(browser.timezoneOffsetMinutes);
  summary.browser.localTime ??= stringValue(browser.localTime);
  summary.browser.deviceType ??= stringValue(browser.deviceType);
  summary.browser.touchCapable ??= booleanValue(browser.touchCapable);
  summary.browser.viewport ??= browser.viewport ?? stateBrowser.viewport ?? null;
  summary.browser.screen ??= browser.screen ?? null;
  summary.browser.connection ??= browser.connection ?? null;
  summary.attribution.utm ??= attribution.utm ?? null;
  summary.attribution.identity ??= attribution.identity ?? null;
  const searchKeys = stringArray(attribution.searchKeys);
  if (summary.attribution.searchKeys.length === 0 && searchKeys.length > 0) {
    summary.attribution.searchKeys = searchKeys;
  }
}

function eventTime(event: Record<string, unknown>, record: Record<string, unknown>): number | null {
  const occurredAt = typeof event.occurredAt === "string" ? Date.parse(event.occurredAt) : NaN;
  if (Number.isFinite(occurredAt)) {
    return occurredAt;
  }

  const receivedAt = typeof record.receivedAt === "string" ? Date.parse(record.receivedAt) : NaN;
  return Number.isFinite(receivedAt) ? receivedAt : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
