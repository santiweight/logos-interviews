import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { TypeCheckDiagnostic } from "./typeCheck";

const execFileAsync = promisify(execFile);

export type PyrightSourceMapEntry = {
  sourceLine: number | null;
  columnOffset: number;
};

export type PyrightLoweredSheet = {
  source: string;
  sourceMap: PyrightSourceMapEntry[];
  nonPythonForms: NonPythonForm[];
};

export type NonPythonForm =
  | "bodyless-signature"
  | "bare-signature"
  | "function-keyword"
  | "record"
  | "dataclass-shorthand"
  | "sum-type"
  | "tuple-alias"
  | "nested-map";

export type PyrightTypeCheckResult = {
  diagnostics: TypeCheckDiagnostic[];
  lowered: PyrightLoweredSheet;
  raw: PyrightJson;
};

type PyrightPosition = {
  line: number;
  character: number;
};

type PyrightRange = {
  start: PyrightPosition;
  end: PyrightPosition;
};

type PyrightDiagnostic = {
  file: string;
  severity: "error" | "warning" | "information";
  message: string;
  range: PyrightRange;
  rule?: string;
};

type PyrightJson = {
  generalDiagnostics: PyrightDiagnostic[];
  summary?: {
    errorCount: number;
    warningCount: number;
    informationCount: number;
  };
};

type BatchCase = {
  id: string;
  sheet: string;
};

export async function typeCheckWithPyright(sheet: string): Promise<PyrightTypeCheckResult> {
  const result = await typeCheckManyWithPyright([{ id: "sheet", sheet }]);
  const item = result.get("sheet");
  if (!item) {
    throw new Error("Pyright did not return a result for the sheet");
  }

  return item;
}

export async function typeCheckManyWithPyright(
  cases: BatchCase[],
): Promise<Map<string, PyrightTypeCheckResult>> {
  const tempDir = await mkdtemp(join(tmpdir(), "logos-pyright-"));
  const loweredByFile = new Map<string, PyrightLoweredSheet>();
  const idByFile = new Map<string, string>();

  try {
    await writeFile(
      join(tempDir, "pyrightconfig.json"),
      JSON.stringify(
        {
          typeCheckingMode: "standard",
          pythonVersion: "3.11",
          reportMissingModuleSource: "none",
        },
        null,
        2,
      ),
    );

    await Promise.all(
      cases.map(async (item, index) => {
        const lowered = lowerSheetForPyright(item.sheet);
        const file = join(tempDir, `${String(index).padStart(3, "0")}_${safeFileName(item.id)}.py`);
        loweredByFile.set(file, lowered);
        idByFile.set(file, item.id);
        await writeFile(file, lowered.source);
      }),
    );

    const raw = await runPyright(tempDir);
    const diagnosticsByFile = new Map<string, PyrightDiagnostic[]>();
    for (const diagnostic of raw.generalDiagnostics) {
      const diagnostics = diagnosticsByFile.get(diagnostic.file) ?? [];
      diagnostics.push(diagnostic);
      diagnosticsByFile.set(diagnostic.file, diagnostics);
    }

    const results = new Map<string, PyrightTypeCheckResult>();
    for (const [file, lowered] of loweredByFile) {
      const diagnostics = (diagnosticsByFile.get(file) ?? [])
        .map((diagnostic) => mapPyrightDiagnostic(diagnostic, lowered))
        .filter((diagnostic): diagnostic is TypeCheckDiagnostic => diagnostic !== null);
      const fileRaw: PyrightJson = {
        generalDiagnostics: diagnosticsByFile.get(file) ?? [],
        summary: raw.summary,
      };
      results.set(idByFile.get(file) ?? basename(file, ".py"), {
        diagnostics,
        lowered,
        raw: fileRaw,
      });
    }

    return results;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function lowerSheetForPyright(sheet: string): PyrightLoweredSheet {
  const output: string[] = [];
  const sourceMap: PyrightSourceMapEntry[] = [];
  const nonPythonForms = new Set<NonPythonForm>();
  const lines = normalizeNewlines(sheet).split("\n");
  let recordBlockIndent: number | null = null;

  emit(output, sourceMap, "from __future__ import annotations", null);
  emit(output, sourceMap, "from dataclasses import dataclass", null);
  emit(output, sourceMap, "from typing import Any, TypeAlias", null);
  emit(output, sourceMap, "", null);

  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = index + 1;
    const line = lines[index];
    const trimmed = line.trim();

    if (recordBlockIndent !== null && trimmed.length > 0 && indentWidth(line) <= recordBlockIndent) {
      recordBlockIndent = null;
    }

    const typeDecl = parseTypeDeclarationLine(line);
    if (typeDecl && isSumTypeRhs(typeDecl.target)) {
      nonPythonForms.add("sum-type");
      emitSumType(output, sourceMap, typeDecl.name, typeDecl.target, sourceLine);
      continue;
    }

    if (typeDecl && isTypeAliasRhs(typeDecl.target)) {
      if (/^\(.+\)$/.test(typeDecl.target.trim())) {
        nonPythonForms.add("tuple-alias");
      }
      emit(
        output,
        sourceMap,
        `${typeDecl.name}: TypeAlias = ${toPythonAlias(typeDecl.target, nonPythonForms)}`,
        sourceLine,
      );
      continue;
    }

    const dataclass = parseDataclassShorthand(line);
    if (dataclass) {
      const isImplicitTopLevelDefinition =
        dataclass.keyword === undefined && dataclass.indent.length === 0;
      const isKeywordDefinition = dataclass.keyword !== undefined;
      if (!isImplicitTopLevelDefinition && !isKeywordDefinition) {
        emit(output, sourceMap, convertNestedMaps(line, nonPythonForms), sourceLine);
        continue;
      }

      nonPythonForms.add(dataclass.keyword === "record" ? "record" : "dataclass-shorthand");
      recordBlockIndent = dataclass.hasBlock ? indentWidth(line) : null;
      emit(output, sourceMap, `${dataclass.indent}@dataclass(frozen=True)`, sourceLine);
      emit(output, sourceMap, `${dataclass.indent}class ${dataclass.name}:`, sourceLine);
      if (dataclass.fields.length === 0) {
        emit(output, sourceMap, `${dataclass.indent}  pass`, sourceLine);
      } else {
        for (const field of dataclass.fields) {
          emit(output, sourceMap, `${dataclass.indent}  ${formatField(field, nonPythonForms)}`, sourceLine);
        }
      }
      continue;
    }

    const field = parseFieldLine(line);
    if (field && recordBlockIndent !== null) {
      emit(output, sourceMap, `${field.indent}${formatField(field, nonPythonForms)}`, sourceLine);
      continue;
    }

    const loweredFunction = lowerFunctionLine(line, nonPythonForms);
    if (loweredFunction !== null) {
      emit(output, sourceMap, loweredFunction, sourceLine);
      continue;
    }

    const nestedMap = line.includes("[[");
    if (nestedMap) {
      nonPythonForms.add("nested-map");
    }
    emit(output, sourceMap, convertNestedMaps(line, nonPythonForms), sourceLine);
  }

  return {
    source: output.join("\n"),
    sourceMap,
    nonPythonForms: Array.from(nonPythonForms).sort(),
  };
}

async function runPyright(directory: string): Promise<PyrightJson> {
  const pyright = resolve(process.cwd(), "node_modules/.bin/pyright");

  try {
    const { stdout } = await execFileAsync(pyright, ["--outputjson", "--project", directory], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 16,
    });
    return JSON.parse(stdout) as PyrightJson;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof (error as { stdout?: unknown }).stdout === "string"
    ) {
      return JSON.parse((error as { stdout: string }).stdout) as PyrightJson;
    }

    throw error;
  }
}

function mapPyrightDiagnostic(
  diagnostic: PyrightDiagnostic,
  lowered: PyrightLoweredSheet,
): TypeCheckDiagnostic | null {
  const start = mapPosition(diagnostic.range.start, lowered);
  const end = mapPosition(diagnostic.range.end, lowered);
  if (!start || !end) {
    return null;
  }

  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: Math.max(end.column, start.column + 1),
    severity: diagnostic.severity === "warning" ? "warning" : "error",
    message: normalizePyrightMessage(diagnostic.message),
  };
}

function mapPosition(
  position: PyrightPosition,
  lowered: PyrightLoweredSheet,
): { line: number; column: number } | null {
  const entry = lowered.sourceMap[position.line];
  if (!entry?.sourceLine) {
    return null;
  }

  return {
    line: entry.sourceLine,
    column: Math.max(1, position.character + 1 - entry.columnOffset),
  };
}

function normalizePyrightMessage(message: string): string {
  return message.split("\n")[0]?.replaceAll("\"", "'") ?? message;
}

function emit(
  output: string[],
  sourceMap: PyrightSourceMapEntry[],
  line: string,
  sourceLine: number | null,
  columnOffset = 0,
): void {
  output.push(line);
  sourceMap.push({ sourceLine, columnOffset });
}

function emitSumType(
  output: string[],
  sourceMap: PyrightSourceMapEntry[],
  name: string,
  target: string,
  sourceLine: number,
): void {
  const variants = splitTopLevel(target, "|").map(parseVariant);
  for (const variant of variants) {
    emit(output, sourceMap, "@dataclass(frozen=True)", sourceLine);
    emit(output, sourceMap, `class ${variant.name}:`, sourceLine);
    if (variant.fields.length === 0) {
      emit(output, sourceMap, "  pass", sourceLine);
    } else {
      fieldNames(variant).forEach((fieldName, index) => {
        emit(output, sourceMap, `  ${fieldName}: ${toPythonType(variant.fields[index], new Set())}`, sourceLine);
      });
    }
    emit(output, sourceMap, "", sourceLine);
  }

  emit(output, sourceMap, `${name}: TypeAlias = ${variants.map((variant) => variant.name).join(" | ")}`, sourceLine);
}

function lowerFunctionLine(line: string, forms: Set<NonPythonForm>): string | null {
  const header = parseFunctionHeader(line);
  if (!header) {
    return null;
  }

  if (header.keyword === "fn" || header.keyword === "function") {
    forms.add("function-keyword");
  }
  if (header.keyword === undefined) {
    forms.add("bare-signature");
  }
  if (!header.hasColon) {
    forms.add("bodyless-signature");
  }

  const params = convertNestedMaps(normalizeDefinitionLiterals(header.params), forms);
  const returnType = header.returnType === undefined ? "" : ` -> ${toPythonType(header.returnType, forms)}`;
  const colon = header.hasColon ? ":" : ": ...";
  return `${header.indent}${header.asyncPrefix}def ${header.name}(${params})${returnType}${colon}`;
}

function parseTypeDeclarationLine(line: string): { name: string; target: string } | null {
  const heralded = line.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (heralded) {
    return { name: heralded[1], target: heralded[2].trim() };
  }

  const bare = line.match(/^([A-Z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  return bare ? { name: bare[1], target: bare[2].trim() } : null;
}

function parseVariant(source: string): { name: string; fields: string[] } {
  const match = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/);
  if (!match) {
    return { name: source.trim(), fields: [] };
  }

  return {
    name: match[1],
    fields: match[2] ? splitTopLevel(match[2], ",") : [],
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

function toPythonAlias(source: string, forms: Set<NonPythonForm>): string {
  const trimmed = source.trim();
  const tuple = trimmed.match(/^\((.*)\)$/);
  if (tuple) {
    return `tuple[${splitTopLevel(tuple[1], ",").map((part) => toPythonType(part, forms)).join(", ")}]`;
  }

  return toPythonType(trimmed, forms);
}

function toPythonType(source: string, forms: Set<NonPythonForm>): string {
  return convertNestedMaps(source.trim(), forms)
    .replace(/\blist\b(?!\[)/g, "list[Any]")
    .replace(/\bdict\b(?!\[)/g, "dict[Any, Any]")
    .replace(/\bset\b(?!\[)/g, "set[Any]")
    .replace(/\btuple\b(?!\[)/g, "tuple[Any, ...]");
}

function convertNestedMaps(source: string, forms: Set<NonPythonForm>): string {
  return source.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    forms.add("nested-map");
    return `dict[str, dict[int, ${inner.trim()}]]`;
  });
}

function parseDataclassShorthand(line: string): {
  indent: string;
  keyword?: "class" | "record";
  name: string;
  fields: Array<{ name: string; type: string; defaultValue?: string }>;
  hasBlock: boolean;
} | null {
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

  return {
    indent: match[1],
    ...(keyword === undefined ? {} : { keyword }),
    name: match[3],
    fields: args === undefined ? [] : parseFields(args),
    hasBlock,
  };
}

function parseFields(source: string): Array<{ name: string; type: string; defaultValue?: string }> {
  return splitTopLevel(source, ",").flatMap((part) => {
    const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
    if (!match) {
      return [];
    }

    return [
      {
        name: match[1],
        type: match[2].trim(),
        ...(match[3] === undefined ? {} : { defaultValue: normalizeDefinitionLiteral(match[3].trim()) }),
      },
    ];
  });
}

function parseFieldLine(line: string): {
  indent: string;
  name: string;
  type: string;
  defaultValue?: string;
} | null {
  const match = line.match(/^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?\s*$/);
  if (!match) {
    return null;
  }

  return {
    indent: match[1],
    name: match[2],
    type: match[3].trim(),
    ...(match[4] === undefined ? {} : { defaultValue: normalizeDefinitionLiteral(match[4].trim()) }),
  };
}

function formatField(
  field: { name: string; type: string; defaultValue?: string },
  forms: Set<NonPythonForm>,
): string {
  const defaultValue = field.defaultValue === undefined ? "" : ` = ${field.defaultValue}`;
  return `${field.name}: ${toPythonType(field.type, forms)}${defaultValue}`;
}

function parseFunctionHeader(line: string): {
  indent: string;
  asyncPrefix: string;
  keyword?: "def" | "fn" | "function";
  name: string;
  params: string;
  returnType?: string;
  hasColon: boolean;
} | null {
  const match = line.match(
    /^(\s*)(async\s+)?(?:(def|fn|function)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:=]+))?\s*(:?)\s*$/,
  );
  if (!match) {
    return null;
  }

  const keyword = match[3] as "def" | "fn" | "function" | undefined;
  const returnType = match[6]?.trim();
  const isBare = keyword === undefined;
  if (isBare && match[7] !== ":" && returnType === undefined) {
    return null;
  }

  if (isBare && !/^[a-z_]/.test(match[4])) {
    return null;
  }

  return {
    indent: match[1],
    asyncPrefix: match[2] ?? "",
    ...(keyword === undefined ? {} : { keyword }),
    name: match[4],
    params: match[5],
    ...(returnType === undefined ? {} : { returnType }),
    hasColon: match[7] === ":",
  };
}

function fieldNames(variant: { name: string; fields: string[] }): string[] {
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

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }

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

function safeFileName(source: string): string {
  return source.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "case";
}

function normalizeNewlines(source: string): string {
  return source.replaceAll("\r\n", "\n");
}

function indentWidth(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
