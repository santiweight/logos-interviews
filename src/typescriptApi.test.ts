import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeCache, CompleteFunction } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";

const parallelTypeScriptSheet = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log(add(1, 2));
  console.log(mul(2, 3));
}`;

describe("TypeScript API strategy defaults", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => closeServer(server)));
    servers.length = 0;
  });

  it("defaults the compile stream API to parallel completion", async () => {
    const started: string[] = [];
    const resolvers: Array<(value: string) => void> = [];
    const baseUrl = await listen(servers, new Map(), (prompt) => {
      const target = completionTargetName(prompt);
      started.push(target);
      return new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const compilePromise = compileViaApi(baseUrl, parallelTypeScriptSheet);
    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    resolvers[0]?.("function add(x: number, y: number): number {\n  return x + y;\n}");
    resolvers[1]?.("function mul(x: number, y: number): number {\n  return x * y;\n}");

    const events = await compilePromise;
    expect(events.filter((event) => event.kind === "llm-start")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ kind: "compiled" });
  });

  it("defaults the run start API to parallel completion", async () => {
    const started: string[] = [];
    const resolvers: Array<(value: string) => void> = [];
    const baseUrl = await listen(servers, new Map(), (prompt) => {
      const target = completionTargetName(prompt);
      started.push(target);
      return new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const runPromise = postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: parallelTypeScriptSheet,
      runnable: "main",
    });
    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    resolvers[0]?.("function add(x: number, y: number): number {\n  return x + y;\n}");
    resolvers[1]?.("function mul(x: number, y: number): number {\n  return x * y;\n}");

    const startedRun = await runPromise;
    const completed = await pollUntilExited(baseUrl, startedRun.sessionId, startedRun.chunks);
    expect(completed.output.trimEnd().split("\n")).toEqual(["3", "6"]);
  });
});

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
  complete: CompleteFunction,
): Promise<string> {
  const api = createInteractiveRunApi({ cache, complete });
  const server = createServer(async (req, res) => {
    if (req.url === "/api/run/start") {
      await api.handleStart(req, res);
      return;
    }

    if (req.url === "/api/run/poll") {
      await api.handlePoll(req, res);
      return;
    }

    if (req.url === "/api/compile") {
      await handleCompileStream(req, res, cache, complete);
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
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function pollUntilExited(
  baseUrl: string,
  sessionId: string,
  initialChunks: RunChunk[] = [],
): Promise<CompletedPollResponse> {
  let output = initialChunks.map((chunk) => chunk.text).join("");

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const polled = await postJson<RunPollResponse>(baseUrl, "/api/run/poll", { sessionId });
    output += polled.chunks.map((chunk) => chunk.text).join("");
    if (polled.status.state === "exited") {
      return { ...polled, output };
    }

    await delay(20);
  }

  throw new Error(`Timed out waiting for run to exit. Output: ${output}`);
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

async function compileViaApi(baseUrl: string, sheet: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheet }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }

  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function eventually(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function completionTargetName(prompt: string): "add" | "mul" {
  const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? prompt;
  return target.includes("function mul") ? "mul" : "add";
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
