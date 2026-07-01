import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import ts from "typescript";
import {
  buildCompilationIR,
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompletedCodeSheet,
  type CompleteFunction,
  lower,
  parse,
  type Runnable,
} from "./codeSheet";

export type RunArtifact = {
  kind: "html";
  content: string;
};

export type TypeScriptExecution =
  | { ok: true; stdout: string; stderr: string; artifacts: RunArtifact[] }
  | { ok: false; code: number | null; stdout: string; stderr: string; artifacts: RunArtifact[] };

export type RunChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type InteractiveRunStatus =
  | { state: "running" }
  | { state: "exited"; code: number | null; signal: NodeJS.Signals | null; error?: string };

export type TypeScriptCompileResult = {
  completed: CompletedCodeSheet;
  program: string;
  artifacts: RunArtifact[];
};

type TypeDecl = {
  name: string;
  target: string;
};

type FieldDecl = {
  name: string;
  type: string;
  defaultValue?: string;
};

type MethodDecl = {
  name: string;
  params: ParamDecl[];
  returnType: string;
};

type ClassDecl = {
  name: string;
  fields: FieldDecl[];
  methods: MethodDecl[];
  completedSource?: string;
};

type FunctionDecl = {
  name: string;
  params: ParamDecl[];
  returnType: string;
  body?: string;
  completedSource?: string;
};

type ParamDecl = {
  name: string;
  type: string;
};

type ParsedTypeScriptSheet = {
  types: TypeDecl[];
  classes: ClassDecl[];
  functions: FunctionDecl[];
};

const artifactPrefix = "__LOGOS_ARTIFACT__";

export async function compileCodeSheetToTypeScript(
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: {
    cache?: CodeCache;
    complete?: CompleteFunction;
  } = {},
): Promise<TypeScriptCompileResult> {
  const cache = options.cache ?? new Map();
  const completedLogos = await completeSheet(cache, codeSheet, options.complete, {
    strategy: "sequential",
  });
  const parsed = parse(completedLogos.source);
  const lowered = lower(parsed);
  const source = buildTypeScriptModule(completedLogos.source);
  const completed: CompletedCodeSheet = {
    source,
    lowered: { ...lowered, source },
    completions: completedLogos.completions,
    ir: { ...buildCompilationIR(parsed), lowered: { ...lowered, source } },
  };
  return {
    completed,
    program: buildTypeScriptProgram(completedLogos.source, runnable),
    artifacts: [],
  };
}

export function buildTypeScriptProgram(codeSheet: CodeSheet, runnable: Runnable): string {
  const module = buildTypeScriptModule(codeSheet);
  return `${module}

const __logosResult = ${runnable}();
if (typeof __logosResult === "string" && looksLikeHtml(__logosResult)) {
  console.log(${JSON.stringify(artifactPrefix)} + JSON.stringify({ kind: "html", content: __logosResult }));
}
`;
}

export function buildTypeScriptModule(codeSheet: CodeSheet): string {
  const parsed = parseTypeScriptSheet(codeSheet);
  const chunks = [
    runtimePrelude(parsed),
    ...parsed.types.map(emitTypeDecl),
    ...parsed.classes.map(emitClassDecl),
    ...parsed.functions.map(emitFunctionDecl),
  ].filter((chunk) => chunk.trim().length > 0);
  return chunks.join("\n\n").trimEnd();
}

export function buildTypeScriptWebPage(_codeSheet: CodeSheet): string | null {
  return null;
}

export function transpileTypeScript(source: string): string {
  typeCheckTypeScript(source);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length > 0) {
    const message = diagnostics.map((diagnostic) => {
      return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    }).join("\n");
    throw new Error(message);
  }
  return result.outputText;
}

function typeCheckTypeScript(source: string): void {
  const fileName = "logos-program.ts";
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    strictPropertyInitialization: false,
    esModuleInterop: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };
  const host = ts.createCompilerHost(compilerOptions);
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requestedFileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (requestedFileName === fileName) {
      return sourceFile;
    }
    return originalGetSourceFile(requestedFileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.readFile = (requestedFileName) => requestedFileName === fileName ? source : ts.sys.readFile(requestedFileName);
  host.fileExists = (requestedFileName) => requestedFileName === fileName || ts.sys.fileExists(requestedFileName);

  const program = ts.createProgram([fileName], compilerOptions, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];
  if (diagnostics.length === 0) {
    return;
  }

  const message = diagnostics.map((diagnostic) => {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  }).join("\n");
  throw new Error(message);
}

export function runTypeScript(
  source: string,
  command = "node",
  onStdoutLine?: (line: string) => void,
): Promise<TypeScriptExecution> {
  return new Promise((resolve) => {
    let javascript: string;
    try {
      javascript = transpileTypeScript(source);
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        artifacts: [],
      });
      return;
    }

    const child = spawn(command, ["-e", javascript], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const artifacts: RunArtifact[] = [];
    const artifactOutput = new ArtifactOutputParser(artifacts);
    let pendingStdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const filtered = artifactOutput.append(chunk.toString("utf8"));
      if (filtered.length > 0) {
        stdout.push(Buffer.from(filtered));
      }
      if (!onStdoutLine) {
        return;
      }

      const text = pendingStdout + filtered;
      const lines = text.split("\n");
      pendingStdout = lines.pop() ?? "";
      for (const line of lines) {
        onStdoutLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message,
        artifacts,
      });
    });
    child.on("close", (code) => {
      const finalStdout = artifactOutput.flush();
      if (finalStdout.length > 0) {
        stdout.push(Buffer.from(finalStdout));
      }
      if (onStdoutLine && pendingStdout.length > 0) {
        onStdoutLine(pendingStdout.endsWith("\r") ? pendingStdout.slice(0, -1) : pendingStdout);
      }

      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ ok: true, stdout: out, stderr: err, artifacts });
      } else {
        resolve({ ok: false, code, stdout: out, stderr: err, artifacts });
      }
    });
  });
}

export class InteractiveTypeScriptRun {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly chunks: RunChunk[] = [];
  private readonly artifacts: RunArtifact[] = [];
  private readonly artifactOutput = new ArtifactOutputParser(this.artifacts);
  private exitStatus: InteractiveRunStatus | null = null;

  constructor(source: string, command = "node") {
    const javascript = transpileTypeScript(source);
    this.child = spawn(command, ["-e", javascript], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      const filtered = this.artifactOutput.append(chunk.toString("utf8"));
      if (filtered.length > 0) {
        this.chunks.push({ stream: "stdout", text: filtered });
      }
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.chunks.push({ stream: "stderr", text: chunk.toString("utf8") });
    });
    this.child.on("error", (error) => {
      this.chunks.push({ stream: "stderr", text: error.message });
      this.exitStatus = {
        state: "exited",
        code: null,
        signal: null,
        error: error.message,
      };
    });
    this.child.on("close", (code, signal) => {
      const filtered = this.artifactOutput.flush();
      if (filtered.length > 0) {
        this.chunks.push({ stream: "stdout", text: filtered });
      }
      this.exitStatus = {
        state: "exited",
        code,
        signal,
        error: this.exitStatus?.state === "exited" ? this.exitStatus.error : undefined,
      };
    });
  }

  writeInput(input: string): boolean {
    if (this.exitStatus?.state === "exited" || this.child.stdin.destroyed) {
      return false;
    }

    try {
      return this.child.stdin.write(input);
    } catch {
      return false;
    }
  }

  drainOutput(): RunChunk[] {
    return this.chunks.splice(0, this.chunks.length);
  }

  drainArtifacts(): RunArtifact[] {
    return this.artifacts.splice(0, this.artifacts.length);
  }

  status(): InteractiveRunStatus {
    return this.exitStatus ?? { state: "running" };
  }

  stop(): void {
    if (this.exitStatus?.state === "exited") {
      return;
    }

    this.child.kill("SIGTERM");
  }
}

function parseTypeScriptSheet(codeSheet: CodeSheet): ParsedTypeScriptSheet {
  const source = normalizeNewlines(codeSheet);
  const lines = source.split("\n");
  const types: TypeDecl[] = [];
  const classes: ClassDecl[] = [];
  const functions: FunctionDecl[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("@logos")) {
      continue;
    }

    const typeMatch = line.match(/^type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;?$/);
    if (typeMatch) {
      types.push({ name: typeMatch[1], target: collectTypeContinuation(lines, index, typeMatch[2]) });
      continue;
    }

    const completedFunction = line.match(/^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (completedFunction) {
      const { block, endIndex } = readBracedSource(lines, index);
      functions.push({
        name: completedFunction[1],
        params: [],
        returnType: "unknown",
        completedSource: block,
      });
      index = endIndex;
      continue;
    }

    const completedClass = line.match(/^class\s+([A-Z][A-Za-z0-9_]*)\b/);
    if (completedClass) {
      const { block, endIndex } = readBracedSource(lines, index);
      const parsedClass = parseClassDeclaration(completedClass[1], classBodyLines(block));
      classes.push({ ...parsedClass, completedSource: classHasImplementedMethods(block) ? block : undefined });
      index = endIndex;
      continue;
    }

    const fn = parseFunctionHeader(line);
    if (fn) {
      if (fn.body !== undefined) {
        const { body, endIndex } = readIndentedBody(lines, index);
        functions.push({ ...fn, body: body.join("\n") });
        index = endIndex;
      } else {
        functions.push(fn);
      }
    }
  }

  return { types, classes, functions };
}

function emitTypeDecl(decl: TypeDecl): string {
  if (decl.name === "WebPage") {
    return "type WebPage = string;";
  }
  return `type ${typeName(decl.name)} = ${typeExpression(decl.target)};`;
}

function emitClassDecl(decl: ClassDecl): string {
  if (decl.completedSource) {
    return decl.completedSource;
  }
  const constructorBody = [
    "    const init = values[0];",
    "    if (values.length === 1 && typeof init === \"object\" && init !== null && !Array.isArray(init)) {",
    "      Object.assign(this, init);",
    "      return;",
    "    }",
    ...decl.fields.map((field, index) => `    if (values.length > ${index}) this.${safeName(field.name)} = values[${index}] as ${normalizeType(field.type)};`),
  ];
  const lines = [
    `class ${typeName(decl.name)} {`,
    ...decl.fields.map((field) => `  ${safeName(field.name)}!: ${normalizeType(field.type)};`),
    "  constructor(...values: unknown[]) {",
    ...constructorBody,
    "  }",
    ...decl.methods.map((method) => {
      const params = method.params.map((param) => `${safeName(param.name)}: ${normalizeType(param.type)}`).join(", ");
      return `  ${method.name}(${params}): ${normalizeType(method.returnType)} {\n    throw new Error("No implementation for ${typeName(decl.name)}.${method.name}");\n  }`;
    }),
    "}",
  ];
  return lines.join("\n");
}

function emitFunctionDecl(fn: FunctionDecl): string {
  if (fn.completedSource) {
    return fn.completedSource;
  }
  const params = fn.params.map((param) => `${safeName(param.name)}: ${normalizeType(param.type)}`).join(", ");
  const returnType = normalizeType(fn.returnType);
  const body = fn.body === undefined ? `throw new Error("No implementation for ${fn.name}");` : lowerBody(fn.body);
  return `function ${fn.name}(${params}): ${returnType} {\n${indent(body)}\n}`;
}

function runtimePrelude(parsed: ParsedTypeScriptSheet): string {
  const needsWebPage = parsed.types.some((type) => type.name === "App" && /\bWebPage\b/.test(type.target)) ||
    parsed.functions.some((fn) => fn.returnType === "App" || fn.returnType === "WebPage");
  return [
    needsWebPage ? "type WebPage = string;" : "",
    `function looksLikeHtml(value: string): boolean {
  return /^\\s*(?:<!doctype\\s+html|<html\\b|<[a-z][\\s\\S]*>)/i.test(value);
}`,
  ].filter(Boolean).join("\n\n");
}

function lowerBody(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let inTemplateLiteral = false;
  for (const raw of lines) {
    if (inTemplateLiteral) {
      output.push(raw);
      if (hasOddUnescapedBackticks(raw)) {
        inTemplateLiteral = false;
      }
      continue;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("```")) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      output.push(`//${trimmed.slice(1)}`);
      continue;
    }
    if (/^(?:const|let|var|return|if|for|while|switch|try|throw|class|function|interface|type)\b/.test(trimmed)) {
      output.push(trimmed);
      if (hasOddUnescapedBackticks(trimmed)) {
        inTemplateLiteral = true;
      }
      continue;
    }
    if (/^[}\])]/.test(trimmed) || /^[A-Za-z_][A-Za-z0-9_]*\s*[).]/.test(trimmed) || trimmed.endsWith(";")) {
      output.push(trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}") ? trimmed : `${trimmed};`);
      continue;
    }
    const assignment = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assignment) {
      output.push(`const ${safeName(assignment[1])} = ${assignment[2].replace(/;$/, "")};`);
      continue;
    }
    output.push(`${trimmed};`);
  }
  return output.join("\n");
}

function hasOddUnescapedBackticks(source: string): boolean {
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "`") {
      continue;
    }
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) {
      count += 1;
    }
  }
  return count % 2 === 1;
}

function typeExpression(target: string): string {
  const normalized = normalizeType(target);
  if (normalized.includes("|")) {
    return splitTopLevel(normalized, "|").map((variant) => {
      const trimmed = variant.trim();
      const constructor = trimmed.match(/^([A-Z][A-Za-z0-9_]*)(?:\((.*)\))?$/);
      if (!constructor) {
        return typeReference(trimmed);
      }
      const fields = constructor[2]?.trim();
      if (!fields) {
        return JSON.stringify(constructor[1]);
      }
      const fieldTypes = splitTopLevel(fields, ",");
      const fieldDecls = fieldTypes.map((field, index) => `field${index}: ${normalizeType(field)}`).join("; ");
      return `{ kind: ${JSON.stringify(constructor[1])}; ${fieldDecls} }`;
    }).join(" | ");
  }
  return typeReference(normalized);
}

function typeReference(source: string): string {
  const trimmed = source.trim();
  if (/^[A-Z][A-Za-z0-9_]*$/.test(trimmed) && !["WebPage"].includes(trimmed)) {
    return typeName(trimmed);
  }
  return trimmed;
}

function parseClassDeclaration(name: string, block: string[]): ClassDecl {
  const fields: FieldDecl[] = [];
  const methods: MethodDecl[] = [];
  for (const raw of block) {
    const line = raw.trim();
    if (line.length === 0 || line === "{" || line === "}") {
      continue;
    }
    const method = parseMethodSignature(line);
    if (method) {
      methods.push(method);
      continue;
    }
    const field = parseField(line);
    if (field) {
      fields.push(field);
    }
  }
  return { name, fields, methods };
}

function parseMethodSignature(line: string): MethodDecl | null {
  const match = line.match(/^(?:fn\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->|:)\s*([^;{]+)\s*;?$/);
  if (!match) return null;
  return {
    name: match[1],
    params: parseParams(match[2]),
    returnType: match[3],
  };
}

function parseFunctionHeader(line: string): FunctionDecl | null {
  const match = line.match(/^(?:fn|function|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*(:?)\s*$/);
  if (!match) return null;
  return {
    name: match[1],
    params: parseParams(match[2]),
    returnType: match[3]?.trim() ?? "void",
    ...(match[4] === ":" ? { body: "" } : {}),
  };
}

function parseParams(source: string): ParamDecl[] {
  return splitTopLevel(source, ",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0 && param !== "self")
    .map((param) => {
      const [name, type] = param.split(":").map((part) => part.trim());
      return { name: safeName(name), type: type ?? "unknown" };
    });
}

function parseField(source: string): FieldDecl | null {
  const trimmed = source.trim().replace(/;$/, "");
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
  if (!match) return null;
  return {
    name: safeName(match[1]),
    type: match[2].trim(),
    ...(match[3] === undefined ? {} : { defaultValue: match[3].trim() }),
  };
}

function normalizeType(type: string): string {
  return type.trim()
    .replace(/;$/, "")
    .replace(/\bint\b|\bfloat\b/g, "number")
    .replace(/\bstr\b/g, "string")
    .replace(/\bbool\b/g, "boolean")
    .replace(/\bNone\b/g, "void")
    .replace(/\blist\[([^\]]+)\]/g, "$1[]")
    .replace(/\btuple\[([^\]]+)\]/g, "[$1]")
    .replace(/\bEvalError\b/g, "LogosEvalError");
}

function collectTypeContinuation(lines: string[], index: number, first: string): string {
  const parts = [first.trim()];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!/^\s+\|/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(" ");
}

function readIndentedBody(lines: string[], startIndex: number): { body: string[]; endIndex: number } {
  const body: string[] = [];
  let endIndex = startIndex;
  for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim().length > 0 && !/^\s+/.test(line)) {
      break;
    }
    body.push(line.replace(/^  /, ""));
    endIndex = cursor;
  }
  return { body, endIndex };
}

function readBracedSource(lines: string[], startIndex: number): { block: string; endIndex: number } {
  let depth = 0;
  for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    depth += countChar(line, "{") - countChar(line, "}");
    if (cursor > startIndex && depth <= 0) {
      return { block: lines.slice(startIndex, cursor + 1).join("\n"), endIndex: cursor };
    }
  }
  return { block: lines.slice(startIndex).join("\n"), endIndex: lines.length - 1 };
}

function classBodyLines(block: string): string[] {
  const lines = block.split("\n");
  return lines.slice(1, -1);
}

function classHasImplementedMethods(block: string): boolean {
  return /\)\s*(?::\s*[^;{]+)?\s*\{/.test(block) || /constructor\s*\([^)]*\)\s*\{/.test(block);
}

class ArtifactOutputParser {
  private pending = "";

  constructor(private readonly artifacts: RunArtifact[]) {}

  append(text: string): string {
    this.pending += text;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.map((line) => this.filterLine(line, "\n")).join("");
  }

  flush(): string {
    if (this.pending.length === 0) {
      return "";
    }
    const line = this.pending;
    this.pending = "";
    return this.filterLine(line, "");
  }

  private filterLine(line: string, suffix: string): string {
    if (!line.startsWith(artifactPrefix)) {
      return `${line}${suffix}`;
    }
    const artifact = parseArtifact(line.slice(artifactPrefix.length));
    if (!artifact) {
      return `${line}${suffix}`;
    }
    this.artifacts.push(artifact);
    return "";
  }
}

function parseArtifact(raw: string): RunArtifact | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RunArtifact>;
    if (parsed.kind === "html" && typeof parsed.content === "string") {
      return { kind: "html", content: parsed.content };
    }
  } catch {
    return null;
  }
  return null;
}

function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === delimiter && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function countChar(source: string, char: string): number {
  let count = 0;
  for (const current of source) {
    if (current === char) count += 1;
  }
  return count;
}

function indent(source: string): string {
  return source.split("\n").map((line) => line.length === 0 ? line : `  ${line}`).join("\n");
}

function safeName(name: string): string {
  return name === "return" ? "returnValue" : name;
}

function typeName(name: string): string {
  return name === "EvalError" ? "LogosEvalError" : name;
}

function normalizeNewlines(source: string): string {
  return source.replaceAll("\r\n", "\n");
}
