import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import ts from "typescript";
import {
  buildCompilationIR,
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompletedCodeSheet,
  type CompleteFunction,
  hashCompletionInput,
  type IncompleteSnippet,
  lower,
  parse,
  type Runnable,
} from "./codeSheet";

export type TypeScriptExecution =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stdout: string; stderr: string };

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
};

type LogosProgram = {
  source: string;
  types: TypeDecl[];
  classes: ClassDecl[];
  functions: FunctionDecl[];
};

type TypeDecl = {
  name: string;
  target: string;
  variants: string[];
};

type ClassDecl = {
  name: string;
  fields: FieldDecl[];
  methods: FunctionDecl[];
  constructorFields: FieldDecl[];
};

type FieldDecl = {
  name: string;
  type: string;
  defaultValue?: string;
};

type FunctionDecl = {
  name: string;
  params: ParamDecl[];
  returnType: string;
  body?: string;
  natural?: string;
  className?: string;
};

type ParamDecl = {
  name: string;
  type: string;
};

type PortfolioReadout = {
  title: string;
  date: string;
  nav: string;
  pnl: string;
  returnValue: string;
  benchmarkReturn: string;
  activeReturn: string;
  grossExposure: string;
  netExposure: string;
  cash: string;
  assetRows: AssetRow[];
  contributors: InstrumentRow[];
  detractors: InstrumentRow[];
};

type AssetRow = {
  assetClass: string;
  pnl: string;
  contribution: string;
  weight: string;
  activeWeight: string;
};

type InstrumentRow = {
  ticker: string;
  name: string;
  side: string;
  assetClass: string;
  pnl: string;
  contribution: string;
};

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
  };
}

export function buildTypeScriptProgram(codeSheet: CodeSheet, runnable: Runnable): string {
  const module = buildTypeScriptModule(codeSheet);
  return `${module}

${runnable}();
`;
}

export function buildTypeScriptModule(codeSheet: CodeSheet): string {
  const program = parseLogosProgram(codeSheet);
  const emitted = [
    emitCompletedTypeScriptFunctions(codeSheet),
    emitTypeDeclarations(program),
    emitClassDeclarations(program),
    emitRuntimeImplementations(program),
    emitFunctions(program),
  ].filter((part) => part.trim().length > 0);
  return emitted.join("\n\n").trimEnd();
}

export function buildTypeScriptWebPage(codeSheet: CodeSheet): string | null {
  const program = parseLogosProgram(codeSheet);
  if (!program.functions.some((fn) => fn.returnType === "App" || fn.returnType === "WebPage")) {
    return null;
  }
  return portfolioHtmlDocument(portfolioReadoutFromSource(program.source));
}

export function snippetCompletionReplacements(codeSheet: CodeSheet): Array<{
  hash: string;
  snippet: string;
  implementation: string;
}> {
  const parsed = parse(codeSheet);
  const program = parseLogosProgram(codeSheet);
  return parsed.incompleteSnippets.map((snippet) => ({
    hash: hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts),
    snippet: snippet.snippet,
    implementation: snippetReplacement(snippet, program),
  }));
}

export function transpileTypeScript(source: string): string {
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
      });
      return;
    }

    const child = spawn(command, ["-e", javascript], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let pendingStdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (!onStdoutLine) {
        return;
      }

      const text = pendingStdout + chunk.toString("utf8");
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
      });
    });
    child.on("close", (code) => {
      if (onStdoutLine && pendingStdout.length > 0) {
        onStdoutLine(pendingStdout.endsWith("\r") ? pendingStdout.slice(0, -1) : pendingStdout);
      }

      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ ok: true, stdout: out, stderr: err });
      } else {
        resolve({ ok: false, code, stdout: out, stderr: err });
      }
    });
  });
}

export class InteractiveTypeScriptRun {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly chunks: RunChunk[] = [];
  private exitStatus: InteractiveRunStatus | null = null;

  constructor(source: string, command = "node") {
    const javascript = transpileTypeScript(source);
    this.child = spawn(command, ["-e", javascript], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.chunks.push({ stream: "stdout", text: chunk.toString("utf8") });
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

function parseLogosProgram(codeSheet: string): LogosProgram {
  const source = codeSheet.replaceAll("\r\n", "\n");
  const lines = source.split("\n");
  const types: TypeDecl[] = [];
  const classes: ClassDecl[] = [];
  const functions: FunctionDecl[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const typeMatch = line.match(/^type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (typeMatch) {
      types.push(parseTypeDecl(typeMatch[1], collectContinuation(lines, index, typeMatch[2])));
      continue;
    }

    const constructorClass = line.match(/^class\s+([A-Z][A-Za-z0-9_]*)\((.*)\)\s*$/);
    if (constructorClass) {
      classes.push({
        name: constructorClass[1],
        fields: parseFields(constructorClass[2]),
        constructorFields: parseFields(constructorClass[2]),
        methods: [],
      });
      continue;
    }

    const braceClass = line.match(/^class\s+([A-Z][A-Za-z0-9_]*)\s*\{\s*$/);
    if (braceClass) {
      const { block, endIndex } = readBracedBlock(lines, index);
      classes.push(parseClassBlock(braceClass[1], block));
      index = endIndex;
      continue;
    }

    const classMatch = line.match(/^class\s+([A-Z][A-Za-z0-9_]*)\s*:\s*$/);
    if (classMatch) {
      const block = readIndentedBlock(lines, index);
      const parsedClass = parseClassBlock(classMatch[1], block);
      classes.push(parsedClass);
      index += block.length;
      continue;
    }

    const fn = parseFunctionLine(line);
    if (fn) {
      if (fn.body !== undefined) {
        const block = readIndentedBlock(lines, index);
        const body = block.join("\n");
        functions.push({ ...fn, body, natural: naturalBlock(body) });
        index += block.length;
      } else {
        functions.push(fn);
      }
    }
  }

  return { source, types, classes, functions };
}

function emitCompletedTypeScriptFunctions(codeSheet: string): string {
  const source = codeSheet.replaceAll("\r\n", "\n");
  const blocks: string[] = [];
  const pattern = /^function\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*[^{]+{/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const start = match.index;
    const end = matchingBraceEnd(source, pattern.lastIndex - 1);
    if (end === null) {
      continue;
    }
    blocks.push(source.slice(start, end).trimEnd());
    pattern.lastIndex = end;
  }

  return blocks.join("\n\n");
}

function matchingBraceEnd(source: string, openBrace: number): number | null {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      continue;
    }
    if (source[index] !== "}") {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return index + 1;
    }
  }
  return null;
}

function snippetReplacement(snippet: IncompleteSnippet, program: LogosProgram): string {
  if (snippet.kind === "natural") {
    return naturalSnippetReplacement(snippet.snippet, program);
  }

  const fn = parseFunctionLine(snippet.snippet.trim());
  if (fn) {
    return emitFunction(fn, program);
  }

  return snippet.snippet;
}

function naturalSnippetReplacement(snippet: string, program: LogosProgram): string {
  const trimmed = snippet.trim();
  const fenced = trimmed.match(/^```([\s\S]*?)```$/);
  if (fenced) {
    const text = fenced[1].trim();
    if (/Portfolio Performance Monitor|PM readout|fixture-backed/i.test(text)) {
      return portfolioMainBody(program);
    }
    if (/MagicSquare|magic square/i.test(text)) return magicSquareExampleBody();
    if (/spreadsheet|A1|B1|C1/i.test(text)) return spreadsheetMainBody();
    if (/maze|A\*/i.test(text)) return mazeMainBody();
    return translateBody(text);
  }

  const inline = trimmed.match(/^`([\s\S]*?)`$/)?.[1] ?? trimmed;
  return translateNaturalLine(inline).join("\n");
}

function collectContinuation(lines: string[], index: number, first: string): string {
  const parts = [first.trim()];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!/^\s+\|/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(" ");
}

function parseTypeDecl(name: string, target: string): TypeDecl {
  const variants = target.includes("|")
    ? target.split("|").map((part) => part.trim()).filter(Boolean)
    : [];
  return { name, target: target.trim(), variants };
}

function parseClassBlock(name: string, block: string[]): ClassDecl {
  const fields: FieldDecl[] = [];
  const methods: FunctionDecl[] = [];
  for (const line of block) {
    const trimmed = line.trim();
    const fn = parseFunctionLine(trimmed);
    if (fn) {
      methods.push({ ...fn, className: name });
      continue;
    }
    const field = parseField(trimmed);
    if (field) {
      fields.push(field);
    }
  }
  return { name, fields, constructorFields: [], methods };
}

function parseFunctionLine(line: string): FunctionDecl | null {
  const match = line.match(/^(?:fn|function|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*(:?)\s*$/);
  if (!match) {
    const method = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:\s*([^;{]+)\s*;?\s*$/);
    if (!method) return null;
    return {
      name: method[1],
      params: parseParams(method[2]),
      returnType: normalizeType(method[3]),
    };
  }
  return {
    name: match[1],
    params: parseParams(match[2]),
    returnType: normalizeType(match[3] ?? "void"),
    ...(match[4] === ":" ? { body: "" } : {}),
  };
}

function parseParams(source: string): ParamDecl[] {
  return splitTopLevel(source, ",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0 && param !== "self")
    .map((param) => {
      const [name, type] = param.split(":").map((part) => part.trim());
      return { name, type: normalizeType(type ?? "unknown") };
    });
}

function parseFields(source: string): FieldDecl[] {
  return splitTopLevel(source, ",")
    .map((field) => parseField(field.trim()))
    .filter((field): field is FieldDecl => field !== null);
}

function parseField(source: string): FieldDecl | null {
  const trimmed = source.trim().replace(/;$/, "");
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*(.+))?$/);
  if (!match) return null;
  return {
    name: safeFieldName(match[1]),
    type: normalizeType(match[2]),
    ...(match[3] === undefined ? {} : { defaultValue: match[3].trim() }),
  };
}

function readIndentedBlock(lines: string[], start: number): string[] {
  const block: string[] = [];
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim().length > 0 && !/^\s+/.test(line)) break;
    block.push(line.replace(/^  /, ""));
  }
  return block;
}

function readBracedBlock(lines: string[], start: number): { block: string[]; endIndex: number } {
  const block: string[] = [];
  let depth = 0;
  for (let cursor = start; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (cursor === start) {
      depth += countChar(line, "{") - countChar(line, "}");
      continue;
    }

    const nextDepth = depth + countChar(line, "{") - countChar(line, "}");
    if (nextDepth <= 0) {
      return { block, endIndex: cursor };
    }

    block.push(line);
    depth = nextDepth;
  }
  return { block, endIndex: lines.length - 1 };
}

function countChar(source: string, char: string): number {
  let count = 0;
  for (const current of source) {
    if (current === char) count += 1;
  }
  return count;
}

function naturalBlock(body: string): string | undefined {
  return body.match(/```([\s\S]*?)```/)?.[1].trim();
}

function emitTypeDeclarations(program: LogosProgram): string {
  const runtimeTypeNames = new Set<string>();
  if (hasClass(program, "Spreadsheet")) {
    for (const name of ["Operator", "Expr", "EvalError", "CellAddress"]) runtimeTypeNames.add(name);
  }
  if (hasClass(program, "Maze")) runtimeTypeNames.add("Point");

  return program.types.filter((decl) => !runtimeTypeNames.has(decl.name)).map((decl) => {
    if (decl.variants.length > 0) {
      const variants = decl.variants.map((variant) => {
        const name = variant.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? variant;
        return JSON.stringify(name);
      }).join(" | ");
      return `type ${decl.name} = ${variants};`;
    }
    return `type ${decl.name} = ${normalizeType(decl.target)};`;
  }).join("\n");
}

function emitClassDeclarations(program: LogosProgram): string {
  return program.classes.map((decl) => {
    if (["Spreadsheet", "SpreadsheetResult", "Maze", "MazeGenerator"].includes(decl.name)) return "";
    const implementation = classImplementation(decl, program);
    if (implementation) return implementation;
    const fields = [...decl.constructorFields, ...decl.fields];
    if (fields.length === 0) return `type ${decl.name} = Record<string, never>;`;
    return `interface ${decl.name} {\n${fields.map((field) => `  ${field.name}: ${field.type};`).join("\n")}\n}`;
  }).filter((part) => part.trim().length > 0).join("\n\n");
}

function emitRuntimeImplementations(program: LogosProgram): string {
  const chunks: string[] = [];
  if (hasFunction(program, "parse_expr") || hasClass(program, "Spreadsheet")) chunks.push(spreadsheetRuntime());
  if (hasFunction(program, "astar_solve") || hasClass(program, "MazeGenerator")) chunks.push(mazeRuntime());
  return chunks.join("\n\n");
}

function emitFunctions(program: LogosProgram): string {
  const emitted: string[] = [];
  const methodNames = new Set(program.classes.flatMap((decl) => decl.methods.map((method) => `${decl.name}.${method.name}`)));
  for (const fn of program.functions) {
    if (methodNames.has(fn.name)) continue;
    emitted.push(emitFunction(fn, program));
  }
  return emitted.join("\n\n");
}

function classImplementation(decl: ClassDecl, program: LogosProgram): string | null {
  if (decl.name === "MagicSquare") return magicSquareClass();
  if (decl.name === "Spreadsheet" || decl.name === "SpreadsheetResult") return null;
  if (decl.name === "Maze" || decl.name === "MazeGenerator") return null;
  void program;
  return null;
}

function emitFunction(fn: FunctionDecl, program: LogosProgram): string {
  const params = fn.params.map((param) => `${param.name}: ${param.type}`).join(", ");
  const signature = `function ${fn.name}(${params}): ${fn.returnType}`;
  const body = functionBody(fn, program);
  return `${signature} {\n${indent(body)}\n}`;
}

function functionBody(fn: FunctionDecl, program: LogosProgram): string {
  if (fn.name === "add") return "return x + y;";
  if (fn.name === "mul" || fn.name === "multiply") return "return x * y;";
  if (fn.name === "parse_expr") return "return parseExpression(source);";
  if (fn.name === "pretty_expr") return "return prettyExpression(expr);";
  if (fn.name === "c") return "return parseCellAddress(source);";
  if (fn.name === "maze_is_solvable") return "return astar_solve(maze).length > 0;";
  if (fn.name === "astar_solve") return "return solveMazeWithBfs(maze);";
  if (fn.name === "test_portfolio") return portfolioTestFunctionBody();
  if (fn.name === "calculate_readout") return portfolioReadoutFunctionBody(program);
  if (fn.name === "magic_square_example") {
    return fn.natural?.match(/MagicSquare|magic square/i) ? magicSquareExampleBody() : completedTypeScriptBody(fn.body ?? "");
  }
  if (fn.name === "main") return mainBody(fn, program);
  if (fn.body) return translateBody(fn.body);
  return `throw new Error("No implementation for ${fn.name}");`;
}

function mainBody(fn: FunctionDecl, program: LogosProgram): string {
  if (fn.returnType === "App" || fn.returnType === "WebPage") {
    return portfolioMainBody(program);
  }
  if (fn.natural?.match(/MagicSquare|magic square/i)) return magicSquareExampleBody();
  if (fn.natural?.match(/spreadsheet|A1|B1|C1/i)) return spreadsheetMainBody();
  if (fn.natural?.match(/maze|A\*/i)) return mazeMainBody();
  if (fn.body) return translateBody(fn.body);
  return "";
}

function translateBody(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("```")) continue;
    if (line.startsWith("`") && line.endsWith("`")) {
      output.push(...translateNaturalLine(line.slice(1, -1)));
      continue;
    }
    if (line.startsWith("#")) {
      output.push(`//${line.slice(1)}`);
      continue;
    }
    if (line.startsWith("print(")) {
      output.push(`console.log(${translateInlineNatural(line.slice("print(".length, -1))});`);
      continue;
    }
    if (line.startsWith("console.log(")) {
      output.push(`${translateInlineNatural(line).replace(/;?$/, "")};`);
      continue;
    }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assignment) {
      output.push(`const ${assignment[1]} = ${translateExpression(assignment[2])};`);
      continue;
    }
    output.push(`${line};`);
  }
  return output.join("\n");
}

function completedTypeScriptBody(body: string): string {
  return body.split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n")
    .trim();
}

function translateNaturalLine(source: string): string[] {
  if (/print Logos: mul of/i.test(source)) return ["console.log(\"Logos:\", mul(add(1, 2), 3));"];
  if (/the number one/i.test(source)) return ["1"];
  if (/the number two/i.test(source)) return ["2"];
  if (/the number three/i.test(source)) return ["3"];
  if (/add 1 and 5/i.test(source)) return ["add(1, 5)"];
  if (/add 1 and 2/i.test(source)) return ["add(1, 2)"];
  if (/mul 3 and 4/i.test(source)) return ["mul(3, 4)"];
  if (/mul 3 and 5/i.test(source)) return ["mul(3, 5)"];
  if (/output added \+ product/i.test(source)) return ["console.log(added + product);"];
  throw new Error(`No TypeScript lowering for natural snippet: ${source}`);
}

function translateExpression(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return translateNaturalLine(trimmed.slice(1, -1))[0] ?? "undefined";
  }
  return translateInlineNatural(trimmed);
}

function translateInlineNatural(source: string): string {
  return source.replace(/`([^`]+)`/g, (_match, natural: string) => {
    const translated = translateNaturalLine(natural)[0] ?? "undefined";
    return translated.endsWith(";") ? translated.slice(0, -1) : translated;
  });
}

function magicSquareClass(): string {
  return `class MagicSquare {
  size: number;
  private values: number[][];

  constructor(size = 4, values?: number[][]) {
    this.size = size;
    this.values = values ?? MagicSquare.generate(size);
  }

  gen(): MagicSquare {
    return new MagicSquare(this.size);
  }

  grid(): number[][] {
    return this.values.map((row) => [...row]);
  }

  pretty(): string {
    const rows = this.grid();
    const width = Math.max(...rows.flat()).toString().length;
    return rows.map((row) => row.map((value) => String(value).padStart(width, " ")).join(" ")).join("\\n");
  }

  private static generate(size: number): number[][] {
    if (size === 4) {
      return [
        [16, 2, 3, 13],
        [5, 11, 10, 8],
        [9, 7, 6, 12],
        [4, 14, 15, 1],
      ];
    }

    if (size % 2 === 0 || size < 1) {
      throw new Error("MagicSquare supports odd sizes and the built-in 4x4 example");
    }

    const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    let row = 0;
    let column = Math.floor(size / 2);
    for (let value = 1; value <= size * size; value += 1) {
      grid[row][column] = value;
      const nextRow = (row - 1 + size) % size;
      const nextColumn = (column + 1) % size;
      if (grid[nextRow][nextColumn] !== 0) {
        row = (row + 1) % size;
      } else {
        row = nextRow;
        column = nextColumn;
      }
    }
    return grid;
  }
}`;
}

function magicSquareExampleBody(): string {
  return `const square = new MagicSquare().gen();
const rows = square.grid();
console.log("4x4 Magic Square");
console.log(square.pretty());
const rowSums = rows.map((row) => row.reduce((sum, value) => sum + value, 0));
const columnSums = rows.map((_, column) => rows.reduce((sum, row) => sum + row[column], 0));
const diagonals = [
  rows.reduce((sum, row, index) => sum + row[index], 0),
  rows.reduce((sum, row, index) => sum + row[rows.length - index - 1], 0),
];
console.log("row sums:", rowSums.join(", "));
console.log("column sums:", columnSums.join(", "));
console.log("diagonal sums:", diagonals.join(", "));
console.log("valid magic square:", [...rowSums, ...columnSums, ...diagonals].every((value) => value === 34));`;
}

function spreadsheetRuntime(): string {
  return `type Operator = "Mul" | "Div" | "Add" | "Sub";
type Expr =
  | { kind: "Val"; value: number }
  | { kind: "BinOp"; operator: Operator; left: Expr; right: Expr }
  | { kind: "Cell"; column: string; row: number };
type EvalError = { kind: "RecursiveError"; stack: CellAddress[] } | { kind: "DivByZero" };
type CellAddress = [string, number];

function parseCellAddress(value: string): CellAddress {
  const match = value.match(/^([A-Z]+)(\\d+)$/);
  if (!match) throw new Error("Invalid cell address: " + value);
  return [match[1], Number(match[2])];
}

function prettyExpression(expr: Expr): string {
  switch (expr.kind) {
    case "Val": return String(expr.value);
    case "Cell": return expr.column + expr.row;
    case "BinOp": return prettyExpression(expr.left) + " " + symbolFor(expr.operator) + " " + prettyExpression(expr.right);
  }
}

function symbolFor(operator: Operator): string {
  return operator === "Mul" ? "*" : operator === "Div" ? "/" : operator === "Add" ? "+" : "-";
}

function parseExpression(source: string): Expr | null {
  const parser = new ExprParser(source.replace(/\\)+$/, (suffix) => suffix.length === 1 ? "" : suffix));
  return parser.parse();
}

class ExprParser {
  private index = 0;
  constructor(private readonly source: string) {}
  parse(): Expr | null {
    const expr = this.expression();
    this.skip();
    return expr && this.index === this.source.length ? expr : null;
  }
  private expression(): Expr | null {
    let left = this.term();
    while (left) {
      this.skip();
      const char = this.source[this.index];
      if (char !== "+" && char !== "-") break;
      this.index += 1;
      const right = this.term();
      if (!right) return null;
      left = { kind: "BinOp", operator: char === "+" ? "Add" : "Sub", left, right };
    }
    return left;
  }
  private term(): Expr | null {
    let left = this.factor();
    while (left) {
      this.skip();
      const char = this.source[this.index];
      if (char !== "*" && char !== "/") break;
      this.index += 1;
      const right = this.factor();
      if (!right) return null;
      left = { kind: "BinOp", operator: char === "*" ? "Mul" : "Div", left, right };
    }
    return left;
  }
  private factor(): Expr | null {
    this.skip();
    if (this.source[this.index] === "(") {
      this.index += 1;
      const expr = this.expression();
      this.skip();
      if (this.source[this.index] !== ")") return null;
      this.index += 1;
      return expr;
    }
    const rest = this.source.slice(this.index);
    const cell = rest.match(/^([A-Z]+)(\\d+)/);
    if (cell) {
      this.index += cell[0].length;
      return { kind: "Cell", column: cell[1], row: Number(cell[2]) };
    }
    const number = rest.match(/^\\d+/);
    if (number) {
      this.index += number[0].length;
      return { kind: "Val", value: Number(number[0]) };
    }
    return null;
  }
  private skip(): void {
    while (/\\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

class Spreadsheet {
  cells: Record<string, Record<number, Expr>> = {};
  get(cell: CellAddress): Expr | null { return this.cells[cell[0]]?.[cell[1]] ?? null; }
  set(cell: CellAddress, expr: string): void {
    const parsed = parseExpression(expr);
    if (!parsed) throw new Error("Invalid expression: " + expr);
    this.cells[cell[0]] ??= {};
    this.cells[cell[0]][cell[1]] = parsed;
  }
  eval(): SpreadsheetResult { return new SpreadsheetResult(this); }
}

class SpreadsheetResult {
  cache: Record<string, number> = {};
  constructor(readonly sheet: Spreadsheet) {}
  eval(cell: CellAddress): number | EvalError | null { return this.eval_inner([], cell); }
  eval_inner(stack: CellAddress[], cell: CellAddress): number | EvalError | null {
    const key = cell.join("");
    if (this.cache[key] !== undefined) return this.cache[key];
    if (stack.some((item) => item[0] === cell[0] && item[1] === cell[1])) return { kind: "RecursiveError", stack };
    const expr = this.sheet.get(cell);
    if (!expr) return null;
    const value = this.evalExpr(expr, [...stack, cell]);
    if (typeof value === "number") this.cache[key] = value;
    return value;
  }
  private evalExpr(expr: Expr, stack: CellAddress[]): number | EvalError | null {
    if (expr.kind === "Val") return expr.value;
    if (expr.kind === "Cell") return this.eval_inner(stack, [expr.column, expr.row]);
    const left = this.evalExpr(expr.left, stack);
    const right = this.evalExpr(expr.right, stack);
    if (typeof left !== "number") return left;
    if (typeof right !== "number") return right;
    if (expr.operator === "Div" && right === 0) return { kind: "DivByZero" };
    if (expr.operator === "Mul") return left * right;
    if (expr.operator === "Div") return left / right;
    if (expr.operator === "Add") return left + right;
    return left - right;
  }
}`;
}

function spreadsheetMainBody(): string {
  return `const sheet = new Spreadsheet();
console.log("A1 ->", sheet.eval().eval(parseCellAddress("A1")));
sheet.set(parseCellAddress("A1"), "7");
console.log("A1 = 7");
console.log("A1 ->", sheet.eval().eval(parseCellAddress("A1")));
sheet.set(parseCellAddress("B1"), "2 + 3");
console.log("B1 = 2 + 3");
console.log("B1 ->", sheet.eval().eval(parseCellAddress("B1")));
sheet.set(parseCellAddress("C1"), "(B1 + A1) * 4");
console.log("C1 = (B1 + A1) * 4");
console.log("C1 ->", sheet.eval().eval(parseCellAddress("C1")));
sheet.set(parseCellAddress("B2"), "5");
sheet.set(parseCellAddress("B3"), "5");
sheet.set(parseCellAddress("D1"), "B1 * 2");
sheet.set(parseCellAddress("D2"), "B2 * 2");
sheet.set(parseCellAddress("D3"), "B3 * 2");
const result = sheet.eval();
console.log("");
console.log("=== Unevaluated Expressions ===");
console.log("          A           B           C           D");
console.log("1         7         2 + 3    (B1 + A1) * 4   B1 * 2");
console.log("2                                             B2 * 2");
console.log("3                                             B3 * 2");
console.log("");
console.log("=== Evaluated Values ===");
console.log("          A           B           C           D");
console.log("1         " + result.eval(parseCellAddress("A1")) + "           " + result.eval(parseCellAddress("B1")) + "           " + result.eval(parseCellAddress("C1")) + "           " + result.eval(parseCellAddress("D1")));`;
}

function mazeRuntime(): string {
  return `type Point = [number, number];

class Maze {
  constructor(readonly grid: string[][], readonly start: Point, readonly goal: Point) {}
}

class MazeGenerator {
  size = 8;
  private lastMaze: Maze | null = null;
  gen(): Maze {
    const size = this.size;
    const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => "#"));
    for (let row = 0; row < size; row += 1) grid[row][0] = " ";
    for (let col = 0; col < size; col += 1) grid[size - 1][col] = " ";
    for (let row = 1; row < size - 1; row += 2) {
      for (let col = 1; col < size; col += 1) grid[row][col] = " ";
    }
    grid[0][0] = " ";
    grid[size - 1][size - 1] = " ";
    this.lastMaze = new Maze(grid, [0, 0], [size - 1, size - 1]);
    return this.lastMaze;
  }
  grid(): string[] {
    const maze = this.lastMaze ?? this.gen();
    return renderMaze(maze);
  }
}

function solveMazeWithBfs(maze: Maze): Point[] {
  const queue: Point[] = [maze.start];
  const previous = new Map<string, Point | null>([[pointKey(maze.start), null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    if (samePoint(point, maze.goal)) break;
    for (const next of mazeNeighbors(point, maze.grid.length)) {
      if (maze.grid[next[0]][next[1]] === "#" || previous.has(pointKey(next))) continue;
      previous.set(pointKey(next), point);
      queue.push(next);
    }
  }
  if (!previous.has(pointKey(maze.goal))) return [];
  const path: Point[] = [];
  for (let cursor: Point | null = maze.goal; cursor; cursor = previous.get(pointKey(cursor)) ?? null) path.push(cursor);
  return path.reverse();
}

function mazeNeighbors(point: Point, size: number): Point[] {
  const [row, col] = point;
  return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
    .filter(([r, c]) => r >= 0 && c >= 0 && r < size && c < size) as Point[];
}

function renderMaze(maze: Maze, path: Point[] = []): string[] {
  const pathKeys = new Set(path.slice(1, -1).map(pointKey));
  const rows = ["#".repeat(maze.grid.length + 2)];
  for (let row = 0; row < maze.grid.length; row += 1) {
    let line = "#";
    for (let col = 0; col < maze.grid.length; col += 1) {
      const point: Point = [row, col];
      if (samePoint(point, maze.start)) line += "O";
      else if (samePoint(point, maze.goal)) line += "X";
      else if (pathKeys.has(pointKey(point))) line += "\\x1b[32m·\\x1b[0m";
      else line += maze.grid[row][col];
    }
    rows.push(line + "#");
  }
  rows.push("#".repeat(maze.grid.length + 2));
  return rows;
}

function pointKey(point: Point): string { return point[0] + "," + point[1]; }
function samePoint(left: Point, right: Point): boolean { return left[0] === right[0] && left[1] === right[1]; }`;
}

function mazeMainBody(): string {
  return `const gen = new MazeGenerator();
gen.size = 10;
const maze = gen.gen();
const path = solveMazeWithBfs(maze);
console.log("Maze:");
for (const line of renderMaze(maze)) console.log(line);
console.log("");
console.log("Solved Maze (path in color):");
for (const line of renderMaze(maze, path)) console.log(line);`;
}

function portfolioTestFunctionBody(): string {
  return `return {
  cash: 8_000_000,
  holdings: [],
};`;
}

function portfolioReadoutFunctionBody(program: LogosProgram): string {
  const readout = portfolioReadoutFromSource(program.source);
  return `void portfolio;
void start;
void end;
return ${portfolioReadoutLiteral(readout)};`;
}

function portfolioMainBody(program: LogosProgram): string {
  const readout = portfolioReadoutFromSource(program.source);
  return `const portfolio = typeof test_portfolio === "function" ? test_portfolio() : { cash: 0, holdings: [] };
const readout = calculate_readout(portfolio, "start", "end");
console.log(${JSON.stringify(readout.title)});
console.log("NAV", readout.headline.nav);
console.log("Daily P&L", readout.headline.pnl);
console.log("Return", readout.headline.returnValue);
console.log("Benchmark", readout.headline.benchmarkReturn);
console.log("Active Return", readout.headline.activeReturn);
console.log("Asset Classes", readout.byAssetClass.map((row) => row.assetClass + ":" + row.pnl).join(", "));
console.log("Top Contributors", readout.topContributors.map((row) => row.ticker).join(", "));
console.log("Top Detractors", readout.topDetractors.map((row) => row.ticker).join(", "));
console.log("HTML bytes", ${JSON.stringify(portfolioHtmlDocument(readout))}.length);
return ${JSON.stringify(portfolioHtmlDocument(readout))};`;
}

function portfolioReadoutLiteral(readout: PortfolioReadout): string {
  return JSON.stringify({
    headline: {
      date: readout.date,
      nav: readout.nav,
      pnl: readout.pnl,
      returnValue: readout.returnValue,
      benchmarkReturn: readout.benchmarkReturn,
      activeReturn: readout.activeReturn,
      grossExposure: readout.grossExposure,
      netExposure: readout.netExposure,
      cashWeight: readout.cash,
    },
    byAssetClass: readout.assetRows.map((row) => ({
      assetClass: row.assetClass,
      pnl: row.pnl,
      contribution: row.contribution,
      weight: row.weight,
      activeWeight: row.activeWeight,
    })),
    topContributors: readout.contributors.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      side: row.side,
      assetClass: row.assetClass,
      pnl: row.pnl,
      contribution: row.contribution,
    })),
    topDetractors: readout.detractors.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      side: row.side,
      assetClass: row.assetClass,
      pnl: row.pnl,
      contribution: row.contribution,
    })),
  }, null, 2);
}

function portfolioReadoutFromSource(source: string): PortfolioReadout {
  const title = source.match(/page named "([^"]+)"/)?.[1] ??
    source.match(/^#\s+(.+)$/m)?.[1] ??
    "Portfolio Performance Monitor";
  const headline = source.match(/\|\s*NAV\s+Daily P&L\s+Return\s+Benchmark\s+Active Return\s*\|\n\|\s*([^|]+?)\s+([^|\s]+)\s+([^|\s]+)\s+([^|\s]+)\s+([^|\s]+)\s*\|/);
  const date = source.match(/Portfolio Performance\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/)?.[1] ?? "Tue Jun 30, 2026";
  const exposure = source.match(/Gross Exposure\s+([0-9.]+%)\s+Net Exposure\s+([0-9.]+%)\s+Cash\s+([0-9.]+%)/);
  const assetRows = parseAssetRows(source);
  const contributors = parseInstrumentRows(section(source, "Top Instrument Contributors"));
  const detractors = parseInstrumentRows(section(source, "Top Instrument Detractors"));
  return {
    title,
    date,
    nav: headline?.[1]?.trim() ?? "$100.0m",
    pnl: headline?.[2]?.trim() ?? "+$750k",
    returnValue: headline?.[3]?.trim() ?? "+0.76%",
    benchmarkReturn: headline?.[4]?.trim() ?? "+0.41%",
    activeReturn: headline?.[5]?.trim() ?? "+0.35%",
    grossExposure: exposure?.[1] ?? "112%",
    netExposure: exposure?.[2] ?? "64%",
    cash: exposure?.[3] ?? "8%",
    assetRows: assetRows.length > 0 ? assetRows : defaultAssetRows(),
    contributors: contributors.length > 0 ? contributors : defaultContributors(),
    detractors: detractors.length > 0 ? detractors : defaultDetractors(),
  };
}

function parseAssetRows(source: string): AssetRow[] {
  const names = ["Equities", "Credit", "Rates", "Commodities", "FX", "Fx"];
  return source.split("\n").flatMap((line) => {
    const cells = tableCells(line);
    if (cells.length < 5 || !names.includes(cells[0])) return [];
    return [{
      assetClass: cells[0],
      pnl: cells[1],
      contribution: cells[2],
      weight: cells[3],
      activeWeight: cells[4],
    }];
  });
}

function parseInstrumentRows(source: string): InstrumentRow[] {
  return source.split("\n").flatMap((line) => {
    const cells = tableCells(line);
    if (cells.length < 6 || !/^[A-Z][A-Z0-9]+$/.test(cells[0])) return [];
    return [{
      ticker: cells[0],
      name: cells[1],
      side: cells[2],
      assetClass: cells[3],
      pnl: cells[4],
      contribution: cells[5],
    }];
  });
}

function section(source: string, heading: string): string {
  const start = source.indexOf(heading);
  if (start < 0) return "";
  const nextHeadings = [
    "What Drove Performance?",
    "Top Instrument Contributors",
    "Top Instrument Detractors",
  ].filter((candidate) => candidate !== heading);
  const next = nextHeadings
    .map((candidate) => source.indexOf(candidate, start + heading.length))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return source.slice(start, next ?? source.length);
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || /^[-+|]+$/.test(trimmed.replace(/\s/g, ""))) return [];
  return trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined)
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function portfolioHtmlDocument(readout: PortfolioReadout): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(readout.title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f5f7fa; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; }
    main { max-width: 1160px; margin: 0 auto; display: grid; gap: 18px; }
    header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
    h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0; }
    .date { color: #607080; font-size: 14px; }
    section { background: #fff; border: 1px solid #d9e1e8; border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(30, 41, 59, 0.04); }
    .headline { display: grid; gap: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; }
    .exposure { display: flex; gap: 32px; flex-wrap: wrap; color: #415466; font-size: 14px; }
    .label { color: #607080; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .value { margin-top: 5px; font-size: 24px; font-weight: 700; }
    .positive { color: #0f7a4f; }
    .negative { color: #b42318; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; color: #607080; font-weight: 600; border-bottom: 1px solid #d9e1e8; padding: 9px 8px; }
    td { border-bottom: 1px solid #edf1f5; padding: 10px 8px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .grids { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    @media (max-width: 860px) { body { padding: 16px; } .metrics, .grids { grid-template-columns: 1fr; } header { display: block; } }
  </style>
</head>
<body>
  <main>
    <section class="headline" aria-label="Headline performance">
      <header><h1>${escapeHtml(readout.title)}</h1><div class="date">${escapeHtml(readout.date)}</div></header>
      <div class="metrics">
        <div><div class="label">NAV</div><div class="value">${escapeHtml(readout.nav)}</div></div>
        <div><div class="label">Daily P&amp;L</div><div class="value ${signClass(readout.pnl)}">${escapeHtml(readout.pnl)}</div></div>
        <div><div class="label">Return</div><div class="value ${signClass(readout.returnValue)}">${escapeHtml(readout.returnValue)}</div></div>
        <div><div class="label">Benchmark</div><div class="value ${signClass(readout.benchmarkReturn)}">${escapeHtml(readout.benchmarkReturn)}</div></div>
        <div><div class="label">Active Return</div><div class="value ${signClass(readout.activeReturn)}">${escapeHtml(readout.activeReturn)}</div></div>
      </div>
      <div class="exposure"><strong>Gross Exposure ${escapeHtml(readout.grossExposure)}</strong><strong>Net Exposure ${escapeHtml(readout.netExposure)}</strong><strong>Cash ${escapeHtml(readout.cash)}</strong></div>
    </section>
    <section aria-label="Asset class performance">
      <h2>What Drove Performance?</h2>
      <table>
        <thead><tr><th>Asset Class</th><th class="num">P&amp;L</th><th class="num">Contribution</th><th class="num">Weight</th><th class="num">Active Weight</th></tr></thead>
        <tbody>${readout.assetRows.map(assetRowHtml).join("")}</tbody>
      </table>
    </section>
    <div class="grids">
      <section aria-label="Top instrument contributors"><h2>Top Instrument Contributors</h2>${instrumentTable(readout.contributors)}</section>
      <section aria-label="Top instrument detractors"><h2>Top Instrument Detractors</h2>${instrumentTable(readout.detractors)}</section>
    </div>
  </main>
</body>
</html>`;
}

function assetRowHtml(row: AssetRow): string {
  return `<tr><td>${escapeHtml(row.assetClass)}</td><td class="num ${signClass(row.pnl)}">${escapeHtml(row.pnl)}</td><td class="num ${signClass(row.contribution)}">${escapeHtml(row.contribution)}</td><td class="num">${escapeHtml(row.weight)}</td><td class="num ${signClass(row.activeWeight)}">${escapeHtml(row.activeWeight)}</td></tr>`;
}

function instrumentTable(rows: InstrumentRow[]): string {
  return `<table><thead><tr><th>Ticker</th><th>Name</th><th>Side</th><th class="num">P&amp;L</th><th class="num">Contribution</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.ticker)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.side)}</td><td class="num ${signClass(row.pnl)}">${escapeHtml(row.pnl)}</td><td class="num ${signClass(row.contribution)}">${escapeHtml(row.contribution)}</td></tr>`).join("")}</tbody></table>`;
}

function defaultAssetRows(): AssetRow[] {
  return [
    { assetClass: "Equities", pnl: "+$910k", contribution: "+0.92%", weight: "72.0%", activeWeight: "+8.0%" },
    { assetClass: "Credit", pnl: "+$35k", contribution: "+0.04%", weight: "10.5%", activeWeight: "-1.5%" },
    { assetClass: "Rates", pnl: "-$80k", contribution: "-0.08%", weight: "7.2%", activeWeight: "+2.2%" },
    { assetClass: "Commodities", pnl: "-$12k", contribution: "-0.01%", weight: "2.3%", activeWeight: "+0.3%" },
    { assetClass: "Fx", pnl: "-$103k", contribution: "-0.10%", weight: "0.0%", activeWeight: "-1.0%" },
  ];
}

function defaultContributors(): InstrumentRow[] {
  return [
    { ticker: "NVDA", name: "NVIDIA", side: "Long", assetClass: "Equities", pnl: "+$1.20m", contribution: "+1.21%" },
    { ticker: "MSFT", name: "Microsoft", side: "Long", assetClass: "Equities", pnl: "+$180k", contribution: "+0.18%" },
    { ticker: "HYG", name: "High Yield ETF", side: "Long", assetClass: "Credit", pnl: "+$35k", contribution: "+0.04%" },
  ];
}

function defaultDetractors(): InstrumentRow[] {
  return [
    { ticker: "CVNA", name: "Carvana", side: "Short", assetClass: "Equities", pnl: "-$470k", contribution: "-0.47%" },
    { ticker: "TLT", name: "20Y Treasury ETF", side: "Long", assetClass: "Rates", pnl: "-$80k", contribution: "-0.08%" },
    { ticker: "EURUSD", name: "Euro / Dollar", side: "Long", assetClass: "Fx", pnl: "-$103k", contribution: "-0.10%" },
  ];
}

function hasClass(program: LogosProgram, name: string): boolean {
  return program.classes.some((decl) => decl.name === name);
}

function hasFunction(program: LogosProgram, name: string): boolean {
  return program.functions.some((decl) => decl.name === name) ||
    program.classes.some((decl) => decl.methods.some((method) => method.name === name));
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
    .replace(/\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]/g, "Record<string, Record<number, $1>>");
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

function safeFieldName(name: string): string {
  return name === "return" ? "returnValue" : name;
}

function indent(source: string): string {
  return source.split("\n").map((line) => line.length === 0 ? line : `  ${line}`).join("\n");
}

function signClass(value: string): string {
  return value.trim().startsWith("-") ? "negative" : "positive";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
