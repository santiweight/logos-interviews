import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeCache, CompleteFunction } from "./codeSheet";
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

  if (prompt.includes("print mul of (add one and two) and 3")) {
    return "print(9)";
  }

  if (prompt.includes("the number one")) {
    return "1";
  }

  if (prompt.includes("the number two")) {
    return "2";
  }

  if (prompt.includes("the number three")) {
    return "3";
  }

  if (prompt.includes("add 1 and 2")) {
    return "3";
  }

  if (prompt.includes("mul 3 and 4")) {
    return "12";
  }

  throw new Error(`unexpected prompt: ${prompt}`);
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
