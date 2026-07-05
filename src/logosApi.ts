import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogosService } from "./logosService";

export function createLogosApi(service: LogosService) {
  return {
    async handleCompile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const { sheetId, source } = await readJson(req);
      if (typeof sheetId !== "string" || typeof source !== "string") {
        sendJson(res, 400, { ok: false, error: "Missing sheetId or source" });
        return;
      }

      service.updateSheet(sheetId, source);
      const sessionId = service.startCompile(sheetId);

      sendJson(res, 200, { ok: true, sessionId });
    },

    async handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const sessionId = url.searchParams.get("id");
      const afterParam = url.searchParams.get("after");
      const after = afterParam !== null ? parseInt(afterParam, 10) : 0;

      if (!sessionId) {
        sendJson(res, 400, { ok: false, error: "Missing session id" });
        return;
      }

      const session = service.session(sessionId);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "Session not found" });
        return;
      }

      const events = session.events.slice(after);
      const done = !service.isCompiling(sessionId);

      sendJson(res, 200, {
        ok: true,
        events,
        implementation: session.implementation,
        done,
        total: session.events.length,
      });
    },

    async handleSheetState(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const sheetId = url.searchParams.get("id");

      if (!sheetId) {
        sendJson(res, 400, { ok: false, error: "Missing sheet id" });
        return;
      }

      sendJson(res, 200, { ok: true, ...service.sheetState(sheetId) });
    },

    async handleClear(_req: IncomingMessage, res: ServerResponse): Promise<void> {
      service.clear();
      sendJson(res, 200, { ok: true });
    },
  };
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
