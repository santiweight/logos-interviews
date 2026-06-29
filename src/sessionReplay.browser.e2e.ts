import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";

describe("session replay browser flow", () => {
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let baseUrl = "";
  let captureDir = "";
  let previousCaptureDir: string | undefined;
  let previousCaptureReadEnabled: string | undefined;

  beforeAll(async () => {
    captureDir = await mkdtemp(join(tmpdir(), "logos-session-replay-e2e-"));
    previousCaptureDir = process.env.SESSION_CAPTURE_DIR;
    previousCaptureReadEnabled = process.env.SESSION_CAPTURE_READ_ENABLED;
    process.env.SESSION_CAPTURE_DIR = captureDir;
    process.env.SESSION_CAPTURE_READ_ENABLED = "true";

    server = await createServer({
      configFile: "vite.config.ts",
      logLevel: "error",
    });
    await server.listen();
    baseUrl = server.resolvedUrls?.local[0] ?? "";
    if (!baseUrl) {
      throw new Error("Vite did not expose a local test URL");
    }

    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (previousCaptureDir === undefined) {
      delete process.env.SESSION_CAPTURE_DIR;
    } else {
      process.env.SESSION_CAPTURE_DIR = previousCaptureDir;
    }
    if (previousCaptureReadEnabled === undefined) {
      delete process.env.SESSION_CAPTURE_READ_ENABLED;
    } else {
      process.env.SESSION_CAPTURE_READ_ENABLED = previousCaptureReadEnabled;
    }
    await rm(captureDir, { recursive: true, force: true });
  });

  it("replays the code editor and compilation pane from captured rrweb events", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(baseUrl);
      await page.waitForSelector("#editor");
      await page.waitForFunction(() => {
        return document.querySelectorAll(".monaco-editor .view-line").length > 0 &&
          document.querySelector("#snippet-preview") !== null;
      });

      const sessionId = await page.evaluate(() => {
        const value = window.sessionStorage.getItem("logos-interviews-session-id");
        if (!value) {
          throw new Error("Missing capture session id");
        }

        return value;
      });

      await page.getByLabel("Open settings menu").click();
      await page.getByRole("menuitem", { name: "Copy session ID" }).click();
      await expect.poll(async () => await page.locator("#run-status").textContent()).toBe("Session ID copied");

      await page.waitForTimeout(6_000);

      const response = await page.request.get(`${baseUrl}api/session-events/${encodeURIComponent(sessionId)}`);
      expect(response.ok()).toBe(true);
      const payload = await response.json() as { replayEvents?: unknown[] };
      expect(payload.replayEvents?.length).toBeGreaterThan(0);
      expect(JSON.stringify(payload.replayEvents)).not.toContain("[max-depth]");

      const replayPage = await context.newPage();
      await replayPage.goto(`${baseUrl}replay.html?sessionId=${encodeURIComponent(sessionId)}`);
      await replayPage.waitForSelector(".replayer-wrapper iframe");

      const replayFrame = replayPage.frames().find((frame) => frame !== replayPage.mainFrame());
      if (!replayFrame) {
        throw new Error("Replay iframe did not mount");
      }

      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".monaco-editor").length);
      }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".view-line").length);
      }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".source-tab").length);
      }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll("#snippet-preview").length);
      }).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
