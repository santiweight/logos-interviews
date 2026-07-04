import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import {
  buildWholeSheetCompletionPrompt,
  parse,
  type CodeSheet,
} from "./codeSheet";

export type SingleFileAgentInput = {
  previousSheet?: CodeSheet;
  nextSheet: CodeSheet;
  currentCode: CodeSheet;
  diffFromPrevious?: string;
};

export type SingleFileAgentOptions = {
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  maxTurns?: number;
};

export type SingleFileAgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "file"; source: CodeSheet }
  | { kind: "done"; source: CodeSheet };

export type SingleFileAgentFunction = (
  input: SingleFileAgentInput,
  options?: SingleFileAgentOptions,
) => AsyncIterable<SingleFileAgentEvent>;

export const singleFileAgentTools: Tool[] = [
  {
    name: "replace_range",
    description: [
      "Replace an inclusive 1-based line range in the in-memory TypeScript implementation file.",
      "Use this for focused, coherent edits, including first-pass implementation from a scaffold.",
      "The replacement text may contain multiple lines.",
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
        replacement: { type: "string" },
      },
      required: ["startLine", "endLine", "replacement"],
    },
  },
  {
    name: "replace_text",
    description: [
      "Replace exact text in the in-memory TypeScript implementation file.",
      "Use this when a focused literal edit is safer than line numbers.",
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        replacement: { type: "string" },
        expectedReplacements: { type: "integer", minimum: 1 },
      },
      required: ["target", "replacement"],
    },
  },
  {
    name: "replace_file",
    description: [
      "Replace the entire in-memory TypeScript implementation file.",
      "Use this only when the current file is mostly obsolete or a focused sequence of smaller edits would be less clear.",
      "Do not use this for normal first-pass codegen from a scaffold; prefer replace_range or replace_text.",
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string" },
      },
      required: ["source"],
    },
  },
  {
    name: "finish",
    description: "Finish the single-file edit. Optionally provide the final source if it differs from the current in-memory file.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string" },
      },
    },
  },
];

export async function* runClaudeSingleFileAgent(
  input: SingleFileAgentInput,
  options: SingleFileAgentOptions = {},
): AsyncIterable<SingleFileAgentEvent> {
  const client = anthropicClient(options.apiKey);
  const model = options.model ?? process.env.ANTHROPIC_CODEGEN_MODEL ?? process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-4-6";
  const maxTurns = options.maxTurns ?? 8;
  let currentCode = normalizeNewlines(input.currentCode);
  const messages: MessageParam[] = [{
    role: "user",
    content: buildSingleFileAgentPrompt(input),
  }];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (options.signal?.aborted) {
      return;
    }

    const message = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        messages,
        tools: singleFileAgentTools,
        tool_choice: { type: "auto" },
      },
      { signal: options.signal },
    );

    const text = message.content
      .map((block) => block.type === "text" ? block.text : "")
      .join("");
    if (text.length > 0) {
      yield { kind: "text", text };
    }

    messages.push({
      role: "assistant",
      content: message.content as ContentBlockParam[],
    });

    const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
    if (toolUses.length === 0) {
      const fallback = extractTypeScriptSource(text);
      if (fallback !== null) {
        currentCode = fallback;
        yield { kind: "file", source: currentCode };
        yield { kind: "done", source: currentCode };
        return;
      }
      throw new Error("Claude single-file agent stopped without using an edit or finish tool");
    }

    const toolResults: ContentBlockParam[] = [];
    for (const toolUse of toolUses) {
      yield { kind: "tool", name: toolUse.name, input: toolUse.input };

      try {
        const result = applySingleFileTool(currentCode, toolUse.name, toolUse.input);
        currentCode = result.source;
        if (result.changed) {
          yield { kind: "file", source: currentCode };
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.message,
        });

        if (result.done) {
          yield { kind: "done", source: currentCode };
          return;
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

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  throw new Error(`Claude single-file agent exceeded ${maxTurns} turns`);
}

export function buildSingleFileAgentPrompt(input: SingleFileAgentInput): string {
  const compilerContext = buildWholeSheetCompletionPrompt(parse(input.nextSheet), input.currentCode);

  return `You are compiling one Logos worksheet into one TypeScript implementation file.

You can only edit the single in-memory file already provided below. There is no filesystem and no read-file tool.
Your goal is the correct final implementation for the current worksheet, not making the smallest possible edit.
The current worksheet is the sole source of truth. Previous worksheets and the current implementation file are only baselines for reuse.
Before finishing, remove obsolete functions, classes, helpers, imports, UI elements, stories, workflows, runnables, and behavior that are no longer implied by the current worksheet.
Do not keep previous behavior merely because it still compiles. Preserve old code only when it directly implements a declaration, behavior, or dependency still present in the current worksheet.
Prefer a sequence of focused, reviewable edits over one giant replacement. Use replace_range or replace_text to update imports, types, helpers, components, and runnable bodies in separate coherent chunks.
This applies to the first round of codegen too: the current implementation file is a scaffold to edit incrementally, not a reason to replace the entire file in one tool call.
Do not use replace_file as the default. Use replace_file only when the current file is mostly obsolete or when deleting stale code is clearer than incremental edits.
Call finish only when the whole implementation matches the current worksheet.

The following legacy compiler context is the same context used by the non-tool whole-sheet compiler. Follow all of its semantic rules, dependency rules, runtime restrictions, output-formatting guidance, annotation guidance, and incomplete-fragment context.
When that context says to return the entire revised TypeScript code sheet, do not answer with raw code; apply the equivalent final-file change through focused replace_range or replace_text calls where practical, or replace_file only when the old file is mostly obsolete, then call finish.
Generated code runs with Node.js through tsx, except functions returning ReactApp, which render in the browser run panel. For ReactApp functions, return React.createElement(...) and use React hooks through the provided React global; do not use JSX, raw HTML strings, or React imports.
For persistent interactive terminal apps, use neo-blessed. For simple CLI apps, console.log and Node readline/key events are enough.
For neo-blessed modal text entry, do not use blessed.form, autoNext, inputOnFocus, or textbox.readInput. Build modal editors from boxes/text and handle modal keypresses manually from one screen.on("keypress", ...) handler.
Do not add top-level script calls such as main(), await main(), or void main(); the Logos runner invokes the selected runnable.

Legacy compiler context:
${compilerContext}

Worksheet to compile:
\`\`\`typescript
${input.nextSheet}
\`\`\`

${input.previousSheet ? `Previous worksheet:
\`\`\`typescript
${input.previousSheet}
\`\`\`

Diff from previous worksheet:
\`\`\`diff
${input.diffFromPrevious ?? ""}
\`\`\`

` : ""}Current implementation file:
\`\`\`typescript
${input.currentCode}
\`\`\``;
}

function anthropicClient(apiKey: string | undefined): Anthropic {
  const resolvedApiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!resolvedApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude single-file agent");
  }

  return new Anthropic({ apiKey: resolvedApiKey });
}

function applySingleFileTool(
  source: CodeSheet,
  name: string,
  input: unknown,
): { source: CodeSheet; changed: boolean; done: boolean; message: string } {
  switch (name) {
    case "replace_file": {
      const args = objectInput(input);
      const next = normalizeNewlines(stringArg(args, "source"));
      return {
        source: next,
        changed: next !== source,
        done: false,
        message: `Updated file (${lineCount(next)} lines).`,
      };
    }
    case "replace_range": {
      const args = objectInput(input);
      const next = replaceRange(
        source,
        integerArg(args, "startLine"),
        integerArg(args, "endLine"),
        stringArg(args, "replacement"),
      );
      return {
        source: next,
        changed: next !== source,
        done: false,
        message: `Updated file (${lineCount(next)} lines).`,
      };
    }
    case "replace_text": {
      const args = objectInput(input);
      const target = stringArg(args, "target");
      const replacement = normalizeNewlines(stringArg(args, "replacement"));
      const expected = optionalIntegerArg(args, "expectedReplacements");
      const occurrences = source.split(target).length - 1;
      if (occurrences === 0) {
        throw new Error("replace_text target was not found");
      }
      if (expected !== undefined && occurrences !== expected) {
        throw new Error(`replace_text expected ${expected} replacements but found ${occurrences}`);
      }
      const next = source.replaceAll(target, replacement);
      return {
        source: next,
        changed: next !== source,
        done: false,
        message: `Updated ${occurrences} occurrence${occurrences === 1 ? "" : "s"}.`,
      };
    }
    case "finish": {
      const args = objectInput(input);
      const next = typeof args.source === "string" ? normalizeNewlines(args.source) : source;
      return {
        source: next,
        changed: next !== source,
        done: true,
        message: "Finished.",
      };
    }
    default:
      throw new Error(`Unknown single-file tool: ${name}`);
  }
}

function replaceRange(
  source: CodeSheet,
  startLine: number,
  endLine: number,
  replacement: string,
): CodeSheet {
  const lines = normalizeNewlines(source).split("\n");
  if (startLine > endLine) {
    throw new Error("replace_range startLine must be less than or equal to endLine");
  }
  if (endLine > lines.length) {
    throw new Error(`replace_range endLine ${endLine} is past the file length ${lines.length}`);
  }

  const replacementLines = normalizeNewlines(replacement).split("\n");
  lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  return lines.join("\n");
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function stringArg(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string") {
    throw new Error(`Tool input ${name} must be a string`);
  }
  return normalizeNewlines(value);
}

function integerArg(input: Record<string, unknown>, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Tool input ${name} must be an integer`);
  }
  return value;
}

function optionalIntegerArg(input: Record<string, unknown>, name: string): number | undefined {
  if (input[name] === undefined) {
    return undefined;
  }
  return integerArg(input, name);
}

function normalizeNewlines(source: string): string {
  return source.replaceAll("\r\n", "\n");
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length;
}

function extractTypeScriptSource(text: string): string | null {
  const fenced = text.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/)?.[1];
  return fenced ? normalizeNewlines(fenced).trim() : null;
}
