import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { anthropicClient } from "../anthropicKeyService";
import { buildWholeSheetCompletionPrompt, parse } from "../codeSheet";

export type LogosSheet = string;
export type LogosSheetId = string;
export type LogosImplSheet = string;
export type LogosImplSheetId = string;

export type CompilerModel =
  | "claude-sonnet-5"
  | "claude-opus-4-8"
  | "claude-haiku-4-5-20251001";

export type CompilerEvent =
  | { kind: "scaffold"; code: LogosImplSheet }
  | { kind: "agent-text"; text: string }
  | { kind: "agent-tool"; tool: string; input: unknown }
  | { kind: "implementation"; code: LogosImplSheet }
  | { kind: "done"; code: LogosImplSheet }
  | { kind: "error"; message: string };

export type CompilerOptions = {
  model: CompilerModel;
};

export type CompilerCache = {
  get(sheet: LogosSheet): LogosImplSheet | null;
  set(sheet: LogosSheet, code: LogosImplSheet): void;
  findPrevious(sheetId: LogosSheetId): { sheet: LogosSheet; code: LogosImplSheet } | null;
};

export async function* compile(
  sheetId: LogosSheetId,
  sheet: LogosSheet,
  cache: CompilerCache,
  options: CompilerOptions,
): AsyncIterable<CompilerEvent> {
  const cached = cache.get(sheet);
  if (cached !== null) {
    yield { kind: "done", code: cached };
    return;
  }

  const previous = cache.findPrevious(sheetId);
  let code: LogosImplSheet | null = null;

  if (previous) {
    const diff = diffLines(previous.sheet, sheet);
    for await (const event of compileUpdate(sheet, diff, previous.code, options)) {
      if (event.kind === "done") code = event.code;
      yield event;
    }
  } else {
    for await (const event of compileFresh(sheet, options)) {
      if (event.kind === "done") code = event.code;
      yield event;
    }
  }

  if (code !== null) {
    cache.set(sheet, code);
  }
}

export async function* compileFresh(
  sheet: LogosSheet,
  options: CompilerOptions,
): AsyncIterable<CompilerEvent> {
  yield { kind: "scaffold", code: sheet };
  yield* runAgent(sheet, buildPrompt(sheet, sheet, undefined, undefined), options);
}

export async function* compileUpdate(
  sheet: LogosSheet,
  diff: string,
  previousCode: LogosImplSheet,
  options: CompilerOptions,
): AsyncIterable<CompilerEvent> {
  yield* runAgent(previousCode, buildPrompt(sheet, previousCode, sheet, diff), options);
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

const MAX_TURNS = 8;
const FILE_PATH = "/impl.ts";

const TOOLS: ToolUnion[] = [
  { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
];

async function* runAgent(
  currentFile: string,
  prompt: string,
  options: CompilerOptions,
): AsyncIterable<CompilerEvent> {
  const client = anthropicClient();
  let code = normalizeNewlines(currentFile);
  const messages: MessageParam[] = [{ role: "user", content: prompt }];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const message = await client.messages.create({
      model: options.model,
      max_tokens: 16000,
      messages,
      tools: TOOLS,
    });

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    if (text.length > 0) {
      yield { kind: "agent-text", text };
    }

    messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });

    const toolUses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (message.stop_reason === "end_turn" && toolUses.length === 0) {
      yield { kind: "done", code };
      return;
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      yield { kind: "agent-tool", tool: toolUse.name, input: toolUse.input };

      try {
        const result = handleTextEditor(code, toolUse.input);
        code = result.code;
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result.response });
        if (result.changed) {
          yield { kind: "implementation", code };
        }
      } catch (error) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield { kind: "done", code };
}

// ---------------------------------------------------------------------------
// Text editor tool handler
// ---------------------------------------------------------------------------

type EditorResult = { code: string; changed: boolean; response: string };

function handleTextEditor(code: string, input: unknown): EditorResult {
  const args = input as Record<string, unknown>;
  const command = args.command as string;

  switch (command) {
    case "view": {
      const viewRange = args.view_range as [number, number] | undefined;
      const lines = code.split("\n");
      if (viewRange) {
        const [start, end] = viewRange;
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((line, i) => `${start + i}\t${line}`).join("\n");
        return { code, changed: false, response: numbered };
      }
      const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
      return { code, changed: false, response: numbered };
    }

    case "create": {
      const fileText = args.file_text as string;
      const next = normalizeNewlines(fileText);
      return { code: next, changed: next !== code, response: `File created (${lineCount(next)} lines).` };
    }

    case "str_replace": {
      const oldStr = args.old_str as string;
      const newStr = args.new_str as string;
      const occurrences = code.split(oldStr).length - 1;
      if (occurrences === 0) {
        throw new Error(`No match found for:\n${oldStr}`);
      }
      if (occurrences > 1) {
        throw new Error(`Found ${occurrences} matches — expected exactly 1. Make old_str more specific.`);
      }
      const next = code.replace(oldStr, newStr);
      return { code: next, changed: next !== code, response: "Replacement applied." };
    }

    case "insert": {
      const insertLine = args.insert_line as number;
      const newStr = args.new_str as string;
      const lines = code.split("\n");
      const insertLines = normalizeNewlines(newStr).split("\n");
      lines.splice(insertLine, 0, ...insertLines);
      const next = lines.join("\n");
      return { code: next, changed: true, response: `Inserted ${insertLines.length} line(s) after line ${insertLine}.` };
    }

    default:
      throw new Error(`Unknown text editor command: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(
  sheet: LogosSheet,
  currentCode: string,
  previousSheet: LogosSheet | undefined,
  diff: string | undefined,
): string {
  const compilerContext = buildWholeSheetCompletionPrompt(parse(sheet), currentCode);

  return `You are updating a TypeScript implementation file to match a Logos worksheet.

The file is at ${FILE_PATH}. Use the text editor tool to view and edit it.
The current file is a scaffold generated from the worksheet. It already has the correct structure — imports, type declarations, class and function signatures, and runnable definitions — but contains incomplete fragments (pseudo-code, natural-language descriptions, or stub bodies) that you need to replace with working TypeScript.
Your job is to complete the incomplete parts of the scaffold while preserving its existing structure. Do not rewrite code that is already correct.
The current worksheet is the sole source of truth. Remove obsolete functions, classes, helpers, imports, UI elements, stories, workflows, runnables, and behavior that are no longer implied by the current worksheet.
Do not keep previous behavior merely because it still compiles. Preserve old code only when it directly implements a declaration, behavior, or dependency still present in the current worksheet.
Prefer focused str_replace edits over creating the entire file from scratch.
When you are done editing, just end your turn — do not call any tool.

The following legacy compiler context is the same context used by the non-tool whole-sheet compiler. Follow all of its semantic rules, dependency rules, runtime restrictions, output-formatting guidance, annotation guidance, and incomplete-fragment context.
When that context says to return the entire revised TypeScript code sheet, apply the equivalent change through text editor edits instead.
Generated code runs with Node.js through tsx, except functions returning ReactApp, which render in the browser run panel. For ReactApp functions, return React.createElement(...) and use React hooks through the provided React global; use the provided radix global for Radix Themes UI components; do not use JSX, raw HTML strings, React imports, or Radix imports.
Do not add top-level script calls such as main(), await main(), or void main(); the Logos runner invokes the selected runnable.

Legacy compiler context:
${compilerContext}

Worksheet to compile:
\`\`\`typescript
${sheet}
\`\`\`

${previousSheet ? `Previous worksheet:
\`\`\`typescript
${previousSheet}
\`\`\`

Diff from previous worksheet:
\`\`\`diff
${diff ?? ""}
\`\`\`

` : ""}Current implementation file (${FILE_PATH}):
\`\`\`typescript
${currentCode}
\`\`\``;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function diffLines(previous: string, next: string): string {
  const prevLines = previous.replaceAll("\r\n", "\n").split("\n");
  const nextLines = next.replaceAll("\r\n", "\n").split("\n");
  const max = Math.max(prevLines.length, nextLines.length);
  const diff: string[] = [];
  for (let i = 0; i < max; i++) {
    if (prevLines[i] === nextLines[i]) continue;
    if (prevLines[i] !== undefined) diff.push(`-${prevLines[i]}`);
    if (nextLines[i] !== undefined) diff.push(`+${nextLines[i]}`);
  }
  return diff.join("\n");
}

function normalizeNewlines(s: string): string {
  return s.replaceAll("\r\n", "\n");
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length;
}

export { parse as parseLogos } from "../codeSheet";
export type { ParsedSheet as LogosAst } from "../codeSheet";
