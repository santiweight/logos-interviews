import { defineConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { createGlobalCodeCache } from "./src/codeCache";
import type { CodeCache } from "./src/codeSheet";
import { completeWithAnthropic, streamCompleteWithAnthropic } from "./src/anthropicComplete";
import { runClaudeSingleFileAgent } from "./src/claudeSingleFileAgent";
import { AgentCompilationFramework } from "./src/agentCompilation";
import { runSheetAgent, type AgentChatMessage } from "./src/sheetAgent";
import { handleCompileStream } from "./src/compileStream";
import { handleFeedback } from "./src/feedbackCapture";
import { handleSessionEvents } from "./src/sessionCapture";
import { handleSharedSessions } from "./src/sharedSessions";
import { createInteractiveRunApi } from "./src/interactiveRunApi";

const devHost = "127.0.0.1";

export default defineConfig(async ({ command }) => {
  const devPort = command === "serve" ? await availablePort(devHost) : undefined;

  return {
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          replay: "replay.html",
        },
      },
    },
    plugins: [anthropicCompletionPlugin()],
    server: {
      host: devHost,
      ...(devPort === undefined ? {} : { port: devPort, strictPort: true }),
    },
  };
});

function availablePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a dev server port")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function anthropicCompletionPlugin() {
  const codeCache: CodeCache = createGlobalCodeCache();
  const complete = completeWithAnthropic;
  const compileComplete = streamCompleteWithAnthropic;
  const agentCompilation = new AgentCompilationFramework({
    cache: codeCache,
    complete: compileComplete,
    fileAgent: anthropicApiKeyConfigured() ? runClaudeSingleFileAgent : undefined,
  });
  const interactiveRunApi = createInteractiveRunApi({
    cache: codeCache,
    complete,
    compileSheet: (sheet) => agentCompilation.compile(sheet),
  });

  return {
    name: "anthropic-completion-api",
    configureServer(server) {
      server.middlewares.use("/api/run/start", async (req, res) => {
        try {
          await interactiveRunApi.handleStart(req, res);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/run/input", async (req, res) => {
        try {
          await interactiveRunApi.handleInput(req, res);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/run/poll", async (req, res) => {
        try {
          await interactiveRunApi.handlePoll(req, res);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message, chunks: [] });
        }
      });

      server.middlewares.use("/api/run/stop", async (req, res) => {
        try {
          await interactiveRunApi.handleStop(req, res);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/compile", async (req, res) => {
        try {
          await handleCompileStream(req, res, codeCache, compileComplete, agentCompilation);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/cache", async (req, res) => {
        if (req.method !== "DELETE") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        try {
          const cleared = codeCache.size;
          codeCache.clear();
          await codeCache.clearRemote?.();
          agentCompilation.clear();
          sendJson(res, 200, { ok: true, cleared });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/complete", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const { prompt } = await readJson(req);
          if (typeof prompt !== "string" || prompt.length === 0) {
            sendJson(res, 400, { error: "Missing prompt" });
            return;
          }

          sendJson(res, 200, { completion: await complete(prompt) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { error: message });
        }
      });

      server.middlewares.use("/api/agent/chat", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const { sheet, messages } = await readJson(req);
          if (typeof sheet !== "string" || !isAgentMessages(messages)) {
            sendJson(res, 400, { error: "Missing sheet or messages" });
            return;
          }

          sendJson(res, 200, await runSheetAgent(sheet, messages, complete));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { error: message });
        }
      });

      server.middlewares.use("/api/session-events", async (req, res) => {
        await handleSessionEvents(req, res);
      });

      server.middlewares.use("/api/feedback", async (req, res) => {
        await handleFeedback(req, res);
      });

      server.middlewares.use("/api/shared-sessions", async (req, res) => {
        await handleSharedSessions(req, res);
      });
    },
  };
}

function anthropicApiKeyConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
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
