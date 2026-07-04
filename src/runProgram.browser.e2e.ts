import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

type TestSourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
};

type TestRunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: string | null; error?: string };

type TestRunTab = {
  id: string;
  runnable: string;
  sourceHash: string;
  terminalText: string;
  implementation: string;
  status: TestRunStatus | null;
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
  run: {
    activeToolTabId: string | null;
    lastRunLabel: string;
    lastRunStatusText: string;
    tabs: TestRunTab[];
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
      await page.locator(".runnable-run-widget").first().click();
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

  it("clears the code cache from the settings menu", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let clearRequests = 0;
      let compileRequestsAfterClear = 0;
      await page.route("**/api/cache", async (route) => {
        clearRequests += 1;
        expect(route.request().method()).toBe("DELETE");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, cleared: 3 }),
        });
      });
      await page.route("**/api/compile", async (route) => {
        compileRequestsAfterClear += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: `${JSON.stringify({ kind: "compiled", implementation: "", completedSnippets: 0, totalSnippets: 0 })}\n`,
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      compileRequestsAfterClear = 0;
      await page.locator("#workspace-menu summary").click();
      await page.getByRole("menuitem", { name: "Clear code cache" }).click();

      await expect.poll(() => clearRequests).toBe(1);
      await expect.poll(async () => page.locator("#run-status").textContent()).toBe("Code cache cleared");
      await page.waitForTimeout(300);
      expect(compileRequestsAfterClear).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("closes the add-file menu when clicking back into the editor", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);

      await page.getByLabel("Add file").click();
      await expect.poll(async () => isDetailsOpen(page, "#sample-menu")).toBe(true);

      await page.locator("#editor").click({ position: { x: 24, y: 24 } });
      await expect.poll(async () => isDetailsOpen(page, "#sample-menu")).toBe(false);
    } finally {
      await context.close();
    }
  });

  it("leaves browser command shortcuts alone while preserving editor comment toggling", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = "def main():\n  print('hi')\n";

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Shortcut Handling");
      await page.locator("#editor .view-line").first().click();

      const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
      const primaryModifierKey = process.platform === "darwin"
        ? { metaKey: true }
        : { ctrlKey: true };

      await page.keyboard.press(`${primaryModifier}+Slash`);
      await expect.poll(async () => editorSource(page)).toBe("# def main():\n  print('hi')\n");

      const commandL = await dispatchEditorKeydown(page, {
        key: "l",
        code: "KeyL",
        keyCode: 76,
        ...primaryModifierKey,
      });
      expect(commandL).toEqual({ dispatched: true, defaultPrevented: false });
    } finally {
      await context.close();
    }
  });

  it("renders the implementation view with highlighted code", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = "def foo():\n  print('hi')\n";

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Highlighted Implementation");

      await expect.poll(async () => {
        return (await page.locator("#implementation-view-panel .view-line").first().textContent())
          ?.replaceAll("\u00a0", " ");
      }).toContain("def foo");
      await expect.poll(async () => {
        return page.locator("#implementation-view-panel .view-line span[class*='mtk']").count();
      }).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  it("keeps the output pane flush with the shell after resizing it wider", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);

      const handle = await page.locator("#code-run-resize-handle").boundingBox();
      if (!handle) {
        throw new Error("Resize handle did not render");
      }

      await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
      await page.mouse.down();
      await page.mouse.move(handle.x - 260, handle.y + 80, { steps: 8 });
      await page.mouse.up();

      await expect.poll(async () => outputPaneRightGap(page)).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });

  it("does not recenter the implementation view when the clicked implementation is already visible", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = Array.from({ length: 45 }, (_item, index) => {
        const name = `item_${index + 1}`;
        return `def ${name}():\n  return ${index + 1}`;
      }).join("\n");

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Visible Implementation Navigation");

      await page.locator("#editor .view-line").filter({ hasText: "def item_12" }).click();
      await expect.poll(async () => visibleImplementationLines(page)).toContain("def item_12():");

      const before = await visibleImplementationLines(page);
      await page.locator("#editor .view-line").filter({ hasText: "def item_14" }).click();
      await page.waitForTimeout(250);
      await expect.poll(async () => visibleImplementationLines(page)).toEqual(before);
    } finally {
      await context.close();
    }
  });

  it("shows a compilation status marker for selected runnable definitions", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = "def main():\n  print('hi')\n";

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Runnable Header", {
        kind: "definition",
        line: 1,
        name: "main",
        targetKind: "function",
      });

      await expect.poll(async () => page.locator("#snippet-title").textContent()).toBe("Implementation: main");
      await expect.poll(async () => {
        return page.locator("#snippet-status-indicator").getAttribute("data-state");
      }).toBe("complete");
      await expect.poll(async () => page.locator("#snippet-status-indicator").getAttribute("title")).toBe("Ready");
    } finally {
      await context.close();
    }
  });

  it("explains restored running sessions instead of rendering a blank terminal", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let startRequests = 0;
      await page.route("**/api/run/start", async (route) => {
        startRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "restored sessions should not autorun" }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);

      await page.evaluate(async () => {
        const logosWindow = window as LogosWindow;
        const session = logosWindow.createLogosSessionBundle?.();
        if (!session || !logosWindow.loadLogosSession) {
          throw new Error("Logos session helpers are unavailable");
        }

        const source = "def main():\n  print('mandelbrot')\n";
        const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "mandelbrot-run";
        await logosWindow.loadLogosSession({
          ...session,
          sourceTabs: [{
            id: activeSourceTabId,
            projectId: "mandelbrot-run",
            title: "Mandelbrot Run",
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
          run: {
            ...session.run,
            activeToolTabId: "run-main",
            lastRunLabel: "previously",
            lastRunStatusText: "Running main · last run previously",
            tabs: [{
              id: "run-main",
              runnable: "main",
              sourceHash: "mandelbrot-source",
              terminalText: "",
              implementation: source,
              status: { state: "running" },
            }],
          },
        });
      });

      await expect.poll(async () => {
        return page.locator(".terminal-output-text").first().textContent();
      }).toContain("Run was in progress when the session was captured and was not resumed.");
      await expect.poll(async () => page.locator(".terminal-input").first().isDisabled()).toBe(true);
      expect(startRequests).toBe(0);
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

      await page.locator(".runnable-run-widget").first().click();
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

      await page.locator(".runnable-run-widget").first().click();
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

async function loadSource(page: Page, source: string, title: string, selection: unknown = { kind: "none" }): Promise<void> {
  await page.evaluate(async ({ source, title, selection }) => {
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
        selection,
      },
    });
  }, { source, title, selection });
}

async function visibleImplementationLines(page: Page): Promise<string[]> {
  return page.$$eval("#implementation-view-panel .view-line", (lines) => {
    return lines.map((line) => line.textContent?.replaceAll("\u00a0", " ") ?? "");
  });
}

async function outputPaneRightGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shell = document.querySelector("#shell");
    const outputPane = document.querySelector("#output-pane");
    if (!(shell instanceof HTMLElement) || !(outputPane instanceof HTMLElement)) {
      throw new Error("Output pane layout elements are unavailable");
    }

    return shell.getBoundingClientRect().right - outputPane.getBoundingClientRect().right;
  });
}

async function isTerminalInputFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains("terminal-input") === true);
}

async function isDetailsOpen(page: Page, selector: string): Promise<boolean> {
  return page.$eval(selector, (element) => element instanceof HTMLDetailsElement && element.open);
}

async function editorSource(page: Page): Promise<string> {
  return page.evaluate(() => {
    const logosWindow = window as LogosWindow;
    return logosWindow.createLogosSessionBundle?.().editor.value ?? "";
  });
}

async function dispatchEditorKeydown(
  page: Page,
  init: {
    key: string;
    code: string;
    keyCode: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
): Promise<{ dispatched: boolean; defaultPrevented: boolean }> {
  return page.evaluate((init) => {
    const activeElement = document.activeElement;
    const target = activeElement instanceof HTMLElement && document.querySelector("#editor")?.contains(activeElement)
      ? activeElement
      : document.querySelector<HTMLElement>("#editor .native-edit-context, #editor textarea");
    if (!target) {
      throw new Error("Monaco edit target is unavailable");
    }

    target.focus();
    const event = new KeyboardEvent("keydown", {
      key: init.key,
      code: init.code,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      altKey: init.altKey ?? false,
      shiftKey: init.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "keyCode", { get: () => init.keyCode });
    Object.defineProperty(event, "which", { get: () => init.keyCode });

    const dispatched = target.dispatchEvent(event);
    return { dispatched, defaultPrevented: event.defaultPrevented };
  }, init);
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
