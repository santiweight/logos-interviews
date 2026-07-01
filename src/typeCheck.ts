import type { ParsedSheet } from "./codeSheet";

export type TypeCheckSeverity = "error" | "warning";

export type TypeCheckDiagnostic = {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: TypeCheckSeverity;
  message: string;
};

type TypeRef =
  | { kind: "any" }
  | { kind: "none" }
  | { kind: "named"; name: string }
  | { kind: "union"; types: TypeRef[] }
  | { kind: "tuple"; types: TypeRef[] }
  | { kind: "generic"; name: string; args: TypeRef[] };

type Parameter = {
  name: string;
  type: TypeRef;
  optional: boolean;
};

type Callable = {
  name: string;
  line: number;
  params: Parameter[];
  returnType: TypeRef;
};

type CallArgument = {
  source: string;
  column: number;
  endColumn: number;
};

type CallExpression = {
  callee: string;
  args: CallArgument[];
  column: number;
};

type ClassInfo = {
  name: string;
  line: number;
  constructor: Callable;
  methods: Map<string, Callable>;
};

type CheckerContext = {
  aliases: Map<string, TypeRef>;
  callables: Map<string, Callable>;
  classes: Map<string, ClassInfo>;
  knownTypes: Set<string>;
  diagnostics: TypeCheckDiagnostic[];
};

const anyType: TypeRef = { kind: "any" };
const noneType: TypeRef = { kind: "none" };
const builtinTypeNames = new Set([
  "bool",
  "dict",
  "float",
  "int",
  "list",
  "None",
  "object",
  "set",
  "str",
  "tuple",
]);
const builtinCallables = new Set(["dict", "float", "int", "len", "list", "print", "range", "set", "str", "tuple"]);

export function typeCheck(parsed: ParsedSheet): TypeCheckDiagnostic[] {
  const context = buildContext(parsed);
  validateDeclaredTypes(parsed, context);
  checkBodies(parsed.source, context);
  return context.diagnostics.sort((left, right) => left.line - right.line || left.column - right.column);
}

function buildContext(parsed: ParsedSheet): CheckerContext {
  const context: CheckerContext = {
    aliases: new Map(),
    callables: new Map(),
    classes: new Map(),
    knownTypes: new Set(builtinTypeNames),
    diagnostics: [],
  };

  for (const alias of parsed.typeAliases) {
    context.knownTypes.add(alias.name);
  }

  for (const sumType of parsed.sumTypes) {
    context.knownTypes.add(sumType.name);
    for (const variant of sumType.variants) {
      context.knownTypes.add(variant.name);
      context.callables.set(variant.name, {
        name: variant.name,
        line: sumType.line,
        params: variant.fields.map((field, index) => ({
          name: `field${index}`,
          type: parseTypeRef(field),
          optional: false,
        })),
        returnType: { kind: "named", name: sumType.name },
      });
    }
  }

  for (const alias of parsed.typeAliases) {
    context.aliases.set(alias.name, parseTypeRef(alias.target));
  }

  for (const classDecl of parsed.classDecls) {
    const classInfo = parseClassInfo(classDecl.name, classDecl.line, classDecl.snippet);
    context.knownTypes.add(classInfo.name);
    context.classes.set(classInfo.name, classInfo);
    context.callables.set(classInfo.name, classInfo.constructor);
  }

  for (const functionDecl of discoverTopLevelFunctions(parsed.source)) {
    context.callables.set(functionDecl.name, functionDecl);
  }

  return context;
}

function validateDeclaredTypes(parsed: ParsedSheet, context: CheckerContext): void {
  for (const alias of parsed.typeAliases) {
    validateTypeRef(parseTypeRef(alias.target), context, alias.line);
  }

  for (const sumType of parsed.sumTypes) {
    for (const variant of sumType.variants) {
      for (const field of variant.fields) {
        validateTypeRef(parseTypeRef(field), context, sumType.line);
      }
    }
  }

  for (const classDecl of parsed.classDecls) {
    for (const line of classDecl.snippet.split("\n")) {
      const field = parseAnnotatedField(line);
      if (field) {
        validateTypeRef(field.type, context, classDecl.line);
      }
    }
  }

  for (const callable of context.callables.values()) {
    for (const param of callable.params) {
      validateTypeRef(param.type, context, callable.line);
    }
    validateTypeRef(callable.returnType, context, callable.line);
  }
}

function checkBodies(source: string, context: CheckerContext): void {
  for (const block of discoverFunctionBlocks(source)) {
    const callable = context.callables.get(block.name);
    if (!callable || block.lines.length === 0) {
      continue;
    }

    const variables = new Map<string, TypeRef>();
    for (const param of callable.params) {
      variables.set(param.name, param.type);
    }

    if (block.className) {
      variables.set("self", { kind: "named", name: block.className });
    }

    for (const lineInfo of block.lines) {
      const uncommented = stripComment(lineInfo.text);
      const trimmed = uncommented.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const assignment = parseAssignment(trimmed);
      if (assignment) {
        variables.set(assignment.name, inferExpressionType(assignment.expression, variables, context));
      }

      const returned = trimmed.match(/^return(?:\s+(.+))?$/);
      if (returned) {
        const actual = returned[1] === undefined ? noneType : inferExpressionType(returned[1], variables, context);
        if (!isAssignable(actual, callable.returnType, context)) {
          addDiagnostic(
            context,
            lineInfo.line,
            Math.max(1, lineInfo.text.indexOf("return") + 1),
            lineInfo.text.length + 1,
            `Return type ${formatType(actual)} is not assignable to ${formatType(callable.returnType)}.`,
          );
        }
      }

      for (const call of findCalls(uncommented)) {
        checkCall(call, lineInfo.line, lineInfo.text, variables, context);
      }
    }
  }
}

function checkCall(
  call: CallExpression,
  line: number,
  rawLine: string,
  variables: Map<string, TypeRef>,
  context: CheckerContext,
): TypeRef {
  const callable = resolveCallable(call.callee, variables, context);
  if (!callable) {
    return anyType;
  }

  const required = callable.params.filter((param) => !param.optional).length;
  if (call.args.length < required || call.args.length > callable.params.length) {
    const expected =
      required === callable.params.length
        ? String(required)
        : `${required}-${callable.params.length}`;
    addDiagnostic(
      context,
      line,
      call.column,
      Math.min(rawLine.length + 1, call.column + call.callee.length),
      `${call.callee} expects ${expected} argument${expected === "1" ? "" : "s"}, got ${call.args.length}.`,
    );
    return callable.returnType;
  }

  call.args.forEach((arg, index) => {
    const expected = callable.params[index];
    if (!expected) {
      return;
    }

    const actual = inferExpressionType(arg.source, variables, context);
    if (!isAssignable(actual, expected.type, context)) {
      addDiagnostic(
        context,
        line,
        arg.column,
        Math.min(rawLine.length + 1, arg.endColumn),
        `Argument ${index + 1} to ${call.callee} has type ${formatType(actual)}, expected ${formatType(expected.type)}.`,
      );
    }
  });

  return callable.returnType;
}

function resolveCallable(
  callee: string,
  variables: Map<string, TypeRef>,
  context: CheckerContext,
): Callable | null {
  if (builtinCallables.has(callee)) {
    return null;
  }

  const method = callee.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (method) {
    const receiverType = variables.get(method[1]);
    const className = receiverType?.kind === "named" ? receiverType.name : null;
    return className ? context.classes.get(className)?.methods.get(method[2]) ?? null : null;
  }

  return context.callables.get(callee) ?? null;
}

function inferExpressionType(
  expression: string,
  variables: Map<string, TypeRef>,
  context: CheckerContext,
): TypeRef {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return noneType;
  }

  if (/^-?\d+$/.test(trimmed)) {
    return { kind: "named", name: "int" };
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return { kind: "named", name: "float" };
  }

  if (/^(true|false|True|False)$/.test(trimmed)) {
    return { kind: "named", name: "bool" };
  }

  if (/^(None|null)$/.test(trimmed)) {
    return noneType;
  }

  if (/^(['"]).*\1$/.test(trimmed) || /^f(['"]).*\1$/.test(trimmed)) {
    return { kind: "named", name: "str" };
  }

  if (/^\[.*\]$/.test(trimmed)) {
    return { kind: "named", name: "list" };
  }

  if (/^\{.*\}$/.test(trimmed)) {
    return { kind: "named", name: "dict" };
  }

  if (/^\(.*,\s*.*\)$/.test(trimmed)) {
    return { kind: "named", name: "tuple" };
  }

  const directCall = parseDirectCall(trimmed);
  if (directCall) {
    return checkCall(
      directCall,
      0,
      trimmed,
      variables,
      { ...context, diagnostics: context.diagnostics },
    );
  }

  return variables.get(trimmed) ?? anyType;
}

function isAssignable(actual: TypeRef, expected: TypeRef, context: CheckerContext): boolean {
  const normalizedActual = resolveAlias(actual, context);
  const normalizedExpected = resolveAlias(expected, context);

  if (normalizedActual.kind === "any" || normalizedExpected.kind === "any") {
    return true;
  }

  if (normalizedExpected.kind === "union") {
    return normalizedExpected.types.some((type) => isAssignable(normalizedActual, type, context));
  }

  if (normalizedActual.kind === "union") {
    return normalizedActual.types.every((type) => isAssignable(type, normalizedExpected, context));
  }

  if (normalizedExpected.kind === "none") {
    return normalizedActual.kind === "none";
  }

  if (normalizedActual.kind === "none") {
    return false;
  }

  if (normalizedExpected.kind === "named" && normalizedActual.kind === "named") {
    if (normalizedExpected.name === normalizedActual.name) {
      return true;
    }

    return sumTypeContains(context, normalizedExpected.name, normalizedActual.name);
  }

  return normalizedExpected.kind === normalizedActual.kind;
}

function sumTypeContains(context: CheckerContext, sumTypeName: string, variantName: string): boolean {
  for (const callable of context.callables.values()) {
    if (
      callable.name === variantName &&
      callable.returnType.kind === "named" &&
      callable.returnType.name === sumTypeName
    ) {
      return true;
    }
  }

  return false;
}

function resolveAlias(type: TypeRef, context: CheckerContext): TypeRef {
  if (type.kind !== "named") {
    return type;
  }

  return context.aliases.get(type.name) ?? type;
}

function validateTypeRef(type: TypeRef, context: CheckerContext, line: number): void {
  if (type.kind === "named" && !context.knownTypes.has(type.name)) {
    addDiagnostic(context, line, 1, 1, `Unknown type ${type.name}.`);
    return;
  }

  if (type.kind === "union" || type.kind === "tuple") {
    for (const inner of type.types) {
      validateTypeRef(inner, context, line);
    }
    return;
  }

  if (type.kind === "generic") {
    if (!context.knownTypes.has(type.name)) {
      addDiagnostic(context, line, 1, 1, `Unknown type ${type.name}.`);
    }
    for (const arg of type.args) {
      validateTypeRef(arg, context, line);
    }
  }
}

function parseClassInfo(name: string, line: number, source: string): ClassInfo {
  const fields = parseClassFields(source);
  const constructor: Callable = {
    name,
    line,
    params: fields.map((field) => ({
      name: field.name,
      type: field.type,
      optional: field.optional,
    })),
    returnType: { kind: "named", name },
  };
  const methods = new Map<string, Callable>();

  for (const method of discoverClassMethods(source, line, name)) {
    methods.set(method.name, method);
  }

  return { name, line, constructor, methods };
}

function parseClassFields(source: string): Parameter[] {
  const header = source.split("\n")[0] ?? "";
  const shorthand = header.match(/^(?:class|record)?\s*[A-Z][A-Za-z0-9_]*\((.*)\)\s*:?\s*$/);
  if (shorthand) {
    return parseParams(shorthand[1], false);
  }

  return source
    .split("\n")
    .slice(1)
    .map(parseAnnotatedField)
    .filter((field): field is Parameter => field !== null);
}

function parseAnnotatedField(line: string): Parameter | null {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=\s*.+)?$/);
  if (!match) {
    return null;
  }

  return {
    name: match[1],
    type: parseTypeRef(match[2]),
    optional: line.includes("="),
  };
}

function discoverClassMethods(source: string, classLine: number, className: string): Callable[] {
  const methods: Callable[] = [];
  const lines = source.split("\n");

  for (let index = 1; index < lines.length; index += 1) {
    const header = parseFunctionHeader(lines[index]);
    if (!header) {
      continue;
    }

    methods.push({
      name: header.name,
      line: classLine + index,
      params: parseParams(header.params, true),
      returnType: header.returnType === undefined ? anyType : parseTypeRef(header.returnType),
    });
  }

  void className;
  return methods;
}

function discoverTopLevelFunctions(source: string): Callable[] {
  return source
    .split("\n")
    .map((line, index) => ({ header: parseFunctionHeader(line), line: index + 1 }))
    .filter((item) => item.header !== null && item.header.indent.length === 0)
    .map((item) => {
      const header = item.header;
      if (!header) {
        throw new Error("unreachable");
      }

      return {
        name: header.name,
        line: item.line,
        params: parseParams(header.params, false),
        returnType: header.returnType === undefined ? anyType : parseTypeRef(header.returnType),
      };
    });
}

function discoverFunctionBlocks(source: string): Array<{
  name: string;
  className?: string;
  lines: Array<{ line: number; text: string }>;
}> {
  const lines = source.split("\n");
  const blocks: Array<{
    name: string;
    className?: string;
    indent: number;
    lines: Array<{ line: number; text: string }>;
  }> = [];
  const classStack: Array<{ name: string; indent: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      const indent = indentWidth(text);
      while (classStack.length > 0 && indent <= (classStack.at(-1)?.indent ?? 0)) {
        classStack.pop();
      }

      const classMatch = trimmed.match(/^(?:class|record)\s+([A-Z][A-Za-z0-9_]*)(?:\([^)]*\))?\s*:/);
      if (classMatch) {
        classStack.push({ name: classMatch[1], indent });
      }
    }

    const header = parseFunctionHeader(text);
    if (!header || !header.hasColon) {
      continue;
    }

    const blockIndent = indentWidth(text);
    const body: Array<{ line: number; text: string }> = [];
    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim().length === 0) {
        end += 1;
        continue;
      }

      if (indentWidth(candidate) <= blockIndent) {
        break;
      }

      body.push({ line: end + 1, text: candidate });
      end += 1;
    }

    const className = blockIndent > 0 ? closestClassName(classStack, blockIndent) : undefined;
    blocks.push({
      name: header.name,
      ...(className === undefined ? {} : { className }),
      indent: blockIndent,
      lines: body,
    });
  }

  return blocks;
}

function parseParams(source: string, dropSelf: boolean): Parameter[] {
  const params = splitTopLevel(source, ",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0)
    .map((param) => {
      const withoutDefault = param.split("=")[0]?.trim() ?? param;
      const [namePart, typePart] = splitParam(withoutDefault);
      return {
        name: namePart,
        type: typePart === undefined ? anyType : parseTypeRef(typePart),
        optional: param.includes("="),
      };
    });

  return dropSelf && params[0]?.name === "self" ? params.slice(1) : params;
}

function closestClassName(
  classStack: Array<{ name: string; indent: number }>,
  blockIndent: number,
): string | undefined {
  for (let index = classStack.length - 1; index >= 0; index -= 1) {
    const item = classStack[index];
    if (item.indent < blockIndent) {
      return item.name;
    }
  }

  return undefined;
}

function splitParam(source: string): [string, string | undefined] {
  const colon = source.indexOf(":");
  if (colon < 0) {
    return [source.trim(), undefined];
  }

  return [source.slice(0, colon).trim(), source.slice(colon + 1).trim()];
}

function parseTypeRef(source: string): TypeRef {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return anyType;
  }

  const union = splitTopLevel(trimmed, "|");
  if (union.length > 1) {
    return { kind: "union", types: union.map(parseTypeRef) };
  }

  if (trimmed === "None") {
    return noneType;
  }

  const tuple = trimmed.match(/^\((.*)\)$/);
  if (tuple) {
    return { kind: "tuple", types: splitTopLevel(tuple[1], ",").map(parseTypeRef) };
  }

  const bracket = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(.*)\]$/);
  if (bracket) {
    return { kind: "generic", name: bracket[1], args: splitTopLevel(bracket[2], ",").map(parseTypeRef) };
  }

  if (/^\[\[.+\]\]$/.test(trimmed)) {
    return { kind: "named", name: "dict" };
  }

  return { kind: "named", name: trimmed };
}

function parseFunctionHeader(line: string): {
  indent: string;
  name: string;
  params: string;
  returnType?: string;
  hasColon: boolean;
} | null {
  const match = line.match(
    /^(\s*)(?:async\s+)?(?:(?:def|fn|function)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:=]+))?\s*(:?)\s*$/,
  );
  if (!match) {
    return null;
  }

  const returnType = match[4]?.trim();
  return {
    indent: match[1],
    name: match[2],
    params: match[3],
    ...(returnType === undefined ? {} : { returnType }),
    hasColon: match[5] === ":",
  };
}

function parseAssignment(source: string): { name: string; expression: string } | null {
  const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (!match || source.includes("==")) {
    return null;
  }

  return { name: match[1], expression: match[2] };
}

function findCalls(source: string): CallExpression[] {
  const calls: CallExpression[] = [];
  const matcher = /(?<!\bdef\s)(?<!\bfn\s)(?<!\bfunction\s)\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(source)) !== null) {
    const open = matcher.lastIndex - 1;
    const close = findMatchingParen(source, open);
    if (close < 0) {
      continue;
    }

    calls.push({
      callee: match[1],
      args: splitCallArguments(source.slice(open + 1, close), open + 2),
      column: match.index + 1,
    });
  }

  return calls;
}

function parseDirectCall(source: string): CallExpression | null {
  const call = findCalls(source)[0];
  if (!call) {
    return null;
  }

  const prefix = source.slice(0, call.column - 1).trim();
  return prefix.length === 0 ? call : null;
}

function splitCallArguments(source: string, firstColumn: number): CallArgument[] {
  const ranges: CallArgument[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? ",";
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    }

    if (char !== "," || depth !== 0) {
      continue;
    }

    const raw = source.slice(start, index);
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    const trimmed = raw.slice(leading, raw.length - trailing);
    if (trimmed.length > 0) {
      const column = firstColumn + start + leading;
      ranges.push({
        source: trimmed,
        column,
        endColumn: column + trimmed.length,
      });
    }

    start = index + 1;
  }

  return ranges;
}

function findMatchingParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;

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

function stripComment(source: string): string {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      return source.slice(0, index);
    }
  }

  return source;
}

function addDiagnostic(
  context: CheckerContext,
  line: number,
  column: number,
  endColumn: number,
  message: string,
): void {
  if (line <= 0) {
    return;
  }

  context.diagnostics.push({
    line,
    column,
    endLine: line,
    endColumn: Math.max(endColumn, column + 1),
    severity: "error",
    message,
  });
}

function formatType(type: TypeRef): string {
  switch (type.kind) {
    case "any":
      return "Any";
    case "none":
      return "None";
    case "named":
      return type.name;
    case "generic":
      return `${type.name}[${type.args.map(formatType).join(", ")}]`;
    case "tuple":
      return `(${type.types.map(formatType).join(", ")})`;
    case "union":
      return type.types.map(formatType).join(" | ");
  }
}

function indentWidth(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
