import type { IncomingMessage, ServerResponse } from "node:http";
import { AgentCompilationFramework } from "./ai/agentCompilation";
import { completeWithAnthropic, streamCompleteWithAnthropic } from "./ai/anthropicComplete";
import { requireAnthropicApiKey } from "./ai/anthropicKeyService";
import { runClaudeSingleFileAgent } from "./ai/claudeSingleFileAgent";
import { runSheetAgent, type AgentChatMessage } from "./ai/sheetAgent";
import type { CodeCache } from "./domain/codeSheet";
import { handleCompileStream } from "./server/compileStream";
import { createInteractiveRunApi } from "./server/interactiveRunApi";
import { createLogosApi } from "./server/logosApi";
import { LogosService, type NewSheetInput } from "./server/logosService";
import { handleSharedSessions } from "./sharedSessions";
import { createGlobalCodeCache } from "./storage/codeCache";
import { counterReactAppSource } from "./samples/counterReactApp";

export type ApiRoute = {
  path: string;
  match: "exact" | "prefix";
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

export const defaultBackendSheets: NewSheetInput[] = [
  {
    id: "starter-arithmetic",
    projectId: "starter-arithmetic",
    title: "Starter Arithmetic",
    source: `function main(): void {
  l\`print the result of adding one and two, then multiplying by three\`
}`,
  },
  {
    id: "beyond-basics",
    projectId: "beyond-basics",
    title: "Beyond Basics",
    source: `function main(): void {
  l\`print three short examples of natural language code generation\`
}`,
  },
  {
    id: "react-counter",
    projectId: "react-counter",
    title: "React Counter",
    source: counterReactAppSource,
  },
];

export function createApiRoutes(options: { defaultSheets?: NewSheetInput[] } = {}): ApiRoute[] {
  requireAnthropicApiKey();

  const logosService = new LogosService({ model: "claude-sonnet-5" });
  const logosApi = createLogosApi(logosService, {
    defaultSheets: options.defaultSheets ?? defaultBackendSheets,
  });
  const codeCache: CodeCache = createGlobalCodeCache();
  const compileComplete = streamCompleteWithAnthropic;
  const agentCompilation = new AgentCompilationFramework({
    cache: codeCache,
    complete: compileComplete,
    fileAgent: runClaudeSingleFileAgent,
  });
  const interactiveRunApi = createInteractiveRunApi();

  return [
    route("/api/run/start", "exact", (req, res) => interactiveRunApi.handleStart(req, res)),
    route("/api/run/input", "exact", (req, res) => interactiveRunApi.handleInput(req, res)),
    route("/api/run/resize", "exact", (req, res) => interactiveRunApi.handleResize(req, res)),
    route("/api/run/poll", "exact", (req, res) => interactiveRunApi.handlePoll(req, res)),
    route("/api/run/stop", "exact", (req, res) => interactiveRunApi.handleStop(req, res)),
    route("/api/project/default", "exact", (req, res) => logosApi.handleDefaultProject(req, res)),
    route("/api/sheet/compile", "exact", (req, res) => logosApi.handleCompile(req, res)),
    route("/api/compile-session", "exact", (req, res) => logosApi.handleSession(req, res)),
    route("/api/sheet/watch", "exact", (req, res) => logosApi.handleWatch(req, res)),
    route("/api/sheet", "exact", async (req, res) => {
      if (req.method === "POST") {
        await logosApi.handleNewSheet(req, res);
        return;
      }
      await logosApi.handleSheetState(req, res);
    }),
    route("/api/cache", "exact", async (req, res) => {
      if (req.method !== "DELETE") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const cleared = codeCache.size;
      codeCache.clear();
      await codeCache.clearRemote?.();
      agentCompilation.clear();
      logosService.clear();
      sendJson(res, 200, { ok: true, cleared });
    }),
    route("/api/compile", "exact", (req, res) =>
      handleCompileStream(req, res, codeCache, compileComplete, agentCompilation),
    ),
    route("/api/complete", "exact", async (req, res) => {
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
    }),
    route("/api/agent/chat", "exact", async (req, res) => {
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
    }),
    route("/api/shared-sessions", "prefix", (req, res) => handleSharedSessions(req, res)),
  ];
}

export function findApiRoute(routes: ApiRoute[], pathname: string): ApiRoute | null {
  return routes.find((apiRoute) => routeMatches(apiRoute, pathname)) ?? null;
}

export function routeMatches(routeToMatch: ApiRoute, pathname: string): boolean {
  if (routeToMatch.match === "exact") {
    return pathname === routeToMatch.path;
  }

  return pathname === routeToMatch.path || pathname.startsWith(`${routeToMatch.path}/`);
}

export async function handleApiRoute(
  apiRoute: ApiRoute,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await apiRoute.handler(req, res);
  } catch (error) {
    if (res.destroyed || res.writableEnded) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
}

export function handleApiNotFound(res: ServerResponse, pathname: string): void {
  sendJson(res, 404, { ok: false, error: `API route not found: ${pathname}` });
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function route(
  path: string,
  match: ApiRoute["match"],
  handler: ApiRoute["handler"],
): ApiRoute {
  return { path, match, handler };
}

function isAgentMessages(value: unknown): value is AgentChatMessage[] {
  return (
    Array.isArray(value) &&
    value.every((message) => {
      return (
        typeof message === "object" &&
        message !== null &&
        ((message as AgentChatMessage).role === "user" ||
          (message as AgentChatMessage).role === "assistant") &&
        typeof (message as AgentChatMessage).content === "string"
      );
    })
  );
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}
