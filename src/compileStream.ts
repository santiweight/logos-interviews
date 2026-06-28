import type { IncomingMessage, ServerResponse } from "node:http";
import {
  compile,
  type CodeCache,
  type CompilationEvent,
  type CompleteFunction,
} from "./codeSheet";

export async function handleCompileStream(
  req: IncomingMessage,
  res: ServerResponse,
  cache: CodeCache,
  complete: CompleteFunction,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const { sheet } = await readJson(req);
  if (typeof sheet !== "string") {
    sendJson(res, 400, { ok: false, error: "Missing sheet" });
    return;
  }

  const abortController = new AbortController();
  res.on("close", () => abortController.abort());

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    for await (const event of compile(cache, sheet, complete, {
      signal: abortController.signal,
      streamTokens: true,
    })) {
      if (abortController.signal.aborted || res.destroyed) {
        return;
      }

      res.write(`${JSON.stringify(toWireEvent(event))}\n`);
    }

    res.end();
  } catch (error) {
    if (abortController.signal.aborted || res.destroyed) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    res.write(`${JSON.stringify({ kind: "error", error: message })}\n`);
    res.end();
  }
}

function toWireEvent(event: CompilationEvent): Record<string, unknown> {
  switch (event.kind) {
    case "parsed":
      return { kind: "parsed", parsed: event.parsed };
    case "readiness":
      return { kind: "readiness", definitions: event.definitions };
    case "cache-hit":
      return {
        kind: "cache-hit",
        hash: event.hash,
        snippet: event.snippet,
        implementation: event.implementation,
      };
    case "llm-start":
      return { kind: "llm-start", hash: event.hash, snippet: event.snippet };
    case "llm-token":
      return { kind: "llm-token", hash: event.hash, token: event.token };
    case "llm-complete":
      return { kind: "llm-complete", hash: event.hash, implementation: event.implementation };
    case "implementation":
      return {
        kind: "implementation",
        implementation: event.source,
        completedSnippets: event.completedSnippets,
        totalSnippets: event.totalSnippets,
      };
    case "compiled":
      return {
        kind: "compiled",
        implementation: event.completed.source,
        completions: event.completed.completions,
      };
  }
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
