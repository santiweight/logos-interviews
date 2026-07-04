import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCompilationFramework } from "./agentCompilation";
import type { CodeCache } from "./codeSheet";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";
import type { SingleFileAgentFunction } from "./claudeSingleFileAgent";

const simpleNaturalSnippetProgram = `function main() {
  l\`print hello world\`
}`;

const simpleNaturalSnippetImplementation = `function main(): void {
  console.log("hello world");
}`;

const todoCliProgram = `// Build an interactive terminal todo app with neo-blessed.
// It should feel like a compact command dashboard.

type Todo = {
  id: number;
  title: string;
  done: boolean;
};

function main(): void {
  l\`
  Render a full-screen interactive todo list using neo-blessed.
  Seed it with: "Review leads", "Call customer", and "Ship memo".
  Up/down arrow keys move the selected row.
  Space toggles done.
  a adds a new todo with a default title.
  d deletes the selected todo.
  q or escape exits.
  Show a top title bar, a bordered todo table, and a bottom command bar.
  \`
}`;

const todoCliImplementation = `import blessed from "neo-blessed";

type Todo = {
  id: number;
  title: string;
  done: boolean;
};

function main(): void {
  let todos: Todo[] = [
    { id: 1, title: "Review leads", done: false },
    { id: 2, title: "Call customer", done: false },
    { id: 3, title: "Ship memo", done: false },
  ];
  let nextId = 4;
  let selected = 0;

  const screen = blessed.screen({
    smartCSR: true,
    title: "Todo Dashboard",
  });

  blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    content: "{center}{bold}TODO DASHBOARD{/bold}{/center}",
    tags: true,
    style: { fg: "white", bg: "blue", bold: true },
  });

  const listBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: "100%-6",
    border: { type: "line" },
    tags: true,
    style: { border: { fg: "cyan" } },
  });

  blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    content: " Up/Down Move  Space Toggle  a Add  d Delete  q/Esc Quit",
    tags: true,
    style: { fg: "black", bg: "green" },
  });

  function renderList(): void {
    const lines: string[] = [
      "{bold}{cyan-fg}  #   Status   Title{/cyan-fg}{/bold}",
      "{cyan-fg}" + "-".repeat(60) + "{/cyan-fg}",
    ];

    todos.forEach((todo, index) => {
      const status = todo.done ? "{green-fg}[x]{/green-fg}" : "{red-fg}[ ]{/red-fg}";
      let line = "  " + String(todo.id).padStart(2, " ") + "   " + status + "   " + todo.title;
      if (index === selected) {
        line = "{white-bg}{black-fg}" + line + "{/black-fg}{/white-bg}";
      }
      lines.push(line);
    });

    listBox.setContent(lines.join("\\n"));
    screen.render();
  }

  screen.key(["up"], () => {
    selected = Math.max(0, selected - 1);
    renderList();
  });

  screen.key(["down"], () => {
    selected = Math.min(todos.length - 1, selected + 1);
    renderList();
  });

  screen.key(["space"], () => {
    if (todos[selected]) {
      todos[selected].done = !todos[selected].done;
      renderList();
    }
  });

  screen.key(["a"], () => {
    todos.push({ id: nextId, title: "New task " + nextId, done: false });
    nextId += 1;
    selected = todos.length - 1;
    renderList();
  });

  screen.key(["d"], () => {
    todos.splice(selected, 1);
    selected = Math.max(0, Math.min(selected, todos.length - 1));
    renderList();
  });

  screen.key(["q", "escape"], () => {
    screen.destroy();
    process.exit(0);
  });

  renderList();
}`;

describe("simple TypeScript program e2e", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("finishes compile and run for a one-line natural snippet program", async () => {
    const cache: CodeCache = new Map();
    const fileAgentInputs: string[] = [];
    const fileAgent: SingleFileAgentFunction = async function* (input) {
      fileAgentInputs.push(input.nextSheet);
      yield { kind: "file", source: simpleNaturalSnippetImplementation };
      yield { kind: "done", source: simpleNaturalSnippetImplementation };
    };
    const agentCompilation = new AgentCompilationFramework({ cache, fileAgent });
    const baseUrl = await listen(servers, cache, agentCompilation);

    const compileEvents = await compileViaApi(baseUrl, simpleNaturalSnippetProgram);

    expect(fileAgentInputs).toEqual([simpleNaturalSnippetProgram]);
    expect(compileEvents.at(-1)).toMatchObject({
      kind: "compiled",
      implementation: simpleNaturalSnippetImplementation,
      completedSnippets: 1,
      totalSnippets: 1,
    });

    const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: simpleNaturalSnippetProgram,
      runnable: "main",
    });
    const completed = await pollUntilExited(baseUrl, started.sessionId, started.chunks);

    expect(completed.status).toMatchObject({ state: "exited", code: 0 });
    expect(completed.output.trim()).toBe("hello world");
  });

  it.skip("runs a neo-blessed todo dashboard through the interactive TypeScript runtime", async () => {
    const cache: CodeCache = new Map();
    const fileAgentInputs: string[] = [];
    const fileAgent: SingleFileAgentFunction = async function* (input) {
      fileAgentInputs.push(input.nextSheet);
      yield { kind: "file", source: todoCliImplementation };
      yield { kind: "done", source: todoCliImplementation };
    };
    const agentCompilation = new AgentCompilationFramework({ cache, fileAgent });
    const baseUrl = await listen(servers, cache, agentCompilation);

    const compileEvents = await compileViaApi(baseUrl, todoCliProgram);

    expect(fileAgentInputs).toEqual([todoCliProgram]);
    expect(compileEvents.at(-1)).toMatchObject({
      kind: "compiled",
      implementation: todoCliImplementation,
      completedSnippets: 1,
      totalSnippets: 1,
    });

    const started = await postJson<RunStartResponse>(baseUrl, "/api/run/start", {
      sheet: todoCliProgram,
      runnable: "main",
    });
    let output = stdoutText(started.chunks);
    await expect.poll(async () => {
      const polled = await postJson<RunPollResponse>(baseUrl, "/api/run/poll", {
        sessionId: started.sessionId,
      });
      output += stdoutText(polled.chunks);
      return stripAnsi(output);
    }).toContain("Review leads");
    expect(output).not.toContain("blessed.screen is not a function");
    expect(output).not.toContain("PTY unavailable, using pipe fallback");

    await postJson<{ ok: true }>(baseUrl, "/api/run/input", {
      sessionId: started.sessionId,
      input: "q",
    });
    const completed = await pollUntilExited(baseUrl, started.sessionId);

    expect(completed.status).toMatchObject({ state: "exited", code: 0 });
  });
});

type CompileWireEvent = {
  kind?: string;
  implementation?: string;
  completedSnippets?: number;
  totalSnippets?: number;
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
      await handleCompileStream(req, res, cache, () => {
        throw new Error("compile should use the file agent");
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

    if (req.url === "/api/run/input") {
      await runApi.handleInput(req, res);
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

  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CompileWireEvent);
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

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const polled = await postJson<RunPollResponse>(baseUrl, "/api/run/poll", { sessionId });
    output += stdoutText(polled.chunks);
    if (polled.status.state === "exited") {
      return { ...polled, output };
    }

    await delay(20);
  }

  throw new Error(`Timed out waiting for run to exit. Output: ${output}`);
}

function stdoutText(chunks: RunChunk[]): string {
  return chunks
    .filter((chunk) => chunk.stream === "stdout")
    .map((chunk) => chunk.text)
    .join("");
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
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
