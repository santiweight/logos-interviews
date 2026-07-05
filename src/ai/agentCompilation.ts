import {
  buildWholeSheetCompletionPrompt,
  cachedCompiledSheet,
  cacheImplementation,
  compile,
  definitionReadinessFromImplementation,
  definitionReadiness,
  buildCompilationIR,
  completeSheet,
  hashWholeSheetCompletionInput,
  parse,
  renderImplementation,
  type CodeCache,
  type CodeSheet,
  type CompilationEvent,
  type CompileOptions,
  type CompleteFunction,
  type CompleteResult,
  type CompletedCodeSheet,
  type Runnable,
} from "../domain/codeSheet";
import {
  buildTypeScriptProgram,
  runTypeScript,
  runResult,
  type RunResult,
} from "../runtime/compilationStrategies/shared";
import type { SingleFileAgentFunction } from "./claudeSingleFileAgent";
import { typeCheck } from "../domain/typeCheck";

export type SheetId = string;

export type AgentCompilationRecord = {
  sheet: CodeSheet;
  code: CodeSheet;
};

export type AgentCompilationFrameworkOptions = {
  cache?: CodeCache;
  complete?: CompleteFunction;
  fileAgent?: SingleFileAgentFunction;
  python?: string;
  tsx?: string;
  onStdoutLine?: (line: string) => void;
};

type InFlightCompilation = {
  promise: Promise<CodeSheet>;
  resolve: (code: CodeSheet) => void;
  reject: (error: unknown) => void;
};

export class AgentCompilationFramework {
  private readonly cacheStore: CodeCache;
  private readonly sheetState = new Map<SheetId, AgentCompilationRecord>();
  private readonly recentRecords: AgentCompilationRecord[] = [];
  private readonly inFlightCompilations = new Map<string, InFlightCompilation>();
  private cacheGeneration = 0;

  constructor(private readonly options: AgentCompilationFrameworkOptions = {}) {
    this.cacheStore = options.cache ?? new Map();
  }

  async compile(sheetCode: CodeSheet): Promise<CodeSheet> {
    const cached = await this.cache(sheetCode);
    if (cached !== null) {
      return cached;
    }

    if (this.options.fileAgent) {
      const code = await this.compileWithFileAgent(sheetCode);
      this.rememberRecent(sheetCode, code);
      return code;
    }

    if (!this.options.complete) {
      return sheetCode;
    }

    const completed = await completeSheet(this.cacheStore, sheetCode, this.options.complete, {
      strategy: "agentic",
      emitProgress: false,
      streamTokens: false,
    });
    this.rememberRecent(sheetCode, completed.source);
    return completed.source;
  }

  async *compileEvents(
    sheetCode: CodeSheet,
    options: Pick<CompileOptions, "signal" | "streamTokens" | "emitProgress" | "abortCurrentCompletion"> = {},
  ): AsyncIterable<CompilationEvent> {
    const cached = await cachedCompiledSheet(this.cacheStore, sheetCode);
    if (cached) {
      yield* cachedCompilationEvents(sheetCode, cached, options);
      this.rememberRecent(sheetCode, cached.source);
      return;
    }

    const previous = this.bestPreviousRecord(sheetCode);
    if (previous && (this.options.fileAgent || this.options.complete)) {
      yield* this.updateEvents(previous, sheetCode, options);
      return;
    }

    if (this.options.fileAgent) {
      yield* this.fileAgentEvents(null, sheetCode, options);
      return;
    }

    let completed: CompletedCodeSheet | null = null;
    for await (const event of compile(this.cacheStore, sheetCode, this.options.complete, {
      ...options,
      strategy: "agentic",
    })) {
      if (event.kind === "compiled") {
        completed = event.completed;
      }
      yield event;
    }

    if (completed) {
      this.rememberRecent(sheetCode, completed.source);
    }
  }

  async update(
    sheetId: SheetId,
    sheetCode: CodeSheet,
    diffFromPrevious: string,
  ): Promise<CodeSheet> {
    const cached = await this.cache(sheetCode);
    if (cached !== null) {
      this.sheetState.set(sheetId, { sheet: sheetCode, code: cached });
      this.rememberRecent(sheetCode, cached);
      return cached;
    }

    const previous = this.sheetState.get(sheetId);
    if (!previous) {
      const code = await this.compile(sheetCode);
      this.sheetState.set(sheetId, { sheet: sheetCode, code });
      this.rememberRecent(sheetCode, code);
      return code;
    }

    if (this.options.fileAgent) {
      const code = await this.compileWithFileAgent(sheetCode, previous, diffFromPrevious);
      this.sheetState.set(sheetId, { sheet: sheetCode, code });
      this.rememberRecent(sheetCode, code);
      return code;
    }

    if (!this.options.complete) {
      const code = await this.compile(sheetCode);
      this.sheetState.set(sheetId, { sheet: sheetCode, code });
      this.rememberRecent(sheetCode, code);
      return code;
    }

    const code = normalizeWholeSheetAgentResult(await completeText(this.options.complete(
      buildCompilationUpdatePrompt({
        previousSheet: previous.sheet,
        previousCode: previous.code,
        nextSheet: sheetCode,
        diffFromPrevious,
      }),
    )));
    await cacheImplementation(this.cacheStore, hashWholeSheetCompletionInput(parse(sheetCode)), code);
    this.sheetState.set(sheetId, { sheet: sheetCode, code });
    this.rememberRecent(sheetCode, code);
    return code;
  }

  async run(sheetCode: CodeSheet, runnable: Runnable): Promise<RunResult> {
    const code = await this.cache(sheetCode) ?? await this.compile(sheetCode);
    const completed = completedFromCachedCode(sheetCode, code);
    const executed = await runTypeScript(
      buildTypeScriptProgram(code, runnable),
      this.options.tsx,
      this.options.onStdoutLine,
    );
    return runResult(executed, completed);
  }

  async cache(sheetCode: CodeSheet): Promise<CodeSheet | null> {
    return (await cachedCompiledSheet(this.cacheStore, sheetCode))?.source ?? null;
  }

  remember(sheetId: SheetId, sheetCode: CodeSheet, code: CodeSheet): void {
    this.sheetState.set(sheetId, { sheet: sheetCode, code });
    this.rememberRecent(sheetCode, code);
  }

  clear(): void {
    this.cacheGeneration += 1;
    this.sheetState.clear();
    this.recentRecords.length = 0;
    for (const inFlight of this.inFlightCompilations.values()) {
      inFlight.reject(new Error("Compilation invalidated by cache clear"));
    }
    this.inFlightCompilations.clear();
  }

  private async *updateEvents(
    previous: AgentCompilationRecord,
    sheetCode: CodeSheet,
    options: Pick<CompileOptions, "signal" | "streamTokens" | "emitProgress" | "abortCurrentCompletion">,
  ): AsyncIterable<CompilationEvent> {
    if (this.options.fileAgent) {
      yield* this.fileAgentEvents(previous, sheetCode, options);
      return;
    }

    const emitProgress = options.emitProgress ?? true;
    const parsed = parse(sheetCode);
    const ir = buildCompilationIR(parsed);
    const sheetHash = hashWholeSheetCompletionInput(parsed);
    const totalSnippets = ir.nodes.filter((node) => node.kind === "incomplete").length;

    if (options.signal?.aborted) {
      return;
    }

    if (emitProgress) {
      yield { kind: "parsed", parsed };
      yield { kind: "typecheck", diagnostics: typeCheck(parsed) };
      yield {
        kind: "implementation",
        source: previous.code,
        completedSnippets: 0,
        totalSnippets,
      };
      yield { kind: "readiness", definitions: definitionReadiness(parsed, this.cacheStore) };
      yield { kind: "llm-start", hash: sheetHash, snippet: parsed.source };
    }

    const prompt = buildCompilationUpdatePrompt({
      previousSheet: previous.sheet,
      previousCode: previous.code,
      nextSheet: sheetCode,
      diffFromPrevious: diffLines(previous.sheet, sheetCode),
    });
    const result = this.options.complete?.(
      prompt,
      options.abortCurrentCompletion ? { signal: options.signal } : undefined,
    ) ?? "";
    let code = "";

    if (isAsyncIterable(result)) {
      for await (const token of result) {
        code += token;
        if (emitProgress && !options.signal?.aborted && options.streamTokens !== false) {
          yield { kind: "llm-token", hash: sheetHash, token };
        }
      }
    } else {
      code = await result;
    }

    if (options.signal?.aborted) {
      return;
    }

    code = normalizeWholeSheetAgentResult(code);
    await cacheImplementation(this.cacheStore, sheetHash, code);
    this.rememberRecent(sheetCode, code);

    if (emitProgress) {
      yield { kind: "llm-complete", hash: sheetHash, implementation: code };
      yield {
        kind: "implementation",
        source: code,
        completedSnippets: totalSnippets,
        totalSnippets,
      };
      yield { kind: "readiness", definitions: definitionReadinessFromImplementation(parsed, code) };
    }

    yield {
      kind: "compiled",
      completed: completedFromCachedCode(sheetCode, code),
    };
  }

  private async compileWithFileAgent(
    sheetCode: CodeSheet,
    previous: AgentCompilationRecord | null = null,
    diffFromPrevious = previous ? diffLines(previous.sheet, sheetCode) : "",
  ): Promise<CodeSheet> {
    const generation = this.cacheGeneration;
    const sheetHash = hashWholeSheetCompletionInput(parse(sheetCode));
    const existing = this.inFlightCompilations.get(sheetHash);
    if (existing) {
      return existing.promise;
    }

    const inFlight = createInFlightCompilation();
    this.inFlightCompilations.set(sheetHash, inFlight);
    let code = previous?.code ?? renderImplementation(buildCompilationIR(parse(sheetCode)));

    try {
      for await (const event of this.runFileAgent(previous, sheetCode, diffFromPrevious, {})) {
        if (event.kind === "file" || event.kind === "done") {
          code = normalizeImplementationCode(event.source);
        }
      }

      if (generation !== this.cacheGeneration) {
        throw new Error("Compilation invalidated by cache clear");
      }
      await cacheImplementation(this.cacheStore, sheetHash, code);
      inFlight.resolve(code);
      return code;
    } catch (error) {
      inFlight.reject(error);
      throw error;
    } finally {
      if (this.inFlightCompilations.get(sheetHash) === inFlight) {
        this.inFlightCompilations.delete(sheetHash);
      }
    }
  }

  private async *fileAgentEvents(
    previous: AgentCompilationRecord | null,
    sheetCode: CodeSheet,
    options: Pick<CompileOptions, "signal" | "streamTokens" | "emitProgress" | "abortCurrentCompletion">,
  ): AsyncIterable<CompilationEvent> {
    const emitProgress = options.emitProgress ?? true;
    const parsed = parse(sheetCode);
    const ir = buildCompilationIR(parsed);
    const sheetHash = hashWholeSheetCompletionInput(parsed);
    const totalSnippets = ir.nodes.filter((node) => node.kind === "incomplete").length;
    const diffFromPrevious = previous ? diffLines(previous.sheet, sheetCode) : "";
    let code = previous?.code ?? renderImplementation(ir);
    const existing = this.inFlightCompilations.get(sheetHash);
    const generation = this.cacheGeneration;

    if (options.signal?.aborted) {
      return;
    }

    if (emitProgress) {
      yield { kind: "parsed", parsed };
      yield { kind: "typecheck", diagnostics: typeCheck(parsed) };
      if (previous) {
        yield {
          kind: "implementation",
          source: previous.code,
          completedSnippets: 0,
          totalSnippets,
        };
      }
      yield { kind: "readiness", definitions: definitionReadiness(parsed, this.cacheStore) };
      yield { kind: "llm-start", hash: sheetHash, snippet: parsed.source };
    }

    if (existing) {
      code = await existing.promise;
    } else {
      const inFlight = createInFlightCompilation();
      this.inFlightCompilations.set(sheetHash, inFlight);

      try {
        for await (const event of this.runFileAgent(previous, sheetCode, diffFromPrevious, options)) {
          if (options.signal?.aborted) {
            throw new Error("Compilation aborted");
          }

          if (event.kind === "text" && emitProgress && options.streamTokens !== false) {
            yield { kind: "llm-token", hash: sheetHash, token: event.text };
            yield { kind: "agent-text", text: event.text };
          }

          if (event.kind === "tool" && emitProgress) {
            yield { kind: "agent-tool", name: event.name, input: event.input };
          }

          if (event.kind === "file" || event.kind === "done") {
            code = normalizeImplementationCode(event.source);
            if (emitProgress) {
              yield {
                kind: "implementation",
                source: code,
                completedSnippets: event.kind === "done" ? totalSnippets : 0,
                totalSnippets,
              };
            }
          }
        }

        if (generation !== this.cacheGeneration) {
          return;
        }
        await cacheImplementation(this.cacheStore, sheetHash, code);
        inFlight.resolve(code);
      } catch (error) {
        inFlight.reject(error);
        throw error;
      } finally {
        if (this.inFlightCompilations.get(sheetHash) === inFlight) {
          this.inFlightCompilations.delete(sheetHash);
        }
      }
    }

    if (options.signal?.aborted) {
      return;
    }

    if (generation !== this.cacheGeneration) {
      return;
    }
    await cacheImplementation(this.cacheStore, sheetHash, code);
    this.rememberRecent(sheetCode, code);

    if (emitProgress) {
      yield { kind: "llm-complete", hash: sheetHash, implementation: code };
      yield {
        kind: "implementation",
        source: code,
        completedSnippets: totalSnippets,
        totalSnippets,
      };
      yield { kind: "readiness", definitions: definitionReadinessFromImplementation(parsed, code) };
    }

    yield {
      kind: "compiled",
      completed: completedFromCachedCode(sheetCode, code),
    };
  }

  private runFileAgent(
    previous: AgentCompilationRecord | null,
    sheetCode: CodeSheet,
    diffFromPrevious: string,
    options: Pick<CompileOptions, "signal" | "abortCurrentCompletion">,
  ) {
    if (!this.options.fileAgent) {
      throw new Error("AgentCompilationFramework fileAgent is not configured");
    }

    return this.options.fileAgent(
      {
        previousSheet: previous?.sheet,
        nextSheet: sheetCode,
        currentCode: previous?.code ?? renderImplementation(buildCompilationIR(parse(sheetCode))),
        diffFromPrevious,
      },
      options.signal ? { signal: options.signal } : undefined,
    );
  }

  private rememberRecent(sheet: CodeSheet, code: CodeSheet): void {
    const normalized = normalizeForSimilarity(sheet);
    const existing = this.recentRecords.findIndex((record) => normalizeForSimilarity(record.sheet) === normalized);
    if (existing >= 0) {
      this.recentRecords.splice(existing, 1);
    }

    this.recentRecords.unshift({ sheet, code });
    this.recentRecords.splice(20);
  }

  private bestPreviousRecord(sheet: CodeSheet): AgentCompilationRecord | null {
    let best: { record: AgentCompilationRecord; score: number } | null = null;
    for (const record of this.recentRecords) {
      const score = sheetSimilarity(record.sheet, sheet);
      if (!best || score > best.score) {
        best = { record, score };
      }
    }

    return best && best.score >= 0.45 ? best.record : null;
  }
}

function cachedCompilationEvents(
  sheetCode: CodeSheet,
  completed: CompletedCodeSheet,
  options: Pick<CompileOptions, "signal" | "emitProgress">,
): CompilationEvent[] {
  if (options.signal?.aborted) {
    return [];
  }

  const emitProgress = options.emitProgress ?? true;
  if (!emitProgress) {
    return [{ kind: "compiled", completed }];
  }

  const parsed = parse(sheetCode);
  const completion = completed.completions[0];
  return [
    { kind: "parsed", parsed },
    { kind: "typecheck", diagnostics: typeCheck(parsed) },
    ...(completion
      ? [{
          kind: "cache-hit" as const,
          hash: completion.hash,
          snippet: completion.snippet,
          implementation: completion.replacement,
        }]
      : []),
    {
      kind: "implementation",
      source: completed.source,
      completedSnippets: parsed.incompleteSnippets.length,
      totalSnippets: parsed.incompleteSnippets.length,
    },
    { kind: "readiness", definitions: definitionReadinessFromImplementation(parsed, completed.source) },
    { kind: "compiled", completed },
  ];
}

function createInFlightCompilation(): InFlightCompilation {
  let resolve!: (code: CodeSheet) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CodeSheet>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function completedFromCachedCode(sheetCode: CodeSheet, code: CodeSheet): CompletedCodeSheet {
  const parsedSheet = parse(sheetCode);
  return {
    source: code,
    lowered: {
      source: code,
      parsed: parse(code),
    },
    completions: [{
      hash: hashWholeSheetCompletionInput(parsedSheet),
      snippet: parsedSheet.source,
      replacement: code,
      cached: true,
    }],
    ir: parseCompletedIr(code),
  };
}

function parseCompletedIr(code: CodeSheet): CompletedCodeSheet["ir"] {
  const completed = parse(code);
  return {
    parsed: completed,
    lowered: {
      source: code,
      parsed: completed,
    },
    nodes: [{ kind: "source", source: code }],
  };
}

function buildCompilationUpdatePrompt(options: {
  previousSheet: CodeSheet;
  previousCode: CodeSheet;
  nextSheet: CodeSheet;
  diffFromPrevious: string;
}): string {
  return `${buildWholeSheetCompletionPrompt(parse(options.nextSheet))}

You are updating an existing compilation for the same sheet agent. The current worksheet is the sole source of truth, and your goal is the right final implementation, not preserving old code or making a minimal edit.
Use the previous compiled code only as a baseline for reusable pieces that still directly implement the current worksheet. Remove obsolete functions, classes, helpers, imports, UI elements, stories, workflows, runnables, and behavior that are no longer implied by the current worksheet.

Previous worksheet:
\`\`\`typescript
${options.previousSheet}
\`\`\`

Previous compiled code:
\`\`\`typescript
${options.previousCode}
\`\`\`

Diff from previous worksheet:
\`\`\`diff
${options.diffFromPrevious}
\`\`\``;
}

function diffLines(previous: CodeSheet, next: CodeSheet): string {
  const previousLines = previous.replaceAll("\r\n", "\n").split("\n");
  const nextLines = next.replaceAll("\r\n", "\n").split("\n");
  const max = Math.max(previousLines.length, nextLines.length);
  const diff: string[] = [];

  for (let index = 0; index < max; index += 1) {
    const before = previousLines[index];
    const after = nextLines[index];
    if (before === after) {
      continue;
    }
    if (before !== undefined) {
      diff.push(`-${before}`);
    }
    if (after !== undefined) {
      diff.push(`+${after}`);
    }
  }

  return diff.join("\n");
}

function sheetSimilarity(left: CodeSheet, right: CodeSheet): number {
  const leftLines = uniqueContentLines(left);
  const rightLines = uniqueContentLines(right);
  if (leftLines.size === 0 && rightLines.size === 0) {
    return 1;
  }

  let overlap = 0;
  for (const line of leftLines) {
    if (rightLines.has(line)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftLines.size, rightLines.size);
}

function uniqueContentLines(source: CodeSheet): Set<string> {
  return new Set(source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0));
}

function normalizeForSimilarity(source: CodeSheet): string {
  return Array.from(uniqueContentLines(source)).join("\n");
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

function normalizeWholeSheetAgentResult(source: string): CodeSheet {
  const trimmed = source.trim();
  const json = tryExtractSourceJson(trimmed);
  const fenced = (json ?? trimmed).match(/^```(?:typescript|ts|python)?\s*\n([\s\S]*?)\n```$/)?.[1];
  return normalizeImplementationCode(fenced ?? json ?? source);
}

function normalizeImplementationCode(source: CodeSheet): CodeSheet {
  return source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !/^\s*(?:(?:void|await)\s+)?main\(\);?\s*$/.test(line))
    .join("\n")
    .trim();
}

function tryExtractSourceJson(source: string): string | null {
  const candidate = source.match(/({[\s\S]*})/)?.[1] ?? source;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "source" in parsed &&
      typeof (parsed as { source?: unknown }).source === "string"
    ) {
      return (parsed as { source: string }).source;
    }
  } catch {
    return null;
  }

  return null;
}
