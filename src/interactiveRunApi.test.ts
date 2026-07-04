import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import { createGlobalCodeCache } from "./codeCache";
import type { CodeCache, CompleteFunction } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";

const runSessionSheet = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test_basic():
  print(mul(add(1, 2), 3))
  \`print mul of (add one and two) and 3\`
  print(mul(add(\`the number one\`, \`the number two\`), \`the number three\`))

  added = \`add 1 and 2\`
  product = \`mul 3 and 4\`
  print(added)
  print(product)`;

const exactRunSessionSheet = `# In Logos, LLMs will complete partial code for you.
# Click \`add\` in the code view to see its implementation.
def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

# Click the run button to run this class (once it's been compiled).
# Click \`test\` in the code view to see its implementation.
def test_basic():
  # In Logos, you can use regular python...
  print("(1 + 2) * 3 == ", mul(add(1, 2), 3))

  # Or use a snippet to have the LLM write it for you...
  \`print mul of (add one and two) and 3\`
  print(mul(add(\`the number one\`, \`the number two\`), \`the number three\`))

  added = \`add 1 and 2\`
  product = \`mul 3 and 4\`
  print(added)
  print(product)
`;

describe("interactive run API", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => closeServer(server)));
    servers.length = 0;
  });

  it("lets completed sessions be polled repeatedly", async () => {
    const baseUrl = await listen(servers, new Map(), () => {
      throw new Error("completion should not be called");
    });

    const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: `def test_basic():
  print("done")`,
      runnable: "test_basic",
    });

    const completed = await pollUntilExited(baseUrl, started.sessionId);
    expect(completed).toMatchObject({
      ok: true,
      status: { state: "exited", code: 0 },
    });

    const repolled = await postJson<RunPollResponse>(baseUrl, "/api/run/poll", {
      sessionId: started.sessionId,
    });
    expect(repolled).toMatchObject({
      ok: true,
      status: { state: "exited", code: 0 },
      chunks: [],
    });
  });

  it("marks missing poll sessions with a stable error code", async () => {
    const baseUrl = await listen(servers, new Map(), () => {
      throw new Error("completion should not be called");
    });

    const response = await fetch(`${baseUrl}/api/run/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "missing-session" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "run_session_not_found",
      error: "Run session not found",
      chunks: [],
    });
  });

  it("reproduces a fresh session miss when start and poll use different API instances", async () => {
    const startApi = createInteractiveRunApi({
      cache: new Map(),
      complete: () => {
        throw new Error("completion should not be called");
      },
    });
    const pollApi = createInteractiveRunApi({
      cache: new Map(),
      complete: () => {
        throw new Error("completion should not be called");
      },
    });
    const server = createServer(async (req, res) => {
      if (req.url === "/api/run/start") {
        await startApi.handleStart(req, res);
        return;
      }

      if (req.url === "/api/run/poll") {
        await pollApi.handlePoll(req, res);
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
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: `def test():
  print("fresh")`,
      runnable: "test",
    });
    const response = await fetch(`${baseUrl}/api/run/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: started.sessionId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "run_session_not_found",
      error: "Run session not found",
      chunks: [],
    });
  });

  it("runs repeated sessions for the same runnable without stale session errors", async () => {
    const baseUrl = await listen(servers, new Map(), completeRunSessionSheet);
    const started = await Promise.all(
      Array.from({ length: 3 }, () =>
        postJson<RunStartResponse>(baseUrl, "/api/run/start", {
          sheet: runSessionSheet,
          runnable: "test_basic",
        })),
    );

    const completed = await Promise.all(
      started.map((run) => pollUntilExited(baseUrl, run.sessionId, run.chunks)),
    );

    expect(completed.map((run) => ({
      ok: run.ok,
      status: run.status,
      output: run.output.trimEnd().split("\n"),
    }))).toEqual([
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["9", "9", "9", "3", "12"],
      },
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["9", "9", "9", "3", "12"],
      },
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["9", "9", "9", "3", "12"],
      },
    ]);
  });

  it("starts repeated runs after compile warmed the shared cache", async () => {
    const cache: CodeCache = new Map();
    const baseUrl = await listen(servers, cache, completeRunSessionSheet);
    const compileEvents = await compileViaApi(baseUrl, exactRunSessionSheet);

    expect(compileEvents.at(-1)).toMatchObject({ kind: "compiled" });
    expect(
      compileEvents
        .filter((event) => event.kind === "readiness")
        .at(-1),
    ).toMatchObject({
      definitions: [
        expect.objectContaining({ name: "add", ready: true }),
        expect.objectContaining({ name: "mul", ready: true }),
        expect.objectContaining({ name: "test_basic", ready: true }),
      ],
    });

    const started = await Promise.all(
      Array.from({ length: 3 }, () =>
        postJson<RunStartResponse>(baseUrl, "/api/run/start", {
          sheet: exactRunSessionSheet,
          runnable: "test_basic",
        })),
    );
    const completed = await Promise.all(
      started.map((run) => pollUntilExited(baseUrl, run.sessionId, run.chunks)),
    );
    const repolled = await Promise.all(
      started.map((run) =>
        postJson<RunPollResponse>(baseUrl, "/api/run/poll", {
          sessionId: run.sessionId,
        })),
    );

    expect(completed.map((run) => ({
      ok: run.ok,
      status: run.status,
      output: run.output.trimEnd().split("\n"),
    }))).toEqual([
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["(1 + 2) * 3 ==  9", "9", "9", "3", "12"],
      },
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["(1 + 2) * 3 ==  9", "9", "9", "3", "12"],
      },
      {
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["(1 + 2) * 3 ==  9", "9", "9", "3", "12"],
      },
    ]);
    expect(repolled.map((run) => ({
      ok: run.ok,
      chunks: run.chunks,
      status: run.status,
    }))).toEqual([
      { ok: true, chunks: [], status: { state: "exited", code: 0, signal: null } },
      { ok: true, chunks: [], status: { state: "exited", code: 0, signal: null } },
      { ok: true, chunks: [], status: { state: "exited", code: 0, signal: null } },
    ]);
  });

  it("starts from the global cache when compile and run use different cache instances", async () => {
    const previousCodeCacheDir = process.env.CODE_CACHE_DIR;
    const codeCacheDir = await mkdtemp(join(tmpdir(), "logos-code-cache-"));
    process.env.CODE_CACHE_DIR = codeCacheDir;

    try {
      const compileCache = createGlobalCodeCache();
      const runApi = createInteractiveRunApi({
        cache: createGlobalCodeCache(),
        complete: () => {
          throw new Error("run should use the global cache");
        },
      });
      const server = createServer(async (req, res) => {
        if (req.url === "/api/compile") {
          await handleCompileStream(req, res, compileCache, completeRunSessionSheet);
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
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const compileEvents = await compileViaApi(baseUrl, exactRunSessionSheet);
      const compiled = compileEvents.at(-1);

      expect(compiled).toMatchObject({ kind: "compiled" });

      const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
        sheet: exactRunSessionSheet,
        runnable: "test_basic",
      });
      const completed = await pollUntilExited(baseUrl, started.sessionId, started.chunks);

      expect({
        ok: completed.ok,
        status: completed.status,
        output: completed.output.trimEnd().split("\n"),
      }).toEqual({
        ok: true,
        status: { state: "exited", code: 0, signal: null },
        output: ["(1 + 2) * 3 ==  9", "9", "9", "3", "12"],
      });
    } finally {
      await rm(codeCacheDir, { recursive: true, force: true });
      if (previousCodeCacheDir === undefined) {
        delete process.env.CODE_CACHE_DIR;
      } else {
        process.env.CODE_CACHE_DIR = previousCodeCacheDir;
      }
    }
  });

  it("joins an active agent compilation when a run starts for the same sheet", async () => {
    const cache: CodeCache = new Map();
    const agentStarted = deferred<void>();
    const releaseAgent = deferred<void>();
    let agentCalls = 0;
    const sheet = `def test_basic():
  print("ok")`;
    const implementation = sheet;
    const agentCompilation = new AgentCompilationFramework({
      cache,
      fileAgent: async function* () {
        agentCalls += 1;
        agentStarted.resolve();
        await releaseAgent.promise;
        yield { kind: "file", source: implementation };
        yield { kind: "done", source: implementation };
      },
    });
    const runApi = createInteractiveRunApi({
      cache,
      compileSheet: (code) => agentCompilation.compile(code),
      complete: () => {
        throw new Error("run/start should join the active agent compilation");
      },
    });
    const server = createServer(async (req, res) => {
      if (req.url === "/api/compile") {
        await handleCompileStream(req, res, cache, () => {
          throw new Error("compile should use the agent framework");
        }, agentCompilation);
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
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const compilePromise = compileViaApi(baseUrl, sheet);
    await agentStarted.promise;
    const runStartPromise = postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet,
      runnable: "test_basic",
    });
    await delay(20);

    expect(agentCalls).toBe(1);
    releaseAgent.resolve();

    const [, started] = await Promise.all([compilePromise, runStartPromise]);
    const completed = await pollUntilExited(baseUrl, started.sessionId, started.chunks);

    expect(agentCalls).toBe(1);
    expect(completed.output.trim()).toBe("ok");
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

function completeRunSessionSheet(prompt: string): string {
  const implementationTarget =
    prompt
      .split("Your job is to finish the implementation of:")
      .at(-1) ?? "";

  if (prompt.includes("Your job is to finish the implementation of:")) {
    if (implementationTarget.includes("def add(x: int, y: int) -> int")) {
      return `def add(x: int, y: int) -> int:
  return x + y`;
    }

    if (implementationTarget.includes("def mul(x: int, y: int) -> int")) {
      return `def mul(x: int, y: int) -> int:
  return x * y`;
    }
  }

  switch (naturalFragment(prompt)) {
    case "`print mul of (add one and two) and 3`":
      return "print(9)";
    case "`add`":
      return "add";
    case "`test`":
      return "test";
    case "`the number one`":
      return "1";
    case "`the number two`":
      return "2";
    case "`the number three`":
      return "3";
    case "`add 1 and 2`":
      return "3";
    case "`mul 3 and 4`":
      return "12";
  }

  throw new Error(`unexpected prompt: ${prompt}`);
}

function naturalFragment(prompt: string): string | null {
  const [, rest] = prompt.split(
    "Your job is to replace this natural-language Python fragment with valid Python code:\n\n",
  );
  return rest?.split("\n\nReturn only")[0]?.trim() ?? null;
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
