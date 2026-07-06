import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { LoadableSession } from "../../ui/types";

type LogosWindow = Window & {
  createLogosSessionBundle?: () => LoadableSession;
  loadLogosSession?: (session: LoadableSession) => Promise<void>;
};

const targetSheetId = "live-agent-flow";
const controlSheetId = "scratch-control";
const firstProgramSheetId = "live-first-program";
const secondProgramSheetId = "live-second-program";
const expectedRunText = "logos ui e2e ok";
const firstProgramRunText = "logos first tab ok";
const secondProgramRunText = "logos second tab ok";
const simpleNaturalSnippetProgram = `function main(): void {
  l\`print exactly: ${expectedRunText}\`
}`;
const firstNaturalSnippetProgram = `function main(): void {
  l\`print exactly: ${firstProgramRunText}\`
}`;
const secondNaturalSnippetProgram = `function main(): void {
  l\`print exactly: ${secondProgramRunText}\`
}`;

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.LOGOS_ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("live UI TypeScript compile and run e2e", () => {
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
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("compiles a selected sheet through the live Agent View and runs Main", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadTwoSheetSession(page);

      await page.locator(`[data-source-tab-id="${targetSheetId}"]`).click();

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => await runWidget.getAttribute("data-ready")).toBe("false");
      await expect.poll(async () => await runWidget.getAttribute("title"))
        .toBe("main is waiting for its implementation.");

      const compileStarted = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/api/sheet/compile");
      }, { timeout: 30_000 });
      await appendTrailingEditorText(page, "\n// compile trigger");
      await compileStarted;

      await page.locator("[data-tool-tab-id='agent-view']").click();
      await expect.poll(async () => await page.locator("[data-agent-status='running']").textContent(), {
        timeout: 60_000,
      }).toMatch(/Agent is generating code|Waiting for Claude to finish/i);
      await expect.poll(async () => await page.locator("#agent-view-panel").textContent(), {
        timeout: 60_000,
      }).toMatch(/Scaffold generated|Implementation updated|Waiting for Claude/i);

      await expect.poll(async () => await page.locator("[data-agent-status='running']").count(), {
        timeout: 30_000,
      }).toBe(0);

      await expect.poll(async () => await runWidget.getAttribute("data-ready"), { timeout: 30_000 })
        .toBe("true");
      await expect.poll(async () => await runWidget.getAttribute("title"), { timeout: 30_000 })
        .toBe("Run main");

      await runWidget.click();
      await expect.poll(async () => await xtermText(page), { timeout: 180_000 })
        .toMatch(/logos ui e2e ok/i);
    } finally {
      await context.close();
    }
  }, 360_000);

  it("compiles and runs after switching to a different watched sheet", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadTwoProgramSession(page);

      await compileActiveSheetAndRun(page, {
        trigger: "\n// compile first program",
        expectedOutput: /logos first tab ok/i,
      });

      await page.locator(`[data-source-tab-id="${secondProgramSheetId}"]`).click();
      await page.locator("[data-tool-tab-id='agent-view']").click();
      await expect.poll(async () => await page.locator("#agent-view-panel").textContent(), {
        timeout: 240_000,
      }).toMatch(/Scaffold generated|Implementation updated|Compilation complete|console\.log/i);
      await expect.poll(async () => await page.locator("[data-agent-status='running']").count(), {
        timeout: 30_000,
      }).toBe(0);

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => await runWidget.getAttribute("data-ready"), { timeout: 30_000 })
        .toBe("true");
      await expect.poll(async () => await runWidget.getAttribute("title"), { timeout: 30_000 })
        .toBe("Run main");

      await runWidget.click();
      await expect.poll(async () => await xtermText(page), { timeout: 180_000 })
        .toMatch(/logos second tab ok/i);
    } finally {
      await context.close();
    }
  }, 420_000);
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

async function loadTwoSheetSession(page: Page): Promise<void> {
  await page.evaluate(async ({ targetSheetId, controlSheetId, source }) => {
    const logosWindow = window as LogosWindow;
    const session = logosWindow.createLogosSessionBundle?.();
    if (!session || !logosWindow.loadLogosSession) {
      throw new Error("Logos session helpers are unavailable");
    }

    await logosWindow.loadLogosSession({
      ...session,
      sourceTabs: [
        {
          id: controlSheetId,
          projectId: controlSheetId,
          title: "Control Sheet",
          source: "",
          implementation: "",
        },
        {
          id: targetSheetId,
          projectId: targetSheetId,
          title: "Live Agent Flow",
          source,
          implementation: null,
        },
      ],
      activeSourceTabId: controlSheetId,
      editor: {
        ...session.editor,
        value: "",
        cursor: { lineNumber: 1, column: 1 },
        scrollTop: 0,
        scrollLeft: 0,
      },
      compilation: {
        ...session.compilation,
        latestImplementationSource: "",
        selection: { kind: "none" },
      },
      run: {
        ...session.run,
        activeToolTabId: "implementation-view",
        tabs: [],
      },
    });
  }, { targetSheetId, controlSheetId, source: simpleNaturalSnippetProgram });
}

async function loadTwoProgramSession(page: Page): Promise<void> {
  await page.evaluate(async ({
    firstProgramSheetId,
    secondProgramSheetId,
    firstSource,
    secondSource,
  }) => {
    const logosWindow = window as LogosWindow;
    const session = logosWindow.createLogosSessionBundle?.();
    if (!session || !logosWindow.loadLogosSession) {
      throw new Error("Logos session helpers are unavailable");
    }
    const firstSheetResponse = await fetch("/api/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: firstProgramSheetId,
        projectId: firstProgramSheetId,
        title: "Live First Program",
        source: firstSource,
      }),
    });
    const secondSheetResponse = await fetch("/api/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: secondProgramSheetId,
        projectId: secondProgramSheetId,
        title: "Live Second Program",
        source: secondSource,
      }),
    });
    const firstSheet = await firstSheetResponse.json() as { sheet?: { currentSessionId?: string | null } };
    const secondSheet = await secondSheetResponse.json() as { sheet?: { currentSessionId?: string | null } };

    await logosWindow.loadLogosSession({
      ...session,
      sourceTabs: [
        {
          id: firstProgramSheetId,
          projectId: firstProgramSheetId,
          title: "Live First Program",
          source: firstSource,
          implementation: null,
          compileSessionId: firstSheet.sheet?.currentSessionId ?? null,
        },
        {
          id: secondProgramSheetId,
          projectId: secondProgramSheetId,
          title: "Live Second Program",
          source: secondSource,
          implementation: null,
          compileSessionId: secondSheet.sheet?.currentSessionId ?? null,
        },
      ],
      activeSourceTabId: firstProgramSheetId,
      editor: {
        ...session.editor,
        value: firstSource,
        cursor: { lineNumber: 1, column: 1 },
        scrollTop: 0,
        scrollLeft: 0,
      },
      compilation: {
        ...session.compilation,
        latestImplementationSource: "",
        selection: { kind: "none" },
      },
      run: {
        ...session.run,
        activeToolTabId: "implementation-view",
        tabs: [],
      },
    });
  }, {
    firstProgramSheetId,
    secondProgramSheetId,
    firstSource: firstNaturalSnippetProgram,
    secondSource: secondNaturalSnippetProgram,
  });
}

async function compileActiveSheetAndRun(
  page: Page,
  options: { trigger: string; expectedOutput: RegExp },
): Promise<void> {
  const compileStarted = page.waitForResponse((response) => {
    return response.request().method() === "POST" && response.url().endsWith("/api/sheet/compile");
  }, { timeout: 30_000 });
  await appendTrailingEditorText(page, options.trigger);
  await compileStarted;

  await page.locator("[data-tool-tab-id='agent-view']").click();
  await expect.poll(async () => await page.locator("[data-agent-status='running']").count(), {
    timeout: 30_000,
  }).toBe(0);

  const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
  await expect.poll(async () => await runWidget.getAttribute("data-ready"), { timeout: 30_000 })
    .toBe("true");
  await runWidget.click();
  await expect.poll(async () => await xtermText(page), { timeout: 180_000 })
    .toMatch(options.expectedOutput);
}

async function appendTrailingEditorText(page: Page, text: string): Promise<void> {
  const before = await page.evaluate(() => (window as LogosWindow).createLogosSessionBundle?.().editor.value ?? "");
  await page.locator("#editor").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText(text);
  await expect.poll(async () => {
    return page.evaluate(() => (window as LogosWindow).createLogosSessionBundle?.().editor.value);
  }).toBe(`${before}${text}`);
}

async function xtermText(page: Page): Promise<string> {
  return await page.locator(".terminal-output.tab-panel.active .terminal-xterm-host .xterm-rows").first().textContent() ?? "";
}
