import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import { runClaudeSingleFileAgent } from "./claudeSingleFileAgent";
import type { CodeCache } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { streamCompleteWithAnthropic } from "./anthropicComplete";
import { createInteractiveRunApi } from "./interactiveRunApi";

const simpleNaturalSnippetProgram = `function main() {
  l\`print hello world\`
}`;

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("live TypeScript compile and run e2e", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("compiles a one-line natural snippet through Claude and runs it through the TypeScript runtime", async () => {
    const cache: CodeCache = new Map();
    const agentCompilation = new AgentCompilationFramework({
      cache,
      complete: streamCompleteWithAnthropic,
      fileAgent: runClaudeSingleFileAgent,
    });
    const baseUrl = await listen(servers, cache, agentCompilation);

    const compileEvents = await compileViaApi(baseUrl, simpleNaturalSnippetProgram);
    const compiled = lastEvent(compileEvents, "compiled");
    const readiness = lastEvent(compileEvents, "readiness");

    expect(compiled).toMatchObject({
      kind: "compiled",
      completedSnippets: 1,
      totalSnippets: 1,
    });
    expect(compiled.implementation.toLowerCase()).toContain("hello");
    expect(compiled.implementation.toLowerCase()).toContain("world");
    expect(compiled.implementation).not.toMatch(/^\s*(?:(?:void|await)\s+)?main\(\);?\s*$/m);
    expect(readiness.definitions).toContainEqual(expect.objectContaining({
      name: "main",
      ready: true,
      blockingDependencies: [],
    }));

    const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: simpleNaturalSnippetProgram,
      runnable: "main",
    });
    const completed = await pollUntilExited(baseUrl, started.sessionId, started.chunks);

    expect(completed.status).toMatchObject({ state: "exited", code: 0 });
    expect(completed.output.trim().toLowerCase()).toContain("hello");
    expect(completed.output.trim().toLowerCase()).toContain("world");
  }, 180_000);
});

type DefinitionWire = {
  name: string;
  ready: boolean;
  blockingDependencies: string[];
};

type CompileWireEvent = {
  kind?: string;
  implementation?: string;
  completedSnippets?: number;
  totalSnippets?: number;
  definitions?: DefinitionWire[];
  error?: string;
};

type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

type RunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: string | null; error?: string };

type RunStartResponse = {
  ok: true;
  sessionId: string;
  chunks: RunChunk[];
  status: RunStatus;
};

type RunPollResponse = {
  ok: true;
  chunks: RunChunk[];
  status: RunStatus;
};

type CompletedPollResponse = RunPollResponse & {
  output: string;
};

async function listen(
  servers: Array<ReturnType<typeof createServer>>,
  cache: CodeCache,
  agentCompilation: AgentCompilationFramework,
): Promise<string> {
  const runApi = createInteractiveRunApi({
    cache,
    compileSheet: (sheet) => agentCompilation.compile(sheet),
  });
  const server = createServer(async (req, res) => {
    if (req.url === "/api/compile") {
      await handleCompileStream(req, res, cache, streamCompleteWithAnthropic, agentCompilation);
      return;
    }

    if (req.url === "/api/run/start") {
      await runApi.handleStart(req, res);
      return;
    }

    if (req.url === "/api/run/poll") {
      await runApi.handlePoll(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start test server");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function compileViaApi(baseUrl: string, sheet: string): Promise<CompileWireEvent[]> {
  const response = await fetch(`${baseUrl}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }

  const events = text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CompileWireEvent);
  const error = events.find((event) => event.kind === "error");
  if (error) {
    throw new Error(error.error ?? "Unknown compile error");
  }

  return events;
}

function lastEvent(events: CompileWireEvent[], kind: "compiled"): CompileWireEvent & { implementation: string };
function lastEvent(events: CompileWireEvent[], kind: "readiness"): CompileWireEvent & { definitions: DefinitionWire[] };
function lastEvent(events: CompileWireEvent[], kind: string): CompileWireEvent {
  const event = events.filter((item) => item.kind === kind).at(-1);
  if (!event) {
    throw new Error(`Missing ${kind} event. Events: ${JSON.stringify(events)}`);
  }

  return event;
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }

  return payload as T;
}

async function pollUntilExited(
  baseUrl: string,
  sessionId: string,
  initialChunks: RunChunk[] = [],
): Promise<CompletedPollResponse> {
  let output = stdoutText(initialChunks);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const polled = await postJson<RunPollResponse>(baseUrl, "/api/run/poll", { sessionId });
    output += stdoutText(polled.chunks);
    if (polled.status.state === "exited") {
      return { ...polled, output };
    }

    await delay(25);
  }

  throw new Error(`Timed out waiting for run to exit. Output: ${output}`);
}

function stdoutText(chunks: RunChunk[]): string {
  return chunks
    .filter((chunk) => chunk.stream === "stdout")
    .map((chunk) => chunk.text)
    .join("");
}

function sendJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
