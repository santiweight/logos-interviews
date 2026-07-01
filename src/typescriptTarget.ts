import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import ts from "typescript";
import {
  buildCompilationIR,
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type CompilationStrategy,
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
    strategy?: CompilationStrategy;
  } = {},
): Promise<TypeScriptCompileResult> {
  const cache = options.cache ?? new Map();
  const completedLogos = await completeSheet(cache, codeSheet, options.complete, {
    strategy: options.strategy ?? "sequential",
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
      if (line.includes("{")) {
        const { block, endIndex } = readBracedSource(lines, index);
        const parsedFunction = parseFunctionHeader(line);
        functions.push({
          name: completedFunction[1],
          params: [],
          returnType: parsedFunction?.returnType ?? "unknown",
          completedSource: block,
        });
        index = endIndex;
        continue;
      }
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
      if (line.includes("{")) {
        const { block, endIndex } = readBracedSource(lines, index);
        const body = classBodyLines(block);
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
    needsWebPage ? shadcnRuntimePrelude() : "",
    `function looksLikeHtml(value: string): boolean {
  return /^\\s*(?:<!doctype\\s+html|<html\\b|<[a-z][\\s\\S]*>)/i.test(value);
}`,
  ].filter(Boolean).join("\n\n");
}

function shadcnRuntimePrelude(): string {
  return `type ShadcnChild = unknown;
type ShadcnProps = {
  className?: string;
  children?: ShadcnChild;
  id?: string;
  type?: string;
  onClick?: string;
  onclick?: string;
  [key: string]: unknown;
};

const shadcn = (() => {
  const baseCss = \`
    :root {
      color-scheme: light;
      --background: #f7f7f8;
      --foreground: #18181b;
      --card: #ffffff;
      --card-foreground: #18181b;
      --muted: #f4f4f5;
      --muted-foreground: #71717a;
      --border: #e4e4e7;
      --primary: #18181b;
      --primary-foreground: #fafafa;
      --ring: rgba(24, 24, 27, 0.18);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--background); color: var(--foreground); font-family: inherit; }
    .logos-page { max-width: 1120px; margin: 0 auto; padding: 32px; }
    .logos-page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
    .logos-page-title { margin: 0; font-size: 24px; font-weight: 720; letter-spacing: 0; }
    .logos-page-description { margin: 6px 0 0; color: var(--muted-foreground); font-size: 14px; }
    .logos-card { border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--card-foreground); box-shadow: 0 1px 2px rgba(24, 24, 27, 0.04); }
    .logos-card-header { display: grid; gap: 4px; padding: 18px 20px 0; }
    .logos-card-title { margin: 0; font-size: 16px; font-weight: 680; }
    .logos-card-description { margin: 0; color: var(--muted-foreground); font-size: 13px; }
    .logos-card-content { padding: 20px; }
    .logos-button { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; border: 1px solid transparent; border-radius: 6px; background: var(--primary); color: var(--primary-foreground); cursor: pointer; font: inherit; font-size: 14px; font-weight: 620; padding: 0 14px; text-decoration: none; transition: background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
    .logos-button:hover { background: #27272a; }
    .logos-button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
    .logos-button:active { transform: translateY(1px); }
    .logos-button-secondary { border-color: var(--border); background: #ffffff; color: var(--foreground); }
    .logos-button-secondary:hover { background: var(--muted); }
    .logos-stack { display: grid; gap: 16px; }
    .logos-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .logos-metric { font-variant-numeric: tabular-nums; font-size: 42px; font-weight: 760; letter-spacing: 0; line-height: 1; }
    .logos-muted { color: var(--muted-foreground); }
  \`;

  const classNames = (...values: Array<string | undefined | false | null>): string => values.filter(Boolean).join(" ");
  const escapeHtml = (value: unknown): string => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const escapeAttribute = (value: unknown): string => escapeHtml(value).replaceAll("'", "&#39;");
  const renderChild = (child: ShadcnChild): string => {
    if (Array.isArray(child)) return child.map(renderChild).join("");
    if (child === null || child === undefined || child === false) return "";
    return String(child);
  };
  const renderChildren = (children: ShadcnChild[]): string => children.map(renderChild).join("");
  const isProps = (value: ShadcnChild): value is ShadcnProps =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const normalizeArgs = (args: ShadcnChild[]): { props: ShadcnProps; children: ShadcnChild[] } =>
    args.length > 0 && isProps(args[0])
      ? { props: args[0], children: args.slice(1) }
      : { props: {}, children: args };
  const attrs = (props: ShadcnProps): string => Object.entries(props)
    .filter(([key, value]) => key !== "children" && value !== undefined && value !== null && value !== false)
    .map(([key, value]) => {
      const attr = key === "className" ? "class" : key === "onClick" ? "onclick" : key;
      return value === true ? attr : \`\${attr}="\${escapeAttribute(value)}"\`;
    })
    .join(" ");
  const element = (tag: string, props: ShadcnProps = {}, ...children: ShadcnChild[]): string => {
    const inner = renderChildren(children.length > 0 ? children : [props.children]);
    const attr = attrs(props);
    return \`<\${tag}\${attr.length > 0 ? \` \${attr}\` : ""}>\${inner}</\${tag}>\`;
  };
  const component = (tag: string, baseClass: string) => (...args: ShadcnChild[]): string => {
    const { props, children } = normalizeArgs(args);
    return element(tag, { ...props, className: classNames(baseClass, props.className) }, ...children);
  };
  const buttonComponent = (baseClass: string) => (...args: ShadcnChild[]): string => {
    const { props, children } = normalizeArgs(args);
    return element("button", { type: "button", ...props, className: classNames(baseClass, props.className) }, ...children);
  };

  return {
    cn: classNames,
    html: escapeHtml,
    Div: component("div", ""),
    Span: component("span", ""),
    Text: component("p", "logos-muted"),
    Button: buttonComponent("logos-button"),
    SecondaryButton: buttonComponent("logos-button logos-button-secondary"),
    Card: component("section", "logos-card"),
    CardHeader: component("div", "logos-card-header"),
    CardTitle: component("h2", "logos-card-title"),
    CardDescription: component("p", "logos-card-description"),
    CardContent: component("div", "logos-card-content"),
    Metric: component("div", "logos-metric"),
    Row: component("div", "logos-row"),
    Stack: component("div", "logos-stack"),
    Page: (...args: ShadcnChild[]) => {
      const { props, children } = normalizeArgs(args);
      const header = props.title || props.description
        ? element("header", { className: "logos-page-header" },
          element("div", {},
            props.title ? element("h1", { className: "logos-page-title" }, escapeHtml(props.title)) : "",
            props.description ? element("p", { className: "logos-page-description" }, escapeHtml(props.description)) : "",
          ),
        )
        : "";
      return element("main", { ...props, className: classNames("logos-page", props.className) }, header, ...(children.length > 0 ? children : [props.children]));
    },
    Script: (source: string) => \`<script>\${source}</script>\`,
    renderApp: (body: ShadcnChild, options: { title?: string; scripts?: string[]; styles?: string } = {}): WebPage => \`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>\${escapeHtml(options.title ?? "Logos App")}</title>
  <style data-shadcn-runtime="true">\${baseCss}\${options.styles ?? ""}</style>
</head>
<body>
  \${renderChildren([body])}
  \${(options.scripts ?? []).map((script) => \`<script>\${script}</script>\`).join("\\n")}
</body>
</html>\`,
  };
})();`;
}

function lowerBody(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let inTemplateLiteral = false;
  let continuationDepth = 0;
  for (const raw of lines) {
    if (inTemplateLiteral) {
      output.push(raw);
      continuationDepth += bracketDelta(raw);
      if (hasOddUnescapedBackticks(raw)) {
        inTemplateLiteral = false;
      }
      continue;
    }

    const trimmed = raw.trim();
    if (continuationDepth > 0) {
      output.push(trimmed);
      continuationDepth = Math.max(0, continuationDepth + bracketDelta(trimmed));
      if (hasOddUnescapedBackticks(trimmed)) {
        inTemplateLiteral = true;
      }
      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("```")) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      output.push(`//${trimmed.slice(1)}`);
      continue;
    }
    if (/^(?:const|let|var|return|if|for|while|switch|try|throw|class|function|interface|type)\b/.test(trimmed)) {
      output.push(trimmed);
      continuationDepth = Math.max(0, bracketDelta(trimmed));
      if (hasOddUnescapedBackticks(trimmed)) {
        inTemplateLiteral = true;
      }
      continue;
    }
    if (/^[}\])]/.test(trimmed) || /^[A-Za-z_][A-Za-z0-9_]*\s*[).]/.test(trimmed) || trimmed.endsWith(";")) {
      output.push(trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}") ? trimmed : `${trimmed};`);
      continuationDepth = Math.max(0, bracketDelta(trimmed));
      continue;
    }
    const assignment = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assignment) {
      output.push(`const ${safeName(assignment[1])} = ${assignment[2].replace(/;$/, "")};`);
      continuationDepth = Math.max(0, bracketDelta(trimmed));
      continue;
    }
    output.push(`${trimmed};`);
    continuationDepth = Math.max(0, bracketDelta(trimmed));
  }
  return output.join("\n");
}

function bracketDelta(source: string): number {
  let delta = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") delta += 1;
    if (char === ")" || char === "]" || char === "}") delta -= 1;
  }
  return delta;
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
  const match = line.match(/^(?:(?:fn)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^;{]+))?|(?:function)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?)\s*(?:;|\{)?\s*$/);
  if (!match) return null;
  const isFn = match[1] !== undefined;
  return {
    name: isFn ? match[1] : match[4],
    params: parseParams(isFn ? match[2] : match[5]),
    returnType: (isFn ? match[3] : match[6])?.trim() ?? "void",
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
