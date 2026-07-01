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
    topLevelComments: lines.filter((line) => line.startsWith("#")),
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
    yield { kind: "typecheck", diagnostics: [] };
    for (const hit of initialCacheHits) {
      yield { kind: "cache-hit", hash: hit.hash, snippet: hit.snippet, implementation: hit.implementation };
    }
    yield { kind: "readiness", definitions: definitionReadiness(parsed, codeCache) };
    yield {
      kind: "implementation",
      source: renderImplementation(ir),
      completedSnippets,
      totalSnippets,
    };
  }

  for (const node of ir.nodes) {
    if (options.signal?.aborted) {
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
        if (emitProgress && !options.signal?.aborted && options.streamTokens !== false) {
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

export function definitionReadiness(parsed: ParsedSheet, _codeCache: CodeCache): DefinitionReadiness[] {
  const incompleteDefinitions = parsed.incompleteSnippets.flatMap((snippet) => {
    const header = parseFunctionHeader(snippet.snippet);
    return header
      ? [{
          name: header.name,
          line: snippet.line,
          kind: "function" as const,
          ready: true,
          reason: "implementation" as const,
          dependencies: [],
          blockingDependencies: [],
        }]
      : [];
  });

  const runnables = parsed.runnables.map((runnable) => ({
    name: runnable.name,
    line: runnable.line,
    kind: "function" as const,
    ready: true,
    reason: "implementation" as const,
    dependencies: [],
    blockingDependencies: [],
  }));

  return [...incompleteDefinitions, ...runnables];
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
Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.
For a requested class, return only that class definition and its members. For a requested function, return only that function definition.
Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.
${annotationGuidance.length === 0 ? "" : `${annotationGuidance}\n`}Preserve the intended public behavior shown in the runnable/test functions.`;
}

function appReturnPromptGuidance(source: string, snippet: string): string {
  const index = source.indexOf(snippet);
  if (index < 0) {
    return "";
  }

  const beforeSnippet = source.slice(0, index);
  const functionHeaders = [...beforeSnippet.matchAll(/(?:^|\n)\s*(?:(?:fn)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*->\s*([^{\n]+)|(?:function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*([^{\n]+))\s*\{/g)];
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

function completionDependencyContext(parsed: ParsedSheet, incompleteCodeSnippet: string): string {
  if (naturalSnippetPolicy(incompleteCodeSnippet)) {
    return parsed.source.replace(incompleteCodeSnippet, "<LOGOS_COMPLETION_TARGET>");
  }

  const dependencySources = dependentDeclarationSources(parsed, incompleteCodeSnippet);
  return dependencySources.length === 0 ? "<NO_DECLARATION_DEPENDENCIES>" : dependencySources.join("\n---dep---\n");
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

  const seen = new Set<string>();
  const ordered: string[] = [];
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

  visitReferences(source);
  return ordered;
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
