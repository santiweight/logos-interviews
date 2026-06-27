export type Op = "Add" | "Sub" | "Mul" | "Div";

export type CellAddress = {
  col: number;
  row: number;
};

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "ref"; address: CellAddress }
  | { kind: "op"; op: Op; left: Expr; right: Expr };

export type SheetError =
  | { kind: "RecursiveError"; cycle: CellAddress[] }
  | { kind: "DivByZero" }
  | { kind: "ParseError"; message: string };

export type CellValue = number | SheetError | null;

type EvalResult = number | SheetError;

type Token =
  | { kind: "number"; value: number }
  | { kind: "cell"; value: CellAddress }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

type OperatorSymbol = Extract<Token, { kind: "op" }>["value"];

const OP_MAP: Record<OperatorSymbol, Op> = {
  "+": "Add",
  "-": "Sub",
  "*": "Mul",
  "/": "Div",
};

export class SheetResult {
  readonly width: number;
  readonly height: number;
  readonly rawInputs: string[][];
  readonly formulas: (Expr | null)[][];
  readonly state: CellValue[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.rawInputs = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ""),
    );
    this.formulas = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null),
    );
    this.state = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null),
    );
  }

  set(address: string, val: string | number): void;
  set(col: number, row: number, val: string | number): void;
  set(
    colOrAddress: number | string,
    rowOrVal: number | string,
    maybeVal?: string | number,
  ): void {
    const address =
      typeof colOrAddress === "string"
        ? parseCellAddress(colOrAddress)
        : { col: colOrAddress, row: Number(rowOrVal) };
    if (!address) {
      throw new Error(`Invalid cell address: ${colOrAddress}`);
    }

    const val = typeof colOrAddress === "string" ? rowOrVal : maybeVal;
    if (val === undefined) {
      throw new Error("Missing cell value");
    }

    const { col, row } = address;
    this.assertAddress({ col, row });
    const parsed = parseInput(val);
    this.rawInputs[row][col] = String(val);
    this.formulas[row][col] = isSheetError(parsed) ? null : parsed;
    this.state[row][col] = isSheetError(parsed) ? parsed : null;
    this.recalculate();
  }

  get(address: string): CellValue {
    const parsed = parseCellAddress(address);
    if (!parsed) {
      return { kind: "ParseError", message: `Invalid cell address: ${address}` };
    }
    return this.getAt(parsed.col, parsed.row);
  }

  getAt(col: number, row: number): CellValue {
    if (!this.inBounds({ col, row })) {
      return null;
    }
    return this.state[row][col];
  }

  recalculate(): void {
    for (const [col, row] of this.cells()) {
      if (this.formulas[row][col] !== null) {
        this.state[row][col] = null;
      }
    }

    for (const [col, row] of this.cells()) {
      const expr = this.formulas[row][col];
      if (expr) {
        this.state[row][col] = this.evalRecursively([{ col, row }]);
      }
    }
  }

  private evalRecursively(stack: CellAddress[]): EvalResult {
    const current = stack.at(-1);
    if (!current) {
      return { kind: "ParseError", message: "Cannot evaluate an empty stack" };
    }

    const cached = this.state[current.row][current.col];
    if (cached !== null) {
      return cached;
    }

    const expr = this.formulas[current.row][current.col];
    if (!expr) {
      return 0;
    }

    const result = this.evalExpr(expr, stack);
    this.state[current.row][current.col] = result;
    return result;
  }

  private evalExpr(expr: Expr, stack: CellAddress[]): EvalResult {
    switch (expr.kind) {
      case "num":
        return expr.value;
      case "ref": {
        if (!this.inBounds(expr.address)) {
          return 0;
        }

        const cycleStart = stack.findIndex((item) =>
          sameAddress(item, expr.address),
        );
        if (cycleStart >= 0) {
          return {
            kind: "RecursiveError",
            cycle: [...stack.slice(cycleStart), expr.address],
          };
        }

        return this.evalRecursively([...stack, expr.address]);
      }
      case "op": {
        const left = this.evalExpr(expr.left, stack);
        if (isSheetError(left)) {
          return left;
        }

        const right = this.evalExpr(expr.right, stack);
        if (isSheetError(right)) {
          return right;
        }

        return applyOp(expr.op, left, right);
      }
    }
  }

  private *cells(): Generator<[number, number]> {
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        yield [col, row];
      }
    }
  }

  private inBounds(address: CellAddress): boolean {
    return (
      address.col >= 0 &&
      address.col < this.width &&
      address.row >= 0 &&
      address.row < this.height
    );
  }

  private assertAddress(address: CellAddress): void {
    if (!this.inBounds(address)) {
      throw new Error(`Cell is outside the sheet: ${formatAddress(address)}`);
    }
  }
}

export function parseInput(input: string | number): Expr | SheetError {
  if (typeof input === "number") {
    return { kind: "num", value: input };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: "ParseError", message: "Enter a number or formula" };
  }

  const source = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
  const tokens = tokenizeFormula(source);
  if (isSheetError(tokens)) {
    return tokens;
  }

  const parser = new FormulaParser(tokens);
  return parser.parse();
}

export function parseCellAddress(input: string): CellAddress | null {
  const match = input.trim().toUpperCase().match(/^([A-Z]+)([1-9][0-9]*)$/);
  if (!match) {
    return null;
  }

  return {
    col: lettersToColumn(match[1]),
    row: Number(match[2]) - 1,
  };
}

export function formatAddress(address: CellAddress): string {
  return `${columnToLetters(address.col)}${address.row + 1}`;
}

export function isSheetError(value: unknown): value is SheetError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "RecursiveError" ||
      value.kind === "DivByZero" ||
      value.kind === "ParseError")
  );
}

export function formatCellValue(value: CellValue): string {
  if (value === null) {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value.kind === "RecursiveError") {
    return `RecursiveError(${value.cycle.map(formatAddress).join(" -> ")})`;
  }

  if (value.kind === "DivByZero") {
    return "DivByZero";
  }

  return `ParseError(${value.message})`;
}

function tokenizeFormula(source: string): Token[] | SheetError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let text = char;
      i += 1;
      while (i < source.length && /[0-9]/.test(source[i])) {
        text += source[i];
        i += 1;
      }
      tokens.push({ kind: "number", value: Number(text) });
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      let text = char;
      i += 1;
      while (i < source.length && /[A-Za-z0-9]/.test(source[i])) {
        text += source[i];
        i += 1;
      }

      const address = parseCellAddress(text);
      if (!address) {
        return { kind: "ParseError", message: `Invalid cell reference: ${text}` };
      }

      tokens.push({ kind: "cell", value: address });
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "op", value: char });
      i += 1;
      continue;
    }

    return { kind: "ParseError", message: `Unexpected token: ${char}` };
  }

  return tokens;
}

class FormulaParser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr | SheetError {
    const expr = this.expression();
    if (isSheetError(expr)) {
      return expr;
    }

    if (this.peek()) {
      return { kind: "ParseError", message: "Unexpected trailing input" };
    }

    return expr;
  }

  private expression(): Expr | SheetError {
    return this.binaryExpression(0);
  }

  private binaryExpression(minPrecedence: number): Expr | SheetError {
    let left = this.primary();
    if (isSheetError(left)) {
      return left;
    }

    while (true) {
      const token = this.peek();
      if (!token || token.kind !== "op") {
        break;
      }

      const precedence = precedenceOf(token.value);
      if (precedence < minPrecedence) {
        break;
      }

      this.advance();
      const right = this.binaryExpression(precedence + 1);
      if (isSheetError(right)) {
        return right;
      }

      left = {
        kind: "op",
        op: OP_MAP[token.value],
        left,
        right,
      };
    }

    return left;
  }

  private primary(): Expr | SheetError {
    const token = this.advance();
    if (!token) {
      return { kind: "ParseError", message: "Expected expression" };
    }

    if (token.kind === "number") {
      return { kind: "num", value: token.value };
    }

    if (token.kind === "cell") {
      return { kind: "ref", address: token.value };
    }

    if (token.kind === "lparen") {
      const expr = this.expression();
      if (isSheetError(expr)) {
        return expr;
      }

      const close = this.advance();
      if (!close || close.kind !== "rparen") {
        return { kind: "ParseError", message: "Expected closing parenthesis" };
      }

      return expr;
    }

    return { kind: "ParseError", message: "Expected number, cell, or group" };
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private advance(): Token | undefined {
    const token = this.peek();
    this.position += 1;
    return token;
  }
}

function applyOp(op: Op, left: number, right: number): EvalResult {
  switch (op) {
    case "Add":
      return left + right;
    case "Sub":
      return left - right;
    case "Mul":
      return left * right;
    case "Div":
      if (right === 0) {
        return { kind: "DivByZero" };
      }
      return Math.trunc(left / right);
  }
}

function precedenceOf(op: OperatorSymbol): number {
  return op === "*" || op === "/" ? 2 : 1;
}

function sameAddress(left: CellAddress, right: CellAddress): boolean {
  return left.col === right.col && left.row === right.row;
}

function lettersToColumn(letters: string): number {
  let result = 0;
  for (const letter of letters) {
    result = result * 26 + letter.charCodeAt(0) - 64;
  }
  return result - 1;
}

function columnToLetters(col: number): string {
  let n = col + 1;
  let result = "";

  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result;
}
