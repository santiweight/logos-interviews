import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completeWithAnthropic, streamCompleteWithAnthropic } from "./anthropicComplete";
import { runClaudeSingleFileAgent } from "./claudeSingleFileAgent";
import { createGlobalCodeCache } from "./codeCache";
import { handleCompileStream } from "./compileStream";
import { createInteractiveRunApi } from "./interactiveRunApi";
import type { CodeCache } from "./codeSheet";
import { AgentCompilationFramework } from "./agentCompilation";
import { handleFeedback } from "./feedbackCapture";
import { handleSessionEvents } from "./sessionCapture";
import { handleSharedSessions } from "./sharedSessions";
import { runSheetAgent, type AgentChatMessage } from "./sheetAgent";

const codeCache: CodeCache = createGlobalCodeCache();
const agentCompilation = new AgentCompilationFramework({
  cache: codeCache,
  complete: streamCompleteWithAnthropic,
  fileAgent: anthropicApiKeyConfigured() ? runClaudeSingleFileAgent : undefined,
});
const interactiveRunApi = createInteractiveRunApi({
  cache: codeCache,
  complete: completeWithAnthropic,
  compileSheet: (sheet) => agentCompilation.compile(sheet),
});
const port = Number(process.env.PORT ?? 8080);
const distDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

function anthropicApiKeyConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { ok: false, error: "Missing request URL" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/run/start") {
      await interactiveRunApi.handleStart(req, res);
      return;
    }

    if (url.pathname === "/api/run/input") {
      await interactiveRunApi.handleInput(req, res);
      return;
    }

    if (url.pathname === "/api/run/poll") {
      await interactiveRunApi.handlePoll(req, res);
      return;
    }

    if (url.pathname === "/api/run/stop") {
      await interactiveRunApi.handleStop(req, res);
      return;
    }

    if (url.pathname === "/api/compile") {
      await handleCompileStream(req, res, codeCache, streamCompleteWithAnthropic, agentCompilation);
      return;
    }

    if (url.pathname === "/api/cache") {
      await handleCache(req, res);
      return;
    }

    if (url.pathname === "/api/complete") {
      await handleComplete(req, res);
      return;
    }

    if (url.pathname === "/api/agent/chat") {
      await handleAgentChat(req, res);
      return;
    }

    if (url.pathname === "/api/session-events" || url.pathname.startsWith("/api/session-events/")) {
      await handleSessionEvents(req, res);
      return;
    }

    if (url.pathname === "/api/feedback") {
      await handleFeedback(req, res);
      return;
    }

    if (url.pathname === "/api/shared-sessions" || url.pathname.startsWith("/api/shared-sessions/")) {
      await handleSharedSessions(req, res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`logos-interviews listening on ${port}`);
});

async function handleCache(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "DELETE") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const cleared = codeCache.size;
  codeCache.clear();
  await codeCache.clearRemote?.();
  agentCompilation.clear();
  sendJson(res, 200, { ok: true, cleared });
}

async function handleComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const { prompt } = await readJson(req);
  if (typeof prompt !== "string" || prompt.length === 0) {
    sendJson(res, 400, { error: "Missing prompt" });
    return;
  }

  sendJson(res, 200, { completion: await completeWithAnthropic(prompt) });
}

async function handleAgentChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const { sheet, messages } = await readJson(req);
  if (typeof sheet !== "string" || !isAgentMessages(messages)) {
    sendJson(res, 400, { error: "Missing sheet or messages" });
    return;
  }

  sendJson(res, 200, await runSheetAgent(sheet, messages, completeWithAnthropic));
}

function isAgentMessages(value: unknown): value is AgentChatMessage[] {
  return Array.isArray(value) && value.every((message) => {
    return (
      typeof message === "object" &&
      message !== null &&
      ((message as AgentChatMessage).role === "user" ||
        (message as AgentChatMessage).role === "assistant") &&
      typeof (message as AgentChatMessage).content === "string"
    );
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = normalize(join(distDir, requestedPath));

  if (!isInsideDist(filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    sendBuffer(res, 200, body, contentType(filePath));
  } catch {
    const index = await readFile(join(distDir, "index.html"));
    sendBuffer(res, 200, index, "text/html; charset=utf-8");
  }
}

function isInsideDist(filePath: string): boolean {
  const path = relative(distDir, filePath);
  return path.length === 0 || (!path.startsWith("..") && !path.startsWith("/"));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function sendBuffer(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  type: string,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", type);
  res.end(body);
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
