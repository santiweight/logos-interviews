import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { AgentCompilationFramework } from "./agentCompilation";
import { completeWithAnthropic, streamCompleteWithAnthropic } from "./anthropicComplete";
import { runClaudeSingleFileAgent } from "./claudeSingleFileAgent";
import type { CodeCache } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";

type TestSourceTab = {
  id: string;
  projectId: string;
  title: string;
  source: string;
  implementation?: string | null;
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

const simpleNaturalSnippetProgram = `function main(): void {
  l\`print hello world\`
}`;

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("live UI TypeScript compile and run e2e", () => {
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    const cache: CodeCache = new Map();
    const agentCompilation = new AgentCompilationFramework({
      cache,
      complete: streamCompleteWithAnthropic,
      fileAgent: runClaudeSingleFileAgent,
    });
    const runApi = createInteractiveRunApi({
      cache,
      complete: completeWithAnthropic,
      compileSheet: (sheet) => agentCompilation.compile(sheet),
    });

    server = await createServer({
      configFile: "vite.config.ts",
      logLevel: "error",
      plugins: [{
        name: "logos-live-api-e2e",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url) {
              next();
              return;
            }

            const pathname = new URL(req.url, "http://localhost").pathname;
            if (pathname === "/api/compile") {
              await handleCompileStream(req, res, cache, streamCompleteWithAnthropic, agentCompilation);
              return;
            }

            if (pathname === "/api/run/start") {
              await runApi.handleStart(req, res);
              return;
            }

            if (pathname === "/api/run/poll") {
              await runApi.handlePoll(req, res);
              return;
            }

            if (pathname === "/api/run/input") {
              await runApi.handleInput(req, res);
              return;
            }

            if (pathname === "/api/run/resize") {
              await runApi.handleResize(req, res);
              return;
            }

            if (pathname === "/api/run/stop") {
              await runApi.handleStop(req, res);
              return;
            }

            next();
          });
        },
      }],
    });
    await server.listen();
    baseUrl = server.resolvedUrls?.local[0] ?? "";
    if (!baseUrl) {
      throw new Error("Vite did not expose a local test URL");
    }

    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("enables Run Main after real Claude compilation and runs through the UI", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithNoImplementation(page, simpleNaturalSnippetProgram, "Live Hello World");

      const compileResponse = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/api/compile");
      }, { timeout: 180_000 });
      await appendTrailingEditorSpace(page);
      const compileText = await (await compileResponse).text();
      expect(compileText).toContain('"kind":"compiled"');

      const runWidget = page.locator(".runnable-run-widget").filter({ hasText: "Run Main" }).first();
      await expect.poll(async () => await runWidget.getAttribute("class"), { timeout: 20_000 })
        .not.toContain("runnable-run-widget-disabled");
      await expect.poll(async () => await runWidget.getAttribute("title"), { timeout: 20_000 })
        .toBe("Run main");

      await runWidget.click();
      await expect.poll(async () => {
        return page.locator(".terminal-output-text").first().textContent();
      }, { timeout: 60_000 }).toMatch(/hello.*world/i);
    } finally {
      await context.close();
    }
  }, 240_000);
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

async function loadSourceWithNoImplementation(page: Page, source: string, title: string): Promise<void> {
  await page.evaluate(async ({ source, title }) => {
    const logosWindow = window as LogosWindow;
    const session = logosWindow.createLogosSessionBundle?.();
    if (!session || !logosWindow.loadLogosSession) {
      throw new Error("Logos session helpers are unavailable");
    }

    const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "live-ui-run";
    await logosWindow.loadLogosSession({
      ...session,
      sourceTabs: [{
        id: activeSourceTabId,
        projectId: title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
        title,
        source,
        implementation: null,
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
        latestImplementationSource: "",
        selection: { kind: "none" },
      },
    });
  }, { source, title });
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
