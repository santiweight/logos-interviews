import { defineConfig } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runCodeSheet } from "./src/codeSheetRunner";
import type { CodeCache } from "./src/codeSheet";

export default defineConfig({
  plugins: [anthropicCompletionPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});

function anthropicCompletionPlugin() {
  const codeCache: CodeCache = new Map();
  const complete = (prompt: string) => completeWithAnthropic(prompt);

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
    },
  };
}

async function completeWithAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
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
