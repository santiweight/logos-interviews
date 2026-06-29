import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

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

  it("runs a simple program through an interactive run session", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const runOnceRequests: string[] = [];
      const interactiveStartRequests: string[] = [];
      await page.route("**/api/run/start", async (route) => {
        interactiveStartRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "simple-run-session",
            runnable: "foo",
            implementation: "def foo():\n  print('hi')\n",
            chunks: [{ stream: "stdout", text: "hi\n" }],
            status: { state: "exited", code: 0, signal: null },
          }),
        });
      });
      await page.route(/\/api\/run$/, async (route) => {
        runOnceRequests.push(route.request().url());
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "one-shot run should not start" }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);

      const source = "def foo():\n  print('hi')\n";
      await loadSource(page, source, "Simple Run");

      const startResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/api/run/start");
      });
      await page.locator(".runnable-play-glyph").first().click();
      const startResponse = await startResponsePromise;
      await expect.poll(async () => {
        return page.locator(".terminal-output-text").first().textContent();
      }).toBe("hi\n");

      expect(startResponse.status()).toBe(200);
      expect(interactiveStartRequests).toHaveLength(1);
      expect(runOnceRequests).toEqual([]);
      expect(await isTerminalInputFocused(page)).toBe(false);
    } finally {
      await context.close();
    }
  });

  it("keeps stdin unfocused until the user focuses it, then sends keyboard input", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const inputs: unknown[] = [];
      const pendingPollChunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

      await page.route("**/api/run/start", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "reverse-session",
            runnable: "main",
            implementation: reverseSource(),
            chunks: [{ stream: "stdout", text: "Enter a word (or 'quit' to exit): " }],
            status: { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/poll", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            runnable: "main",
            implementation: reverseSource(),
            chunks: pendingPollChunks.splice(0, pendingPollChunks.length),
            status: { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/input", async (route) => {
        const body = route.request().postDataJSON() as { input?: string };
        inputs.push(body);
        if (body.input === "logos\n") {
          pendingPollChunks.push({ stream: "stdout", text: "sogol\nEnter a word (or 'quit' to exit): " });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, reverseSource(), "Reverse CLI");

      await page.locator(".runnable-play-glyph").first().click();
      const terminalInput = page.locator(".terminal-input").first();
      await expect.poll(async () => terminalInput.isEnabled()).toBe(true);
      expect(await isTerminalInputFocused(page)).toBe(false);

      await terminalInput.click();
      expect(await isTerminalInputFocused(page)).toBe(true);
      await page.keyboard.type("logos");
      await page.keyboard.press("Enter");

      await expect.poll(() => inputs).toEqual([{ sessionId: "reverse-session", input: "logos\n" }]);
      await expect.poll(async () => page.locator(".terminal-output-text").first().textContent()).toContain("sogol");
    } finally {
      await context.close();
    }
  });

  it("focuses stdin from terminal panel clicks and disables stdin after exit", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let shouldExit = false;

      await page.route("**/api/run/start", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "reverse-session",
            runnable: "main",
            implementation: reverseSource(),
            chunks: [{ stream: "stdout", text: "Enter a word (or 'quit' to exit): " }],
            status: { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/poll", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            runnable: "main",
            implementation: reverseSource(),
            chunks: [],
            status: shouldExit ? { state: "exited", code: 0, signal: null } : { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/input", async (route) => {
        const body = route.request().postDataJSON() as { input?: string };
        shouldExit = body.input === "quit\n";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, reverseSource(), "Reverse CLI");

      await page.locator(".runnable-play-glyph").first().click();
      await expect.poll(async () => page.locator(".terminal-input").first().isEnabled()).toBe(true);
      expect(await isTerminalInputFocused(page)).toBe(false);

      await page.locator(".terminal-output").first().click();
      expect(await isTerminalInputFocused(page)).toBe(true);
      await page.keyboard.type("quit");
      await page.keyboard.press("Enter");

      await expect.poll(async () => page.locator(".terminal-input").first().isDisabled()).toBe(true);
      await expect.poll(async () => page.locator(".terminal-output-text").first().textContent()).toContain("quit\n");
    } finally {
      await context.close();
    }
  });
});

async function waitForSessionHelpers(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const logosWindow = window as LogosWindow;
    return (
      typeof logosWindow.createLogosSessionBundle === "function" &&
      typeof logosWindow.loadLogosSession === "function"
    );
  });
}

async function loadSource(page: Page, source: string, title: string): Promise<void> {
  await page.evaluate(async ({ source, title }) => {
    const logosWindow = window as LogosWindow;
    const session = logosWindow.createLogosSessionBundle?.();
    if (!session || !logosWindow.loadLogosSession) {
      throw new Error("Logos session helpers are unavailable");
    }

    const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "browser-run";
    await logosWindow.loadLogosSession({
      ...session,
      sourceTabs: [{
        id: activeSourceTabId,
        projectId: title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
        title,
        source,
      }],
      activeSourceTabId,
      editor: {
        ...session.editor,
        value: source,
        cursor: { lineNumber: 1, column: 1 },
        scrollTop: 0,
        scrollLeft: 0,
      },
      compilation: {
        ...session.compilation,
        latestImplementationSource: source,
      },
    });
  }, { source, title });
}

async function isTerminalInputFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains("terminal-input") === true);
}

function reverseSource(): string {
  return `def main():
  while True:
    try:
      word = input("Enter a word (or 'quit' to exit): ")
    except EOFError:
      break
    if word == "quit":
      break
    print(word[::-1])`;
}
