import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import type { CodeCache, CompleteFunction } from "./codeSheet";
import { handleCompileStream } from "./compileStream";

const magicSquareSheet = `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def test_magic_square():
  \`\`\`
  generate a MagicSquare
  pretty print it with colors, and the sum of each column/row/diagonal
  check the MagicSquare is valid, and show the work
  \`\`\``;

describe("compile stream", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("does not stream implementation payloads after a cached runnable is ready", async () => {
    const cache: CodeCache = new Map();
    const baseUrl = await listen(servers, cache, completeMagicSquare);

    await compileViaApi(baseUrl, magicSquareSheet);
    const events = await compileViaApi(baseUrl, magicSquareSheet);
    const readyIndex = events.findIndex((event) => (
      event.kind === "readiness" &&
      event.definitions?.some((definition) => (
        definition.name === "test_magic_square" &&
        definition.ready === true
      ))
    ));

    expect(readyIndex).toBeGreaterThan(-1);
    expect(events.slice(readyIndex + 1)).toEqual([
      expect.objectContaining({
        kind: "compiled",
        implementation: expect.any(String),
      }),
    ]);
  });

  it("keeps compile as the only frontend operation while updating server-side state", async () => {
    const cache: CodeCache = new Map();
    const prompts: string[] = [];
    const complete: CompleteFunction = (prompt) => {
      prompts.push(prompt);
      if (prompt.includes("Previous compiled code")) {
        return `def add(x: int, y: int) -> int:
  return x + y + 1

def test():
  print(add(2, 3))`;
      }

      return `def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1, 2))`;
    };
    const agentCompilation = new AgentCompilationFramework({ cache, complete });
    const baseUrl = await listen(servers, cache, complete, agentCompilation);
    const firstSheet = `def add(x: int, y: int) -> int

def test():
  print(add(1, 2))`;
    const nextSheet = `def add(x: int, y: int) -> int

def test():
  print(add(2, 3))`;

    await compileViaApi(baseUrl, firstSheet);
    const events = await compileViaApi(baseUrl, nextSheet);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Previous compiled code");
    expect(events).toContainEqual(expect.objectContaining({
      kind: "implementation",
      implementation: expect.stringContaining("return x + y + 1"),
    }));
  });
});

type CompileWireEvent = {
  kind?: string;
  implementation?: string;
  definitions?: Array<{ name?: string; ready?: boolean }>;
};

async function listen(
  servers: Array<ReturnType<typeof createServer>>,
  cache: CodeCache,
  complete: CompleteFunction,
  agentCompilation?: AgentCompilationFramework,
): Promise<string> {
  const server = createServer(async (req, res) => {
    if (req.url === "/api/compile") {
      await handleCompileStream(req, res, cache, complete, agentCompilation);
      return;
    }

    sendJson(res, 404, { ok: false });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start server");
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

  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CompileWireEvent);
}

function completeMagicSquare(prompt: string): string {
  if (prompt.includes("class MagicSquare")) {
    const helperLines = Array.from({ length: 100 }, (_, index) => `MAGIC_TRACE_${index} = ${index}`);
    return `${helperLines.join("\n")}

class MagicSquare:
  def __init__(self, size: int = 3):
    self.size = size
  def gen(self):
    return self
  def pretty(self):
    return "ok"`;
  }

  return `square = MagicSquare().gen()
print(square.pretty())`;
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
