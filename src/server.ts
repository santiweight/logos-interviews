import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completeWithAnthropic } from "./anthropicComplete";
import type { CodeCache } from "./codeSheet";
import { runCodeSheet } from "./codeSheetRunner";

const codeCache: CodeCache = new Map();
const port = Number(process.env.PORT ?? 8080);
const distDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

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

    if (url.pathname === "/api/run") {
      await handleRun(req, res);
      return;
    }

    if (url.pathname === "/api/complete") {
      await handleComplete(req, res);
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

async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed", stdout: [] });
    return;
  }

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
    complete: completeWithAnthropic,
  });

  if (result.ok) {
    sendJson(res, 200, {
      ok: true,
      stdout: result.stdout,
      implementation: result.completed.source,
    });
    return;
  }

  sendJson(res, 200, {
    ok: false,
    error: result.error,
    stdout: result.stdout,
    implementation: result.completed.source,
  });
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
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
