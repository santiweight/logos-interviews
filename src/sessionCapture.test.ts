import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { handleSessionEvents } from "./sessionCapture";

describe("session capture", () => {
  let logDir: string | null = null;

  afterEach(async () => {
    if (logDir) {
      await rm(logDir, { recursive: true, force: true });
      logDir = null;
    }
  });

  it("writes posted session events as JSONL records", async () => {
    logDir = await mkdtemp(join(tmpdir(), "logos-session-capture-"));
    const previousDir = process.env.SESSION_CAPTURE_DIR;
    const previousStorageEnv = snapshotEnv(objectStorageEnvKeys);
    process.env.SESSION_CAPTURE_DIR = logDir;
    clearEnv(previousStorageEnv);

    try {
      const server = createServer((req, res) => {
        void handleSessionEvents(req, res);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Test server did not bind to a TCP port");
        }

        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-1",
            events: [
              { seq: 0, type: "session_start" },
              { seq: 1, type: "click", details: { target: "button" } },
            ],
          }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true, captured: 2 });

        const lines = (await readFile(join(logDir, "session-events.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));

        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({
          sessionId: "session-1",
          event: { seq: 0, type: "session_start" },
        });
        expect(lines[1]).toMatchObject({
          sessionId: "session-1",
          event: { seq: 1, type: "click", details: { target: "button" } },
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    } finally {
      if (previousDir === undefined) {
        delete process.env.SESSION_CAPTURE_DIR;
      } else {
        process.env.SESSION_CAPTURE_DIR = previousDir;
      }
      restoreEnv(previousStorageEnv);
    }
  });

  it("writes session event batches to S3-compatible storage when configured", async () => {
    const previousEnv = snapshotEnv(objectStorageEnvKeys);
    const s3Requests: CapturedRequest[] = [];
    const s3Server = createServer(async (req, res) => {
      s3Requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body: await readBody(req),
      });
      res.statusCode = 200;
      res.end();
    });
    const appServer = createServer((req, res) => {
      void handleSessionEvents(req, res);
    });

    try {
      const s3BaseUrl = await listen(s3Server);
      clearEnv(previousEnv);
      process.env.BUCKET_NAME = "capture-bucket";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_ENDPOINT_URL_S3 = s3BaseUrl;
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

      const appBaseUrl = await listen(appServer);
      const response = await fetch(`${appBaseUrl}/api/session-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          events: [{ seq: 0, type: "session_start" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(s3Requests).toHaveLength(2);
      const sessionEventsRequest = s3Requests.find((request) => request.url.includes("/session-capture/session-events/"));
      const sessionIndexRequest = s3Requests.find((request) => request.url.includes("/session-capture/session-index/"));
      expect(sessionEventsRequest?.method).toBe("PUT");
      expect(sessionEventsRequest?.url).toMatch(
        /^\/capture-bucket\/session-capture\/session-events\/\d{4}\/\d{2}\/\d{2}\/.+\.jsonl/,
      );
      expect(JSON.parse(sessionEventsRequest?.body.trim() ?? "{}")).toMatchObject({
        sessionId: "session-1",
        event: { seq: 0, type: "session_start" },
      });
      expect(sessionIndexRequest?.method).toBe("PUT");
      expect(sessionIndexRequest?.url).toMatch(
        /^\/capture-bucket\/session-capture\/session-index\/\d{4}\/\d{2}\/\d{2}\/.+\.jsonl/,
      );
      const sessionIndexRecord = JSON.parse(sessionIndexRequest?.body.trim() ?? "{}") as {
        eventObjectKey?: string;
        summary?: { sessionId?: string; records?: number };
      };
      expect(sessionIndexRecord).toMatchObject({
        eventObjectKey: expect.stringMatching(/^session-capture\/session-events\//),
        summary: {
          sessionId: "session-1",
          records: 1,
        },
      });
    } finally {
      await closeServer(appServer);
      await closeServer(s3Server);
      restoreEnv(previousEnv);
    }
  });

  it("reads captured session records and replay events when replay reads are enabled", async () => {
    logDir = await mkdtemp(join(tmpdir(), "logos-session-replay-"));
    const previousDir = process.env.SESSION_CAPTURE_DIR;
    const previousReadEnabled = process.env.SESSION_CAPTURE_READ_ENABLED;
    const previousStorageEnv = snapshotEnv(objectStorageEnvKeys);
    process.env.SESSION_CAPTURE_DIR = logDir;
    process.env.SESSION_CAPTURE_READ_ENABLED = "true";
    clearEnv(previousStorageEnv);

    try {
      const server = createServer((req, res) => {
        void handleSessionEvents(req, res);
      });
      const baseUrl = await listen(server);

      try {
        const writeResponse = await fetch(`${baseUrl}/api/session-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-replay-1",
            events: [
              {
                seq: 1,
                type: "dom_replay",
                details: {
                  schema: "rrweb@2",
                  event: { type: 2, timestamp: 10, data: { source: 1, nested: nestedReplayNode(30) } },
                },
              },
              { seq: 0, type: "session_start" },
            ],
          }),
        });
        expect(writeResponse.status).toBe(200);

        const readResponse = await fetch(`${baseUrl}/api/session-events/session-replay-1`);
        expect(readResponse.status).toBe(200);

        const payload = await readResponse.json() as {
          ok?: boolean;
          sessionId?: string;
          records?: Array<{ event?: { seq?: number; type?: string } }>;
          replayEvents?: unknown[];
        };

        expect(payload).toMatchObject({
          ok: true,
          sessionId: "session-replay-1",
        });
        expect(payload.records?.map((record) => record.event?.seq)).toEqual([0, 1]);
        expect(payload.replayEvents).toEqual([
          { type: 2, timestamp: 10, data: { source: 1, nested: nestedReplayNode(30) } },
        ]);
      } finally {
        await closeServer(server);
      }
    } finally {
      if (previousDir === undefined) {
        delete process.env.SESSION_CAPTURE_DIR;
      } else {
        process.env.SESSION_CAPTURE_DIR = previousDir;
      }
      if (previousReadEnabled === undefined) {
        delete process.env.SESSION_CAPTURE_READ_ENABLED;
      } else {
        process.env.SESSION_CAPTURE_READ_ENABLED = previousReadEnabled;
      }
      restoreEnv(previousStorageEnv);
    }
  });

  it("lists captured session summaries when replay reads are enabled", async () => {
    logDir = await mkdtemp(join(tmpdir(), "logos-session-list-"));
    const previousDir = process.env.SESSION_CAPTURE_DIR;
    const previousReadEnabled = process.env.SESSION_CAPTURE_READ_ENABLED;
    const previousStorageEnv = snapshotEnv(objectStorageEnvKeys);
    process.env.SESSION_CAPTURE_DIR = logDir;
    process.env.SESSION_CAPTURE_READ_ENABLED = "true";
    clearEnv(previousStorageEnv);

    try {
      const server = createServer((req, res) => {
        void handleSessionEvents(req, res);
      });
      const baseUrl = await listen(server);

      try {
        const writeResponse = await fetch(`${baseUrl}/api/session-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-list-1",
            events: [
              {
                seq: 0,
                type: "session_start",
                occurredAt: "2026-06-29T20:00:00.000Z",
                url: "https://logos-dev.fly.dev/?candidateId=candidate-1&utm_source=invite",
                details: {
                  userAgent: "Test Browser",
                  language: "en-US",
                  platform: "MacIntel",
                  timezone: "America/New_York",
                  timezoneOffsetMinutes: 240,
                  localTime: "Mon Jun 29 2026 16:00:00 GMT-0400",
                  deviceType: "desktop",
                  touchCapable: false,
                  viewport: { width: 1200, height: 800 },
                  screen: { width: 1440, height: 900 },
                  referrer: "https://calendar.example/interview",
                  attribution: {
                    searchKeys: ["candidateId", "utm_source"],
                    utm: { source: "invite" },
                    identity: { candidateId: "candidate-1" },
                  },
                  connection: { effectiveType: "4g" },
                },
              },
              {
                seq: 1,
                type: "dom_replay",
                occurredAt: "2026-06-29T20:00:01.000Z",
                details: { event: { type: 2, timestamp: 1 } },
              },
            ],
          }),
        });
        expect(writeResponse.status).toBe(200);
        const indexLines = (await readFile(join(logDir, "session-index.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { summary?: { sessionId?: string } });
        expect(indexLines.some((line) => line.summary?.sessionId === "session-list-1")).toBe(true);

        const listResponse = await fetch(`${baseUrl}/api/session-events`);
        expect(listResponse.status).toBe(200);

        const payload = await listResponse.json() as {
          ok?: boolean;
          sessions?: Array<{
            sessionId?: string;
            records?: number;
            replayEvents?: number;
            url?: string;
            referrer?: string;
            browser?: {
              timezone?: string;
              timezoneOffsetMinutes?: number;
              deviceType?: string;
              connection?: unknown;
            };
            attribution?: {
              identity?: unknown;
              utm?: unknown;
              searchKeys?: string[];
            };
          }>;
        };

        expect(payload.ok).toBe(true);
        expect(payload.sessions?.[0]).toMatchObject({
          sessionId: "session-list-1",
          records: 2,
          replayEvents: 1,
          url: "https://logos-dev.fly.dev/?candidateId=candidate-1&utm_source=invite",
          referrer: "https://calendar.example/interview",
          browser: {
            timezone: "America/New_York",
            timezoneOffsetMinutes: 240,
            deviceType: "desktop",
            connection: { effectiveType: "4g" },
          },
          attribution: {
            identity: { candidateId: "candidate-1" },
            utm: { source: "invite" },
            searchKeys: ["candidateId", "utm_source"],
          },
        });
      } finally {
        await closeServer(server);
      }
    } finally {
      if (previousDir === undefined) {
        delete process.env.SESSION_CAPTURE_DIR;
      } else {
        process.env.SESSION_CAPTURE_DIR = previousDir;
      }
      if (previousReadEnabled === undefined) {
        delete process.env.SESSION_CAPTURE_READ_ENABLED;
      } else {
        process.env.SESSION_CAPTURE_READ_ENABLED = previousReadEnabled;
      }
      restoreEnv(previousStorageEnv);
    }
  });
});

function nestedReplayNode(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { tagName: "span", attributes: { class: "view-line" } };

  for (let index = 0; index < depth; index++) {
    node = {
      tagName: "div",
      attributes: { class: `level-${index}` },
      childNodes: [node],
    };
  }

  return node;
}

type CapturedRequest = {
  method: string;
  url: string;
  body: string;
};

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not listen on test server");
      }

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv(previous: Map<string, string | undefined>): void {
  for (const key of previous.keys()) {
    delete process.env[key];
  }
}

const objectStorageEnvKeys = [
  "BUCKET_NAME",
  "AWS_REGION",
  "AWS_ENDPOINT_URL_S3",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];
