import { typeCheck } from "./typeCheck";
import type { TypeCheckDiagnostic } from "./typeCheck";

export type CodeSheet = string;
export type Runnable = string;
export type SnippetHash = string;
export type CodeCache = Map<SnippetHash, string> & {
  hydrate?: (hash: SnippetHash) => Promise<void>;
  persist?: (hash: SnippetHash, implementation: string) => Promise<void>;
  clearRemote?: () => Promise<void>;
};
export type CompleteResult = string | Promise<string> | AsyncIterable<string>;
export type CompleteOptions = {
  signal?: AbortSignal;
};
export type CompleteFunction = (prompt: string, options?: CompleteOptions) => CompleteResult;

export type RunnableInfo = {
  name: Runnable;
  line: number;
};

export type ParsedSheet = {
  source: CodeSheet;
  runnables: RunnableInfo[];
  incompleteSnippets: IncompleteSnippet[];
  declarations: Declaration[];
  sumTypes: SumTypeDecl[];
  typeAliases: TypeAliasDecl[];
  classDecls: ClassDecl[];
  topLevelComments: string[];
};

export type LoweredCodeSheet = {
  source: CodeSheet;
  parsed: ParsedSheet;
};

export type CompletedCodeSheet = {
  source: CodeSheet;
  lowered: LoweredCodeSheet;
  completions: Completion[];
  ir: CompilationIR;
};

export type Completion = {
  hash: SnippetHash;
  snippet: string;
  replacement: string;
  cached: boolean;
};

export type CompletionState =
  | { kind: "partial"; snippet: string; hash: SnippetHash }
  | { kind: "complete"; snippet: string; hash: SnippetHash; implementation: string };

export type CompilationEvent =
  | { kind: "parsed"; parsed: ParsedSheet }
  | { kind: "typecheck"; diagnostics: TypeCheckDiagnostic[] }
  | { kind: "readiness"; definitions: DefinitionReadiness[] }
  | { kind: "cache-hit"; hash: SnippetHash; snippet: string; implementation: string }
  | { kind: "llm-start"; hash: SnippetHash; snippet: string }
  | { kind: "llm-token"; hash: SnippetHash; token: string }
  | { kind: "llm-complete"; hash: SnippetHash; implementation: string }
  | { kind: "implementation"; source: CodeSheet; completedSnippets: number; totalSnippets: number }
  | { kind: "compiled"; completed: CompletedCodeSheet };

export type CompileOptions = {
  signal?: AbortSignal;
  streamTokens?: boolean;
  emitProgress?: boolean;
  abortCurrentCompletion?: boolean;
  strategy?: CompilationStrategy;
};

export type CompilationStrategy = "sequential" | "parallel" | "agentic";

export type DefinitionReadiness = {
  name: string;
  line: number;
  kind: "function" | "method";
  ready: boolean;
  reason?: "implementation" | "dependency";
  dependencies: string[];
  blockingDependencies: string[];
};

export type ImplementationTarget = {
  kind: "function" | "class";
  name: string;
  line: number;
  endLine: number;
  source: string;
};

export type SourceSelectionContext =
  | { kind: "snippet"; snippet: IncompleteSnippet }
  | { kind: "implementation"; target: ImplementationTarget }
  | { kind: "whole-file" };

export type CompilationIR = {
  parsed: ParsedSheet;
  lowered: LoweredCodeSheet;
  nodes: CompilationNode[];
};

export type CompilationNode =
  | { kind: "source"; source: string }
  | {
      kind: "incomplete";
      line: number;
      snippetKind: IncompleteSnippet["kind"];
      annotationContexts: LogosAnnotationContext[];
      indent: string;
      state: CompletionState;
    };

type ParallelCompletionItem = {
  node: Extract<CompilationNode, { kind: "incomplete" }>;
  hash: SnippetHash;
  snippet: string;
  prompt: string;
  source: CodeSheet;
};

type ParallelCompletionStreamEvent =
  | { kind: "token"; index: number; hash: SnippetHash; token: string }
  | { kind: "complete"; index: number; item: ParallelCompletionItem; replacement: string };

export type Declaration =
  | { kind: "sum-type"; name: string; line: number; source: string }
  | { kind: "class"; name: string; line: number; source: string }
  | { kind: "incomplete"; snippetKind: IncompleteSnippet["kind"]; line: number; source: string };

export type SumTypeDecl = {
  name: string;
  source: string;
  line: number;
  variants: SumTypeVariant[];
};

type SumTypeVariant = {
  name: string;
  fields: string[];
};

type TypeAliasDecl = {
  name: string;
  source: string;
  line: number;
  target: string;
};

type ParsedTypeDeclaration = {
  name: string;
  source: string;
  line: number;
  startLine: number;
  endLine: number;
  target: string;
};

type FunctionDecl = {
  name: string;
  line: number;
  source: string;
  className?: string;
};

type DataclassShorthand = {
  indent: string;
  keyword?: "class" | "record";
  name: string;
  fields: DataclassField[];
  hasBlock: boolean;
};

type DataclassField = {
  name: string;
  type: string;
  defaultValue?: string;
};

type FunctionHeader = {
  indent: string;
  asyncPrefix: string;
  keyword?: "def" | "fn" | "function";
  name: string;
  params: string;
  returnType?: string;
  hasColon: boolean;
};

export type IncompleteSnippet = {
  kind: "function" | "class" | "natural";
  line: number;
  column?: number;
  snippet: string;
  annotationContexts?: LogosAnnotationContext[];
  range?: SourceRange;
};

export type LogosAnnotationContext = {
  annotation: string;
  cacheKey: string;
  promptGuidance: string;
};

const pythonCompletionRuntimePolicy = `Use only Python's standard library and code already present in the sheet; do not import third-party packages.
For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.`;

const pythonPrintingPolicy = `When generating visible output, prefer self-explanatory printing over raw value dumps:
- Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
- For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
- For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
- For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
- Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
- Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.`;

export type ClassDecl = {
  name: string;
  line: number;
  snippet: string;
};

type SourceRange = {
  start: number;
  end: number;
};

export function parse(codeSheet: CodeSheet): ParsedSheet {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const typeDeclarations = collectTypeDeclarations(lines);
  const sumTypes = parseSumTypeDeclarations(typeDeclarations);
  const classDecls = discoverClassDecls(lines);
  const incomplete = discoverIncompleteSnippets(source);

  return {
    source,
    runnables: discoverRunnables(lines),
    incompleteSnippets: incomplete,
    declarations: declarations(sumTypes, classDecls, incomplete),
    sumTypes,
    typeAliases: parseTypeAliasDeclarations(typeDeclarations),
    classDecls,
    topLevelComments: lines.filter((line) => line.startsWith("#")),
  };
}

export function lower(parsed: ParsedSheet): LoweredCodeSheet {
  const lines = parsed.source.split("\n");
  const typeLineIndexes = typeDeclarationLineIndexes(lines);
  const body = lowerSurfaceSyntax(lines.filter((_, index) => !typeLineIndexes.has(index)).join("\n"));
  const loweredDataclassImport =
    parsed.sumTypes.length > 0 || body.needsDataclass ? "from dataclasses import dataclass" : "";
  const loweredSumTypes = lowerSumTypes(parsed.sumTypes);
  const loweredTypeAliases = lowerTypeAliases(parsed.typeAliases);

  return {
    parsed,
    source: [
      loweredDataclassImport,
      loweredSumTypes,
      loweredTypeAliases,
      body.source,
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n"),
  };
}

export function runnables(codeSheet: CodeSheet): RunnableInfo[] {
  return parse(codeSheet).runnables;
}

export function buildCompilationIR(parsed: ParsedSheet): CompilationIR {
  const lowered = lower(parsed);
  const incomplete = discoverIncompleteSnippets(lowered.source);
  const nodes: CompilationNode[] = [];
  let cursor = 0;

  for (const item of incomplete) {
    const range = item.range ?? rangeForLineSnippet(lowered.source, item.line, item.snippet);
    const start = range.start;
    if (start > cursor) {
      nodes.push({
        kind: "source",
        source: lowered.source.slice(cursor, start),
      });
    }

    nodes.push({
      kind: "incomplete",
      line: item.line,
      snippetKind: item.kind,
      annotationContexts: item.annotationContexts ?? [],
      indent: indentationAt(lowered.source, start),
      state: {
        kind: "partial",
        snippet: item.snippet,
        hash: hashCompletionInput(parsed, item.snippet, item.annotationContexts),
      },
    });

    cursor = range.end;
  }

  if (cursor < lowered.source.length) {
    nodes.push({ kind: "source", source: lowered.source.slice(cursor) });
  }

  if (nodes.length === 0) {
    nodes.push({ kind: "source", source: lowered.source });
  }

  return { parsed, lowered, nodes };
}

export function completionSnippetHashes(parsed: ParsedSheet): SnippetHash[] {
  return buildCompilationIR(parsed).nodes.flatMap((node) => {
    return node.kind === "incomplete" ? [node.state.hash] : [];
  });
}

export async function completeSheet(
  codeCache: CodeCache,
  codeSheet: CodeSheet,
  complete?: CompleteFunction,
  options: CompileOptions = {},
): Promise<CompletedCodeSheet> {
  let compiled: CompletedCodeSheet | null = null;
  for await (const event of compile(codeCache, codeSheet, complete, {
    ...options,
    emitProgress: false,
    streamTokens: false,
  })) {
    if (event.kind === "compiled") {
      compiled = event.completed;
    }
  }

  if (!compiled) {
    throw new Error("Compilation did not produce a compiled sheet");
  }

  return compiled;
}

export async function* compile(
  codeCache: CodeCache,
  codeSheet: CodeSheet,
  complete?: CompleteFunction,
  options: CompileOptions = {},
): AsyncIterable<CompilationEvent> {
  const parsed = parse(codeSheet);
  const ir = buildCompilationIR(parsed);
  const totalSnippets = ir.nodes.filter((node) => node.kind === "incomplete").length;
  let completedSnippets = 0;
  const completions: Completion[] = [];
  const emitProgress = options.emitProgress ?? true;
  const initialCacheHits: Array<{ hash: SnippetHash; snippet: string; implementation: string }> = [];

  if (isAborted(options.signal)) {
    return;
  }

  for (const node of ir.nodes) {
    if (node.kind !== "incomplete" || node.state.kind !== "partial") {
      continue;
    }

    const { hash, snippet } = node.state;
    const cachedReplacement = await cachedImplementation(codeCache, hash);
    if (cachedReplacement === undefined) {
      continue;
    }

    node.state = { kind: "complete", hash, snippet, implementation: cachedReplacement };
    completions.push({ hash, snippet, replacement: cachedReplacement, cached: true });
    completedSnippets += 1;
    initialCacheHits.push({ hash, snippet, implementation: cachedReplacement });
  }

  if (emitProgress) {
    yield { kind: "parsed", parsed };
    yield { kind: "typecheck", diagnostics: typeCheck(parsed) };
    for (const hit of initialCacheHits) {
      yield { kind: "cache-hit", hash: hit.hash, snippet: hit.snippet, implementation: hit.implementation };
    }
    yield {
      kind: "implementation",
      source: renderImplementation(ir),
      completedSnippets,
      totalSnippets,
    };
    yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
  }

  if (compileInParallel(options) && complete) {
    const missing: ParallelCompletionItem[] = [];

    for (const node of ir.nodes) {
      if (isAborted(options.signal)) {
        return;
      }

      if (node.kind !== "incomplete" || node.state.kind !== "partial") {
        continue;
      }

      const { hash, snippet } = node.state;
      const cachedReplacement = await cachedImplementation(codeCache, hash);
      if (cachedReplacement !== undefined) {
        node.state = { kind: "complete", hash, snippet, implementation: cachedReplacement };
        completions.push({ hash, snippet, replacement: cachedReplacement, cached: true });
        completedSnippets += 1;
        if (emitProgress) {
          yield { kind: "cache-hit", hash, snippet, implementation: cachedReplacement };
          yield {
            kind: "implementation",
            source: renderImplementation(ir),
            completedSnippets,
            totalSnippets,
          };
          yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
        }
        continue;
      }

      const synthesizedReplacement = synthesizeTopLevelClassFactory(parsed, snippet);
      if (synthesizedReplacement !== null) {
        await cacheImplementation(codeCache, hash, synthesizedReplacement);
        node.state = { kind: "complete", hash, snippet, implementation: synthesizedReplacement };
        completions.push({ hash, snippet, replacement: synthesizedReplacement, cached: false });
        completedSnippets += 1;
        if (emitProgress) {
          yield { kind: "llm-complete", hash, implementation: synthesizedReplacement };
          yield {
            kind: "implementation",
            source: renderImplementation(ir),
            completedSnippets,
            totalSnippets,
          };
          yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
        }
        continue;
      }

      const source = renderImplementation(ir);
      missing.push({
        node,
        hash,
        snippet,
        prompt: buildCompletionPrompt(
          source,
          snippet,
          node.snippetKind,
          node.annotationContexts,
        ),
        source,
      });
    }

    if (emitProgress) {
      for (const item of missing) {
        yield { kind: "llm-start", hash: item.hash, snippet: item.snippet };
      }
    }

    for await (const completionEvent of streamParallelCompletions(missing, complete, options)) {
      if (isAborted(options.signal)) {
        return;
      }

      if (completionEvent.kind === "token") {
        if (emitProgress && options.streamTokens !== false) {
          yield { kind: "llm-token", hash: completionEvent.hash, token: completionEvent.token };
        }
        continue;
      }

      const { item, replacement } = completionEvent;
      await cacheImplementation(codeCache, item.hash, replacement);
      item.node.state = {
        kind: "complete",
        hash: item.hash,
        snippet: item.snippet,
        implementation: replacement,
      };
      completions.push({
        hash: item.hash,
        snippet: item.snippet,
        replacement,
        cached: false,
      });
      completedSnippets += 1;

      if (emitProgress) {
        yield { kind: "llm-complete", hash: item.hash, implementation: replacement };
        yield {
          kind: "implementation",
          source: renderImplementation(ir),
          completedSnippets,
          totalSnippets,
        };
        yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
      }
    }

    yield {
      kind: "compiled",
      completed: {
        source: renderImplementation(ir),
        lowered: ir.lowered,
        completions,
        ir,
      },
    };
    return;
  }

  for (const node of ir.nodes) {
    if (isAborted(options.signal)) {
      return;
    }

    if (node.kind !== "incomplete" || node.state.kind !== "partial") {
      continue;
    }

    const { hash, snippet } = node.state;
    const cachedReplacement = await cachedImplementation(codeCache, hash);
    if (cachedReplacement !== undefined) {
      node.state = { kind: "complete", hash, snippet, implementation: cachedReplacement };
      completions.push({ hash, snippet, replacement: cachedReplacement, cached: true });
      completedSnippets += 1;
      if (emitProgress) {
        yield { kind: "cache-hit", hash, snippet, implementation: cachedReplacement };
        yield {
          kind: "implementation",
          source: renderImplementation(ir),
          completedSnippets,
          totalSnippets,
        };
        yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
      }
      continue;
    }

    if (!complete) {
      continue;
    }

    if (emitProgress) {
      yield { kind: "llm-start", hash, snippet };
    }
    const prompt = buildCompletionPrompt(
      renderImplementation(ir),
      snippet,
      node.snippetKind,
      node.annotationContexts,
    );
    let replacement = "";
    const result = complete(
      prompt,
      options.abortCurrentCompletion ? { signal: options.signal } : undefined,
    );

    if (isAsyncIterable(result)) {
      for await (const token of result) {
        replacement += token;
        if (emitProgress && !isAborted(options.signal) && options.streamTokens !== false) {
          yield { kind: "llm-token", hash, token };
        }
      }
    } else {
      replacement = await result;
    }

    replacement = normalizeSnippet(
      replacement,
      node.snippetKind,
      snippet,
      renderImplementation(ir),
    );
    await cacheImplementation(codeCache, hash, replacement);
    node.state = { kind: "complete", hash, snippet, implementation: replacement };
    completions.push({ hash, snippet, replacement, cached: false });
    completedSnippets += 1;
    if (isAborted(options.signal)) {
      return;
    }

    if (emitProgress) {
      yield { kind: "llm-complete", hash, implementation: replacement };
      yield {
        kind: "implementation",
        source: renderImplementation(ir),
        completedSnippets,
        totalSnippets,
      };
      yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
    }
  }

  yield {
    kind: "compiled",
    completed: {
      source: renderImplementation(ir),
      lowered: ir.lowered,
      completions,
      ir,
    },
  };
}

function compileInParallel(options: CompileOptions): boolean {
  return options.strategy === "parallel";
}

export function renderImplementation(ir: CompilationIR): CodeSheet {
  const imports: string[] = [];
  const seenImports = new Set<string>();
  const source = ir.nodes
    .map((node) => {
      if (node.kind === "source") {
        return stripLogosAnnotationLines(node.source);
      }

      if (node.state.kind !== "complete") {
        return node.state.snippet;
      }

      if (node.snippetKind !== "natural") {
        return node.state.implementation;
      }

      const replacement = splitNaturalReplacement(node.state.implementation);
      for (const importLine of replacement.imports) {
        if (!seenImports.has(importLine)) {
          seenImports.add(importLine);
          imports.push(importLine);
        }
      }

      return indentNaturalReplacement(replacement.body, node.indent);
    })
    .join("");

  if (imports.length === 0) {
    return source;
  }

  return `${imports.join("\n")}\n\n${source}`;
}

export function definitionReadiness(
  parsed: ParsedSheet,
  codeCache: CodeCache,
): DefinitionReadiness[] {
  const functionDecls = discoverFunctionDecls(parsed.source);
  const topLevelNames = new Set(functionDecls.filter((decl) => !decl.className).map((decl) => decl.name));
  const classNames = new Set(parsed.classDecls.map((decl) => decl.name));
  const incomplete = incompleteSymbols(parsed, codeCache);
  const topLevelSources = new Map(
    discoverTopLevelFunctionBlocks(parsed.source).map((decl) => [decl.name, decl.source]),
  );
  const classSources = new Map(parsed.classDecls.map((decl) => [decl.name, decl.snippet]));
  const dependencies = new Map<string, string[]>();

  for (const name of topLevelNames) {
    const source = topLevelSources.get(name) ?? "";
    dependencies.set(name, referencedKnownSymbols(source, topLevelNames, classNames, name));
  }

  return functionDecls.map((decl) => {
    const symbol = decl.className ?? decl.name;
    const source = decl.className
      ? classSources.get(decl.className) ?? ""
      : topLevelSources.get(decl.name) ?? "";
    const directImplementationMissing =
      (decl.className !== undefined
        ? incomplete.has(decl.className)
        : incomplete.has(decl.name)) ||
      hasUncachedNaturalSnippet(parsed, codeCache, source);
    const deps = decl.className ? [] : dependencies.get(decl.name) ?? [];
    const blockingDependencies = directImplementationMissing
      ? []
      : blockingSymbols(symbol, dependencies, incomplete);
    const reason = directImplementationMissing
      ? "implementation"
      : blockingDependencies.length > 0
        ? "dependency"
        : undefined;

    return {
      name: decl.className ? `${decl.className}.${decl.name}` : decl.name,
      line: decl.line,
      kind: decl.className ? "method" : "function",
      ready: !directImplementationMissing && blockingDependencies.length === 0,
      ...(reason === undefined ? {} : { reason }),
      dependencies: deps,
      blockingDependencies,
    };
  });
}

export function implementationTargetAtLine(
  codeSheet: CodeSheet,
  lineNumber: number,
): ImplementationTarget | null {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const targets: ImplementationTarget[] = [
    ...discoverClassDecls(lines).map((decl) => implementationTargetFromBlock(
      "class",
      decl.name,
      decl.line,
      decl.snippet,
    )),
    ...discoverTopLevelFunctionBlocks(source).map((decl) => implementationTargetFromBlock(
      "function",
      decl.name,
      decl.line,
      decl.source,
    )),
  ].sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return right.endLine - left.endLine;
  });

  return targets.find((target) => (
    lineNumber >= target.line && lineNumber <= target.endLine
  )) ?? null;
}

export function selectionContextAtPosition(
  codeSheet: CodeSheet,
  lineNumber: number,
  column: number,
): SourceSelectionContext {
  const source = normalizeNewlines(codeSheet);
  const exactSnippet = parse(source).incompleteSnippets.find((snippet) => (
    snippetContainsPosition(source, snippet, lineNumber, column)
  ));

  if (exactSnippet) {
    return { kind: "snippet", snippet: exactSnippet };
  }

  const target = implementationTargetAtLine(source, lineNumber);
  if (target) {
    return { kind: "implementation", target };
  }

  return { kind: "whole-file" };
}

export function implementationBlockForTarget(
  implementation: CodeSheet,
  target: ImplementationTarget,
): string | null {
  const source = normalizeNewlines(implementation);

  if (target.kind === "class") {
    return discoverClassDecls(source.split("\n"))
      .find((decl) => decl.name === target.name)
      ?.snippet ?? null;
  }

  return discoverTopLevelFunctionBlocks(source)
    .find((decl) => decl.name === target.name)
    ?.source ?? null;
}

export function hashSnippet(incompleteCodeSnippet: string): SnippetHash {
  return hashText("snippet", incompleteCodeSnippet);
}

export async function cachedImplementation(
  codeCache: CodeCache,
  hash: SnippetHash,
): Promise<string | undefined> {
  if (!codeCache.has(hash)) {
    await codeCache.hydrate?.(hash);
  }

  return codeCache.get(hash);
}

export async function cacheImplementation(
  codeCache: CodeCache,
  hash: SnippetHash,
  implementation: string,
): Promise<void> {
  codeCache.set(hash, implementation);
  await codeCache.persist?.(hash, implementation);
}

export function hashCompletionInput(
  parsed: ParsedSheet,
  incompleteCodeSnippet: string,
  annotationContexts: LogosAnnotationContext[] = [],
): SnippetHash {
  const naturalPolicy = naturalSnippetPolicy(incompleteCodeSnippet);
  return hashText(
    "completion",
    [
      "--- incomplete snippet ---",
      incompleteCodeSnippet.trim(),
      "",
      ...(naturalPolicy === null
        ? []
        : [
            "--- natural-language policy ---",
            naturalPolicy.cacheKey,
            "",
          ]),
      ...(annotationContexts.length === 0
        ? []
        : [
            "--- annotation contexts ---",
            ...annotationContexts.map((context) => context.cacheKey),
            "",
          ]),
      "--- dependencies ---",
      dependencyContext(parsed, incompleteCodeSnippet),
    ].join("\n"),
  );
}

function hashText(prefix: string, source: string): SnippetHash {
  const normalized = source.trim().replace(/\s+/g, " ");
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function declarations(
  sumTypes: SumTypeDecl[],
  classDecls: ClassDecl[],
  incomplete: IncompleteSnippet[],
): Declaration[] {
  return [
    ...sumTypes.map((decl) => ({
      kind: "sum-type" as const,
      name: decl.name,
      line: decl.line,
      source: decl.source,
    })),
    ...classDecls.map((decl) => ({
      kind: "class" as const,
      name: decl.name,
      line: decl.line,
      source: decl.snippet,
    })),
    ...incomplete.map((snippet) => ({
      kind: "incomplete" as const,
      snippetKind: snippet.kind,
      line: snippet.line,
      source: snippet.snippet,
    })),
  ].sort((left, right) => left.line - right.line);
}

function isAsyncIterable(value: CompleteResult): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

async function* streamParallelCompletions(
  items: ParallelCompletionItem[],
  complete: CompleteFunction,
  options: CompileOptions,
): AsyncIterable<ParallelCompletionStreamEvent> {
  const iterators = items.map((item, index) => {
    return streamParallelCompletion(item, index, complete, options)[Symbol.asyncIterator]();
  });
  const pending = new Map<number, Promise<{
    index: number;
    result: IteratorResult<ParallelCompletionStreamEvent>;
  }>>();
  const readNext = (index: number): Promise<{
    index: number;
    result: IteratorResult<ParallelCompletionStreamEvent>;
  }> => iterators[index].next().then((result) => ({ index, result }));

  for (let index = 0; index < iterators.length; index += 1) {
    pending.set(index, readNext(index));
  }

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    pending.delete(index);

    if (isAborted(options.signal)) {
      return;
    }

    if (result.done) {
      continue;
    }

    yield result.value;
    pending.set(index, readNext(index));
  }
}

async function* streamParallelCompletion(
  item: ParallelCompletionItem,
  index: number,
  complete: CompleteFunction,
  options: CompileOptions,
): AsyncIterable<ParallelCompletionStreamEvent> {
  const result = complete(
    item.prompt,
    options.abortCurrentCompletion ? { signal: options.signal } : undefined,
  );
  let replacement = "";
  if (isAsyncIterable(result)) {
    for await (const token of result) {
      replacement += token;
      if (isAborted(options.signal)) {
        return;
      }

      if (token.length > 0 && options.streamTokens !== false) {
        yield { kind: "token", index, hash: item.hash, token };
      }
    }
  } else {
    replacement = await result;
  }

  if (isAborted(options.signal)) {
    return;
  }

  yield {
    kind: "complete",
    index,
    item,
    replacement: normalizeSnippet(
      replacement,
      item.node.snippetKind,
      item.snippet,
      item.source,
    ),
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function synthesizeTopLevelClassFactory(parsed: ParsedSheet, snippet: string): string | null {
  const header = parseFunctionHeader(snippet.split("\n")[0]);
  if (
    header === null ||
    header.indent.length > 0 ||
    header.params.trim().length > 0 ||
    header.returnType === undefined
  ) {
    return null;
  }

  const returnType = header.returnType.trim();
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(returnType)) {
    return null;
  }

  const classDecl = parsed.classDecls.find((decl) => decl.name === returnType);
  if (!classDecl || classDeclaresConstructor(classDecl)) {
    return null;
  }

  const keyword = header.keyword ?? "def";
  return `${header.indent}${header.asyncPrefix}${keyword} ${header.name}(${header.params}) -> ${returnType}:\n  return ${returnType}()`;
}

function classDeclaresConstructor(classDecl: ClassDecl): boolean {
  return classDecl.snippet.split("\n").some((line) => {
    const header = parseFunctionHeader(line);
    return header !== null && header.indent.length > 0 && header.name === "__init__";
  });
}

function incompleteSymbols(parsed: ParsedSheet, codeCache: CodeCache): Set<string> {
  const result = new Set<string>();

  for (const snippet of parsed.incompleteSnippets) {
    if (codeCache.has(hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts))) {
      continue;
    }

    if (snippet.kind === "function") {
      const functionName = parseFunctionHeader(snippet.snippet.split("\n")[0])?.name;
      if (functionName) {
        result.add(functionName);
      }
      continue;
    }

    const className = snippet.snippet.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    if (className) {
      result.add(className);
    }
  }

  return result;
}

function hasUncachedNaturalSnippet(
  parsed: ParsedSheet,
  codeCache: CodeCache,
  source: string,
): boolean {
  return parsed.incompleteSnippets.some((snippet) => {
    return (
      snippet.kind === "natural" &&
      source.includes(snippet.snippet) &&
      !codeCache.has(hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts))
    );
  });
}

function blockingSymbols(
  name: string,
  dependencies: Map<string, string[]>,
  incomplete: Set<string>,
): string[] {
  const blocking = new Set<string>();
  const visited = new Set<string>();
  const queue = [...(dependencies.get(name) ?? [])];

  while (queue.length > 0) {
    const dependency = queue.shift();
    if (!dependency || visited.has(dependency)) {
      continue;
    }

    visited.add(dependency);
    if (incomplete.has(dependency)) {
      blocking.add(dependency);
      continue;
    }

    for (const transitive of dependencies.get(dependency) ?? []) {
      queue.push(transitive);
    }
  }

  return Array.from(blocking).sort();
}

function referencedKnownSymbols(
  source: string,
  topLevelNames: Set<string>,
  classNames: Set<string>,
  selfName: string,
): string[] {
  const ignored = new Set([
    "None",
    "True",
    "False",
    "int",
    "str",
    "list",
    "dict",
    "set",
    "tuple",
    "print",
    "range",
    "len",
    "self",
  ]);
  const matches = source.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  const result = new Set<string>();

  for (const identifier of matches) {
    if (identifier === selfName || ignored.has(identifier)) {
      continue;
    }

    if (topLevelNames.has(identifier) || classNames.has(identifier)) {
      result.add(identifier);
    }
  }

  return Array.from(result).sort();
}

function implementationTargetFromBlock(
  kind: ImplementationTarget["kind"],
  name: string,
  line: number,
  source: string,
): ImplementationTarget {
  return {
    kind,
    name,
    line,
    endLine: line + source.split("\n").length - 1,
    source,
  };
}

function dependencyContext(parsed: ParsedSheet, snippet: string): string {
  const typeDecls = new Map(parsed.sumTypes.map((decl) => [decl.name, decl]));
  const typeAliases = new Map(parsed.typeAliases.map((decl) => [decl.name, decl]));
  const classDecls = new Map(parsed.classDecls.map((decl) => [decl.name, decl]));
  const functionDecls = new Map(
    discoverTopLevelFunctionBlocks(parsed.source).map((decl) => [decl.name, decl]),
  );
  const needed = new Set<string>();
  const queue = referencedIdentifiers(snippet);

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || needed.has(name)) {
      continue;
    }

    const typeDecl = typeDecls.get(name);
    const typeAlias = typeAliases.get(name);
    const classDecl = classDecls.get(name);
    const functionDecl = functionDecls.get(name);
    if (!typeDecl && !typeAlias && !classDecl && !functionDecl) {
      continue;
    }

    needed.add(name);
    const dependencySource =
      typeDecl?.source ?? typeAlias?.source ?? classDecl?.snippet ?? functionDecl?.source ?? "";
    for (const referenced of referencedIdentifiers(dependencySource)) {
      if (!needed.has(referenced)) {
        queue.push(referenced);
      }
    }
  }

  const dependencies = [
    ...parsed.sumTypes
      .filter((decl) => needed.has(decl.name))
      .map((decl) => ({ line: decl.line, source: decl.source })),
    ...parsed.typeAliases
      .filter((decl) => needed.has(decl.name))
      .map((decl) => ({ line: decl.line, source: decl.source })),
    ...parsed.classDecls
      .filter((decl) => needed.has(decl.name) && decl.snippet !== snippet)
      .map((decl) => ({ line: decl.line, source: decl.snippet })),
    ...discoverTopLevelFunctionBlocks(parsed.source)
      .filter((decl) => needed.has(decl.name) && decl.source !== snippet)
      .map((decl) => ({ line: decl.line, source: decl.source })),
  ].sort((left, right) => left.line - right.line);

  return [...parsed.topLevelComments, ...dependencies.map((item) => item.source)]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function referencedIdentifiers(source: string): string[] {
  const ignored = new Set([
    "None",
    "True",
    "False",
    "int",
    "str",
    "list",
    "dict",
    "set",
    "tuple",
  ]);
  const explicit = source.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g);
  const matches = source.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  return Array.from(
    new Set(
      [
        ...Array.from(explicit, (match) => match[1]),
        ...matches.filter((identifier) => {
          return /^[A-Z]/.test(identifier) && !ignored.has(identifier);
        }),
      ].filter((identifier) => !ignored.has(identifier)),
    ),
  );
}

function discoverRunnables(lines: string[]): RunnableInfo[] {
  return lines.flatMap((line, index) => {
    const header = parseFunctionHeader(line);
    if (!header || header.indent.length > 0 || header.asyncPrefix.length > 0 || !header.hasColon) {
      return [];
    }

    const params = header.params.trim();
    if (params.length > 0) {
      return [];
    }

    return [{ name: header.name, line: index + 1 }];
  });
}

function discoverFunctionDecls(codeSheet: CodeSheet): FunctionDecl[] {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const declarations: FunctionDecl[] = discoverTopLevelFunctionBlocks(source);

  for (const classDecl of discoverClassDecls(lines)) {
    const classLines = classDecl.snippet.split("\n");
    for (let index = 1; index < classLines.length; index += 1) {
      const header = parseFunctionHeader(classLines[index]);
      if (!header || header.indent.length === 0) {
        continue;
      }

      declarations.push({
        name: header.name,
        className: classDecl.name,
        line: classDecl.line + index,
        source: classLines[index].trimEnd(),
      });
    }
  }

  return declarations.sort((left, right) => left.line - right.line);
}

function discoverTopLevelFunctionBlocks(codeSheet: CodeSheet): FunctionDecl[] {
  const lines = normalizeNewlines(codeSheet).split("\n");
  const declarations: FunctionDecl[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = parseFunctionHeader(lines[index]);
    if (!header || header.indent.length > 0) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim().length === 0) {
        end += 1;
        continue;
      }

      if (!/^\s+/.test(candidate)) {
        break;
      }

      end += 1;
    }

    declarations.push({
      name: header.name,
      line: index + 1,
      source: trimTrailingBlankLines(lines.slice(index, end)).join("\n"),
    });
  }

  return declarations;
}

function parseSumTypeDeclarations(typeDeclarations: ParsedTypeDeclaration[]): SumTypeDecl[] {
  return typeDeclarations.flatMap((declaration) => {
    if (!isSumTypeRhs(declaration.target)) {
      return [];
    }

    return [
      {
        name: declaration.name,
        source: declaration.source,
        line: declaration.line,
        variants: splitTopLevel(declaration.target, "|").map(parseVariant),
      },
    ];
  });
}

function parseTypeAliasDeclarations(typeDeclarations: ParsedTypeDeclaration[]): TypeAliasDecl[] {
  return typeDeclarations.flatMap((declaration) => {
    if (isSumTypeRhs(declaration.target) || !isTypeAliasRhs(declaration.target)) {
      return [];
    }

    return [
      {
        name: declaration.name,
        source: declaration.source,
        line: declaration.line,
        target: declaration.target,
      },
    ];
  });
}

function collectTypeDeclarations(lines: string[]): ParsedTypeDeclaration[] {
  const declarations: ParsedTypeDeclaration[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const start = parseTypeDeclarationStartLine(lines[index]);
    if (!start) {
      continue;
    }

    const continuationLines: string[] = [];
    let end = index + 1;
    if (start.target.trim().length === 0) {
      while (end < lines.length) {
        const candidate = lines[end];
        if (candidate.trim().length > 0 && !/^\s+/.test(candidate)) {
          break;
        }

        continuationLines.push(candidate);
        end += 1;
      }
    }

    const target = normalizeTypeDeclarationTarget(start.target, continuationLines);
    if (target.length === 0) {
      continue;
    }

    const sourceLines = lines.slice(index, end);
    declarations.push({
      name: start.name,
      source: trimTrailingBlankLines(sourceLines).join("\n"),
      line: index + 1,
      startLine: index + 1,
      endLine: end,
      target,
    });
    index = Math.max(index, end - 1);
  }

  return declarations;
}

function parseTypeDeclarationStartLine(line: string): { name: string; target: string } | null {
  const heralded = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (heralded) {
    return { name: heralded[1], target: heralded[2] };
  }

  const bare = line.match(/^([A-Z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (bare) {
    return { name: bare[1], target: bare[2] };
  }

  return null;
}

function normalizeTypeDeclarationTarget(firstTarget: string, continuationLines: string[]): string {
  return [firstTarget, ...continuationLines]
    .map((line) => {
      const trimmed = stripTypeComment(line).trim();
      return trimmed.startsWith("|") ? trimmed.slice(1).trim() : trimmed;
    })
    .filter((line) => line.length > 0)
    .join(" | ");
}

function stripTypeComment(source: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if ((char === "'" || char === '"') && previous !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }

    if (char === "#" && quote === null) {
      return source.slice(0, index);
    }
  }

  return source;
}

function discoverClassDecls(lines: string[]): ClassDecl[] {
  const classDecls: ClassDecl[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const className = discoverableClassName(lines[index]);
    if (!className) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim().length === 0) {
        end += 1;
        continue;
      }

      if (!/^\s+/.test(candidate)) {
        break;
      }

      end += 1;
    }

    classDecls.push({
      name: className,
      line: index + 1,
      snippet: trimTrailingBlankLines(lines.slice(index, end)).join("\n"),
    });
  }

  return classDecls;
}

function parseVariant(source: string): SumTypeVariant {
  const trimmed = source.trim();
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/);
  if (!match) {
    throw new Error(`Invalid sum type variant: ${source}`);
  }

  return {
    name: match[1],
    fields: match[2] ? splitTopLevel(match[2], ",").map((field) => field.trim()) : [],
  };
}

function isSumTypeRhs(source: string): boolean {
  const parts = splitTopLevel(source, "|");
  return parts.length > 1 && parts.every((part) => {
    return /^([A-Za-z_][A-Za-z0-9_]*)(?:\(.*\))?$/.test(part.trim());
  });
}

function isTypeAliasRhs(source: string): boolean {
  const trimmed = source.trim();
  if (/^\(.+\)$/.test(trimmed)) {
    return true;
  }

  return splitTopLevel(trimmed, "|").every((part) => {
    return /^[A-Za-z_][A-Za-z0-9_]*(?:\[.+\])?$/.test(part.trim());
  });
}

function lowerSumTypes(sumTypes: SumTypeDecl[]): string {
  if (sumTypes.length === 0) {
    return "";
  }

  const seenConstructors = new Set<string>();
  const output: string[] = [];

  for (const sumType of sumTypes) {
    for (const variant of sumType.variants) {
      if (seenConstructors.has(variant.name)) {
        continue;
      }

      seenConstructors.add(variant.name);
      if (output.length > 0) {
        output.push("");
      }
      output.push("@dataclass(frozen=True)", `class ${variant.name}:`);

      if (variant.fields.length === 0) {
        output.push("  pass");
      } else {
        fieldNames(variant).forEach((fieldName, index) => {
          output.push(`  ${fieldName}: ${toPythonType(variant.fields[index])}`);
        });
      }
    }
  }

  for (const sumType of sumTypes) {
    output.push("", `${sumType.name} = ${sumType.variants.map((v) => v.name).join(" | ")}`);
  }

  return output.join("\n");
}

function lowerTypeAliases(typeAliases: TypeAliasDecl[]): string {
  return typeAliases
    .map((alias) => `${alias.name} = ${toPythonAlias(alias.target)}`)
    .join("\n");
}

function fieldNames(variant: SumTypeVariant): string[] {
  if (variant.name === "Cell" && variant.fields.length === 2) {
    return ["col", "row"];
  }

  if (variant.fields.length === 1) {
    return ["value"];
  }

  if (variant.fields.length === 3) {
    return ["op", "left", "right"];
  }

  return variant.fields.map((_, index) => `field${index}`);
}

function toPythonAlias(source: string): string {
  const trimmed = source.trim();
  const tupleMatch = trimmed.match(/^\((.*)\)$/);
  if (tupleMatch) {
    const fields = splitTopLevel(tupleMatch[1], ",");
    return `tuple[${fields.map(toPythonType).join(", ")}]`;
  }

  return toPythonType(trimmed);
}

function toPythonType(source: string): string {
  const trimmed = source.trim();
  if (
    trimmed === "str" ||
    trimmed === "int" ||
    trimmed === "bool" ||
    trimmed === "float" ||
    trimmed === "None"
  ) {
    return trimmed;
  }
  if (/^(list|dict|set|tuple)\[.+\]$/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

function discoverIncompleteSnippets(codeSheet: CodeSheet): IncompleteSnippet[] {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const lineStarts = lineStartOffsets(source);
  const naturalSnippets = discoverNaturalSnippets(source);
  const naturalRanges = naturalSnippets.flatMap((snippet) => snippet.range ?? []);
  const snippets: IncompleteSnippet[] = [];
  const coveredLines = new Set<number>();
  const coveredRanges: SourceRange[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (lineOverlapsRanges(lineStarts, lines, index, naturalRanges) || !isCompletableClassHeader(line)) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim().length === 0) {
        end += 1;
        continue;
      }

      if (!/^\s+/.test(candidate)) {
        break;
      }

      end += 1;
    }

    const classLines = lines.slice(index, end);
    const hasIncompleteMethod = classLines.some((classLine) => {
      const header = parseFunctionHeader(classLine);
      return header !== null && header.indent.length > 0 && !header.hasColon;
    });

    if (hasIncompleteMethod) {
      const snippetLines = trimTrailingBlankLines(classLines);
      const snippet = snippetLines.join("\n");
      const range = {
        start: lineStarts[index],
        end: lineStarts[index] + snippet.length,
      };
      const annotationContexts = logosAnnotationContextsForDeclaration(lines, index);

      snippets.push(snippetWithRange({
        kind: "class",
        line: index + 1,
        snippet,
        ...(annotationContexts.length === 0 ? {} : { annotationContexts }),
      }, range));
      coveredRanges.push(range);

      for (let lineNumber = index + 1; lineNumber <= end; lineNumber += 1) {
        coveredLines.add(lineNumber);
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (
      coveredLines.has(index + 1) ||
      lineOverlapsRanges(lineStarts, lines, index, naturalRanges) ||
      !isIncompleteTopLevelFunction(lines[index])
    ) {
      continue;
    }

    const start = index;
    let end = index + 1;
    while (
      end < lines.length &&
      !coveredLines.has(end + 1) &&
      !lineOverlapsRanges(lineStarts, lines, end, naturalRanges) &&
      isIndentedComment(lines[end])
    ) {
      end += 1;
    }

    const snippet = lines.slice(start, end).map((line) => line.trimEnd()).join("\n");
    const range = {
      start: lineStarts[start],
      end: lineStarts[start] + snippet.length,
    };
    const annotationContexts = logosAnnotationContextsForDeclaration(lines, start);

    snippets.push(snippetWithRange({
      kind: "function",
      line: start + 1,
      snippet,
      ...(annotationContexts.length === 0 ? {} : { annotationContexts }),
    }, range));
    coveredRanges.push(range);
    index = end - 1;
  }

  for (const snippet of naturalSnippets) {
    if (!coveredRanges.some((range) => rangesOverlap(range, snippet.range))) {
      snippets.push(snippet);
    }
  }

  return snippets.sort((left, right) => {
    const leftStart = left.range?.start ?? lineStarts[left.line - 1] ?? 0;
    const rightStart = right.range?.start ?? lineStarts[right.line - 1] ?? 0;
    return leftStart - rightStart;
  });
}

function isIncompleteTopLevelFunction(line: string): boolean {
  const header = parseFunctionHeader(line);
  return header !== null && header.indent.length === 0 && !header.hasColon;
}

function isIndentedComment(line: string): boolean {
  return /^\s+#/.test(line);
}

function lowerSurfaceSyntax(source: string): {
  source: string;
  needsDataclass: boolean;
} {
  const output: string[] = [];
  let needsDataclass = false;
  let recordBlockIndent: number | null = null;
  let inFence = false;

  for (const line of source.split("\n")) {
    const fenceCount = fencedBacktickCount(line);
    if (inFence || fenceCount > 0) {
      output.push(line);
      if (fenceCount % 2 === 1) {
        inFence = !inFence;
      }
      continue;
    }

    if (recordBlockIndent !== null && line.trim().length > 0 && indentWidth(line) <= recordBlockIndent) {
      recordBlockIndent = null;
    }

    const dataclass = parseDataclassShorthand(line);
    if (dataclass) {
      const isImplicitTopLevelDefinition =
        dataclass.keyword === undefined && dataclass.indent.length === 0;
      const isKeywordDefinition = dataclass.keyword !== undefined;
      if (!isImplicitTopLevelDefinition && !isKeywordDefinition) {
        output.push(recordBlockIndent === null ? line : lowerDataclassFieldLine(line));
        continue;
      }

      needsDataclass = true;
      recordBlockIndent = dataclass.hasBlock ? indentWidth(line) : null;
      output.push(
        `${dataclass.indent}@dataclass(frozen=True)`,
        `${dataclass.indent}class ${dataclass.name}:`,
        ...dataclass.fields.map((field) => {
          return `${dataclass.indent}  ${formatDataclassField(field)}`;
        }),
      );
      continue;
    }

    const loweredFunction = lowerFunctionKeyword(line);
    output.push(
      recordBlockIndent === null
        ? loweredFunction
        : lowerDataclassFieldLine(loweredFunction),
    );
  }

  return { source: output.join("\n"), needsDataclass };
}

function parseDataclassShorthand(line: string): DataclassShorthand | null {
  const match = line.match(
    /^(\s*)(?:(class|record)\s+)?([A-Z][A-Za-z0-9_]*)(?:\((.*)\))?\s*(:?)\s*$/,
  );
  if (!match) {
    return null;
  }

  const keyword = match[2] as "class" | "record" | undefined;
  const args = match[4];
  const hasBlock = match[5] === ":";
  if (keyword === "class" && args === undefined) {
    return null;
  }

  if (keyword === undefined && args === undefined && !hasBlock) {
    return null;
  }

  const fields = args === undefined ? [] : parseDataclassFields(args);
  if (!fields) {
    return null;
  }

  return {
    indent: match[1],
    ...(keyword === undefined ? {} : { keyword }),
    name: match[3],
    fields,
    hasBlock,
  };
}

function parseDataclassFields(source: string): DataclassField[] | null {
  const fields = splitTopLevel(source, ",").map(parseDataclassField);
  if (fields.length === 0 || fields.some((field) => field === null)) {
    return null;
  }

  return fields.filter((field): field is DataclassField => field !== null);
}

function parseDataclassField(source: string): DataclassField | null {
  const match = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
  if (!match) {
    return null;
  }

  const type = match[2].trim();
  if (type.length === 0) {
    return null;
  }

  return {
    name: match[1],
    type,
    ...(match[3] === undefined ? {} : { defaultValue: normalizeDefinitionLiteral(match[3].trim()) }),
  };
}

function lowerFunctionKeyword(line: string): string {
  const header = parseFunctionHeader(line);
  if (!header) {
    return line;
  }

  const normalizedParams = normalizeDefinitionLiterals(header.params);
  const returnType = header.returnType === undefined ? "" : ` -> ${header.returnType}`;
  const colon = header.hasColon ? ":" : "";
  return `${header.indent}${header.asyncPrefix}def ${header.name}(${normalizedParams})${returnType}${colon}`;
}

function discoverableClassName(line: string): string | null {
  const normalClass = line.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s*:\s*$/);
  if (normalClass) {
    return normalClass[1];
  }

  const dataclass = parseDataclassShorthand(line);
  if (dataclass?.indent === "") {
    return dataclass.name;
  }

  return null;
}

function isCompletableClassHeader(line: string): boolean {
  if (/^class\s+[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?\s*:\s*$/.test(line)) {
    return true;
  }

  const dataclass = parseDataclassShorthand(line);
  return dataclass?.indent === "";
}

function parseFunctionHeader(line: string): FunctionHeader | null {
  const match = line.match(
    /^(\s*)(async\s+)?(?:(def|fn|function)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:=]+))?\s*(:?)\s*$/,
  );
  if (!match) {
    return null;
  }

  const keyword = match[3] as FunctionHeader["keyword"] | undefined;
  const name = match[4];
  const returnType = match[6]?.trim();
  const hasColon = match[7] === ":";
  const isBare = keyword === undefined;
  if (isBare && !hasColon && returnType === undefined) {
    return null;
  }

  if (isBare && !/^[a-z_]/.test(name)) {
    return null;
  }

  return {
    indent: match[1],
    asyncPrefix: match[2] ?? "",
    ...(keyword === undefined ? {} : { keyword }),
    name,
    params: match[5],
    ...(returnType === undefined ? {} : { returnType }),
    hasColon,
  };
}

function formatDataclassField(field: DataclassField): string {
  const defaultValue = field.defaultValue === undefined ? "" : ` = ${field.defaultValue}`;
  return `${field.name}: ${toPythonType(field.type)}${defaultValue}`;
}

function lowerDataclassFieldLine(line: string): string {
  const match = line.match(/^(\s+)([A-Za-z_][A-Za-z0-9_]*\s*:\s*.+)$/);
  if (!match) {
    return line;
  }

  const field = parseDataclassField(match[2]);
  return field ? `${match[1]}${formatDataclassField(field)}` : line;
}

function normalizeDefinitionLiterals(source: string): string {
  return source.replace(/\b(true|false|null)\b/g, normalizeDefinitionLiteral);
}

function normalizeDefinitionLiteral(source: string): string {
  if (source === "true") {
    return "True";
  }
  if (source === "false") {
    return "False";
  }
  if (source === "null") {
    return "None";
  }
  return source;
}

function indentWidth(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function discoverNaturalSnippets(source: string): IncompleteSnippet[] {
  const snippets: IncompleteSnippet[] = [];
  const lineStarts = lineStartOffsets(source);
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf("`", index);
    if (start < 0) {
      break;
    }

    if (isInPythonLineComment(source, start)) {
      const lineEnd = source.indexOf("\n", start);
      index = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }

    if (source.startsWith("```", start)) {
      const end = source.indexOf("```", start + 3);
      if (end < 0) {
        break;
      }

      const inner = source.slice(start + 3, end).trim();
      if (inner.length > 0) {
        const line = lineForOffset(lineStarts, start);
        const lineStart = lineStarts[line - 1] ?? 0;
        const annotationContexts = logosAnnotationContextsForNaturalSnippet(source, line);
        snippets.push(snippetWithRange({
          kind: "natural",
          line,
          column: start - lineStart + 1,
          snippet: source.slice(start, end + 3),
          ...(annotationContexts.length === 0 ? {} : { annotationContexts }),
        }, { start, end: end + 3 }));
      }

      index = end + 3;
      continue;
    }

    const end = source.indexOf("`", start + 1);
    if (end < 0) {
      break;
    }

    const inner = source.slice(start + 1, end).trim();
    if (inner.length > 0) {
      const line = lineForOffset(lineStarts, start);
      const lineStart = lineStarts[line - 1] ?? 0;
      const annotationContexts = logosAnnotationContextsForNaturalSnippet(source, line);
      snippets.push(snippetWithRange({
        kind: "natural",
        line,
        column: start - lineStart + 1,
        snippet: source.slice(start, end + 1),
        ...(annotationContexts.length === 0 ? {} : { annotationContexts }),
      }, { start, end: end + 1 }));
    }

    index = end + 1;
  }

  return snippets;
}

function logosAnnotationContextsForNaturalSnippet(
  source: string,
  lineNumber: number,
): LogosAnnotationContext[] {
  const lines = source.split("\n");
  const targetLine = lines[lineNumber - 1] ?? "";
  const targetIndent = indentWidth(targetLine);

  for (let index = lineNumber - 2; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }

    const header = parseFunctionHeader(line);
    if (header && header.hasColon && indentWidth(line) < targetIndent) {
      return logosAnnotationContextsForDeclaration(lines, index);
    }
  }

  return [];
}

function logosAnnotationContextsForDeclaration(
  lines: string[],
  declarationIndex: number,
): LogosAnnotationContext[] {
  const declarationIndent = indentWidth(lines[declarationIndex] ?? "");
  const contexts: LogosAnnotationContext[] = [];

  for (let index = declarationIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      break;
    }

    const context = logosAnnotationContextForLine(line, declarationIndent);
    if (!context) {
      break;
    }

    contexts.unshift(context);
  }

  return contexts;
}

function logosAnnotationContextForLine(
  line: string,
  expectedIndent: number,
): LogosAnnotationContext | null {
  if (indentWidth(line) !== expectedIndent) {
    return null;
  }

  const trimmed = line.trim();
  const match = trimmed.match(/^@logos((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(?:\([^)]*\))?\s*$/);
  if (!match) {
    return null;
  }

  const annotation = `logos${match[1]}`;
  if (annotation !== "logos.debug.print") {
    return null;
  }

  return {
    annotation: `${annotation}()`,
    cacheKey: "logos.debug.print-v1",
    promptGuidance:
      "when generating code, make sure to add thoughtful and reasonable print statements to help the user understand how the code evaluated. consider the user's snippet and make sure that you are outputting important values at key moments",
  };
}

function isInPythonLineComment(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  let quote: "'" | "\"" | null = null;

  for (let index = lineStart; index < offset; index += 1) {
    const char = source[index];

    if (quote !== null) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "#") {
      return true;
    }

    if (char === "'" || char === "\"") {
      quote = char;
    }
  }

  return false;
}

function fencedBacktickCount(line: string): number {
  return line.match(/```/g)?.length ?? 0;
}

function lineOverlapsRanges(
  lineStarts: number[],
  lines: string[],
  index: number,
  ranges: SourceRange[],
): boolean {
  const start = lineStarts[index] ?? 0;
  const end = start + lines[index].length;
  const lineRange = { start, end: end === start ? end + 1 : end };
  return ranges.some((range) => rangesOverlap(lineRange, range));
}

function snippetContainsPosition(
  source: string,
  snippet: IncompleteSnippet,
  lineNumber: number,
  column: number,
): boolean {
  const range = snippet.range ?? rangeForLineSnippet(source, snippet.line, snippet.snippet);
  const lineStarts = lineStartOffsets(source);
  const offset = (lineStarts[lineNumber - 1] ?? source.length) + Math.max(0, column - 1);

  return offset >= range.start && offset <= range.end;
}

function snippetWithRange(snippet: IncompleteSnippet, range: SourceRange): IncompleteSnippet {
  return Object.defineProperty(snippet, "range", {
    value: range,
    enumerable: false,
  });
}

function rangeForLineSnippet(source: string, line: number, snippet: string): SourceRange {
  const lineStarts = lineStartOffsets(source);
  const start = lineStarts[line - 1] ?? 0;
  return { start, end: start + snippet.length };
}

function lineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineForOffset(lineStarts: number[], offset: number): number {
  let line = 1;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > offset) {
      break;
    }
    line = index + 1;
  }
  return line;
}

function indentationAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return prefix.match(/^\s*/)?.[0] ?? "";
}

function rangesOverlap(left: SourceRange, right: SourceRange | undefined): boolean {
  return right !== undefined && left.start < right.end && right.start < left.end;
}

function indentNaturalReplacement(source: string, indent: string): string {
  const lines = normalizeNaturalReplacementBlockIndent(source.split("\n"));
  return lines
    .map((line, index) => {
      if (index === 0 || line.trim().length === 0) {
        return line;
      }

      return `${indent}${line}`;
    })
    .join("\n");
}

function normalizeNaturalReplacementBlockIndent(lines: string[]): string[] {
  const firstSignificant = lines.find((line) => line.trim().length > 0);
  if (!firstSignificant || indentWidth(firstSignificant) > 0 || lineOpensIndentedContinuation(firstSignificant)) {
    return lines;
  }

  const laterSignificant = lines.slice(1).filter((line) => line.trim().length > 0);
  const laterIndents = laterSignificant.map(indentWidth).filter((width) => width > 0);
  if (laterIndents.length === 0 || laterIndents.length !== laterSignificant.length) {
    return lines;
  }

  const correction = Math.min(...laterIndents);
  if (correction <= 0) {
    return lines;
  }

  return lines.map((line, index) => {
    if (index === 0 || line.trim().length === 0) {
      return line;
    }

    return line.slice(Math.min(correction, indentWidth(line)));
  });
}

function lineOpensIndentedContinuation(line: string): boolean {
  const trimmed = line.trimEnd();
  return /[:\\([{]$/.test(trimmed);
}

function splitNaturalReplacement(source: string): { imports: string[]; body: string } {
  const imports: string[] = [];
  const body: string[] = [];

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (/^(?:import\s+|from\s+\S+\s+import\s+)/.test(trimmed)) {
      imports.push(trimmed);
      continue;
    }

    body.push(line);
  }

  return {
    imports,
    body: trimOuterBlankLines(body).join("\n"),
  };
}

function stripLogosAnnotationLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => !isLogosAnnotationLine(line))
    .join("\n");
}

function isLogosAnnotationLine(line: string): boolean {
  return /^\s*@logos(?:\.|\s*\(|\s*$)/.test(line);
}

export function buildCompletionPrompt(
  sheet: CodeSheet,
  snippet: string,
  kind: IncompleteSnippet["kind"],
  annotationContexts: LogosAnnotationContext[] = [],
): string {
  const annotationGuidance = annotationPromptGuidance(annotationContexts);
  const annotationBlock = annotationGuidance.length === 0 ? "" : `\n${annotationGuidance}`;
  if (kind === "natural") {
    const naturalPolicy = naturalSnippetPolicy(snippet)?.promptGuidance ?? "";
    return `You are an expert software engineer building programs.

You are tasked with assisting on the following Python code sheet:

${sheet}

Your job is to replace this natural-language Python fragment with valid Python code:

${snippet}

Return only the replacement code for the fragment, without backticks or fences.
${naturalPolicy}${annotationBlock}
If imports are needed, include normal Python import/from lines before the replacement; those imports will be added to the file top.
${pythonCompletionRuntimePolicy}
${pythonPrintingPolicy}
Do not assign local variables, loop variables, classes, or functions with the same names as top-level helpers, classes, or constructors already present in the sheet.
Use normal Python and preserve the intended public behavior shown in the runnable/test functions.`;
  }

  return `You are an expert software engineer building programs.

You are tasked with assisting on the following Python code sheet:

${sheet}

Your job is to finish the implementation of:

${snippet}

Return only implementations for declarations that appear in the requested snippet, plus any standard-library imports required by those declarations.
Use only Python built-ins and standard-library modules; do not import third-party packages.
Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.
For a requested class, return only that class definition and its members. For a requested function, return only that function definition. Helper code must be nested inside the requested declaration rather than added as a sibling definition.
Do not define a nested class or function with the same name as a top-level declaration from the sheet; use the declared top-level dependency instead.
Do not assign local variables or loop variables with the same names as top-level helpers, classes, or constructors already present in the sheet.
Do not call a class constructor with arguments unless the sheet declares that __init__ signature or shows that call shape in runnable/test code. If a class has no declared __init__, support no-argument construction.
When completing a class with no declared __init__, make no-argument construction produce a valid default object for the runnable/test code; any extra __init__ parameters must be optional.
When completing a function whose return type is a declared top-level class with no declared constructor arguments, return an instance of that top-level class using no-argument construction instead of defining a nested class, subclass, or duplicate implementation.
${pythonCompletionRuntimePolicy}
${pythonPrintingPolicy}
Use normal Python. Prefer dataclasses and match statements for sum types.
${annotationGuidance.length === 0 ? "" : `${annotationGuidance}\n`}Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.`;
}

function annotationPromptGuidance(contexts: LogosAnnotationContext[]): string {
  if (contexts.length === 0) {
    return "";
  }

  return [
    "Apply these Logos annotation contexts while generating the replacement:",
    ...contexts.map((context) => `- ${context.annotation}: ${context.promptGuidance}`),
  ].join("\n");
}

function naturalSnippetPolicy(snippet: string): { cacheKey: string; promptGuidance: string } | null {
  const trimmed = snippet.trim();
  if (!trimmed.startsWith("`")) {
    return null;
  }

  if (trimmed.startsWith("```")) {
    return {
      cacheKey: "natural-fenced-statement-v4",
      promptGuidance:
        "This is a triple-backtick natural-language block. Treat it as an imperative Python statement block and return one or more Python statements. If the user asks to print or show results, make the printed output useful to someone who cannot see the generated code: label sections and values, add blank lines around section breaks, and format grids/tables/puzzles as readable terminal layouts rather than raw lists or reprs.",
    };
  }

  return {
    cacheKey: "natural-single-expression-default-v3",
    promptGuidance:
      "This is a single-backtick natural-language fragment. Return a Python expression by default, especially for calculation/value requests such as calculate, sum, count, or find. Return statements only when the fragment explicitly asks for an imperative side effect such as printing, assignment, mutation, raising, sleeping, looping, rendering, displaying, or showing output. For render/display/show requests that produce a string, make the result visible with print(...). Do not wrap expression results in print unless the fragment explicitly asks for visible output.",
  };
}

export function normalizeSnippet(
  source: string,
  kind: IncompleteSnippet["kind"],
  requestedSnippet = "",
  contextSheet = "",
): string {
  const trimmed = source.trim();
  const fence = trimmed.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  const unfenced = fence?.[1] ?? trimmed;
  const lines = dedentLines(unfenced.replaceAll("\r\n", "\n").split("\n"));
  const duplicateDefinitions = existingDefinitionsToDrop(contextSheet, requestedSnippet);
  const requestedDefinitions = requestedDefinitionNames(requestedSnippet);

  if (kind === "natural") {
    return extractNaturalPythonLines(lines).join("\n").trim();
  }

  if (kind === "class") {
    const requestedName = requestedSnippet.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    const classIndex = lines.findIndex((line) => {
      const match = line.trimStart().match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      return match !== null && (requestedName === undefined || match[1] === requestedName);
    });
    if (classIndex < 0) {
      return unfenced.trimEnd();
    }

    return pruneTopLevelDefinitions(
      extractTopLevelDefinitions(lines, firstTopLevelCodeIndex(lines, classIndex)),
      duplicateDefinitions,
      requestedDefinitions,
      contextSheet,
    );
  }

  const requestedName = parseFunctionHeader(requestedSnippet.split("\n")[0])?.name;
  const definitionIndex = lines.findIndex((line) => {
    const header = parseFunctionHeader(line.trimStart());
    return header !== null && (requestedName === undefined || header.name === requestedName);
  });
  if (definitionIndex < 0) {
    const fallbackIndex = lines.findIndex((line) => {
      return /^(class\s+|def\s+|async\s+def\s+|@|import\s+|from\s+)/.test(line.trimStart());
    });
    return fallbackIndex < 0
      ? unfenced.trimEnd()
      : pruneTopLevelDefinitions(
          extractTopLevelDefinitions(lines, fallbackIndex),
          duplicateDefinitions,
          requestedDefinitions,
          contextSheet,
        );
  }

  return pruneTopLevelDefinitions(
    extractTopLevelDefinitions(lines, firstTopLevelCodeIndex(lines, definitionIndex)),
    duplicateDefinitions,
    requestedDefinitions,
    contextSheet,
  );
}

function extractNaturalPythonLines(lines: string[]): string[] {
  const trimmedOuter = trimOuterBlankLines(lines);
  const firstSignificant = trimmedOuter.findIndex((line) => line.trim().length > 0);
  if (firstSignificant < 0 || isLikelyPythonNaturalLine(trimmedOuter[firstSignificant].trim())) {
    return trimmedOuter;
  }

  const firstPythonLine = trimmedOuter.findIndex((line, index) => {
    return index > firstSignificant && isLikelyPythonNaturalLine(line.trim());
  });

  return firstPythonLine < 0 ? trimmedOuter : trimmedOuter.slice(firstPythonLine);
}

function isLikelyPythonNaturalLine(line: string): boolean {
  return (
    /^(?:import|from|def|class|for|if|elif|else\b|while|try\b|except|finally\b|with|return|raise|print|pass|break|continue|assert|yield)\b/.test(line) ||
    /^[A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]+\])?\s*(?:=|\+=|-=|\*=|\/=|\/\/=)/.test(line) ||
    /^[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(line) ||
    /^[\[{('"0-9-]/.test(line)
  );
}

function dedentLines(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const commonIndent = indents.length === 0 ? 0 : Math.min(...indents);
  if (commonIndent === 0) {
    return lines;
  }

  return lines.map((line) => line.slice(commonIndent));
}

function extractTopLevelDefinitions(lines: string[], start: number): string {
  const snippet: string[] = [];

  for (const line of lines.slice(start)) {
    const trimmed = line.trimStart();
    if (line.trim().length === 0) {
      snippet.push(line);
      continue;
    }

    if (/^\s+/.test(line) || isTopLevelDefinitionLine(trimmed)) {
      snippet.push(line.trimEnd());
      continue;
    }

    break;
  }

  return trimTrailingBlankLines(snippet).join("\n").trimEnd();
}

function firstTopLevelCodeIndex(lines: string[], fallback: number): number {
  const firstCodeIndex = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return (
      /^(import\s+|from\s+|@|def\s+|async\s+def\s+|class\s+)/.test(trimmed) ||
      /^[A-Za-z_][A-Za-z0-9_]*(?:\s*:\s*[^=]+)?\s*=/.test(trimmed)
    );
  });

  return firstCodeIndex < 0 ? fallback : firstCodeIndex;
}

function existingDefinitionsToDrop(contextSheet: string, requestedSnippet: string): Set<string> {
  if (contextSheet.trim().length === 0) {
    return new Set();
  }

  const requested = requestedDefinitionNames(requestedSnippet);
  const existing = new Set([
    ...discoverClassDecls(contextSheet.split("\n")).map((decl) => decl.name),
    ...discoverTopLevelFunctionBlocks(contextSheet).map((decl) => decl.name),
  ]);

  for (const name of requested) {
    existing.delete(name);
  }

  return existing;
}

function requestedDefinitionNames(source: string): Set<string> {
  const names = new Set<string>();

  for (const line of source.split("\n")) {
    const className = line.trimStart().match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    if (className) {
      names.add(className);
      continue;
    }

    const functionName = parseFunctionHeader(line.trimStart())?.name;
    if (functionName) {
      names.add(functionName);
    }
  }

  return names;
}

function pruneTopLevelDefinitions(
  source: string,
  namesToDrop: Set<string>,
  requestedDefinitions: Set<string>,
  contextSheet: string,
): string {
  const lines = source.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const definitionName = topLevelDefinitionName(line);
    if (!definitionName) {
      output.push(line);
      index += 1;
      continue;
    }

    const blockEnd = topLevelDefinitionBlockEnd(lines, index);
    const referenceSource = [
      output.join("\n"),
      lines.slice(blockEnd).join("\n"),
      contextSheet,
    ].join("\n");
    const shouldDrop =
      namesToDrop.has(definitionName) ||
      (
        !requestedDefinitions.has(definitionName) &&
        !definitionName.startsWith("_") &&
        !referencesName(referenceSource, definitionName)
      );

    if (!shouldDrop) {
      output.push(...lines.slice(index, blockEnd));
      index = blockEnd;
      continue;
    }

    while (output.length > 0 && /^@/.test(output[output.length - 1].trimStart())) {
      output.pop();
    }
    index = blockEnd;
  }

  return trimOuterBlankLines(output).join("\n").trimEnd();
}

function topLevelDefinitionBlockEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim().length === 0 || /^\s+/.test(line)) {
      end += 1;
      continue;
    }
    break;
  }
  return end;
}

function topLevelDefinitionName(line: string): string | null {
  if (/^\s/.test(line)) {
    return null;
  }

  return line.match(/^(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? null;
}

function referencesName(source: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(source);
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTopLevelDefinitionLine(trimmed: string): boolean {
  return (
    /^(@|def\s+|async\s+def\s+|class\s+|import\s+|from\s+)/.test(trimmed) ||
    trimmed.startsWith("#") ||
    /^[A-Za-z_][A-Za-z0-9_]*(?:\s*:\s*[^=]+)?\s*=/.test(trimmed) ||
    /^[\]}),]+$/.test(trimmed)
  );
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of source) {
    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    }

    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function typeDeclarationLineIndexes(lines: string[]): Set<number> {
  const indexes = new Set<number>();
  for (const declaration of collectTypeDeclarations(lines)) {
    if (!isSumTypeRhs(declaration.target) && !isTypeAliasRhs(declaration.target)) {
      continue;
    }

    for (let line = declaration.startLine - 1; line < declaration.endLine; line += 1) {
      indexes.add(line);
    }
  }

  return indexes;
}

function normalizeNewlines(source: string): string {
  return source.replaceAll("\r\n", "\n");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && copy.at(-1)?.trim().length === 0) {
    copy.pop();
  }
  return copy;
}

function trimOuterBlankLines(lines: string[]): string[] {
  const copy = trimTrailingBlankLines(lines);
  while (copy.length > 0 && copy[0].trim().length === 0) {
    copy.shift();
  }
  return copy;
}
