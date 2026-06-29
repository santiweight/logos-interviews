import { createServer } from "node:http";
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
