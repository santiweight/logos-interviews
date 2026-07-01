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
  kind: "function" | "method" | "class";
  ready: boolean;
  reason?: "implementation" | "dependency";
  dependencies: string[];
  blockingDependencies: string[];
};

export type CodeSheetDependencyGraph = {
  nodes: CodeSheetDependencyNode[];
};

export type CodeSheetDependencyNode = {
  name: string;
  line: number;
  kind: "function" | "class" | "type";
  source: string;
  dependencies: string[];
  transitiveDependencies: string[];
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

type IncompleteCompilationNode = Extract<CompilationNode, { kind: "incomplete" }>;

type ParallelCompletionEvent =
  | { kind: "token"; hash: SnippetHash; token: string }
  | {
      kind: "complete";
      node: IncompleteCompilationNode;
      hash: SnippetHash;
      snippet: string;
      replacement: string;
    }
  | { kind: "error"; error: unknown };

export type Declaration =
  | { kind: "sum-type"; name: string; line: number; source: string }
  | { kind: "class"; name: string; line: number; source: string }
  | { kind: "incomplete"; snippetKind: IncompleteSnippet["kind"]; line: number; source: string };

export type SumTypeDecl = {
  name: string;
  source: string;
  line: number;
  variants: Array<{ name: string; fields: string[] }>;
};

export type TypeAliasDecl = {
  name: string;
  source: string;
  line: number;
  target: string;
};

export type ClassDecl = {
  name: string;
  line: number;
  snippet: string;
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

type SourceRange = {
  start: number;
  end: number;
};

type FunctionHeader = {
  indent: string;
  keyword: "fn" | "function";
  name: string;
  params: string;
  returnType?: string;
  hasBody: boolean;
};

export function parse(codeSheet: CodeSheet): ParsedSheet {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const classDecls = discoverClassDecls(lines);
  const sumTypes = discoverSumTypes(lines);
  const typeAliases = discoverTypeAliases(lines, sumTypes);
  const incompleteSnippets = discoverIncompleteSnippets(source);

  return {
    source,
    runnables: discoverRunnables(lines),
    incompleteSnippets,
    declarations: [
      ...sumTypes.map((item): Declaration => ({ kind: "sum-type", name: item.name, line: item.line, source: item.source })),
      ...classDecls.map((item): Declaration => ({ kind: "class", name: item.name, line: item.line, source: item.snippet })),
      ...incompleteSnippets.map((item): Declaration => ({
        kind: "incomplete",
        snippetKind: item.kind,
        line: item.line,
        source: item.snippet,
      })),
    ],
    sumTypes,
    typeAliases,
    classDecls,
    topLevelComments: lines.filter((line) => line.startsWith("//")),
  };
}

export function lower(parsed: ParsedSheet): LoweredCodeSheet {
  return {
    source: parsed.source,
    parsed,
  };
}

export function runnables(codeSheet: CodeSheet): RunnableInfo[] {
  return parse(codeSheet).runnables;
}

export function buildCompilationIR(parsed: ParsedSheet): CompilationIR {
  const lowered = lower(parsed);
  const nodes: CompilationNode[] = [];
  let cursor = 0;

  for (const snippet of parsed.incompleteSnippets) {
    const range = snippet.range ?? rangeForLineSnippet(lowered.source, snippet.line, snippet.snippet);
    if (range.start > cursor) {
      nodes.push({ kind: "source", source: lowered.source.slice(cursor, range.start) });
    }

    nodes.push({
      kind: "incomplete",
      line: snippet.line,
      snippetKind: snippet.kind,
      annotationContexts: snippet.annotationContexts ?? [],
      indent: indentationAt(lowered.source, range.start),
      state: {
        kind: "partial",
        snippet: snippet.snippet,
        hash: hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts),
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
  return parsed.incompleteSnippets.map((snippet) => hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts));
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

  if (options.signal?.aborted) {
    return;
  }

  if (options.strategy === "parallel" && complete) {
    for await (const event of compileParallelRemaining(
      ir,
      parsed,
      codeCache,
      complete,
      options,
      completions,
      completedSnippets,
      totalSnippets,
      emitProgress,
    )) {
      yield event;
    }
    return;
  }

  for (const node of ir.nodes) {
    if (node.kind !== "incomplete" || node.state.kind !== "partial") {
      continue;
    }

    const { hash, snippet } = node.state;
    const cachedReplacement = await validCachedImplementation(codeCache, hash, snippet, node.snippetKind);
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
    yield { kind: "typecheck", diagnostics: [] };
    for (const hit of initialCacheHits) {
      yield { kind: "cache-hit", hash: hit.hash, snippet: hit.snippet, implementation: hit.implementation };
    }
    yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
    if (completedSnippets < totalSnippets) {
      yield {
        kind: "implementation",
        source: renderImplementation(ir),
        completedSnippets,
        totalSnippets,
      };
    }
  }

  for (const node of ir.nodes) {
    if (options.signal?.aborted) {
      return;
    }

    if (node.kind !== "incomplete" || node.state.kind !== "partial") {
      continue;
    }

    const { hash, snippet } = node.state;
    const cachedReplacement = await validCachedImplementation(codeCache, hash, snippet, node.snippetKind);
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

    const tokenEvents: Array<Extract<CompilationEvent, { kind: "llm-token" }>> = [];
    const replacement = await completeSnippetWithValidation({
      complete,
      completeOptions: options.abortCurrentCompletion ? { signal: options.signal } : undefined,
      contextSource: renderImplementation(ir),
      snippet,
      snippetKind: node.snippetKind,
      annotationContexts: node.annotationContexts,
      onToken: (token) => {
        if (emitProgress && !options.signal?.aborted && options.streamTokens !== false) {
          tokenEvents.push({ kind: "llm-token", hash, token });
        }
      },
    });
    for (const event of tokenEvents) {
      yield event;
    }
    await cacheImplementation(codeCache, hash, replacement);
    node.state = { kind: "complete", hash, snippet, implementation: replacement };
    completions.push({ hash, snippet, replacement, cached: false });
    completedSnippets += 1;

    if (options.signal?.aborted) {
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

async function* compileParallelRemaining(
  ir: CompilationIR,
  parsed: ParsedSheet,
  codeCache: CodeCache,
  complete: CompleteFunction,
  options: CompileOptions,
  completions: Completion[],
  completedSnippets: number,
  totalSnippets: number,
  emitProgress: boolean,
): AsyncIterable<CompilationEvent> {
  const remaining = new Set(ir.nodes.filter((node): node is IncompleteCompilationNode => {
    return node.kind === "incomplete" && node.state.kind === "partial";
  }));

  if (remaining.size === 0 || options.signal?.aborted) {
    yield compiledEvent(ir, completions);
    return;
  }

  const initialReadiness = definitionReadiness(parsed, codeCache);
  const initialRunnablesReady = parsed.runnables.length > 0 &&
    parsed.runnables.every((runnable) => initialReadiness.find((definition) => definition.name === runnable.name)?.ready === true);
  if (emitProgress) {
    yield { kind: "readiness", definitions: initialReadiness };
  }

  while (remaining.size > 0) {
    if (options.signal?.aborted) {
      return;
    }

    const promptSource = renderImplementation(ir);
    const readyNodes = [...remaining].filter((node) => dependenciesSatisfied(node, ir, parsed, promptSource));
    if (readyNodes.length === 0) {
      const blocked = [...remaining].map((node) => {
        const snippet = node.state.snippet.split("\n")[0]?.trim() ?? "<unknown snippet>";
        const name = declarationName(node.state.snippet);
        const graphNode = name ? dependencyGraph(parsed).nodes.find((item) => item.name === name) : undefined;
        const deps = graphNode?.dependencies.filter((dependency) => {
          const dependencyNode = ir.nodes.find((candidate): candidate is IncompleteCompilationNode => {
            if (candidate.kind !== "incomplete") return false;
            return declarationName(candidate.state.snippet) === dependency;
          });
          return dependencyNode && (
            dependencyNode.state.kind !== "complete" ||
            !renderedDeclarationHasBody(promptSource, dependency, dependencyNode.snippetKind)
          );
        }) ?? [];
        return deps.length === 0 ? snippet : `${snippet} waiting on ${deps.join(", ")}`;
      }).join(", ");
      throw new Error(`Parallel compilation could not find a dependency-ready completion batch. Blocked snippets: ${blocked}`);
    }
    const batch: IncompleteCompilationNode[] = [];
    for (const node of readyNodes) {
      if (node.state.kind !== "partial") {
        remaining.delete(node);
        continue;
      }

      const snippet = node.state.snippet;
      const hash = renderedCompletionHash(parsed, snippet, node.annotationContexts, promptSource);
      node.state = { ...node.state, hash };
      const cachedReplacement = await validCachedImplementation(codeCache, hash, snippet, node.snippetKind);
      if (cachedReplacement === undefined) {
        remaining.delete(node);
        batch.push(node);
        continue;
      }

      node.state = { kind: "complete", hash, snippet, implementation: cachedReplacement };
      remaining.delete(node);
      completions.push({ hash, snippet, replacement: cachedReplacement, cached: true });
      completedSnippets += 1;
      if (emitProgress && !initialRunnablesReady) {
        yield { kind: "cache-hit", hash, snippet, implementation: cachedReplacement };
        if (remaining.size > 0) {
          yield {
            kind: "implementation",
            source: renderImplementation(ir),
            completedSnippets,
            totalSnippets,
          };
        }
        yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
      }
    }

    if (batch.length === 0) {
      continue;
    }

    const queue = new AsyncEventQueue<ParallelCompletionEvent>();
    let activeTasks = batch.length;

    for (const node of batch) {
      remaining.delete(node);
      const { hash, snippet } = node.state;
      if (emitProgress) {
        yield { kind: "llm-start", hash, snippet };
      }

      void runParallelCompletionTask(
        queue,
        node,
        promptSource,
        codeCache,
        complete,
        options,
      ).finally(() => {
        activeTasks -= 1;
        if (activeTasks === 0) {
          queue.close();
        }
      });
    }

    for await (const event of queue) {
      if (options.signal?.aborted) {
        return;
      }

      if (event.kind === "error") {
        throw event.error;
      }

      if (event.kind === "token") {
        if (emitProgress && options.streamTokens !== false) {
          yield { kind: "llm-token", hash: event.hash, token: event.token };
        }
        continue;
      }

      event.node.state = {
        kind: "complete",
        hash: event.hash,
        snippet: event.snippet,
        implementation: event.replacement,
      };
      const staticHash = hashCompletionInput(parsed, event.snippet, event.node.annotationContexts);
      if (staticHash !== event.hash) {
        await cacheImplementation(codeCache, staticHash, event.replacement);
      }
      completions.push({
        hash: event.hash,
        snippet: event.snippet,
        replacement: event.replacement,
        cached: false,
      });
      completedSnippets += 1;

      if (emitProgress) {
        yield { kind: "llm-complete", hash: event.hash, implementation: event.replacement };
        yield {
          kind: "implementation",
          source: renderImplementation(ir),
          completedSnippets,
          totalSnippets,
        };
        yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
      }
    }
  }

  yield compiledEvent(ir, completions);
}

function dependenciesSatisfied(
  node: IncompleteCompilationNode,
  ir: CompilationIR,
  parsed: ParsedSheet,
  promptSource: string,
): boolean {
  if (node.state.kind !== "partial") {
    return true;
  }
  const name = declarationName(node.state.snippet);
  if (!name) {
    return true;
  }

  const graphNode = dependencyGraph(parsed).nodes.find((item) => item.name === name);
  if (!graphNode) {
    return true;
  }

  const incompleteNodesByName = new Map<string, IncompleteCompilationNode>();
  for (const candidate of ir.nodes) {
    if (candidate.kind !== "incomplete") {
      continue;
    }
    const candidateName = declarationName(candidate.state.snippet);
    if (candidateName) {
      incompleteNodesByName.set(candidateName, candidate);
    }
  }

  return graphNode.dependencies.every((dependency) => {
    const dependencyNode = incompleteNodesByName.get(dependency);
    if (!dependencyNode) {
      return true;
    }
    return dependencyNode.state.kind === "complete" &&
      renderedDeclarationHasBody(promptSource, dependency, dependencyNode.snippetKind);
  });
}

function renderedDeclarationHasBody(
  source: string,
  name: string,
  kind: IncompleteSnippet["kind"],
): boolean {
  if (kind === "natural") {
    return true;
  }
  const pattern = kind === "class"
    ? new RegExp(`class\\s+${escapeRegExp(name)}\\b[^{}]*\\{`)
    : new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*(?::\\s*[^;{]+)?\\{`);
  return pattern.test(source);
}

async function runParallelCompletionTask(
  queue: AsyncEventQueue<ParallelCompletionEvent>,
  node: IncompleteCompilationNode,
  promptSource: string,
  codeCache: CodeCache,
  complete: CompleteFunction,
  options: CompileOptions,
): Promise<void> {
  if (node.state.kind !== "partial") {
    return;
  }

  const { hash, snippet } = node.state;
  try {
    const replacement = await completeSnippetWithValidation({
      complete,
      completeOptions: options.abortCurrentCompletion ? { signal: options.signal } : undefined,
      contextSource: promptSource,
      snippet,
      snippetKind: node.snippetKind,
      annotationContexts: node.annotationContexts,
      onToken: (token) => {
        if (!options.signal?.aborted) {
          queue.push({ kind: "token", hash, token });
        }
      },
    });
    await cacheImplementation(codeCache, hash, replacement);
    if (!options.signal?.aborted) {
      queue.push({ kind: "complete", node, hash, snippet, replacement });
    }
  } catch (error) {
    queue.push({ kind: "error", error });
  }
}

type CompleteSnippetOptions = {
  complete: CompleteFunction;
  completeOptions?: CompleteOptions;
  contextSource: string;
  snippet: string;
  snippetKind: IncompleteSnippet["kind"];
  annotationContexts: LogosAnnotationContext[];
  onToken?: (token: string) => void;
};

async function completeSnippetWithValidation(options: CompleteSnippetOptions): Promise<string> {
  const basePrompt = buildCompletionPrompt(
    options.contextSource,
    options.snippet,
    options.snippetKind,
    options.annotationContexts,
  );
  let lastInvalid: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}

The previous response was invalid because it still contained incomplete semicolon-only Logos declarations:
${lastInvalid.map((snippet) => `- ${snippet}`).join("\n")}

Return a complete implementation for the requested declaration. Do not return any function or class declaration without a body.`;

    let replacement = "";
    const result = options.complete(prompt, options.completeOptions);
    if (isAsyncIterable(result)) {
      for await (const token of result) {
        replacement += token;
        options.onToken?.(token);
      }
    } else {
      replacement = await result;
    }

    replacement = normalizeSnippet(
      replacement,
      options.snippetKind,
      options.snippet,
      options.contextSource,
    );

    const invalid = incompleteDeclarationSnippets(replacement);
    if (invalid.length === 0) {
      return replacement;
    }
    lastInvalid = invalid;
  }

  throw new Error(`Completion for requested snippet left incomplete Logos stubs: ${lastInvalid.join(", ")}`);
}

async function validCachedImplementation(
  codeCache: CodeCache,
  hash: SnippetHash,
  snippet: string,
  snippetKind: IncompleteSnippet["kind"],
): Promise<string | undefined> {
  const implementation = await cachedImplementation(codeCache, hash);
  if (implementation === undefined) {
    return undefined;
  }

  if (snippetKind === "natural") {
    return implementation;
  }

  const invalid = incompleteDeclarationSnippets(implementation);
  if (invalid.length === 0 && implementation.trim() !== snippet.trim()) {
    return implementation;
  }

  codeCache.delete(hash);
  return undefined;
}

function incompleteDeclarationSnippets(source: string): string[] {
  return parse(source).incompleteSnippets
    .filter((snippet) => snippet.kind !== "natural")
    .map((snippet) => snippet.snippet.split("\n")[0]?.trim() ?? "<unknown snippet>");
}

function compiledEvent(ir: CompilationIR, completions: Completion[]): CompilationEvent {
  return {
    kind: "compiled",
    completed: {
      source: renderImplementation(ir),
      lowered: ir.lowered,
      completions,
      ir,
    },
  };
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export function renderImplementation(ir: CompilationIR): CodeSheet {
  const imports: string[] = [];
  const seenImports = new Set<string>();
  const source = ir.nodes.map((node) => {
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
  }).join("");

  if (imports.length === 0) {
    return source;
  }

  return `${imports.join("\n")}\n\n${source}`;
}

export function definitionReadiness(parsed: ParsedSheet, codeCache: CodeCache): DefinitionReadiness[] {
  const graph = dependencyGraph(parsed);
  const incomplete = incompleteDeclarationNames(parsed, codeCache);
  const graphDefinitions: DefinitionReadiness[] = graph.nodes
    .filter((node) => node.kind === "function" || node.kind === "class")
    .map((node) => {
      const ownPendingSnippets = node.kind === "function" &&
        hasPendingInternalSnippets(parsed, codeCache, node.name, node.line);
      const directImplementationMissing = incomplete.has(node.name) || ownPendingSnippets;
      const blockingDependencies = directImplementationMissing
        ? []
        : blockingDependencyNames(node.name, graph, incomplete);
      const reason = directImplementationMissing
        ? "implementation"
        : blockingDependencies.length > 0
          ? "dependency"
          : undefined;
      return {
        name: node.name,
        line: node.line,
        kind: node.kind === "class" ? "class" as const : "function" as const,
        ready: !directImplementationMissing && blockingDependencies.length === 0,
        ...(reason === undefined ? {} : { reason }),
        dependencies: node.dependencies,
        blockingDependencies,
      };
    });

  const definitionsByName = new Map(graphDefinitions.map((definition) => [definition.name, definition]));
  const runnableBlocks = topLevelFunctionBlocks(parsed.source);
  const runnables = parsed.runnables.flatMap((runnable): DefinitionReadiness[] => {
    if (definitionsByName.has(runnable.name)) {
      return [];
    }
    const block = runnableBlocks.find((item) => item.name === runnable.name && item.line === runnable.line);
    const referencedNames = new Set(identifiers(block?.source ?? ""));
    const dependencies = graph.nodes
      .filter((node) => node.name !== runnable.name && referencedNames.has(node.name))
      .map((node) => node.name);
    const blockingDependencies = dependencies.filter((name) => definitionsByName.get(name)?.ready === false);
    const ownPendingSnippets = hasPendingInternalSnippets(parsed, codeCache, runnable.name, runnable.line);
    const ready = blockingDependencies.length === 0 && !ownPendingSnippets;

    return [{
      name: runnable.name,
      line: runnable.line,
      kind: "function" as const,
      ready,
      ...(ready ? {} : { reason: blockingDependencies.length > 0 ? "dependency" as const : "implementation" as const }),
      dependencies,
      blockingDependencies,
    }];
  });

  return [...graphDefinitions, ...runnables];
}

export function dependencyGraphForCodeSheet(codeSheet: CodeSheet): CodeSheetDependencyGraph {
  return dependencyGraph(parse(codeSheet));
}

export function dependencyGraph(parsed: ParsedSheet): CodeSheetDependencyGraph {
  const declarations = graphDeclarations(parsed);
  const byName = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  const nodes = declarations.map((declaration): CodeSheetDependencyNode => {
    const dependencies = directDependencies(declaration.name, declaration.source, byName);
    return {
      name: declaration.name,
      line: declaration.line,
      kind: declaration.kind,
      source: declaration.source,
      dependencies,
      transitiveDependencies: transitiveDependencies(dependencies, byName),
    };
  });

  return { nodes };
}

function incompleteDeclarationNames(parsed: ParsedSheet, codeCache: CodeCache): Set<string> {
  const missing = new Set<string>();
  for (const snippet of parsed.incompleteSnippets) {
    const name = declarationName(snippet.snippet);
    if (!name) {
      continue;
    }
    const hash = hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts);
    if (!codeCache.has(hash)) {
      missing.add(name);
    }
  }
  return missing;
}

function blockingDependencyNames(
  name: string,
  graph: CodeSheetDependencyGraph,
  incomplete: Set<string>,
): string[] {
  const byName = new Map(graph.nodes.map((node) => [node.name, node]));
  const blocking = new Set<string>();
  const visited = new Set<string>();
  const queue = [...(byName.get(name)?.dependencies ?? [])];

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
    queue.push(...(byName.get(dependency)?.dependencies ?? []));
  }

  return [...blocking].sort();
}

function hasPendingInternalSnippets(
  parsed: ParsedSheet,
  codeCache: CodeCache,
  name: string,
  line: number,
): boolean {
  const block = topLevelFunctionBlocks(parsed.source).find((item) => item.name === name && item.line === line);
  if (!block) {
    return false;
  }

  return parsed.incompleteSnippets.some((snippet) => {
    if (snippet.line < block.line || snippet.line > block.endLine) {
      return false;
    }
    if (parseFunctionHeader(snippet.snippet)) {
      return false;
    }
    const classDecl = parsed.classDecls.find((decl) => decl.line === snippet.line && decl.snippet === snippet.snippet);
    if (classDecl) {
      return false;
    }
    return !codeCache.has(hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts));
  });
}

function topLevelFunctionBlocks(source: string): Array<{ name: string; line: number; endLine: number; source: string }> {
  const lines = source.split("\n");
  const blocks: Array<{ name: string; line: number; endLine: number; source: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = parseFunctionHeader(lines[index]);
    if (!header || header.indent.length > 0 || !header.hasBody) {
      continue;
    }

    const endLine = lines[index].includes("{") ? bracedBlockEndLine(lines, index) : blockEndLine(lines, index);
    blocks.push({
      name: header.name,
      line: index + 1,
      endLine,
      source: lines.slice(index, endLine).join("\n"),
    });
  }
  return blocks;
}

export function selectionContextAtPosition(
  codeSheet: CodeSheet,
  lineNumber: number,
  column: number,
): SourceSelectionContext {
  const snippet = parse(codeSheet).incompleteSnippets.find((item) => {
    if (!item.range) {
      return item.line === lineNumber;
    }
    const offset = offsetAt(codeSheet, lineNumber, column);
    return offset >= item.range.start && offset <= item.range.end;
  });
  return snippet ? { kind: "snippet", snippet } : { kind: "whole-file" };
}

export function implementationTargetAtLine(codeSheet: CodeSheet, lineNumber: number): ImplementationTarget | null {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const line = lines[lineNumber - 1] ?? "";
  const header = parseFunctionHeader(line);
  if (header) {
    const endLine = line.includes("{") ? bracedBlockEndLine(lines, lineNumber - 1) : lineNumber;
    return {
      kind: "function",
      name: header.name,
      line: lineNumber,
      endLine,
      source: lines.slice(lineNumber - 1, endLine).join("\n"),
    };
  }

  const className = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
  if (className) {
    return {
      kind: "class",
      name: className,
      line: lineNumber,
      endLine: blockEndLine(lines, lineNumber - 1),
      source: lines.slice(lineNumber - 1, blockEndLine(lines, lineNumber - 1)).join("\n"),
    };
  }

  return null;
}

export function implementationBlockForTarget(implementation: CodeSheet, target: ImplementationTarget): string | null {
  if (target.kind === "class") {
    return discoverClassDecls(implementation.split("\n")).find((decl) => decl.name === target.name)?.snippet ?? null;
  }
  const pattern = new RegExp(`function\\s+${escapeRegExp(target.name)}\\s*\\(`);
  const index = implementation.search(pattern);
  return index < 0 ? null : implementation.slice(index).split(/\n(?=function\s+|class\s+)/)[0].trimEnd();
}

export function splitNaturalReplacement(source: string): { imports: string[]; body: string } {
  const lines = normalizeFencedCode(source).split("\n");
  const imports = lines.filter((line) => /^import\s/.test(line.trim()));
  const body = lines.filter((line) => !/^import\s/.test(line.trim())).join("\n").trimEnd();
  return { imports, body };
}

export function indentNaturalReplacement(replacement: string, indent: string): string {
  return splitNaturalReplacement(replacement).body
    .split("\n")
    .map((line) => line.length === 0 ? line : `${indent}${line}`)
    .join("\n");
}

export function buildCompletionPrompt(
  source: string,
  snippet: string,
  snippetKind: IncompleteSnippet["kind"] = "function",
  annotationContexts: LogosAnnotationContext[] = [],
): string {
  const annotationGuidance = annotationPromptGuidance(annotationContexts);
  const annotationBlock = annotationGuidance.length === 0 ? "" : `\n${annotationGuidance}`;

  if (snippetKind === "natural") {
    const naturalPolicy = naturalSnippetPolicy(snippet)?.promptGuidance ?? "";
    const appGuidance = appReturnPromptGuidance(source, snippet);
    return `You are an expert software engineer building TypeScript programs.

You are tasked with assisting on the following Logos-TS code sheet:

${source}

Your job is to replace this natural-language Logos fragment with valid TypeScript code:

${snippet}

Return only the replacement code for the fragment, without backticks or fences.
${naturalPolicy}${appGuidance}${annotationBlock}
If imports are needed, include normal TypeScript import lines before the replacement; those imports will be added to the file top.
Use only TypeScript, JavaScript built-ins, Web APIs, and code already present in the sheet unless the sheet explicitly declares another dependency.
${dependencyPromptGuidance()}
Do not stringify, echo, or console.log the natural-language source unless the fragment explicitly asks to print, log, show, render, or display text.
Preserve the intended public behavior shown in the runnable/test functions.`;
  }

  return `You are an expert software engineer building TypeScript programs.

You are tasked with assisting on the following Logos-TS code sheet:

${source}

Your job is to finish the implementation of:

${snippet}

Return only implementations for declarations that appear in the requested snippet, plus any imports required by those declarations.
Use only TypeScript, JavaScript built-ins, Web APIs, and code already present in the sheet unless the sheet explicitly declares another dependency.
For a requested class, return only that class definition and its members. For a requested function, return only that function definition.
${dependencyPromptGuidance()}
${reactComponentPromptGuidance(snippet)}
Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.
${annotationGuidance.length === 0 ? "" : `${annotationGuidance}\n`}Preserve the intended public behavior shown in the runnable/test functions.`;
}

function dependencyPromptGuidance(): string {
  return `Treat comments directly attached to declarations as part of the declaration contract.
Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet or in an attached declaration comment, use it as an existing dependency and do not define it here.
Do not define a nested class or function with the same name as a top-level declaration from the sheet; use the declared top-level dependency instead.
Do not return semicolon-only declarations or leave any requested top-level declaration without a body. Every requested function must be emitted as a complete function body.
Do not assign local variables, loop variables, classes, or functions with the same names as top-level helpers, classes, constructors, or types already present in the sheet.
Do not call a class constructor with arguments unless the sheet declares that constructor signature or shows that call shape in runnable/test code. If a class has no declared constructor, support no-argument construction.
When completing a function whose return type is a declared top-level class with no declared constructor arguments, return an instance of that top-level class using no-argument construction instead of defining a nested class, subclass, or duplicate implementation.`;
}

function reactComponentPromptGuidance(snippet: string): string {
  if (!/\bReact(?:Component|App)\b/.test(snippet)) {
    return "";
  }
  return `The requested function returns a React component or React app. Generate React code using React.createElement, not JSX syntax.
If local React state or hooks are needed, return React.createElement(function CapitalizedComponentName() { ... }) and call React.useState inside that nested component function.`;
}

function appReturnPromptGuidance(source: string, snippet: string): string {
  const index = source.indexOf(snippet);
  if (index < 0) {
    return "";
  }

  const beforeSnippet = source.slice(0, index);
  const functionHeaders = [...beforeSnippet.matchAll(/(?:^|\n)\s*(?:(?:fn)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)|(?:function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*([A-Za-z_][A-Za-z0-9_]*))/g)];
  const current = functionHeaders.at(-1);
  const returnType = (current?.[1] ?? current?.[2])?.trim();
  if (returnType !== "App" && returnType !== "WebPage") {
    return "";
  }

  return `
The surrounding function returns App/WebPage. Generate valid TypeScript statements that compute fixture-backed data and end by returning one complete HTML string. Prefer simple named local variables over dense inline expressions. Do not satisfy this by only printing to console, and do not return a textual summary.
When writing UI code, think only about producing executable code. Do not explain the design, mention these instructions, or invent a design-system abstraction.
The Logos app runtime provides a global shadcn helper object. Use it for UI output instead of hand-writing raw page chrome. Available helpers include shadcn.renderApp, shadcn.Page, shadcn.Card, shadcn.CardHeader, shadcn.CardTitle, shadcn.CardDescription, shadcn.CardContent, shadcn.Button, shadcn.SecondaryButton, shadcn.Row, shadcn.Stack, shadcn.Metric, shadcn.Text, shadcn.Div, shadcn.Span, and shadcn.Script.
Use shadcn helpers with props first and children after: shadcn.Button({ onClick: "window.someHandler()" }, "Label"). Do not put JavaScript handlers in button text, such as shadcn.Button("Label", "someHandler()"). Interactive buttons must have a visible human label and an onClick prop or equivalent handler.
The returned HTML is produced once by TypeScript and then runs as a static browser page. Any client-side interaction must be implemented with self-contained JavaScript in shadcn.Script that updates the DOM directly, or by precomputing alternate views and toggling them in the browser. Do not call Logos/TypeScript functions from browser handlers unless you also define equivalent browser-side JavaScript. Do not use alert(), confirm(), prompt(), console-only handlers, or messages like "re-render required" as substitutes for real UI updates.
Use a shadcn/ui-style operational interface: neutral background, white surfaces, subtle borders, radius <= 8px, compact typography, tabular numbers, table-first layouts, metric cards for headline numbers, standard button/card/form patterns, and restrained color for positive/negative state.
Do not hand-roll unusual controls or decorative chrome. Avoid gradients, blobs, marketing heroes, oversized illustration, and ornamental panels.`;
}

export function normalizeSnippet(
  replacement: string,
  snippetKind?: IncompleteSnippet["kind"],
  original = "",
  contextSheet = "",
): string {
  const normalized = normalizeFencedCode(replacement);
  if (snippetKind === "class" || snippetKind === "function") {
    return extractRequestedTypeScriptDeclaration(normalized, original, snippetKind);
  }

  if (snippetKind === "natural") {
    return extractNaturalTypeScriptReplacement(normalized, original, contextSheet)
      .split("\n")
      .filter((line) => !/^```/.test(line.trim()))
      .join("\n")
      .trim();
  }

  return normalized.trim();
}

function extractRequestedTypeScriptDeclaration(
  source: string,
  original: string,
  kind: IncompleteSnippet["kind"],
): string {
  const requestedName = kind === "class"
    ? original.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
    : original.match(/^(?:fn|function|def)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];

  if (requestedName === undefined) {
    return extractCodeLikeSuffix(source);
  }

  const pattern = kind === "class"
    ? new RegExp(`class\\s+${escapeRegExp(requestedName)}\\b[^{}]*\\{`)
    : new RegExp(`function\\s+${escapeRegExp(requestedName)}\\s*\\([^)]*\\)\\s*(?::\\s*[^{}]+)?\\{`);
  const match = pattern.exec(source);
  if (!match) {
    return extractCodeLikeSuffix(source);
  }

  const openBrace = match.index + match[0].lastIndexOf("{");
  const end = matchingBraceEnd(source, openBrace);
  return end === null ? extractCodeLikeSuffix(source) : source.slice(match.index, end).trim();
}

function extractNaturalTypeScriptReplacement(source: string, original: string, contextSheet: string): string {
  const enclosingFunction = enclosingFunctionName(contextSheet, original);
  const functionMatch = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?::\s*[^{}]+)?\{/.exec(source);
  if (functionMatch) {
    if (functionMatch[1] === enclosingFunction) {
      const openBrace = functionMatch.index + functionMatch[0].lastIndexOf("{");
      const end = matchingBraceEnd(source, openBrace);
      if (end !== null) {
        return source.slice(openBrace + 1, end - 1).trim();
      }
    }
    return extractCodeLikeSuffix(source);
  }

  return extractCodeLikeSuffix(source);
}

function enclosingFunctionName(contextSheet: string, snippet: string): string | null {
  const index = contextSheet.indexOf(snippet);
  if (index < 0) {
    return null;
  }
  const beforeSnippet = contextSheet.slice(0, index);
  const functionHeaders = [...beforeSnippet.matchAll(/(?:^|\n)\s*(?:fn|function|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)];
  return functionHeaders.at(-1)?.[1] ?? null;
}

function extractCodeLikeSuffix(source: string): string {
  const lines = source
    .split("\n")
    .filter((line) => !/^```/.test(line.trim()))
    .map((line) => line.replace(/\s+$/u, ""));
  const start = lines.findIndex((line) => isTypeScriptCodeStart(line.trim()));
  return (start < 0 ? source : lines.slice(start).join("\n")).trim();
}

function isTypeScriptCodeStart(line: string): boolean {
  return /^(?:import|export|class|interface|type|function|const|let|var|return|if|for|while|switch|try|throw|console\.|document\.|window\.|[A-Za-z_][A-Za-z0-9_]*\s*[=(.])/.test(line);
}

function matchingBraceEnd(source: string, openBrace: number): number | null {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return index + 1;
  }
  return null;
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
      cacheKey: "typescript-natural-fenced-statement-v1",
      promptGuidance:
        "This is a triple-backtick natural-language block. Treat it as an imperative TypeScript statement block and return one or more TypeScript statements. If the user asks to print or show results, make the visible output useful to someone who cannot see the generated code.",
    };
  }

  return {
    cacheKey: "typescript-natural-single-expression-default-v1",
    promptGuidance:
      "This is a single-backtick natural-language fragment. Return a TypeScript expression by default, especially for calculation/value requests such as calculate, sum, multiply, count, or find. Return statements only when the fragment explicitly asks for an imperative side effect such as printing, logging, assignment, mutation, throwing, looping, rendering, displaying, or showing output. Do not wrap expression results in console.log unless the fragment explicitly asks for visible output.",
  };
}

function isAsyncIterable(value: CompleteResult): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function stripLogosAnnotationLines(source: string): string {
  return source.split("\n")
    .filter((line) => !line.trim().startsWith("@logos"))
    .join("\n");
}

export function hashCompletionInput(
  parsed: ParsedSheet,
  incompleteCodeSnippet: string,
  annotationContexts: LogosAnnotationContext[] = [],
): SnippetHash {
  const naturalPolicy = naturalSnippetPolicy(incompleteCodeSnippet);
  const dependencyContext = completionDependencyContext(parsed, incompleteCodeSnippet);
  return hashText("completion", [
    "logos-typescript-completion-v7",
    incompleteCodeSnippet.trim(),
    naturalPolicy?.cacheKey ?? "",
    dependencyContext,
    parsed.topLevelComments.join("\n"),
    annotationContexts.map((context) => context.cacheKey).join("\n"),
  ].join("\n---\n"));
}

function renderedCompletionHash(
  parsed: ParsedSheet,
  incompleteCodeSnippet: string,
  annotationContexts: LogosAnnotationContext[] = [],
  renderedSource: string,
): SnippetHash {
  const naturalPolicy = naturalSnippetPolicy(incompleteCodeSnippet);
  const renderedContext = renderedDependencyContext(parsed, incompleteCodeSnippet, renderedSource);
  if (renderedContext === completionDependencyContext(parsed, incompleteCodeSnippet)) {
    return hashCompletionInput(parsed, incompleteCodeSnippet, annotationContexts);
  }

  return hashText("completion", [
    "logos-typescript-rendered-completion-v1",
    incompleteCodeSnippet.trim(),
    naturalPolicy?.cacheKey ?? "",
    renderedContext,
    parsed.topLevelComments.join("\n"),
    annotationContexts.map((context) => context.cacheKey).join("\n"),
  ].join("\n---\n"));
}

function renderedDependencyContext(
  parsed: ParsedSheet,
  incompleteCodeSnippet: string,
  renderedSource: string,
): string {
  if (naturalSnippetPolicy(incompleteCodeSnippet)) {
    return renderedSource.replace(incompleteCodeSnippet, "<LOGOS_COMPLETION_TARGET>");
  }

  const name = declarationName(incompleteCodeSnippet);
  const graphNode = name ? dependencyGraph(parsed).nodes.find((node) => node.name === name) : undefined;
  if (!graphNode || graphNode.transitiveDependencies.length === 0) {
    return completionDependencyContext(parsed, incompleteCodeSnippet);
  }

  const sources = graphNode.transitiveDependencies.map((dependency) => {
    return topLevelDeclarationSourceByName(renderedSource, dependency) ??
      dependencyGraph(parsed).nodes.find((node) => node.name === dependency)?.source ??
      dependency;
  });
  return sources.join("\n---dep---\n");
}

function completionDependencyContext(parsed: ParsedSheet, incompleteCodeSnippet: string): string {
  if (naturalSnippetPolicy(incompleteCodeSnippet)) {
    return parsed.source.replace(incompleteCodeSnippet, "<LOGOS_COMPLETION_TARGET>");
  }

  const dependencySources = dependentDeclarationSources(parsed, incompleteCodeSnippet);
  return dependencySources.length === 0 ? "<NO_DECLARATION_DEPENDENCIES>" : dependencySources.join("\n---dep---\n");
}

type GraphDeclaration = {
  name: string;
  line: number;
  kind: CodeSheetDependencyNode["kind"];
  source: string;
};

function graphDeclarations(parsed: ParsedSheet): GraphDeclaration[] {
  const parsedTypeNames = new Set([
    ...parsed.sumTypes.map((item) => item.name),
    ...parsed.typeAliases.map((item) => item.name),
  ]);
  const declarations: GraphDeclaration[] = [
    ...parsed.sumTypes.map((item): GraphDeclaration => ({
      name: item.name,
      line: item.line,
      kind: "type",
      source: item.source,
    })),
    ...parsed.typeAliases
      .filter((item) => !parsed.sumTypes.some((sumType) => sumType.name === item.name))
      .map((item): GraphDeclaration => ({
        name: item.name,
        line: item.line,
        kind: "type",
        source: item.source,
      })),
    ...graphOnlyTypeDeclarations(parsed).filter((item) => !parsedTypeNames.has(item.name)),
    ...parsed.classDecls.map((item): GraphDeclaration => ({
      name: item.name,
      line: item.line,
      kind: "class",
      source: item.snippet,
    })),
  ];

  const classNames = new Set(parsed.classDecls.map((item) => item.name));
  const incompleteNames = new Set<string>();
  for (const item of parsed.incompleteSnippets) {
    const name = declarationName(item.snippet);
    if (!name) {
      continue;
    }
    if (item.kind === "class" && classNames.has(name)) {
      continue;
    }
    incompleteNames.add(name);
    declarations.push({
      name,
      line: item.line,
      kind: item.kind === "class" ? "class" : "function",
      source: sourceWithAttachedComments(parsed.source, item.snippet, item.range),
    });
  }

  for (const runnable of parsed.runnables) {
    if (incompleteNames.has(runnable.name)) {
      continue;
    }
    declarations.push({
      name: runnable.name,
      line: runnable.line,
      kind: "function",
      source: topLevelFunctionSourceAtLine(parsed.source, runnable.line),
    });
  }

  return declarations;
}

function graphOnlyTypeDeclarations(parsed: ParsedSheet): GraphDeclaration[] {
  const lines = parsed.source.split("\n");
  const declarations: GraphDeclaration[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^type\s+([A-Z][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const trimmed = lines[end].trim();
      if (trimmed.length === 0) {
        break;
      }
      if (/^(?:type|class|function|fn)\s+/.test(trimmed)) {
        break;
      }
      end += 1;
      if (trimmed.endsWith(";")) {
        break;
      }
    }

    declarations.push({
      name: match[1],
      line: index + 1,
      kind: "type",
      source: lines.slice(index, end).join("\n"),
    });
  }
  return declarations;
}

function directDependencies(
  declarationName: string,
  source: string,
  byName: Map<string, GraphDeclaration>,
): string[] {
  const dependencies: string[] = [];
  const seen = new Set<string>();
  for (const name of identifiers(source)) {
    if (name === declarationName || seen.has(name) || !byName.has(name)) {
      continue;
    }
    seen.add(name);
    dependencies.push(name);
  }
  return dependencies;
}

function transitiveDependencies(
  direct: string[],
  byName: Map<string, GraphDeclaration>,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    ordered.push(name);
    const declaration = byName.get(name);
    if (!declaration) {
      return;
    }
    for (const dependency of directDependencies(name, declaration.source, byName)) {
      visit(dependency);
    }
  };

  for (const name of direct) {
    visit(name);
  }
  return ordered;
}

function dependentDeclarationSources(parsed: ParsedSheet, source: string): string[] {
  const byName = new Map<string, string>();
  for (const item of parsed.sumTypes) {
    byName.set(item.name, item.source);
  }
  for (const item of parsed.typeAliases) {
    byName.set(item.name, item.source);
  }
  for (const item of parsed.classDecls) {
    if (item.snippet !== source) {
      byName.set(item.name, item.snippet);
    }
  }
  for (const item of parsed.incompleteSnippets) {
    const name = declarationName(item.snippet);
    if (!name || item.snippet === source) {
      continue;
    }
    byName.set(name, sourceWithAttachedComments(parsed.source, item.snippet, item.range));
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  const root = sourceWithAttachedComments(parsed.source, source, matchingSnippetRange(parsed, source));
  const visitReferences = (text: string): void => {
    for (const name of identifiers(text)) {
      if (seen.has(name)) continue;
      const dependency = byName.get(name);
      if (!dependency) continue;
      seen.add(name);
      ordered.push(dependency);
      visitReferences(dependency);
    }
  };

  visitReferences(root);
  return ordered;
}

function matchingSnippetRange(parsed: ParsedSheet, source: string): SourceRange | undefined {
  return parsed.incompleteSnippets.find((item) => item.snippet === source)?.range;
}

function sourceWithAttachedComments(sheetSource: string, declarationSource: string, range?: SourceRange): string {
  if (!range) {
    return declarationSource;
  }
  const start = attachedCommentStart(sheetSource, range.start);
  return sheetSource.slice(start, range.end);
}

function attachedCommentStart(source: string, declarationStart: number): number {
  const lineStarts = lineStartOffsets(source);
  let line = lineForOffset(lineStarts, declarationStart) - 2;
  let start = declarationStart;
  while (line >= 0) {
    const lineStart = lineStarts[line] ?? 0;
    const nextLineStart = lineStarts[line + 1] ?? source.length + 1;
    const lineEnd = Math.max(lineStart, nextLineStart - 1);
    const text = source.slice(lineStart, lineEnd);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      break;
    }
    if (!trimmed.startsWith("//")) {
      break;
    }
    start = lineStart;
    line -= 1;
  }
  return start;
}

function declarationName(source: string): string | null {
  return source.match(/^(?:function|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\b/)?.[1] ??
    source.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/)?.[1] ??
    null;
}

function topLevelFunctionSourceAtLine(source: string, lineNumber: number): string {
  const lines = source.split("\n");
  const line = lines[lineNumber - 1] ?? "";
  const start = offsetAt(source, lineNumber, 1);
  if (!parseFunctionHeader(line)?.hasBody) {
    return line;
  }

  let depth = 0;
  let sawOpeningBrace = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      sawOpeningBrace = true;
      continue;
    }
    if (char !== "}") {
      continue;
    }
    depth -= 1;
    if (sawOpeningBrace && depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}

function topLevelDeclarationSourceByName(source: string, name: string): string | null {
  const functionMatch = new RegExp(`(?:^|\\n)function\\s+${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*(?::\\s*[^;{]+)?\\{`).exec(source);
  if (functionMatch) {
    const start = functionMatch.index + (functionMatch[0].startsWith("\n") ? 1 : 0);
    const openBrace = source.indexOf("{", start);
    const end = openBrace < 0 ? null : matchingBraceEnd(source, openBrace);
    if (end !== null) {
      return source.slice(start, end);
    }
  }

  const classMatch = new RegExp(`(?:^|\\n)class\\s+${escapeRegExp(name)}\\b[^{}]*\\{`).exec(source);
  if (classMatch) {
    const start = classMatch.index + (classMatch[0].startsWith("\n") ? 1 : 0);
    const openBrace = source.indexOf("{", start);
    const end = openBrace < 0 ? null : matchingBraceEnd(source, openBrace);
    if (end !== null) {
      return source.slice(start, end);
    }
  }

  const lines = source.split("\n");
  const startLine = lines.findIndex((line) => new RegExp(`^type\\s+${escapeRegExp(name)}\\s*=`).test(line));
  if (startLine < 0) {
    return null;
  }

  let endLine = startLine + 1;
  while (endLine < lines.length) {
    const trimmed = lines[endLine].trim();
    if (trimmed.length === 0 || /^(?:type|class|function|fn)\s+/.test(trimmed)) {
      break;
    }
    endLine += 1;
    if (trimmed.endsWith(";")) {
      break;
    }
  }
  return lines.slice(startLine, endLine).join("\n");
}

function identifiers(source: string): string[] {
  return [...source.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0]);
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

export function normalizeFencedCode(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/)?.[1] ?? trimmed;
  return normalizeNewlines(fenced).trimEnd();
}

function discoverRunnables(lines: string[]): RunnableInfo[] {
  return lines.flatMap((line, index) => {
    const header = parseFunctionHeader(line);
    if (!header || header.indent.length > 0 || !header.hasBody || header.params.trim().length > 0) {
      return [];
    }
    return [{ name: header.name, line: index + 1 }];
  });
}

function discoverClassDecls(lines: string[]): ClassDecl[] {
  const classDecls: ClassDecl[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s*(?::|\{)?\s*$/);
    if (!match) {
      continue;
    }
    const end = lines[index].includes("{") ? bracedBlockEndLine(lines, index) : blockEndLine(lines, index);
    classDecls.push({
      name: match[1],
      line: index + 1,
      snippet: lines.slice(index, end).join("\n"),
    });
  }
  return classDecls;
}

function bracedBlockEndLine(lines: string[], startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
    if (index > startIndex && depth <= 0) {
      return index + 1;
    }
  }
  return lines.length;
}

function discoverSumTypes(lines: string[]): SumTypeDecl[] {
  return lines.flatMap((line, index) => {
    const match = line.match(/^type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match || !/[|]/.test(match[2])) {
      return [];
    }
    return [{
      name: match[1],
      source: line,
      line: index + 1,
      variants: match[2].split("|").map((variant) => {
        const trimmed = variant.trim();
        const variantMatch = trimmed.match(/^([A-Z][A-Za-z0-9_]*)(?:\((.*)\))?$/);
        return {
          name: variantMatch?.[1] ?? trimmed,
          fields: variantMatch?.[2]?.split(",").map((field) => field.trim()).filter(Boolean) ?? [],
        };
      }),
    }];
  });
}

function discoverTypeAliases(lines: string[], sumTypes: SumTypeDecl[]): TypeAliasDecl[] {
  const sumTypeNames = new Set(sumTypes.map((item) => item.name));
  return lines.flatMap((line, index) => {
    const match = line.match(/^type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match || sumTypeNames.has(match[1])) {
      return [];
    }
    return [{ name: match[1], source: line, line: index + 1, target: match[2].trim() }];
  });
}

function discoverIncompleteSnippets(source: string): IncompleteSnippet[] {
  const lines = source.split("\n");
  const lineStarts = lineStartOffsets(source);
  const snippets: IncompleteSnippet[] = [];
  const naturalRanges = discoverNaturalSnippets(source);
  snippets.push(...naturalRanges);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const classMatch = line.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?\s*(?::|\{)?\s*$/);
    if (classMatch) {
      const endLine = line.includes("{") ? bracedBlockEndLine(lines, index) : blockEndLine(lines, index);
      const snippet = lines.slice(index, endLine).join("\n");
      if (classNeedsCompletion(snippet)) {
        snippets.push({
          kind: "class",
          line: index + 1,
          snippet,
          range: {
            start: lineStarts[index],
            end: lineStarts[endLine - 1] + (lines[endLine - 1]?.length ?? 0),
          },
        });
      }
      index = endLine - 1;
      continue;
    }

    const header = parseFunctionHeader(line);
    if (header && !header.hasBody) {
      snippets.push({
        kind: "function",
        line: index + 1,
        snippet: line.trimEnd(),
        range: { start: lineStarts[index], end: lineStarts[index] + line.length },
      });
    }
  }

  return snippets.sort((left, right) => (left.range?.start ?? 0) - (right.range?.start ?? 0));
}

function classNeedsCompletion(snippet: string): boolean {
  if (/constructor\s*\([^)]*\)\s*\{/.test(snippet)) {
    return false;
  }
  return snippet.split("\n").some((line) => {
    const trimmed = line.trim();
    return /^fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^:{]+)?\s*$/.test(trimmed) ||
      /^[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*[^;{]+\s*;\s*$/.test(trimmed);
  });
}

function discoverNaturalSnippets(source: string): IncompleteSnippet[] {
  const snippets: IncompleteSnippet[] = [];
  const lineStarts = lineStartOffsets(source);
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("`", index);
    if (start < 0) break;

    const triple = source.startsWith("```", start);
    const end = source.indexOf(triple ? "```" : "`", start + (triple ? 3 : 1));
    if (end < 0) break;

    const finish = end + (triple ? 3 : 1);
    const snippet = source.slice(start, finish);
    const line = lineForOffset(lineStarts, start);
    const lineStart = lineStarts[line - 1] ?? 0;
    snippets.push({
      kind: "natural",
      line,
      column: start - lineStart + 1,
      snippet,
      annotationContexts: annotationContextsBefore(source, line),
      range: { start, end: finish },
    });
    index = finish;
  }
  return snippets;
}

function annotationContextsBefore(source: string, lineNumber: number): LogosAnnotationContext[] {
  const lines = source.split("\n");
  const contexts: LogosAnnotationContext[] = [];
  for (let index = lineNumber - 2; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("@logos")) break;
    contexts.unshift({
      annotation: trimmed,
      cacheKey: trimmed,
      promptGuidance: "emit visible, useful TypeScript runtime output",
    });
  }
  return contexts;
}

function parseFunctionHeader(line: string): FunctionHeader | null {
  const match = line.match(
    /^(\s*)(?:(fn)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^;{]+))?|(?:function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?)\s*(;|\{)?\s*$/,
  );
  if (!match) {
    return null;
  }
  const isFn = match[2] === "fn";
  const returnType = isFn ? match[5] : match[8];
  return {
    indent: match[1],
    keyword: isFn ? "fn" : "function",
    name: isFn ? match[3] : match[6],
    params: isFn ? match[4] : match[7],
    ...(returnType === undefined ? {} : { returnType: returnType.trim() }),
    hasBody: match[9] === "{",
  };
}

function blockEndLine(lines: string[], startIndex: number): number {
  const startIndent = indentWidth(lines[startIndex]);
  let end = startIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim().length > 0 && indentWidth(line) <= startIndent) {
      break;
    }
    end += 1;
  }
  return end;
}

function indentationAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(lineStart, offset).match(/^\s*/)?.[0] ?? "";
}

function rangeForLineSnippet(source: string, lineNumber: number, snippet: string): SourceRange {
  const starts = lineStartOffsets(source);
  const startOfLine = starts[lineNumber - 1] ?? 0;
  const lineEnd = source.indexOf("\n", startOfLine);
  const endOfLine = lineEnd < 0 ? source.length : lineEnd;
  const line = source.slice(startOfLine, endOfLine);
  const column = line.indexOf(snippet);
  const start = column < 0 ? startOfLine : startOfLine + column;
  return { start, end: start + snippet.length };
}

function indentWidth(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function offsetAt(source: string, lineNumber: number, column: number): number {
  const starts = lineStartOffsets(source);
  return (starts[lineNumber - 1] ?? source.length) + Math.max(0, column - 1);
}

function lineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineForOffset(lineStarts: number[], offset: number): number {
  let line = 1;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] > offset) break;
    line = index + 1;
  }
  return line;
}

function normalizeNewlines(source: string): string {
  return source.replaceAll("\r\n", "\n");
}

function hashText(prefix: string, text: string): SnippetHash {
  let hash = 2166136261;
  const input = `${prefix}\0${text}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
