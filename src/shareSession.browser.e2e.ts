import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("shared session browser flow", () => {
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let baseUrl = "";
  let sharedSessionDir = "";
  let previousSharedSessionDir: string | undefined;

  beforeAll(async () => {
    sharedSessionDir = await mkdtemp(join(tmpdir(), "logos-shared-session-e2e-"));
    previousSharedSessionDir = process.env.SHARED_SESSION_DIR;
    process.env.SHARED_SESSION_DIR = sharedSessionDir;

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
    if (previousSharedSessionDir === undefined) {
      delete process.env.SHARED_SESSION_DIR;
    } else {
      process.env.SHARED_SESSION_DIR = previousSharedSessionDir;
    }
    await rm(sharedSessionDir, { recursive: true, force: true });
  });

  it("shares the current session and imports it from the copied link", async () => {
    if (!browser) {
      throw new Error("Browser did not start");
    }

    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(baseUrl).origin,
    });

    try {
      const source = `def shared_session_e2e_marker():\n  print("share imported")\n`;
      const page = await context.newPage();
      await page.goto(baseUrl);
      await page.waitForFunction(() => {
        const logosWindow = window as LogosWindow;
        return (
          typeof logosWindow.createLogosSessionBundle === "function" &&
          typeof logosWindow.loadLogosSession === "function"
        );
      });

      await page.evaluate(async (nextSource) => {
        const logosWindow = window as LogosWindow;
        const session = logosWindow.createLogosSessionBundle?.();
        if (!session || !logosWindow.loadLogosSession) {
          throw new Error("Logos session helpers are unavailable");
        }

        const activeSourceTabId = session.activeSourceTabId ?? session.sourceTabs[0]?.id ?? "e2e-tab";
        const sourceTabs = session.sourceTabs.length > 0
          ? session.sourceTabs.map((tab) => tab.id === activeSourceTabId
            ? { ...tab, title: "E2E Share", source: nextSource }
            : tab)
          : [{
              id: activeSourceTabId,
              projectId: "e2e",
              title: "E2E Share",
              source: nextSource,
            }];

        await logosWindow.loadLogosSession({
          ...session,
          sourceTabs,
          activeSourceTabId,
          editor: {
            ...session.editor,
            value: nextSource,
            cursor: { lineNumber: 2, column: 26 },
            scrollTop: 0,
            scrollLeft: 0,
          },
          compilation: {
            ...session.compilation,
            latestImplementationSource: nextSource,
          },
        });
      }, source);

      const createResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().includes("/api/shared-sessions");
      });
      await page.getByLabel("Share session link").click();
      const createResponse = await createResponsePromise;
      const createPayload = await createResponse.json() as { ok?: boolean; shareId?: string };
      expect(createPayload).toMatchObject({ ok: true, shareId: expect.any(String) });

      const clipboardText = await page.evaluate(async () => await navigator.clipboard.readText());
      expect(clipboardText).toContain(`session=${createPayload.shareId}`);

      const importedPage = await context.newPage();
      await importedPage.goto(clipboardText);
      await importedPage.waitForFunction((expectedSource) => {
        const logosWindow = window as LogosWindow;
        return logosWindow.createLogosSessionBundle?.().editor.value === expectedSource;
      }, source);

      const importedSource = await importedPage.evaluate(() => {
        return (window as LogosWindow).createLogosSessionBundle?.().editor.value;
      });
      expect(importedSource).toBe(source);
    } finally {
      await context.close();
    }
  });
});
