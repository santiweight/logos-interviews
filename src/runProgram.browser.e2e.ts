import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";

type TestSourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
};

type TestLoadableSession = {
  sourceTabs: TestSourceTab[];
  activeSourceTabId: string | null;
  editor: {
    value: string;
    cursor: { lineNumber: number; column: number } | null;
    scrollTop: number;
    scrollLeft: number;
  };
  compilation: {
    compileVersion: number;
    latestImplementationSource: string;
    selection: unknown;
  };
};

type LogosWindow = Window & {
  createLogosSessionBundle?: () => TestLoadableSession;
  loadLogosSession?: (session: TestLoadableSession) => Promise<void>;
};

describe("run program browser flow", () => {
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let baseUrl = "";

  beforeAll(async () => {
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
  });

  it("runs a simple program without creating an interactive run session", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const interactiveRequests: string[] = [];
      await page.route("**/api/run/start", async (route) => {
        interactiveRequests.push(route.request().url());
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "interactive run should not start" }),
        });
      });
      await page.route("**/api/run/poll", async (route) => {
        interactiveRequests.push(route.request().url());
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            errorCode: "run_session_not_found",
            error: "Run session not found",
            chunks: [],
          }),
        });
      });

      await page.goto(baseUrl);
      await page.waitForFunction(() => {
        const logosWindow = window as LogosWindow;
        return (
          typeof logosWindow.createLogosSessionBundle === "function" &&
          typeof logosWindow.loadLogosSession === "function"
        );
      });

      const source = "def foo():\n  print('hi')\n";
      await page.evaluate(async (nextSource) => {
        const logosWindow = window as LogosWindow;
        const session = logosWindow.createLogosSessionBundle?.();
        if (!session || !logosWindow.loadLogosSession) {
          throw new Error("Logos session helpers are unavailable");
        }

        const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "simple-run";
        await logosWindow.loadLogosSession({
          ...session,
          sourceTabs: [{
            id: activeSourceTabId,
            projectId: "simple-run",
            title: "Simple Run",
            source: nextSource,
          }],
          activeSourceTabId,
          editor: {
            ...session.editor,
            value: nextSource,
            cursor: { lineNumber: 1, column: 1 },
            scrollTop: 0,
            scrollLeft: 0,
          },
          compilation: {
            ...session.compilation,
            latestImplementationSource: nextSource,
          },
        });
      }, source);

      const runResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/api/run");
      });
      await page.locator(".runnable-play-glyph").first().click();
      const runResponse = await runResponsePromise;
      await expect.poll(async () => {
        return page.locator(".terminal-output-text").first().textContent();
      }).toBe("hi\n");

      expect(runResponse.status()).toBe(200);
      expect(interactiveRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
