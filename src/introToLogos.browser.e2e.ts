import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { AgentCompilationFramework } from "./agentCompilation";
import {
  completeWithAnthropic,
  streamCompleteWithAnthropic,
} from "./anthropicComplete";
import { runClaudeSingleFileAgent } from "./claudeSingleFileAgent";
import type { CodeCache } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";

type TestLoadableSession = {
  sourceTabs: Array<{
    id: string;
    projectId: string;
    title: string;
    source: string;
    implementation?: string | null;
  }>;
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

const introToLogosSource = `// Logos is a natural-language programming environment for TypeScript.
//
// Click Run Main to compile and run this file.
// Click generated code to inspect the implementation.
//
// Try edits:
//   1. change the range to 50-100, or 100-200
//   2. print the numbers in a formatted grid

function main(): void {
  l\`
  Print all prime numbers from 1 to 50 in a rainbow gradient
  in a 3-wide grid.

  The first number is red, the last is indigo.
  \`
}`;

const describeE2E = process.env.RUN_E2E === "true" ? describe : describe.skip;

describeE2E("intro to logos e2e", () => {
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
      plugins: [
        {
          name: "logos-intro-e2e-api",
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (!req.url) {
                next();
                return;
              }

              const pathname = new URL(req.url, "http://localhost").pathname;

              if (pathname === "/api/compile") {
                await handleCompileStream(
                  req,
                  res,
                  cache,
                  streamCompleteWithAnthropic,
                  agentCompilation,
                );
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
        },
      ],
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

  it("compiles and runs intro to logos from an empty cache", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(baseUrl);
      await waitForSessionHelpers(page);
      await loadSourceWithNoImplementation(
        page,
        introToLogosSource,
        "Intro to Logos",
      );

      // With empty cache, Run Main should be disabled
      const runWidget = page
        .locator(".runnable-run-widget")
        .filter({ hasText: "Run Main" })
        .first();
      await expect
        .poll(async () => await runWidget.getAttribute("aria-disabled"))
        .toBe("true");

      // Trigger compilation
      await triggerCompilation(page);
      await expect
        .poll(
          async () => {
            return implementationViewText(page);
          },
          { timeout: 10_000 },
        )
        .toContain("Code is being generated");

      // Wait for compilation to complete
      await expect
        .poll(
          async () => {
            return implementationViewText(page);
          },
          { timeout: 180_000 },
        )
        .not.toContain("Code is being generated");

      // After compilation, the implementation should have real code
      const implText = await implementationViewText(page);
      expect(implText).not.toContain("No implementation yet.");
      expect(implText.length).toBeGreaterThan(20);

      // Debug: check widget state
      const debugInfo = await page.evaluate(() => {
        const widget = document.querySelector(".runnable-run-widget");
        return {
          title: widget?.getAttribute("title"),
          ariaDisabled: widget?.getAttribute("aria-disabled"),
          classes: widget?.getAttribute("class"),
          text: widget?.textContent,
        };
      });
      console.log("Run widget state after compilation:", JSON.stringify(debugInfo, null, 2));

      // Run Main should become enabled
      await expect
        .poll(async () => await runWidget.getAttribute("aria-disabled"), {
          timeout: 180_000,
        })
        .toBe("false");
      await expect
        .poll(async () => await runWidget.getAttribute("title"), {
          timeout: 10_000,
        })
        .toBe("Run main");

      // Click Run Main
      await runWidget.click();

      // Wait for terminal output — should contain something (prime numbers, or any output)
      await expect
        .poll(
          async () => {
            return xtermText(page);
          },
          { timeout: 60_000 },
        )
        .toMatch(/.{5,}/);

      // Sanity: output should not contain error traces
      const output = await xtermText(page);
      expect(output).not.toMatch(
        /Error:|TypeError:|ReferenceError:|SyntaxError:/,
      );
    } finally {
      await context.close();
    }
  }, 300_000);
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

async function loadSourceWithNoImplementation(
  page: Page,
  source: string,
  title: string,
): Promise<void> {
  await page.evaluate(
    async ({ source, title }) => {
      const logosWindow = window as LogosWindow;
      const session = logosWindow.createLogosSessionBundle?.();
      if (!session || !logosWindow.loadLogosSession) {
        throw new Error("Logos session helpers are unavailable");
      }

      const activeSourceTabId =
        session.activeSourceTabId ??
        session.sourceTabs[0]?.id ??
        "intro-logos-e2e";
      await logosWindow.loadLogosSession({
        ...session,
        sourceTabs: [
          {
            id: activeSourceTabId,
            projectId: "intro-to-logos",
            title,
            source,
            implementation: null,
          },
        ],
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
    },
    { source, title },
  );
}

async function triggerCompilation(page: Page): Promise<void> {
  await page.locator("#editor").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
  );
  await page.keyboard.press("End");
  await page.keyboard.insertText(" ");
}

async function implementationViewText(page: Page): Promise<string> {
  const text = (await page.locator("#implementation-view-panel").textContent()) ?? "";
  return text.replaceAll(" ", " ");
}

async function xtermText(page: Page): Promise<string> {
  return (
    (await page
      .locator(".terminal-xterm-host .xterm-rows")
      .first()
      .textContent()) ?? ""
  );
}
