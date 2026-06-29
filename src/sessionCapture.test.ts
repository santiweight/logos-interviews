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
      expect(s3Requests).toHaveLength(1);
      expect(s3Requests[0].method).toBe("PUT");
      expect(s3Requests[0].url).toMatch(
        /^\/capture-bucket\/session-capture\/session-events\/\d{4}\/\d{2}\/\d{2}\/.+\.jsonl/,
      );
      expect(JSON.parse(s3Requests[0].body.trim())).toMatchObject({
        sessionId: "session-1",
        event: { seq: 0, type: "session_start" },
      });
    } finally {
      await closeServer(appServer);
      await closeServer(s3Server);
      restoreEnv(previousEnv);
    }
  });
});

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
