import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApiRoutes,
  findApiRoute,
  handleApiNotFound,
  handleApiRoute,
  sendJson,
} from "../apiRoutes";

const apiRoutes = createApiRoutes();
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

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const apiRoute = findApiRoute(apiRoutes, url.pathname);
      if (!apiRoute) {
        handleApiNotFound(res, url.pathname);
        return;
      }

      await handleApiRoute(apiRoute, req, res);
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
