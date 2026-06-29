import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleSharedSessions } from "./sharedSessions";

describe("shared sessions", () => {
  it("stores and reads a loadable session by share id", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "logos-shared-session-"));
    const previousDir = process.env.SHARED_SESSION_DIR;
    process.env.SHARED_SESSION_DIR = logDir;

    const server = createServer((req, res) => {
      void handleSharedSessions(req, res);
    });

    try {
      const baseUrl = await listen(server);
      const loadableSession = {
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
          lastRunLabel: "never",
          lastRunStatusText: "",
          lastRunDefinitionHash: null,
          runStatus: { text: "", state: "" },
          tabs: [],
        },
        agent: { expanded: false, input: "", messages: [] },
      };

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
      await rm(logDir, { recursive: true, force: true });
    }
  });
});

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
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
