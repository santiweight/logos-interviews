import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogosService, NewSheetInput } from "./logosService";

export type LogosApiOptions = {
  defaultSheets: NewSheetInput[];
};

export function createLogosApi(service: LogosService, options: LogosApiOptions = { defaultSheets: [] }) {
  return {
    async handleDefaultProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method === "GET") {
        const sheets = service.initializeDefaultProject(options.defaultSheets);
        sendJson(res, 200, { ok: true, sheets, activeSheetId: sheets[0]?.id ?? null });
        return;
      }

      if (req.method === "PUT") {
        const body = await readJson(req);
        const sheets = sourceSheetsFromBody(body);
        if (!sheets) {
          sendJson(res, 400, { ok: false, error: "Missing sheets" });
          return;
        }

        const nextSheets = service.replaceDefaultProject(sheets);
        const activeSheetId = typeof body.activeSheetId === "string" &&
          nextSheets.some((sheet) => sheet.id === body.activeSheetId)
          ? body.activeSheetId
          : nextSheets[0]?.id ?? null;
        sendJson(res, 200, { ok: true, sheets: nextSheets, activeSheetId });
        return;
      }

      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    },

    async handleNewSheet(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const { id, projectId, title, source } = await readJson(req);
      if (
        typeof id !== "string" ||
        typeof projectId !== "string" ||
        typeof title !== "string" ||
        typeof source !== "string"
      ) {
        sendJson(res, 400, { ok: false, error: "Missing sheet fields" });
        return;
      }

      const sheet = service.newSheet({ id, projectId, title, source });
      sendJson(res, 200, { ok: true, sheet });
    },

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
      const sessionId = service.watchSheet(sheetId);

      sendJson(res, 200, { ok: true, sessionId });
    },

    async handleWatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const { sheetId } = await readJson(req);
      if (typeof sheetId !== "string") {
        sendJson(res, 400, { ok: false, error: "Missing sheetId" });
        return;
      }

      const sessionId = service.watchSheet(sheetId);

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
      if (req.method !== "GET" && req.method !== "DELETE") {
        sendJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }

      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const sheetId = url.searchParams.get("id");

      if (!sheetId) {
        sendJson(res, 400, { ok: false, error: "Missing sheet id" });
        return;
      }

      if (req.method === "DELETE") {
        const deleted = service.deleteSheet(sheetId);
        sendJson(res, 200, { ok: true, deleted });
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

function sourceSheetsFromBody(body: Record<string, unknown>): NewSheetInput[] | null {
  if (!Array.isArray(body.sheets)) return null;
  const seen = new Set<string>();
  const sheets: NewSheetInput[] = [];
  for (const item of body.sheets) {
    if (typeof item !== "object" || item === null) return null;
    const sheet = item as Partial<Record<keyof NewSheetInput, unknown>>;
    if (
      typeof sheet.id !== "string" ||
      sheet.id.length === 0 ||
      typeof sheet.projectId !== "string" ||
      typeof sheet.title !== "string" ||
      typeof sheet.source !== "string" ||
      seen.has(sheet.id)
    ) {
      return null;
    }
    seen.add(sheet.id);
    sheets.push({
      id: sheet.id,
      projectId: sheet.projectId,
      title: sheet.title,
      source: sheet.source,
    });
  }
  return sheets;
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
