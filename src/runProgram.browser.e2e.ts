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
        return xtermText(page);
      }).toContain("hi");

      expect(startResponse.status()).toBe(200);
      expect(interactiveStartRequests).toHaveLength(1);
      expect(runOnceRequests).toEqual([]);
      expect(await isXtermFocused(page)).toBe(false);
    } finally {
      await context.close();
    }
  });

  it("compiles and runs a simple TypeScript natural-snippet program in the UI", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function main() {
  l\`print hello world\`
}`;
      const implementation = `function main(): void {
  console.log("hello world");
}`;
      let compileRequests = 0;
      let runStartRequests = 0;

      await page.route("**/api/compile", async (route) => {
        expect(route.request().method()).toBe("POST");
        const body = route.request().postDataJSON() as { sheet?: string };
        if (body.sheet?.trim() === source) {
          compileRequests += 1;
        }
        const responseImplementation = body.sheet?.trim() === source ? implementation : body.sheet ?? "";
        await route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: [
            JSON.stringify({
              kind: "implementation",
              implementation: responseImplementation,
              completedSnippets: 1,
              totalSnippets: 1,
            }),
            JSON.stringify({
              kind: "readiness",
              definitions: [{ name: "main", ready: true, blockingDependencies: [] }],
            }),
            JSON.stringify({
              kind: "compiled",
              implementation: responseImplementation,
              completedSnippets: 1,
              totalSnippets: 1,
            }),
            "",
          ].join("\n"),
        });
      });

      await page.route("**/api/run/start", async (route) => {
        runStartRequests += 1;
        const body = route.request().postDataJSON() as { sheet?: string; runnable?: string };
        expect(body.sheet?.trim()).toBe(source);
        expect(body.runnable).toBe("main");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "hello-world-run-session",
            runnable: "main",
            implementation,
            chunks: [{ stream: "stdout", text: "hello world\n" }],
            status: { state: "exited", code: 0, signal: null },
          }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Hello World");
      await appendTrailingEditorSpace(page);

      await expect.poll(() => compileRequests).toBeGreaterThan(0);
      await expect.poll(async () => {
        return (await page.locator("#implementation-view-panel .view-line").first().textContent())
          ?.replaceAll("\u00a0", " ");
      }).toContain("function main");
      await expect.poll(async () => page.locator("#run-status").textContent()).not.toContain("Code is being generated");

      await page.locator(".runnable-run-widget").first().click();
      await expect.poll(() => runStartRequests).toBe(1);
      await expect.poll(async () => {
        return xtermText(page);
      }).toContain("hello world");
    } finally {
      await context.close();
    }
  });

  it("renders a ReactApp runnable in an iframe run panel", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function hello_app(): ReactApp {
  l\`render hello world\`
}`;
      const implementation = `function hello_app(): ReactApp {
  const [message, setMessage] = React.useState("hello world");
  return React.createElement(
    "main",
    { style: { minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "sans-serif" } },
    React.createElement("button", { onClick: () => setMessage("clicked") }, message)
  );
}`;

      await page.route("**/api/run/start", async (route) => {
        const body = route.request().postDataJSON() as { sheet?: string; runnable?: string };
        expect(body.sheet?.trim()).toBe(source);
        expect(body.runnable).toBe("hello_app");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            kind: "react",
            runId: "hello-react-run",
            runnable: "hello_app",
            implementation,
            appCode: `function hello_app() {
  const [message, setMessage] = React.useState("hello world");
  return React.createElement(
    "main",
    { style: { minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "sans-serif" } },
    React.createElement("button", { onClick: () => setMessage("clicked") }, message)
  );
}`,
            status: { state: "exited", code: 0, signal: null },
          }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithImplementation(page, source, implementation, "Hello ReactApp");

      const runWidget = page.locator(".runnable-run-widget").first();
      await expect.poll(async () => await runWidget.getAttribute("class")).not.toContain("runnable-run-widget-disabled");
      await runWidget.click();

      const frame = page.frameLocator(".react-app-run-frame").first();
      await expect.poll(async () => frame.locator("button").textContent()).toBe("hello world");
      await frame.locator("button").click();
      await expect.poll(async () => frame.locator("button").textContent()).toBe("clicked");
      await expect.poll(async () => page.locator(".terminal-xterm-host").first().isHidden()).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("enables Run Main from the completed implementation even if readiness stayed stale", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function main(): void {
  l\`print hello world\`
}`;
      const implementation = `function main(): void {
  function message(): string {
    return "hello world";
  }

  console.log(message());
}`;
      let runStartRequests = 0;

      await page.route("**/api/compile", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: [
            JSON.stringify({
              kind: "implementation",
              implementation,
              completedSnippets: 1,
              totalSnippets: 1,
            }),
            JSON.stringify({
              kind: "readiness",
              definitions: [{
                name: "main",
                ready: false,
                reason: "implementation",
                dependencies: [],
                blockingDependencies: [],
              }],
            }),
            JSON.stringify({
              kind: "compiled",
              implementation,
              completedSnippets: 1,
              totalSnippets: 1,
            }),
            "",
          ].join("\n"),
        });
      });

      await page.route("**/api/run/start", async (route) => {
        runStartRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "stale-readiness-run-session",
            runnable: "main",
            implementation,
            chunks: [{ stream: "stdout", text: "hello world\n" }],
            status: { state: "exited", code: 0, signal: null },
          }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSource(page, source, "Stale Readiness Hello World");
      await appendTrailingEditorSpace(page);

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => {
        return (await page.locator("#implementation-view-panel .view-line").first().textContent())
          ?.replaceAll("\u00a0", " ");
      }).toContain("function main");
      await expect.poll(async () => await runWidget.getAttribute("aria-disabled")).toBe("false");
      await expect.poll(async () => await runWidget.getAttribute("title")).toBe("Run main");

      await runWidget.click();
      await expect.poll(() => runStartRequests).toBe(1);
      await expect.poll(async () => {
        return xtermText(page);
      }).toContain("hello world");
    } finally {
      await context.close();
    }
  });

  it("uses a restored TypeScript implementation to keep Run Main enabled", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function main(): void {
  l\`print hello world\`
}`;
      const implementation = `function main(): void {
  console.log("hello world");
}`;

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithImplementation(page, source, implementation, "Restored Hello World");

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => await runWidget.getAttribute("class")).not.toContain("runnable-run-widget-disabled");
      await expect.poll(async () => await runWidget.getAttribute("title")).toBe("Run main");
    } finally {
      await context.close();
    }
  });

  it("renders blocked Run Main as disabled instead of green", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function main(): void {
  l\`print hello world\`
}`;

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithImplementation(page, source, "", "Blocked Hello World");

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => await runWidget.getAttribute("aria-disabled")).toBe("true");
      await expect.poll(async () => await runWidget.getAttribute("class")).toContain("runnable-run-widget-disabled");
      await expect.poll(async () => {
        return runWidget.evaluate((node) => getComputedStyle(node).color);
      }).not.toBe("rgb(25, 184, 90)");
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
      await expect.poll(() => compileRequestsAfterClear).toBe(1);
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

  it("lets Monaco keep editor shortcuts while leaving browser location bar shortcuts alone", async () => {
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

      await page.keyboard.press(`${primaryModifier}+A`);
      await page.keyboard.type("selected");
      await expect.poll(async () => editorSource(page)).toBe("selected");

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
        return xtermText(page);
      }).toContain("Run was in progress when the session was captured and was not resumed.");
      await expect.poll(async () => page.locator(".terminal-input").count()).toBe(0);
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
      const inputs: string[] = [];
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
        inputs.push(body.input ?? "");
        if (inputs.join("").includes("logos\r")) {
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
      await expect.poll(async () => page.locator(".terminal-input").count()).toBe(0);
      expect(await isXtermFocused(page)).toBe(false);

      await page.locator(".terminal-xterm-host").first().click();
      expect(await isXtermFocused(page)).toBe(true);
      await page.keyboard.press("Tab");
      await expect.poll(() => inputs.filter((input) => input === "\t").length).toBe(1);
      expect(await isXtermFocused(page)).toBe(true);
      await page.keyboard.type("logos");
      await page.keyboard.press("Enter");

      await expect.poll(() => inputs.join("")).toContain("logos\r");
      await expect.poll(async () => xtermText(page)).toContain("sogol");
    } finally {
      await context.close();
    }
  });

  it("renders runs through xterm instead of the legacy textbox", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const source = `function main(): void {
  l\`render a neo-blessed todo dashboard\`
}`;
      const implementation = `import blessed from "neo-blessed";

function main(): void {
  const screen = blessed.screen({ smartCSR: true, title: "Todo Dashboard" });
  const box = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    content: "Todo Dashboard\\n[ ] Review leads",
  });
  void box;
  screen.key(["q"], () => process.exit(0));
  screen.render();
}`;
      const tuiFrame = "\x1b[?1049h\x1b[2J\x1b[HTodo Dashboard\r\n[ ] Review leads";
      const inputs: string[] = [];
      const resizes: Array<{ cols: number; rows: number }> = [];

      await page.route("**/api/run/start", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            sessionId: "todo-tui-session",
            runnable: "main",
            implementation,
            chunks: [{ stream: "stdout", text: tuiFrame }],
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
            implementation,
            chunks: [],
            status: { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/input", async (route) => {
        const body = route.request().postDataJSON() as { input?: string };
        inputs.push(body.input ?? "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      });
      await page.route("**/api/run/resize", async (route) => {
        const body = route.request().postDataJSON() as { cols?: number; rows?: number };
        if (typeof body.cols === "number" && typeof body.rows === "number") {
          resizes.push({ cols: body.cols, rows: body.rows });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithImplementation(page, source, implementation, "Todo TUI");

      await page.locator(".runnable-run-widget").first().click();

      await expect.poll(async () => page.locator(".terminal-xterm-host .xterm-rows").first().textContent())
        .toContain("Review leads");
      await expect.poll(async () => page.locator(".terminal-output-text").count()).toBe(0);
      await expect.poll(async () => page.locator(".terminal-input").count()).toBe(0);
      await expect.poll(async () => page.locator(".terminal-xterm-host .xterm-rows").first().textContent())
        .not.toContain("\x1b[");

      await resizeOutputPaneDeterministically(page);
      await expect.poll(async () => (await terminalPanelMetrics(page)).rightGap).toBeLessThan(2);
      await expect.poll(() => {
        const cols = resizes.map((resize) => resize.cols);
        return Math.max(...cols) - Math.min(...cols);
      }).toBeGreaterThan(5);

      await page.locator(".terminal-xterm-host").first().click();
      await page.keyboard.press("q");
      await expect.poll(() => inputs).toContain("q");
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
      const inputs: string[] = [];
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
            status: shouldExit ? { state: "exited", code: 0, signal: null } : { state: "running" },
          }),
        });
      });
      await page.route("**/api/run/input", async (route) => {
        const body = route.request().postDataJSON() as { input?: string };
        inputs.push(body.input ?? "");
        shouldExit = inputs.join("").includes("quit\r");
        if (shouldExit) {
          pendingPollChunks.push({ stream: "stdout", text: "quit\r\n" });
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
      await expect.poll(async () => page.locator(".terminal-input").count()).toBe(0);
      expect(await isXtermFocused(page)).toBe(false);

      await page.locator(".terminal-output").first().click();
      expect(await isXtermFocused(page)).toBe(true);
      await page.keyboard.type("quit");
      await page.keyboard.press("Enter");

      await expect.poll(() => inputs.join("")).toContain("quit\r");
      await expect.poll(async () => xtermText(page)).toContain("quit");
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

async function loadSourceWithImplementation(
  page: Page,
  source: string,
  implementation: string,
  title: string,
): Promise<void> {
  await page.evaluate(async ({ source, implementation, title }) => {
    const logosWindow = window as LogosWindow;
    const session = logosWindow.createLogosSessionBundle?.();
    if (!session || !logosWindow.loadLogosSession) {
      throw new Error("Logos session helpers are unavailable");
    }

    const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "browser-restored-run";
    await logosWindow.loadLogosSession({
      ...session,
      sourceTabs: [{
        id: activeSourceTabId,
        projectId: title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
        title,
        source,
        implementation,
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
        latestImplementationSource: implementation,
        selection: { kind: "none" },
      },
    });
  }, { source, implementation, title });
}

async function appendTrailingEditorSpace(page: Page): Promise<void> {
  const before = await page.evaluate(() => (window as LogosWindow).createLogosSessionBundle?.().editor.value ?? "");
  await page.locator("#editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText(" ");
  await expect.poll(async () => {
    return page.evaluate(() => (window as LogosWindow).createLogosSessionBundle?.().editor.value);
  }).toBe(`${before} `);
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

async function xtermText(page: Page): Promise<string> {
  return await page.locator(".terminal-xterm-host .xterm-rows").first().textContent() ?? "";
}

async function isXtermFocused(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea") === true);
}

async function terminalPanelMetrics(page: Page): Promise<{ panelWidth: number; hostWidth: number; rightGap: number }> {
  return page.evaluate(() => {
    const outputPane = document.querySelector("#output-pane");
    const panel = document.querySelector(".terminal-output.tab-panel.active");
    const host = document.querySelector(".terminal-xterm-host");
    if (!(outputPane instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(host instanceof HTMLElement)) {
      throw new Error("Terminal panel is unavailable");
    }

    const outputRect = outputPane.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      panelWidth: panelRect.width,
      hostWidth: hostRect.width,
      rightGap: Math.abs(outputRect.right - panelRect.right),
    };
  });
}

async function resizeOutputPaneDeterministically(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shell = document.querySelector("#shell");
    if (!(shell instanceof HTMLElement)) {
      throw new Error("Shell is unavailable");
    }

    shell.style.setProperty("--code-pane-basis", "900px");
    shell.style.setProperty("--code-pane-grow", "0");
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const shell = document.querySelector("#shell");
    if (!(shell instanceof HTMLElement)) {
      throw new Error("Shell is unavailable");
    }

    shell.style.setProperty("--code-pane-basis", "500px");
    shell.style.setProperty("--code-pane-grow", "0");
  });
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
