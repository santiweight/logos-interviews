export type CodeSheet = string;
export type Runnable = string;
export type SnippetHash = string;
export type CodeCache = Map<SnippetHash, string>;
export type CompleteFunction = (prompt: string) => string | Promise<string>;

export type RunnableInfo = {
  name: Runnable;
  line: number;
};

export type ParsedSheet = {
  source: CodeSheet;
  runnables: RunnableInfo[];
  sumTypes: SumTypeDecl[];
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
};

export type Completion = {
  hash: SnippetHash;
  snippet: string;
  replacement: string;
  cached: boolean;
};

type SumTypeDecl = {
  name: string;
  source: string;
  line: number;
  variants: SumTypeVariant[];
};

type SumTypeVariant = {
  name: string;
  fields: string[];
};

type IncompleteSnippet = {
  kind: "function" | "class";
  line: number;
  snippet: string;
};

type ClassDecl = {
  name: string;
  line: number;
  snippet: string;
};

export function parse(codeSheet: CodeSheet): ParsedSheet {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");

  return {
    source,
    runnables: discoverRunnables(lines),
    sumTypes: lines.flatMap(parseSumTypeLine),
    classDecls: discoverClassDecls(lines),
    topLevelComments: lines.filter((line) => line.startsWith("#")),
  };
}

export function lower(parsed: ParsedSheet): LoweredCodeSheet {
  const lines = parsed.source.split("\n");
  const body = lines.filter((line) => !isSumTypeLine(line)).join("\n");
  const loweredSumTypes = lowerSumTypes(parsed.sumTypes);

  return {
    parsed,
    source: [loweredSumTypes, body].filter((part) => part.trim().length > 0).join("\n\n"),
  };
}

export function runnables(codeSheet: CodeSheet): RunnableInfo[] {
  return parse(codeSheet).runnables;
}

export async function completeSheet(
  codeCache: CodeCache,
  codeSheet: CodeSheet,
  complete?: CompleteFunction,
): Promise<CompletedCodeSheet> {
  const parsed = parse(codeSheet);
  const lowered = lower(parsed);
  const completions: Completion[] = [];
  let completedSource = lowered.source;
  const incomplete = incompleteSnippets(completedSource);

  for (const item of incomplete) {
    const snippetHash = hashCompletionInput(parsed, item.snippet);
    const cachedReplacement = codeCache.get(snippetHash);

    let replacement = cachedReplacement;
    if (!replacement) {
      if (!complete) {
        break;
      }
      replacement = normalizeSnippet(
        await complete(buildCompletionPrompt(completedSource, item.snippet)),
      );
      codeCache.set(snippetHash, replacement);
    }

    completions.push({
      hash: snippetHash,
      snippet: item.snippet,
      replacement,
      cached: Boolean(cachedReplacement),
    });
    completedSource = replaceIncompleteSnippet(completedSource, item.snippet, replacement);
  }

  return {
    source: completedSource,
    lowered,
    completions,
  };
}

export function hashSnippet(incompleteCodeSnippet: string): SnippetHash {
  return hashText("snippet", incompleteCodeSnippet);
}

export function hashCompletionInput(parsed: ParsedSheet, incompleteCodeSnippet: string): SnippetHash {
  return hashText(
    "completion",
    [
      "--- incomplete snippet ---",
      incompleteCodeSnippet.trim(),
      "",
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

function dependencyContext(parsed: ParsedSheet, snippet: string): string {
  const typeDecls = new Map(parsed.sumTypes.map((decl) => [decl.name, decl]));
  const classDecls = new Map(parsed.classDecls.map((decl) => [decl.name, decl]));
  const needed = new Set<string>();
  const queue = referencedIdentifiers(snippet);

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || needed.has(name)) {
      continue;
    }

    const typeDecl = typeDecls.get(name);
    const classDecl = classDecls.get(name);
    if (!typeDecl && !classDecl) {
      continue;
    }

    needed.add(name);
    const dependencySource = typeDecl?.source ?? classDecl?.snippet ?? "";
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
    ...parsed.classDecls
      .filter((decl) => needed.has(decl.name) && decl.snippet !== snippet)
      .map((decl) => ({ line: decl.line, source: decl.snippet })),
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
  const matches = source.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  return Array.from(
    new Set(
      matches.filter((identifier) => {
        return /^[A-Z]/.test(identifier) && !ignored.has(identifier);
      }),
    ),
  );
}

function discoverRunnables(lines: string[]): RunnableInfo[] {
  return lines.flatMap((line, index) => {
    const match = line.match(
      /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:\s*$/,
    );
    if (!match) {
      return [];
    }

    const params = match[2].trim();
    if (params.length > 0) {
      return [];
    }

    return [{ name: match[1], line: index + 1 }];
  });
}

function parseSumTypeLine(line: string, index: number): SumTypeDecl[] {
  const match = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (!match) {
    return [];
  }

  return [
    {
      name: match[1],
      source: line.trimEnd(),
      line: index + 1,
      variants: splitTopLevel(match[2], "|").map(parseVariant),
    },
  ];
}

function discoverClassDecls(lines: string[]): ClassDecl[] {
  const classDecls: ClassDecl[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (!match) {
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
      name: match[1],
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

function lowerSumTypes(sumTypes: SumTypeDecl[]): string {
  if (sumTypes.length === 0) {
    return "";
  }

  const seenConstructors = new Set<string>();
  const output = ["from dataclasses import dataclass"];

  for (const sumType of sumTypes) {
    for (const variant of sumType.variants) {
      if (seenConstructors.has(variant.name)) {
        continue;
      }

      seenConstructors.add(variant.name);
      output.push("", "@dataclass(frozen=True)", `class ${variant.name}:`);

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

function fieldNames(variant: SumTypeVariant): string[] {
  if (variant.fields.length === 1) {
    return ["value"];
  }

  if (variant.fields.length === 3) {
    return ["op", "left", "right"];
  }

  return variant.fields.map((_, index) => `field${index}`);
}

function toPythonType(source: string): string {
  const trimmed = source.trim();
  if (trimmed === "str" || trimmed === "int" || trimmed === "None") {
    return trimmed;
  }
  if (/^list\[.+\]$/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

function incompleteSnippets(codeSheet: CodeSheet): IncompleteSnippet[] {
  const lines = normalizeNewlines(codeSheet).split("\n");
  const snippets: IncompleteSnippet[] = [];
  const coveredLines = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.match(/^class\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*$/)) {
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
      const trimmed = classLine.trimEnd();
      return (
        /^\s+def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*$/.test(
          trimmed,
        ) && !trimmed.endsWith(":")
      );
    });

    if (hasIncompleteMethod) {
      snippets.push({
        kind: "class",
        line: index + 1,
        snippet: trimTrailingBlankLines(classLines).join("\n"),
      });

      for (let lineNumber = index + 1; lineNumber <= end; lineNumber += 1) {
        coveredLines.add(lineNumber);
      }
    }
  }

  snippets.push(
    ...lines.flatMap((line, index) => {
      if (coveredLines.has(index + 1)) {
        return [];
      }

      const trimmed = line.trimEnd();
      const match = trimmed.match(
        /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*$/,
      );
      if (!match || trimmed.endsWith(":")) {
        return [];
      }

      return [{ kind: "function" as const, line: index + 1, snippet: trimmed }];
    }),
  );

  return snippets.sort((left, right) => left.line - right.line);
}

function buildCompletionPrompt(sheet: CodeSheet, snippet: string): string {
  return `You are an expert software engineer building programs.

You are tasked with assisting on the following Python code sheet:

${sheet}

Your job is to finish the implementation of:

${snippet}

Return just the function or class snippet, no imports.
Use normal Python. Prefer dataclasses and match statements for sum types.`;
}

function normalizeSnippet(source: string): string {
  const trimmed = source.trim();
  const fence = trimmed.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  const unfenced = fence?.[1] ?? trimmed;
  const lines = unfenced.replaceAll("\r\n", "\n").split("\n");
  const classIndex = lines.findIndex((line) => /^class\s+/.test(line.trimStart()));
  if (classIndex >= 0) {
    return extractIndentedBlock(lines, classIndex);
  }

  const defIndex = lines.findIndex((line) => /^def\s+/.test(line.trimStart()));
  if (defIndex < 0) {
    return unfenced.trimEnd();
  }

  return extractIndentedBlock(lines, defIndex);
}

function extractIndentedBlock(lines: string[], start: number): string {
  const snippet: string[] = [lines[start].trimEnd()];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      snippet.push(line);
      continue;
    }

    if (!/^\s+/.test(line)) {
      break;
    }

    snippet.push(line.trimEnd());
  }

  return trimTrailingBlankLines(snippet).join("\n").trimEnd();
}

function replaceIncompleteSnippet(
  source: string,
  snippet: string,
  replacement: string,
): string {
  const lines = normalizeNewlines(source).split("\n");
  const snippetLines = snippet.split("\n");
  const lineIndex = lines.findIndex((_, index) => {
    const candidate = lines
      .slice(index, index + snippetLines.length)
      .map((line) => line.trimEnd())
      .join("\n");
    return candidate === snippet;
  });

  if (lineIndex < 0) {
    throw new Error(`Could not find incomplete snippet: ${snippet}`);
  }

  lines.splice(lineIndex, snippetLines.length, replacement);
  return lines.join("\n");
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

function isSumTypeLine(line: string): boolean {
  return /^type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);
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
