import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { completeWithAnthropic } from "./anthropicComplete";
import { checkCode, checkWebPage, generateCode } from "./codegenQualityChecks";
import { sampleAppEvalCases, sampleEvalCases, samples } from "./samples";
import { runTypeScript } from "./typescriptTarget";

const execFileAsync = promisify(execFile);

let serverProcess: ReturnType<typeof spawn> | null = null;
let browser: Browser | null = null;
let baseUrl = "";
const codegenCounterSheet = `function main(): WebPage {
  \`\`\`
  a counter that starts at 0 and increments each time the button is clicked
  \`\`\`
}`;
const codegenCounterBody = `const incrementScript = "window.incrementCounter = () => { const el = document.getElementById('count'); if (!el) return; el.textContent = String(Number(el.textContent || '0') + 1); };";
return shadcn.renderApp(
  shadcn.Page({ title: "Counter Button", description: "Counter demo" },
    shadcn.Card(
      shadcn.CardHeader(
        shadcn.CardTitle("Counter"),
        shadcn.CardDescription("Click the button to increment the value."),
      ),
      shadcn.CardContent(
        shadcn.Stack(
          shadcn.Metric({ id: "count" }, "0"),
          shadcn.Button({ id: "increment", onClick: "window.incrementCounter()" }, "Increment"),
        ),
      ),
    ),
  ),
  { title: "Counter Button", scripts: [incrementScript] },
);`;
const borkedCounterHtmlFixture = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style data-shadcn-runtime="true"></style>
</head>
<body>
  <main>
    <h1>Counter Button</h1>
    <section>
      <h2>Counter</h2>
      <div id="counter-value">Count0</div>
      <button type="button">Incrementincrement()</button>
    </section>
  </main>
</body>
</html>`;
const itIfAnthropicCodegen = process.env.RUN_ANTHROPIC_CODEGEN_E2E === "true" && process.env.ANTHROPIC_API_KEY
  ? it
  : it.skip;

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

  it("runs the default Counter Button app from the real UI run glyph", async () => {
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

    await page.locator(".run-artifact-frame").waitFor({ state: "attached", timeout: 120_000 });
    const frame = page.frameLocator(".run-artifact-frame");
    await expect.poll(async () => frame.locator("#count").textContent(), { timeout: 120_000 }).toBe("0");
    await frame.locator("#increment").click();
    await expect.poll(async () => frame.locator("#count").textContent(), { timeout: 15_000 }).toBe("1");
    await frame.locator("#increment").click();
    await expect.poll(async () => frame.locator("#count").textContent(), { timeout: 15_000 }).toBe("2");

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

  it("runs the human Sudoku viewer as an HTML app artifact", async () => {
    const testCase = sampleAppEvalCases.find((item) => item.sampleId === "sudoku-human-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }

    const result = await runSheetViaApi(testCase.sheet, testCase.runnable);
    expect(result.ok).toBe(true);
    const html = result.artifacts.find((artifact) => artifact.kind === "html")?.content;
    expect(html).toBeDefined();
    if (html === undefined) return;
    expect(testCase.htmlCheck.matches(html)).toBe(true);

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
    await expect.poll(async () => page.locator(".sudoku-cell").count()).toBe(81);
    const text = await page.locator("body").innerText();
    expect(text).toContain("Human Sudoku Strategy Viewer");
    expect(text).toContain("No guessing");
    expect(text).toContain("Unique Box Solve");
    expect(browserErrors).toEqual([]);
    await page.close();
  }, 240_000);

  it("renders a hard-coded shadcn counter HTML artifact and handles clicks", async () => {
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

    await page.setContent(shadcnCounterHtmlFixture(), { waitUntil: "load" });
    await expect.poll(async () => page.locator("#count").textContent()).toBe("0");
    await page.locator("#increment").click();
    await expect.poll(async () => page.locator("#count").textContent()).toBe("1");
    await page.locator("#increment").click();
    await expect.poll(async () => page.locator("#count").textContent()).toBe("2");
    expect(browserErrors).toEqual([]);
    await page.close();
  });

  it("checks generated counter code, webpage quality, and click behavior", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const generated = await generateCode(codegenCounterSheet, "main", {
      cache: new Map(),
      complete: () => codegenCounterBody,
    });
    expect(checkCode(generated.code, {
      expectedKind: "webpage",
      promptFragments: ["a counter that starts at 0 and increments each time the button is clicked"],
      requiredSubstrings: ["shadcn.renderApp", "shadcn.Button"],
    })).toEqual({ ok: true, failures: [] });

    const result = await runTypeScript(generated.code);
    expect(result.ok).toBe(true);
    const html = result.artifacts.find((artifact) => artifact.kind === "html")?.content;
    expect(html).toBeDefined();
    if (html === undefined) return;

    const page = await browser.newPage();
    const pageCheck = await checkWebPage(page, html, { expectShadcn: true, minVisibleTextLength: 20 });
    expect(pageCheck).toEqual({ ok: true, failures: [] });
    await expect.poll(async () => page.locator("#count").textContent()).toBe("0");
    await page.locator("#increment").click();
    await expect.poll(async () => page.locator("#count").textContent()).toBe("1");
    await page.locator("#increment").click();
    await expect.poll(async () => page.locator("#count").textContent()).toBe("2");
    await page.close();
  });

  it("rejects webpages that visibly render object values", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const page = await browser.newPage();
    const result = await checkWebPage(
      page,
      `<!doctype html><html><head><style data-shadcn-runtime="true"></style></head><body><main><button>[object Object]</button></main></body></html>`,
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "webpage html contains [object Object]",
      "webpage visible text contains [object Object]",
      "button 1 name contains [object Object]",
    ]));
    await page.close();
  });

  it("rejects borked counter pages that render handler text instead of wiring clicks", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const page = await browser.newPage();
    const result = await checkWebPage(page, borkedCounterHtmlFixture);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "button 1 name contains JavaScript handler text",
      "button 1 looks interactive but has no click handler",
    ]));
    await page.close();
  });

  itIfAnthropicCodegen("generates a working counter app through the real LLM path", async () => {
    if (!browser) {
      throw new Error("Browser was not started");
    }

    const attempts = Number(process.env.CODEGEN_QUALITY_ATTEMPTS ?? "3");
    const minimumPasses = Number(process.env.CODEGEN_QUALITY_MIN_PASSES ?? String(attempts));
    const outcomes: Array<{ attempt: number; ok: boolean; failures: string[] }> = [];

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const generated = await generateCode(codegenCounterSheet, "main", {
        cache: new Map(),
        complete: completeWithAnthropic,
      });
      const codeCheck = checkCode(generated.code, {
        expectedKind: "webpage",
        promptFragments: ["a counter that starts at 0 and increments each time the button is clicked"],
      });
      const run = codeCheck.ok ? await runTypeScript(generated.code) : null;
      const html = run?.artifacts.find((artifact) => artifact.kind === "html")?.content ?? "";
      const page = await browser.newPage();
      const pageCheck = run?.ok === true
        ? await checkWebPage(page, html, { expectShadcn: true, minVisibleTextLength: 20 })
        : { ok: false, failures: [run ? `run failed: ${run.stderr}` : "code check failed"] };
      if (pageCheck.ok) {
        await page.getByRole("button", { name: /increment/i }).click();
        const clicked = await page.locator("body").innerText();
        if (!/\b1\b/.test(clicked)) {
          pageCheck.failures.push("counter did not show 1 after click");
          pageCheck.ok = false;
        }
      }
      await page.close();
      const failures = [...codeCheck.failures, ...(run?.ok === false ? [run.stderr] : []), ...pageCheck.failures];
      outcomes.push({ attempt, ok: failures.length === 0, failures });
    }

    const passes = outcomes.filter((outcome) => outcome.ok).length;
    expect(passes, JSON.stringify(outcomes, null, 2)).toBeGreaterThanOrEqual(minimumPasses);
  }, 300_000);
});

function shadcnCounterHtmlFixture(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Hello shadcn Counter</title>
  <style data-shadcn-runtime="true">
    body { margin: 0; min-height: 100vh; background: #f7f7f8; color: #18181b; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 32px; }
    .card { border: 1px solid #e4e4e7; border-radius: 8px; background: white; box-shadow: 0 1px 2px rgba(24, 24, 27, 0.04); }
    .card-header { padding: 18px 20px 0; }
    .card-content { display: grid; gap: 16px; padding: 20px; }
    .metric { font-variant-numeric: tabular-nums; font-size: 42px; font-weight: 760; line-height: 1; }
    button { min-height: 36px; border: 0; border-radius: 6px; background: #18181b; color: #fafafa; cursor: pointer; font: inherit; font-weight: 620; padding: 0 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Hello shadcn</h1>
    <section class="card">
      <div class="card-header"><h2>Counter</h2><p>Click the button to increment the value.</p></div>
      <div class="card-content"><div id="count" class="metric">0</div><button id="increment" type="button">Increment</button></div>
    </section>
  </main>
  <script>
    window.incrementCounter = () => {
      const el = document.getElementById("count");
      if (!el) return;
      el.textContent = String(Number(el.textContent || "0") + 1);
    };
    document.getElementById("increment")?.addEventListener("click", window.incrementCounter);
  </script>
</body>
</html>`;
}

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
