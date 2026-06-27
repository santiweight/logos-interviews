import { defineConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { runCodeSheet } from "./src/codeSheetRunner";
import type { CodeCache } from "./src/codeSheet";
import { completeWithAnthropic } from "./src/anthropicComplete";
import { runSheetAgent, type AgentChatMessage } from "./src/sheetAgent";
import { handleCompileStream } from "./src/compileStream";

const devHost = "127.0.0.1";

export default defineConfig(async ({ command }) => {
  const devPort = command === "serve" ? await availablePort(devHost) : undefined;

  return {
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
  const codeCache: CodeCache = new Map();
  const complete = completeWithAnthropic;

  return {
    name: "anthropic-completion-api",
    configureServer(server) {
      server.middlewares.use("/api/run", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed", stdout: [] });
          return;
        }

        try {
          const { sheet, runnable } = await readJson(req);
          if (typeof sheet !== "string" || typeof runnable !== "string") {
            sendJson(res, 400, {
              ok: false,
              error: "Missing sheet or runnable",
              stdout: [],
            });
            return;
          }

          const result = await runCodeSheet(sheet, runnable, {
            cache: codeCache,
            complete,
          });

          if (result.ok) {
            sendJson(res, 200, {
              ok: true,
              stdout: result.stdout,
              implementation: result.completed.source,
            });
          } else {
            sendJson(res, 200, {
              ok: false,
              error: result.error,
              stdout: result.stdout,
              implementation: result.completed.source,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message, stdout: [] });
        }
      });

      server.middlewares.use("/api/compile", async (req, res) => {
        try {
          await handleCompileStream(req, res, codeCache, complete);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.middlewares.use("/api/cache", (req, res) => {
        if (req.method !== "DELETE") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const cleared = codeCache.size;
        codeCache.clear();
        sendJson(res, 200, { ok: true, cleared });
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
    },
  };
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
