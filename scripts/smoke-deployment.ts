import { chromium, type Browser, type Page } from "playwright";
import { counterReactAppSource, deterministicCounterReactAppSource } from "../src/samples/counterReactApp";

type JsonRecord = Record<string, unknown>;

type CompileEvent =
  | { kind: "error"; error: string }
  | { kind: "typecheck"; diagnostics?: unknown[] }
  | { kind: "readiness"; definitions?: Array<{ name?: string; ready?: boolean }> }
  | { kind: "compiled"; implementation?: string }
  | JsonRecord;

type RunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: string | null; error?: string };

type RunChunk = {
  text?: string;
};

type RunResponse = {
  sessionId?: string;
  status?: RunStatus;
  chunks?: RunChunk[];
  [key: string]: unknown;
};

type SmokeOptions = {
  baseUrl: string;
  liveAnthropic: boolean;
};

const options = parseArgs(process.argv.slice(2));
const baseUrl = options.baseUrl.replace(/\/+$/, "");
const smokeId = `logos-deployment-smoke-${process.env.GITHUB_SHA ?? "local"}-${Date.now()}-${process.pid}`;

await main();

async function main(): Promise<void> {
  await step(`Checking ${baseUrl}/healthz`, () => checkHealth());
  await step("Checking default project API", () => checkDefaultProject());
  await step("Checking browser React Counter run smoke", () => checkBrowserCounterApps());
  await step("Checking compile stream", async () => {
    const sheet = terminalSmokeSheet();
    const compileEvents = await compileSheet(sheet, "smoke_compile_run");
    const implementation = compiledImplementation(compileEvents);
    await step("Checking interactive compile + run lifecycle", () =>
      checkInteractiveRun({
        sheet,
        runnable: "smoke_compile_run",
        implementation,
        expectedOutput: `logos deployment smoke ok ${smokeId}`,
        implSheetId: `${smokeId}-smoke_compile_run-impl`,
        sheetId: `${smokeId}-sheet`,
      })
    );
  });

  if (options.liveAnthropic) {
    await step("Checking live Anthropic compile + run lifecycle", () => checkLiveAnthropicRun());
  }

  console.log(`Deployment smoke passed for ${baseUrl}`);
}

async function step(label: string, run: () => Promise<void>): Promise<void> {
  console.log(label);
  await run();
}

function parseArgs(args: string[]): SmokeOptions {
  let baseUrl = "";
  let liveAnthropic = process.env.SMOKE_ANTHROPIC_E2E === "true";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--base-url") {
      baseUrl = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--live-anthropic") {
      liveAnthropic = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (!arg.startsWith("-") && baseUrl.length === 0) {
      baseUrl = arg;
      continue;
    }
    usage(`Unknown argument: ${arg}`);
  }

  if (baseUrl.length === 0) {
    usage("Missing --base-url");
  }

  return { baseUrl, liveAnthropic };
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    usage(`Missing value for ${flag}`);
  }
  return value;
}

function usage(message: string): never {
  console.error(message);
  printUsage();
  process.exit(2);
}

function printUsage(): void {
  console.error("Usage: pnpm smoke:deployment -- --base-url <url> [--live-anthropic]");
}

async function checkHealth(): Promise<void> {
  let lastBody = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      lastBody = await response.text();
      if (response.ok && lastBody === "{\"ok\":true}") {
        return;
      }
    } catch {
      lastBody = "";
    }
    await sleep(1000);
  }

  const response = await fetch(`${baseUrl}/healthz`);
  const body = await response.text();
  if (!response.ok || body !== "{\"ok\":true}") {
    throw new Error(`Unexpected health response from ${baseUrl}/healthz: ${body}`);
  }
}

async function checkDefaultProject(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/project/default`);
  if (!response.ok) {
    throw new Error(`GET /api/project/default returned HTTP ${response.status}: ${await response.text()}`);
  }

  const body = await response.json() as { ok?: boolean; sheets?: Array<{ id?: string; source?: string }> };
  if (body.ok !== true || !Array.isArray(body.sheets) || body.sheets.length === 0) {
    throw new Error(`default project response was not valid: ${JSON.stringify(body)}`);
  }

  const counterSheet = body.sheets.find((sheet) => sheet.id === "react-counter");
  if (counterSheet?.source !== counterReactAppSource) {
    throw new Error(`default project did not include the React Counter sample: ${JSON.stringify(counterSheet)}`);
  }
}

async function compileSheet(sheet: string, runnable: string): Promise<CompileEvent[]> {
  const body = await postText("/api/compile", {
    sheet,
    runnable,
    compilationStrategy: "sequential",
  });
  const events = parseNdjson(body) as CompileEvent[];
  checkCompileEvents(events, runnable);
  return events;
}

function checkCompileEvents(events: CompileEvent[], expectedRunnable: string): void {
  const failure = events.find((event): event is { kind: "error"; error: string } => event.kind === "error");
  if (failure) {
    throw new Error(`compile stream error: ${failure.error}`);
  }

  const diagnostics = events
    .filter((event): event is { kind: "typecheck"; diagnostics?: unknown[] } => event.kind === "typecheck")
    .flatMap((event) => event.diagnostics ?? []);
  if (diagnostics.length > 0) {
    throw new Error(`compile typecheck diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const readinessEvents = events
    .filter((event): event is { kind: "readiness"; definitions?: Array<{ name?: string; ready?: boolean }> } =>
      event.kind === "readiness"
    );
  const readiness = readinessEvents.at(-1);
  const smokeRunnable = readiness?.definitions?.find((definition) => definition.name === expectedRunnable);
  if (!smokeRunnable?.ready) {
    throw new Error(`smoke runnable was not ready: ${JSON.stringify(readiness)}`);
  }

  if (events.at(-1)?.kind !== "compiled") {
    throw new Error(`compile did not finish with compiled marker: ${JSON.stringify(events.at(-1))}`);
  }
}

function compiledImplementation(events: CompileEvent[]): string {
  let compiled: { kind: "compiled"; implementation?: string } | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isCompiledEvent(event)) {
      compiled = event;
      break;
    }
  }
  if (typeof compiled?.implementation !== "string" || compiled.implementation.length === 0) {
    throw new Error(`compile response did not include implementation: ${JSON.stringify(events.at(-1))}`);
  }
  return compiled.implementation;
}

function isCompiledEvent(event: CompileEvent): event is { kind: "compiled"; implementation?: string } {
  return event.kind === "compiled";
}

function parseNdjson(body: string): unknown[] {
  return body
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function checkInteractiveRun(input: {
  sheet: string;
  runnable: string;
  implementation: string;
  expectedOutput: string;
  implSheetId: string;
  sheetId: string;
}): Promise<void> {
  const startResponse = await postJson<RunResponse>("/api/run/start", {
    sheet: input.sheet,
    sheetId: input.sheetId,
    runnable: input.runnable,
    implementation: input.implementation,
    implSheetId: input.implSheetId,
  });

  const sessionId = startResponse.sessionId;
  if (!sessionId) {
    throw new Error(`Run start response did not include a session id: ${JSON.stringify(startResponse)}`);
  }

  let output = chunkText(startResponse);
  let status = startResponse.status;

  for (let attempt = 0; attempt < 40 && status?.state !== "exited"; attempt += 1) {
    await sleep(250);
    const pollResponse = await postJson<RunResponse>("/api/run/poll", { sessionId });
    output += chunkText(pollResponse);
    status = pollResponse.status;
  }

  if (status?.state !== "exited") {
    throw new Error(`Run did not exit before timeout. Last state: ${JSON.stringify(status)}`);
  }
  if (status.code !== 0) {
    throw new Error(`Run exited with code ${status.code}. Output: ${output}`);
  }
  if (!output.includes(input.expectedOutput)) {
    throw new Error(`Run output did not include expected smoke marker. Expected: ${input.expectedOutput}. Actual: ${output}`);
  }

  const rePollResponse = await postJson<RunResponse>("/api/run/poll", { sessionId });
  if (rePollResponse.status?.state !== "exited") {
    throw new Error(`Completed run session was not pollable: ${JSON.stringify(rePollResponse)}`);
  }
}

function chunkText(response: RunResponse): string {
  return (response.chunks ?? []).map((chunk) => chunk.text ?? "").join("");
}

async function checkLiveAnthropicRun(): Promise<void> {
  const uniqueSuffix = `${Date.now()}_${process.pid}`;
  const llmFunction = `smoke_add_${uniqueSuffix}`;
  const llmRunnable = `smoke_llm_compile_run_${uniqueSuffix}`;
  const sheet = `function ${llmFunction}(x: number, y: number): number

function ${llmRunnable}(): void {
  console.log(${llmFunction}(1, 2));
}`;
  const compileEvents = await compileSheet(sheet, llmRunnable);
  const implementation = compiledImplementation(compileEvents);
  await checkInteractiveRun({
    sheet,
    runnable: llmRunnable,
    implementation,
    expectedOutput: "3",
    implSheetId: `${smokeId}-${llmRunnable}-impl`,
    sheetId: `${smokeId}-${llmRunnable}-sheet`,
  });
}

async function checkBrowserCounterApps(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    await checkDeterministicCounter(browser);
    await checkLogosTemplateCounter(browser);
  } finally {
    await browser.close();
  }
}

async function checkDeterministicCounter(browser: Browser): Promise<void> {
  const page = await newSmokePage(browser);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await loadSourceWithImplementation(
      page,
      deterministicCounterReactAppSource,
      deterministicCounterReactAppSource,
      "Deterministic React Counter",
    );
    await runCounterWidget(page);

    const button = page.frameLocator(".react-app-run-frame").first().getByTestId("counter-button");
    await waitForPage(page, "deterministic counter button initial text", async () => await button.textContent() === "0");
    await button.click();
    await waitForPage(page, "deterministic counter button incremented text", async () => await button.textContent() === "1");
  } finally {
    await page.context().close();
  }
}

async function checkLogosTemplateCounter(browser: Browser): Promise<void> {
  const compileEvents = await compileSheet(counterReactAppSource, "counter_app");
  const implementation = compiledImplementation(compileEvents);
  const page = await newSmokePage(browser);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await loadSourceWithImplementation(
      page,
      counterReactAppSource,
      implementation,
      "Compiled Logos React Counter",
    );
    await runCounterWidget(page);

    const frame = page.frameLocator(".react-app-run-frame").first();
    const button = frame.locator("button").first();
    await waitForPage(page, "Logos sample counter button initial text", async () =>
      includesCounterValue(await button.textContent(), 0)
    );
    await button.click();
    await waitForPage(page, "Logos sample counter button incremented text", async () =>
      includesCounterValue(await button.textContent(), 1)
    );
  } finally {
    await page.context().close();
  }
}

function includesCounterValue(text: string | null, value: number): boolean {
  const normalized = text?.replace(/\s+/g, " ").trim() ?? "";
  return new RegExp(`(^|\\D)${value}(\\D|$)`).test(normalized);
}

async function newSmokePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}

async function loadSourceWithImplementation(
  page: Page,
  source: string,
  implementation: string,
  title: string,
): Promise<void> {
  await waitForSessionHelpers(page);
  await page.evaluate(async ({ source, implementation, title }) => {
    const win = window as unknown as {
      createLogosSessionBundle: () => any;
      loadLogosSession: (session: any) => Promise<void>;
    };
    const session = win.createLogosSessionBundle();
    const activeSourceTabId = `deployment-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
    await win.loadLogosSession({
      ...session,
      sourceTabs: [{
        id: activeSourceTabId,
        projectId: activeSourceTabId,
        title,
        source,
        implementation,
        implSheetId: `${activeSourceTabId}-impl`,
        compileSessionId: null,
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
      run: {
        ...session.run,
        activeToolTabId: "implementation-view",
        tabs: [],
      },
    });
  }, { source, implementation, title });
}

async function waitForSessionHelpers(page: Page): Promise<void> {
  await waitForPage(page, "session helpers", async () =>
    await page.evaluate(() => {
      const win = window as unknown as {
        createLogosSessionBundle?: unknown;
        loadLogosSession?: unknown;
      };
      return typeof win.createLogosSessionBundle === "function" &&
        typeof win.loadLogosSession === "function";
    })
  );
}

async function runCounterWidget(page: Page): Promise<void> {
  const runWidget = page.locator(".runnable-run-widget", { hasText: "Run Counter_app" }).first();
  await waitForPage(
    page,
    "React Counter run widget",
    async () => await runWidget.getAttribute("aria-disabled") === "false",
    180_000,
  );
  await runWidget.click();
}

async function waitForPage(
  page: Page,
  description: string,
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(250);
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

function terminalSmokeSheet(): string {
  const output = `logos deployment smoke ok ${smokeId}`;
  return `function smoke_compile_run(): void {
  console.log(${JSON.stringify(output)});
}`;
}

async function postJson<T>(path: string, payload: JsonRecord): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${baseUrl}${path} returned HTTP ${response.status}: ${body}`);
  }
  return JSON.parse(body) as T;
}

async function postText(path: string, payload: JsonRecord): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${baseUrl}${path} returned HTTP ${response.status}: ${body}`);
  }
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
