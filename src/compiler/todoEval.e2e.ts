import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  compileFresh,
  type CompilerEvent,
  type CompilerModel,
  type LogosImplSheet,
} from "./codegen";

type TimedEvent = CompilerEvent & {
  elapsedMs: number;
};

type TodoEvalResult = {
  event: "todo-eval-result";
  model: CompilerModel;
  elapsedMs: number;
  toolCalls: number;
  toolCommands: Record<string, number>;
  implementationEvents: number;
  finalLines: number;
  finalChars: number;
  done: boolean;
  semanticChecks: Record<string, boolean>;
  semanticOk: boolean;
  artifactPath?: string;
  timeline: Array<{
    elapsedMs: number;
    kind: CompilerEvent["kind"];
    tool?: string;
    command?: string;
    codeLines?: number;
    codeChars?: number;
  }>;
};

const enabled = process.env.RUN_TODO_EVAL === "true";
const describeIfEnabled = enabled ? describe : describe.skip;

const model = (process.env.TODO_EVAL_MODEL ?? "claude-sonnet-5") as CompilerModel;
const artifactDir = process.env.TODO_EVAL_ARTIFACT_DIR ?? ".todo-eval";

const todoSheet = `type Todo = {
  description: string;
  dueDate: Date;
  done: boolean;
};

type TodoId = string;

class TodoList {
  todos: Map<TodoId, Todo>;

  add(todo: Todo): TodoId;
  delete(todoId: TodoId): void;
  update(todoId: TodoId, todo: Todo): void;
}


function todo_app(): ReactApp {
  l\`
  Todo list application. Use Things 3 as inspiration.

  Seed with following data:
  
  [x] Buy groceries             [Today]
  [ ] Return clothes            [Tomorrow]
  [ ] Flight to Maldives        [Aug 27]
  [ ] Wedding                   [Dec 13 2027]

  Click the status to change status:
    - empty: empty circle
    - in progress: orange filled circle
    - done: green tick

  Click the date to raise a date picker that can select the date
  \`
}`;

describeIfEnabled("todo ReactApp compile eval", () => {
  it(
    "measures compile duration and text-editor tool calls",
    async () => {
      const started = performance.now();
      const events: TimedEvent[] = [];

      for await (const event of compileFresh(todoSheet, { model })) {
        events.push({
          ...event,
          elapsedMs: roundMs(performance.now() - started),
        });
      }

      const result = summarize(events, roundMs(performance.now() - started));
      console.log(JSON.stringify(result));

      expect(result.done).toBe(true);
      expect(result.finalLines).toBeGreaterThan(0);
      expect(result.semanticChecks).toEqual(
        Object.fromEntries(Object.keys(result.semanticChecks).map((key) => [key, true])),
      );
    },
    numericEnv("TODO_EVAL_TIMEOUT_MS", 900_000),
  );
});

function summarize(events: TimedEvent[], elapsedMs: number): TodoEvalResult {
  const done = events.findLast((event) => event.kind === "done");
  const finalCode = done?.kind === "done" ? done.code : "";
  const toolEvents = events.filter((event) => event.kind === "agent-tool");
  const toolCommands = new Map<string, number>();
  const semanticChecks = todoSemanticChecks(finalCode);

  for (const event of toolEvents) {
    if (event.kind !== "agent-tool") continue;
    const command = toolCommand(event.input);
    toolCommands.set(command, (toolCommands.get(command) ?? 0) + 1);
  }

  const artifactPath = finalCode.length > 0 ? saveArtifact(finalCode, events) : undefined;

  return {
    event: "todo-eval-result",
    model,
    elapsedMs,
    toolCalls: toolEvents.length,
    toolCommands: Object.fromEntries(toolCommands),
    implementationEvents: events.filter((event) => event.kind === "implementation").length,
    finalLines: lineCount(finalCode),
    finalChars: finalCode.length,
    done: done !== undefined,
    semanticChecks,
    semanticOk: Object.values(semanticChecks).every(Boolean),
    ...(artifactPath === undefined ? {} : { artifactPath }),
    timeline: events.map((event) => {
      if (event.kind === "agent-tool") {
        return {
          elapsedMs: event.elapsedMs,
          kind: event.kind,
          tool: event.tool,
          command: toolCommand(event.input),
        };
      }

      if (event.kind === "implementation" || event.kind === "done" || event.kind === "scaffold") {
        return {
          elapsedMs: event.elapsedMs,
          kind: event.kind,
          codeLines: lineCount(event.code),
          codeChars: event.code.length,
        };
      }

      return {
        elapsedMs: event.elapsedMs,
        kind: event.kind,
      };
    }),
  };
}

function saveArtifact(finalCode: LogosImplSheet, events: TimedEvent[]): string {
  mkdirSync(artifactDir, { recursive: true });
  const basename = `todo-${Date.now()}`;
  const codePath = join(artifactDir, `${basename}.ts`);
  const eventsPath = join(artifactDir, `${basename}.events.json`);
  writeFileSync(codePath, `${finalCode.trimEnd()}\n`, "utf8");
  writeFileSync(eventsPath, `${JSON.stringify(events, null, 2)}\n`, "utf8");
  return codePath;
}

function toolCommand(input: unknown): string {
  if (typeof input !== "object" || input === null || !("command" in input)) {
    return "unknown";
  }
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" && command.length > 0 ? command : "unknown";
}

function todoSemanticChecks(source: string): Record<string, boolean> {
  const lower = source.toLowerCase();
  return {
    hasValidTypeScriptSyntax: typeScriptSyntaxErrors(source).length === 0,
    hasTodoListClass: /\bclass\s+TodoList\b/.test(source),
    hasAllSeedItems: [
      "Buy groceries",
      "Return clothes",
      "Flight to Maldives",
      "Wedding",
    ].every((item) => source.includes(item)),
    hasTodayAndTomorrowLabels: source.includes("Today") && source.includes("Tomorrow"),
    hasEmptyState: lower.includes("empty") ||
      lower.includes("!isinprogress && !isdone") ||
      (lower.includes("transparent") && lower.includes("border")),
    hasInProgressState: /in[- ]?progress/.test(lower),
    hasDoneState: lower.includes("done"),
    hasOrangeInProgressVisual: /orange|#f59|#f97316|#fb923c|rgb\(\s*249/.test(lower),
    hasGreenDoneVisual: /green|#16a34a|#22c55e|rgb\(\s*22/.test(lower),
    hasCheckMark: source.includes("✓") || source.includes("\\u2713"),
    hasDatePickerBehavior: /input[^\n]+date|popover|calendar|selectedDate|selectDate|datePicker/i.test(source),
  };
}

function typeScriptSyntaxErrors(source: string): string[] {
  const file = ts.createSourceFile("todo-eval.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return file.parseDiagnostics.map((diagnostic) => {
    const position = diagnostic.start === undefined
      ? "unknown"
      : file.getLineAndCharacterOfPosition(diagnostic.start);
    const location = position === "unknown" ? "unknown" : `${position.line + 1}:${position.character + 1}`;
    return `${location} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length;
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
