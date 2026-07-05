import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleSharedSessions } from "./sharedSessions";

describe("shared sessions", () => {
  it("stores and reads a loadable session by share id", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "logos-shared-session-"));
    const previousDir = process.env.SHARED_SESSION_DIR;
    const previousStorageEnv = snapshotEnv(objectStorageEnvKeys);
    process.env.SHARED_SESSION_DIR = logDir;
    clearEnv(previousStorageEnv);

    const server = createServer((req, res) => {
      void handleSharedSessions(req, res);
    });

    try {
      const baseUrl = await listen(server);
      const loadableSession = minimalLoadableSession();

      const createResponse = await fetch(`${baseUrl}/api/shared-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadableSession }),
      });
      const createPayload = await createResponse.json() as { ok?: boolean; shareId?: string };
      expect(createPayload).toMatchObject({ ok: true, shareId: expect.any(String) });

      const readResponse = await fetch(`${baseUrl}/api/shared-sessions/${createPayload.shareId}`);
      const readPayload = await readResponse.json() as {
        ok?: boolean;
        shareId?: string;
        loadableSession?: unknown;
      };
      expect(readPayload).toMatchObject({
        ok: true,
        shareId: createPayload.shareId,
        loadableSession,
      });
    } finally {
      await closeServer(server);
      if (previousDir === undefined) {
        delete process.env.SHARED_SESSION_DIR;
      } else {
        process.env.SHARED_SESSION_DIR = previousDir;
      }
      restoreEnv(previousStorageEnv);
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("stores and reads shared sessions through the unified object storage config", async () => {
    const previousEnv = snapshotEnv(objectStorageEnvKeys);
    const objects = new Map<string, string>();
    const requests: CapturedRequest[] = [];
    const s3Server = createServer(async (req, res) => {
      const body = await readBody(req);
      const objectPath = new URL(req.url ?? "/", "http://s3.test").pathname;
      requests.push({ method: req.method ?? "", url: objectPath, body });

      if (req.method === "PUT") {
        objects.set(objectPath, body);
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.method === "GET") {
        const stored = objects.get(objectPath);
        if (stored === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(stored);
        return;
      }

      res.statusCode = 200;
      res.end();
    });
    const appServer = createServer((req, res) => {
      void handleSharedSessions(req, res);
    });

    try {
      const s3BaseUrl = await listen(s3Server);
      clearEnv(previousEnv);
      process.env.BUCKET_NAME = "shared-bucket";
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_ENDPOINT_URL_S3 = s3BaseUrl;
      process.env.AWS_ACCESS_KEY_ID = "test-access-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

      const baseUrl = await listen(appServer);
      const loadableSession = minimalLoadableSession();
      const createResponse = await fetch(`${baseUrl}/api/shared-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadableSession }),
      });
      const createPayload = await createResponse.json() as { ok?: boolean; shareId?: string };
      expect(createPayload).toMatchObject({ ok: true, shareId: expect.any(String) });

      const readResponse = await fetch(`${baseUrl}/api/shared-sessions/${createPayload.shareId}`);
      const readPayload = await readResponse.json() as {
        ok?: boolean;
        shareId?: string;
        loadableSession?: unknown;
      };
      expect(readPayload).toMatchObject({
        ok: true,
        shareId: createPayload.shareId,
        loadableSession,
      });
      expect(requests.map((request) => request.method)).toEqual(["PUT", "GET"]);
      expect(requests.map((request) => request.url)).toEqual([
        `/shared-bucket/shared-sessions/${createPayload.shareId}.json`,
        `/shared-bucket/shared-sessions/${createPayload.shareId}.json`,
      ]);
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

function minimalLoadableSession(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    capturedAt: "2026-06-28T00:00:00.000Z",
    sessionId: "session-1",
    workspaceId: "workspace-1",
    sourceTabs: [{ id: "tab-1", projectId: "sample", title: "Sample", source: "def test(): pass" }],
    activeSourceTabId: "tab-1",
    editor: { value: "def test(): pass", cursor: null, scrollTop: 0, scrollLeft: 0 },
    compilation: {
      compileVersion: 1,
      latestImplementationSource: "def test(): pass",
      selection: { kind: "none" },
    },
    run: {
      activeToolTabId: null,
      tabs: [],
    },
    agent: { expanded: false, input: "", messages: [] },
  };
}

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
