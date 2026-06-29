import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleFeedback } from "./feedbackCapture";

describe("feedback capture", () => {
  it("writes a loadable session bundle with feedback records", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "logos-feedback-"));
    const previousDir = process.env.FEEDBACK_CAPTURE_DIR;
    process.env.FEEDBACK_CAPTURE_DIR = logDir;

    const server = createServer((req, res) => {
      void handleFeedback(req, res);
    });

    try {
      const baseUrl = await listen(server);
      const loadableSession = {
        schemaVersion: 1,
        sessionId: "session-1",
        workspaceId: "workspace-1",
        sourceTabs: [{ id: "tab-1", projectId: "sample", title: "Sample", source: "def test(): pass" }],
        activeSourceTabId: "tab-1",
      };

      const response = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          panel: "code",
          rating: "up",
          url: "http://localhost/",
          loadableSession,
          state: { editor: { value: "def test(): pass" } },
        }),
      });
      const payload = await response.json() as { ok?: boolean; feedbackId?: string };
      expect(payload).toMatchObject({ ok: true, feedbackId: expect.any(String) });

      const lines = (await readFile(join(logDir, "feedback.jsonl"), "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        feedbackId: payload.feedbackId,
        sessionId: "session-1",
        panel: "code",
        rating: "up",
        loadableSession,
      });
    } finally {
      await closeServer(server);
      if (previousDir === undefined) {
        delete process.env.FEEDBACK_CAPTURE_DIR;
      } else {
        process.env.FEEDBACK_CAPTURE_DIR = previousDir;
      }
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("writes feedback records to S3-compatible storage when configured", async () => {
    const previousEnv = snapshotEnv([
      "FEEDBACK_CAPTURE_S3_BUCKET",
      "FEEDBACK_CAPTURE_S3_REGION",
      "FEEDBACK_CAPTURE_S3_ENDPOINT",
      "FEEDBACK_CAPTURE_S3_FORCE_PATH_STYLE",
      "FEEDBACK_CAPTURE_S3_PREFIX",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ]);
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
      void handleFeedback(req, res);
    });

    try {
      const s3BaseUrl = await listen(s3Server);
      clearEnv(previousEnv);
      process.env.FEEDBACK_CAPTURE_S3_BUCKET = "capture-bucket";
      process.env.FEEDBACK_CAPTURE_S3_REGION = "us-east-1";
      process.env.FEEDBACK_CAPTURE_S3_ENDPOINT = s3BaseUrl;
      process.env.FEEDBACK_CAPTURE_S3_FORCE_PATH_STYLE = "true";
      process.env.FEEDBACK_CAPTURE_S3_PREFIX = "feedback-captures";
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

      const appBaseUrl = await listen(appServer);
      const response = await fetch(`${appBaseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          panel: "code",
          rating: "down",
          url: "http://localhost/",
          loadableSession: { schemaVersion: 1 },
          state: { editor: { value: "def test(): pass" } },
        }),
      });

      expect(response.status).toBe(200);
      expect(s3Requests).toHaveLength(1);
      expect(s3Requests[0].method).toBe("PUT");
      expect(s3Requests[0].url).toMatch(
        /^\/capture-bucket\/feedback-captures\/\d{4}\/\d{2}\/\d{2}\/.+\.jsonl/,
      );
      expect(JSON.parse(s3Requests[0].body.trim())).toMatchObject({
        sessionId: "session-1",
        panel: "code",
        rating: "down",
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
