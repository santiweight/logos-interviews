import type { CodeSheet, CompleteFunction, CompleteResult } from "./codeSheet";

export type AgentChatRole = "user" | "assistant";

export type AgentChatMessage = {
  role: AgentChatRole;
  content: string;
};

export type SheetAgentResult = {
  reply: string;
  sheet: CodeSheet | null;
};

export async function runSheetAgent(
  sheet: CodeSheet,
  messages: AgentChatMessage[],
  complete: CompleteFunction,
): Promise<SheetAgentResult> {
  const response = await completeText(complete(buildSheetAgentPrompt(sheet, messages)));
  return parseSheetAgentResponse(response);
}

async function completeText(result: CompleteResult): Promise<string> {
  if (typeof result === "string") {
    return result;
  }

  if (isAsyncIterable(result)) {
    let text = "";
    for await (const token of result) {
      text += token;
    }
    return text;
  }

  return result;
}

function isAsyncIterable(value: CompleteResult): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

export function buildSheetAgentPrompt(
  sheet: CodeSheet,
  messages: AgentChatMessage[],
): string {
  return `You are a simple coding agent for an in-memory Python-like code sheet.

You can discuss the sheet with the user and propose edits. You do not have filesystem access.
The code sheet is an architecture-level interview scaffold, not a full implementation file.
When editing, update comments, types, class fields, function/method signatures, and runnable test code.
Do not add concrete implementation bodies for parsers, evaluators, storage logic, or helper functions unless the user explicitly asks for a full implementation.
If the user includes implementation code as an example, extract the requested API/contract change and keep the sheet at the definition level.
When the user asks for a code change, return the entire revised code sheet so it can replace the editor contents.
When the user is only asking a question, set "sheet" to null.

Current code sheet:
\`\`\`python
${sheet}
\`\`\`

Conversation:
${messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n")}

Return only JSON with this exact shape:
{
  "reply": "short conversational response",
  "sheet": "full revised code sheet with no Markdown code fences, or null if there is no edit"
}`;
}

function parseSheetAgentResponse(source: string): SheetAgentResult {
  const parsed = JSON.parse(extractJson(source)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Agent returned a non-object response");
  }

  const reply = parsed["reply"];
  const sheet = parsed["sheet"];
  if (typeof reply !== "string") {
    throw new Error("Agent response is missing reply");
  }
  if (sheet !== null && typeof sheet !== "string") {
    throw new Error("Agent response sheet must be a string or null");
  }

  return { reply, sheet: sheet === null ? null : normalizeAgentSheet(sheet) };
}

export function normalizeAgentSheet(source: string): CodeSheet {
  const trimmed = source.trim();
  const fence = trimmed.match(/^```(?:python)?\s*\n([\s\S]*?)\n```$/);
  return (fence?.[1] ?? source).replaceAll("\r\n", "\n").trim();
}

function extractJson(source: string): string {
  const trimmed = source.trim();
  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fence) {
    return fence[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
