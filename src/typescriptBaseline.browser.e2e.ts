import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { sampleEvalCases, samples } from "./samples";

const execFileAsync = promisify(execFile);

let serverProcess: ReturnType<typeof spawn> | null = null;
let browser: Browser | null = null;
let baseUrl = "";

describe("Logos-TS browser baseline", () => {
  beforeAll(async () => {
    await execFileAsync("pnpm", ["build"], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn("node", ["dist-server/server.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer(serverProcess, port);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
  });

  it("runs the default Intro to Logos file from the real UI run glyph", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const runnableGlyph = page.locator(".runnable-play-glyph:not(.runnable-play-glyph-disabled)").first();
    await runnableGlyph.waitFor({ state: "visible", timeout: 15_000 });
    await runnableGlyph.click();

    await page.waitForFunction(
      () => document.body.innerText.includes("Regular TypeScript: 9") &&
        document.body.innerText.includes("Logos: 9") &&
        document.body.innerText.includes("Mixed Logos: 9") &&
        document.body.innerText.includes("18"),
      undefined,
      { timeout: 120_000 },
    );

    expect(browserErrors).toEqual([]);
    await context.close();
  }, 180_000);

  it("streams generated Intro snippet completions through the compiler endpoint", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const intro = samples.find((sample) => sample.id === "starter-arithmetic");
    expect(intro).toBeDefined();
    if (!intro) {
      return;
    }

    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const events = await page.evaluate(async (sheet) => {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet, compilationStrategy: "sequential" }),
      });
      const text = await response.text();
      return text.trim().split("\n").map((line) => JSON.parse(line)) as Array<{
        kind: string;
        implementation?: string;
      }>;
    }, intro.code);

    const completions = events.filter((event) => event.kind === "llm-complete" || event.kind === "cache-hit");
    expect(completions.length).toBeGreaterThanOrEqual(5);
    expect(completions.some((event) => event.implementation?.includes("function add"))).toBe(true);
    expect(completions.some((event) => event.implementation?.includes("function mul"))).toBe(true);
    expect(completions.some((event) => event.implementation?.includes('console.log("Logos:"'))).toBe(true);
    expect(completions.some((event) => event.implementation?.includes('console.log("mul 3 and 4")'))).toBe(false);
  }, 180_000);

  it("runs a migrated class sample through the server run API", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const sample = samples.find((item) => item.id === "beyond-basics");
    expect(sample).toBeDefined();
    if (!sample) {
      return;
    }

    const result = await runSheetViaApi(sample.code, "magic_square_example");

    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/magic square/i);
    expect(result.text).toMatch(/valid|row|column|diagonal/i);
  }, 180_000);

  it("runs the portfolio viewer as an HTML app artifact", async () => {
    const testCase = sampleEvalCases.find((item) => item.sampleId === "portfolio-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }

    const result = await runSheetViaApi(testCase.sheet, testCase.runnable);
    expect(result.ok).toBe(true);
    expect(result.artifacts.length).toBeGreaterThan(0);
    const html = result.artifacts.find((artifact) => artifact.kind === "html")?.content;
    expect(html).toBeDefined();
    if (html === undefined) return;

    if (!browser) {
      throw new Error("Browser was not started");
    }
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });

    await page.setContent(html, { waitUntil: "load" });
    const text = await page.locator("body").innerText();
    expect(text).toContain("Portfolio");
    expect(text).toMatch(/NAV|P&L|Return/i);
    expect(text).toMatch(/Asset Class|Instrument|Contributor|Detractor/i);

    expect(browserErrors).toEqual([]);
  }, 240_000);
});

async function runSheetViaApi(sheet: string, runnable: string): Promise<{
  ok: boolean;
  text: string;
  artifacts: Array<{ kind: "html"; content: string }>;
}> {
  if (!browser) {
    throw new Error("Browser was not started");
  }

  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  return await page.evaluate(async ({ sheet, runnable }) => {
    const start = await fetch("/api/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, runnable, compilationStrategy: "sequential" }),
    });
    const started = await start.json() as {
      ok: boolean;
      sessionId: string;
      chunks?: Array<{ stream: string; text: string }>;
      artifacts?: Array<{ kind: "html"; content: string }>;
      status?: { state: string };
      error?: string;
    };
    if (!started.ok || !started.status || !started.chunks || !started.artifacts) {
      return { ok: false, text: started.error ?? "start failed", artifacts: [] };
    }

    const chunks = [...started.chunks];
    let artifacts = [...started.artifacts];
    let status = started.status;
    for (let attempt = 0; attempt < 240 && status.state !== "exited"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await fetch("/api/run/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: started.sessionId }),
      });
      const polled = await poll.json() as {
        ok: boolean;
        chunks?: Array<{ stream: string; text: string }>;
        artifacts?: Array<{ kind: "html"; content: string }>;
        status?: { state: string };
        error?: string;
      };
      if (!polled.ok || !polled.status || !polled.chunks || !polled.artifacts) {
        return { ok: false, text: polled.error ?? "poll failed", artifacts };
      }
      chunks.push(...polled.chunks);
      artifacts = artifacts.concat(polled.artifacts);
      status = polled.status;
    }

    return {
      ok: status.state === "exited",
      text: chunks.map((chunk) => chunk.text).join(""),
      artifacts,
    };
  }, { sheet, runnable });
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const port = address.port;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error("Could not allocate a free port")));
    });
    server.on("error", reject);
  });
}

async function waitForServer(process: ReturnType<typeof spawn>, port: number): Promise<void> {
  const expected = `listening on ${port}`;
  let output = "";

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start. Output:\n${output}`));
    }, 20_000);

    process.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolve();
      }
    });
    process.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    process.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}. Output:\n${output}`));
    });
    process.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
