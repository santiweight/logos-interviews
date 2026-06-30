import { appendFile, mkdtemp, rm } from "node:fs/promises";
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
      await replayPage.getByRole("button", { name: "Render replay" }).click();
      await replayPage.waitForSelector(".replayer-wrapper iframe");

      const replayFrame = replayPage.frames().find((frame) => frame !== replayPage.mainFrame());
      if (!replayFrame) {
        throw new Error("Replay iframe did not mount");
      }

      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".monaco-editor").length);
      }, { timeout: 5_000 }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".view-line").length);
      }, { timeout: 5_000 }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll(".source-tab").length);
      }, { timeout: 5_000 }).toBeGreaterThan(0);
      await expect.poll(async () => {
        return await replayFrame.evaluate(() => document.querySelectorAll("#snippet-preview").length);
      }, { timeout: 5_000 }).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  it("keeps the replay view responsive for large captured sessions", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const largeSessionId = "large-replay-session";
    const records: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 120; index++) {
      records.push({
        receivedAt: "2026-06-29T20:00:00.000Z",
        sessionId: `list-session-${index.toString().padStart(3, "0")}`,
        request: { userAgent: "Perf Browser", forwardedFor: "127.0.0.1", remoteAddress: "127.0.0.1" },
        event: {
          seq: 0,
          type: "session_start",
          occurredAt: new Date(Date.UTC(2026, 5, 29, 20, index % 60, 0)).toISOString(),
          url: `https://logos-dev.fly.dev/?candidateId=list-${index}`,
          details: {
            userAgent: "Perf Browser",
            timezone: "America/New_York",
            deviceType: "desktop",
            attribution: { identity: { candidateId: `list-${index}` }, searchKeys: ["candidateId"] },
          },
        },
      });
    }

    records.push({
      receivedAt: "2026-06-29T21:00:00.000Z",
      sessionId: largeSessionId,
      request: { userAgent: "Perf Browser", forwardedFor: "127.0.0.1", remoteAddress: "127.0.0.1" },
      event: {
        seq: 0,
        type: "session_start",
        occurredAt: "2026-06-29T21:00:00.000Z",
        url: "https://logos-dev.fly.dev/?candidateId=large",
        details: {
          userAgent: "Perf Browser",
          timezone: "America/New_York",
          deviceType: "desktop",
          attribution: { identity: { candidateId: "large" }, searchKeys: ["candidateId"] },
        },
      },
    });

    for (let index = 0; index < 5_000; index++) {
      records.push({
        receivedAt: "2026-06-29T21:00:00.000Z",
        sessionId: largeSessionId,
        request: { userAgent: "Perf Browser", forwardedFor: "127.0.0.1", remoteAddress: "127.0.0.1" },
        event: {
          seq: index + 1,
          type: "dom_replay",
          occurredAt: new Date(Date.UTC(2026, 5, 29, 21, 0, index % 60)).toISOString(),
          details: { event: { type: 3, timestamp: index } },
        },
      });
    }

    await appendFile(
      join(captureDir, "session-events.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    await appendFile(
      join(captureDir, "session-index.jsonl"),
      `${[
        ...Array.from({ length: 120 }, (_, index) =>
          indexedSummaryLine({
            sessionId: `list-session-${index.toString().padStart(3, "0")}`,
            firstAt: new Date(Date.UTC(2026, 5, 29, 20, index % 60, 0)).toISOString(),
            lastAt: new Date(Date.UTC(2026, 5, 29, 20, index % 60, 0)).toISOString(),
            records: 1,
            replayEvents: 0,
            candidateId: `list-${index}`,
          })
        ),
        indexedSummaryLine({
          sessionId: largeSessionId,
          firstAt: "2026-06-29T21:00:00.000Z",
          lastAt: "2026-06-29T21:00:59.000Z",
          records: 5_001,
          replayEvents: 5_000,
          candidateId: "large",
        }),
      ].join("\n")}\n`,
      "utf8",
    );

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      const startedAt = Date.now();
      await page.goto(`${baseUrl}replay.html?sessionId=${encodeURIComponent(largeSessionId)}`);
      await page.getByRole("button", { name: "Render replay" }).waitFor();
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect.poll(async () => await page.locator(".replay-session-card").count(), { timeout: 5_000 }).toBe(50);
      expect(Date.now() - startedAt).toBeLessThan(8_000);
      expect(await page.locator(".replayer-wrapper iframe").count()).toBe(0);
      expect(await page.locator(".replay-status").textContent()).toContain("5001 records");
    } finally {
      await context.close();
    }
  });
});

function indexedSummaryLine(options: {
  sessionId: string;
  firstAt: string;
  lastAt: string;
  records: number;
  replayEvents: number;
  candidateId: string;
}): string {
  return JSON.stringify({
    indexedAt: options.lastAt,
    summary: {
      sessionId: options.sessionId,
      firstAt: options.firstAt,
      lastAt: options.lastAt,
      durationMs: Date.parse(options.lastAt) - Date.parse(options.firstAt),
      records: options.records,
      replayEvents: options.replayEvents,
      activeWithin5Minutes: false,
      url: `https://logos-dev.fly.dev/?candidateId=${options.candidateId}`,
      referrer: null,
      browser: {
        userAgent: "Perf Browser",
        platform: "MacIntel",
        language: "en-US",
        timezone: "America/New_York",
        timezoneOffsetMinutes: 240,
        localTime: "Mon Jun 29 2026 17:00:00 GMT-0400",
        deviceType: "desktop",
        touchCapable: false,
        viewport: { width: 1200, height: 800 },
        screen: { width: 1440, height: 900 },
        connection: null,
      },
      request: {
        forwardedFor: "127.0.0.1",
        remoteAddress: "127.0.0.1",
      },
      attribution: {
        utm: null,
        identity: { candidateId: options.candidateId },
        searchKeys: ["candidateId"],
      },
      eventTypes: [
        { type: "dom_replay", count: options.replayEvents },
        { type: "session_start", count: 1 },
      ],
    },
  });
}
