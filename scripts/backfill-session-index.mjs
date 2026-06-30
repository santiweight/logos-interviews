import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.BUCKET_NAME;
if (!bucket) {
  throw new Error("Missing BUCKET_NAME");
}

const dryRun = process.argv.includes("--dry-run");
const eventPrefix = "session-capture/session-events/";
const indexPrefix = "session-capture/session-index/";
const backfillKey = `${indexPrefix}backfill/session-events-v1.jsonl`;

const client = new S3Client({
  region: process.env.AWS_REGION ?? "auto",
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: process.env.AWS_ENDPOINT_URL_S3 !== undefined,
});

const [eventKeys, indexedKeys] = await Promise.all([
  listKeys(eventPrefix),
  listExistingIndexedEventKeys(),
]);
const keysToBackfill = eventKeys.filter((key) => !indexedKeys.has(key));
const indexedAt = new Date().toISOString();
const lines = [];
let scannedRecords = 0;
let parseErrors = 0;

for (const [index, key] of keysToBackfill.entries()) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const raw = await response.Body.transformToString();
  const summaries = summarizeRecords(parseRecords(raw, () => {
    parseErrors += 1;
  }));

  for (const summary of summaries) {
    scannedRecords += summary.records;
    lines.push(JSON.stringify({ indexedAt, eventObjectKey: key, summary }));
  }

  if ((index + 1) % 50 === 0) {
    console.log(JSON.stringify({
      scannedObjects: index + 1,
      remainingObjects: keysToBackfill.length - index - 1,
      indexRows: lines.length,
      scannedRecords,
    }));
  }
}

const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
if (!dryRun) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: backfillKey,
    Body: body,
    ContentType: "application/x-ndjson",
  }));
}

console.log(JSON.stringify({
  dryRun,
  eventObjects: eventKeys.length,
  alreadyIndexedObjects: indexedKeys.size,
  backfilledObjects: keysToBackfill.length,
  indexRows: lines.length,
  scannedRecords,
  parseErrors,
  backfillKey,
}, null, 2));

async function listKeys(prefix) {
  const keys = [];
  let continuationToken;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  return keys.sort();
}

async function listExistingIndexedEventKeys() {
  const keys = new Set();
  const indexKeys = (await listKeys(indexPrefix)).filter((key) => key !== backfillKey);

  for (const key of indexKeys) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await response.Body.transformToString();
    for (const record of parseRecords(raw, () => undefined)) {
      if (typeof record.eventObjectKey === "string" && record.eventObjectKey.length > 0) {
        keys.add(record.eventObjectKey);
      }
    }
  }

  return keys;
}

function parseRecords(raw, onError) {
  const records = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(line));
    } catch {
      onError();
    }
  }

  return records;
}

function summarizeRecords(records) {
  const summaries = new Map();

  for (const record of records) {
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (!sessionId) {
      continue;
    }

    const event = isRecord(record.event) ? record.event : {};
    const request = isRecord(record.request) ? record.request : {};
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    const timestamp = eventTime(event, record);
    const summary = summaries.get(sessionId) ?? emptySummary(sessionId);

    summary.records += 1;
    if (eventType === "dom_replay") {
      summary.replayEvents += 1;
    }
    summary.eventTypes.set(eventType, (summary.eventTypes.get(eventType) ?? 0) + 1);

    if (timestamp !== null) {
      if (summary.firstMs === null || timestamp < summary.firstMs) {
        summary.firstMs = timestamp;
        summary.firstAt = new Date(timestamp).toISOString();
      }
      if (summary.lastMs === null || timestamp > summary.lastMs) {
        summary.lastMs = timestamp;
        summary.lastAt = new Date(timestamp).toISOString();
      }
    }

    summary.request.forwardedFor ??= stringValue(request.forwardedFor);
    summary.request.remoteAddress ??= stringValue(request.remoteAddress);
    applyEventMetadata(summary, event);
    summaries.set(sessionId, summary);
  }

  return [...summaries.values()].map((summary) => ({
    sessionId: summary.sessionId,
    firstAt: summary.firstAt,
    lastAt: summary.lastAt,
    durationMs: summary.firstMs !== null && summary.lastMs !== null ? summary.lastMs - summary.firstMs : null,
    records: summary.records,
    replayEvents: summary.replayEvents,
    activeWithin5Minutes: false,
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

function emptySummary(sessionId) {
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

function applyEventMetadata(summary, event) {
  if (typeof event.url === "string") {
    summary.url ??= event.url;
  }

  const details = isRecord(event.details) ? event.details : {};
  const state = isRecord(event.state) ? event.state : {};
  const stateBrowser = isRecord(state.browser) ? state.browser : {};
  const attribution = isRecord(details.attribution) ? details.attribution : {};

  summary.url ??= stringValue(details.url) ?? stringValue(attribution.url) ?? stringValue(stateBrowser.url);
  summary.referrer ??= stringValue(details.referrer) ?? stringValue(attribution.referrer);
  summary.browser.userAgent ??= stringValue(details.userAgent);
  summary.browser.platform ??= stringValue(details.platform);
  summary.browser.language ??= stringValue(details.language);
  summary.browser.timezone ??= stringValue(details.timezone);
  summary.browser.timezoneOffsetMinutes ??= numberValue(details.timezoneOffsetMinutes);
  summary.browser.localTime ??= stringValue(details.localTime);
  summary.browser.deviceType ??= stringValue(details.deviceType);
  summary.browser.touchCapable ??= booleanValue(details.touchCapable);
  summary.browser.viewport ??= details.viewport ?? stateBrowser.viewport ?? null;
  summary.browser.screen ??= details.screen ?? null;
  summary.browser.connection ??= details.connection ?? null;
  summary.attribution.utm ??= attribution.utm ?? null;
  summary.attribution.identity ??= attribution.identity ?? null;
  const searchKeys = Array.isArray(attribution.searchKeys)
    ? attribution.searchKeys.filter((item) => typeof item === "string")
    : [];
  if (summary.attribution.searchKeys.length === 0 && searchKeys.length > 0) {
    summary.attribution.searchKeys = searchKeys;
  }
}

function eventTime(event, record) {
  const occurredAt = typeof event.occurredAt === "string" ? Date.parse(event.occurredAt) : NaN;
  if (Number.isFinite(occurredAt)) {
    return occurredAt;
  }

  const receivedAt = typeof record.receivedAt === "string" ? Date.parse(record.receivedAt) : NaN;
  return Number.isFinite(receivedAt) ? receivedAt : null;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
