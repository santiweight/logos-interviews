import { describe, expect, it } from "vitest";
import {
  cachedCompiledSheet,
  compile,
  completionSnippetHashes,
  definitionReadiness,
  completeSheet,
  hashCompletionInput,
  hashSnippet,
  implementationBlockForTarget,
  implementationTargetAtLine,
  lower,
  parse,
  renderImplementation,
  runnables,
  selectionContextAtPosition,
  type CodeCache,
  type CompilationEvent,
} from "./codeSheet";
import {
  buildPythonProgram,
  runCodeSheet,
  startInteractiveCodeSheet,
  type InteractivePythonRun,
  type RunResult,
} from "./codeSheetRunner";
import { sampleEvalCases } from "./samples";
import { typeCheck } from "./typeCheck";

const sheet = `def add(x: int, y: int) -> int

def test():
  print(add(1,2))`;

const multiIncompleteSheet = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(mul(1,2))`;

const spreadsheetClassSheet = `class Spreadsheet:
  cells: [[int]]

  def get(self, col: str, row: int) -> int | None
  def set(self, col: str, row: int, val: int) -> None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, 7)
  print(sheet.get("A", 1))`;

function sourceWithCursorMarkers(markedSource: string): {
  source: string;
  positions: Array<{ line: number; column: number }>;
} {
  let source = "";
  const positions: Array<{ line: number; column: number }> = [];
  let line = 1;
  let column = 1;

  for (const char of markedSource) {
    if (char === "|") {
      positions.push({ line, column });
      continue;
    }

    source += char;
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { source, positions };
}

describe("codeSheet", () => {
  it("captures runnables output", () => {
    expect({
      sheet: runnables(sheet),
      multiIncompleteSheet: runnables(multiIncompleteSheet),
      spreadsheetClassSheet: runnables(spreadsheetClassSheet),
    }).toMatchInlineSnapshot(`
      {
        "multiIncompleteSheet": [
          {
            "line": 5,
            "name": "test",
          },
        ],
        "sheet": [
          {
            "line": 3,
            "name": "test",
          },
        ],
        "spreadsheetClassSheet": [
          {
            "line": 7,
            "name": "test",
          },
        ],
      }
    `);
  });

  it("keeps indented comments with incomplete top-level functions", () => {
    const parsed = parse(`# Fractal rendering file.

class AsciiArt:
  def render() -> str

def mandelbrot() -> AsciiArt
  # Return a deterministic ASCII mandelbrot fractal.

def main():
  \`generate and render the {mandelbrot} fractal\``);

    expect(parsed.incompleteSnippets.map((snippet) => ({
      kind: snippet.kind,
      line: snippet.line,
      snippet: snippet.snippet,
    }))).toEqual([
      {
        kind: "class",
        line: 3,
        snippet: `class AsciiArt:
  def render() -> str`,
      },
      {
        kind: "function",
        line: 6,
        snippet: `def mandelbrot() -> AsciiArt
  # Return a deterministic ASCII mandelbrot fractal.`,
      },
      {
        kind: "natural",
        line: 10,
        snippet: "`generate and render the {mandelbrot} fractal`",
      },
    ]);
  });

  it("keeps adjacent top-level function signatures as separate snippets", () => {
    const parsed = parse(`def foo(x, y) -> int
def bar(x, y) -> int`);

    expect(parsed.incompleteSnippets.map((snippet) => ({
      kind: snippet.kind,
      line: snippet.line,
      snippet: snippet.snippet,
    }))).toEqual([
      {
        kind: "function",
        line: 1,
        snippet: "def foo(x, y) -> int",
      },
      {
        kind: "function",
        line: 2,
        snippet: "def bar(x, y) -> int",
      },
    ]);
    expect(definitionReadiness(parsed, new Map()).map(({ name, line, ready, reason }) => ({
      name,
      line,
      ready,
      reason,
    }))).toEqual([
      { name: "foo", line: 1, ready: false, reason: "implementation" },
      { name: "bar", line: 2, ready: false, reason: "implementation" },
    ]);
  });

  it("trims function and class completions to the requested symbol", async () => {
    const fractalSheet = `class AsciiArt:
  def render() -> str

def mandelbrot() -> AsciiArt
  # Return a deterministic ASCII mandelbrot fractal.

def main():
  \`generate and render the {mandelbrot} fractal\``;
    const result = await runCodeSheet(fractalSheet, "main", {
      complete(prompt) {
        if (prompt.includes("Your job is to replace this natural-language Python fragment")) {
          return "print(mandelbrot().render())";
        }

        const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
        if (target.includes("class AsciiArt:")) {
          return `class AsciiArt:
  def __init__(self, lines=None):
    self.lines = lines or ["@"]
  def render(self) -> str:
    return "\\n".join(self.lines)

def mandelbrot() -> AsciiArt:
  return AsciiArt(["bad"])

def main():
  print("bad")`;
        }

        if (target.includes("def mandelbrot() -> AsciiArt")) {
          return `def mandelbrot() -> AsciiArt:
  return AsciiArt(["@"])

def main():
  print("bad")`;
        }

        throw new Error(`unexpected prompt: ${prompt}`);
      },
    });

    expect({
      result: simplifyRunResult(result),
      mandelbrotDefinitions: result.completed.source.match(/^def mandelbrot/gm)?.length,
      mainDefinitions: result.completed.source.match(/^def main/gm)?.length,
    }).toEqual({
      result: { ok: true, stdout: ["@"] },
      mandelbrotDefinitions: 1,
      mainDefinitions: 1,
    });
  });

  it("preserves private helper functions returned with a single function completion", async () => {
    const parserSheet = `def parse_expr(str) -> int

def test():
  print(parse_expr("7"))`;

    const result = await runCodeSheet(parserSheet, "test", {
      complete() {
        return `def parse_expr(source) -> int:
  tokens = _tokenize(source)
  return _parse_expr_tokens(tokens)

def _tokenize(source):
  return [int(source)]

def _parse_expr_tokens(tokens):
  return tokens[0]

def unrelated_public():
  return "bad"`;
      },
    });

    expect({
      result: simplifyRunResult(result),
      hasPrivateTokenizeHelper: result.completed.source.includes("def _tokenize"),
      hasPrivateParserHelper: result.completed.source.includes("def _parse_expr_tokens"),
      hasUnrelatedPublicFunction: result.completed.source.includes("def unrelated_public"),
    }).toEqual({
      result: { ok: true, stdout: ["7"] },
      hasPrivateTokenizeHelper: true,
      hasPrivateParserHelper: true,
      hasUnrelatedPublicFunction: false,
    });
  });

  it("executes sheets with postponed annotation evaluation", () => {
    expect(
      buildPythonProgram("class AsciiArt:\n  def rotate(self) -> AsciiArt:\n    return self", "main")
        .startsWith("from __future__ import annotations\n\n"),
    ).toBe(true);
  });

  it("does not execute an agent-provided main guard in addition to the requested runnable", async () => {
    const result = await runCodeSheet(`def test():
  print("once")

if __name__ == "__main__":
  test()`, "test");

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["once"],
    });
  });

  it("captures run outputs", async () => {
    const prompts: string[] = [];
    const cache: CodeCache = new Map();
    const complete = (prompt: string): string => {
      prompts.push(prompt);
      const target =
        prompt
          .split("Your job is to finish the implementation of:")
          .at(-1) ?? "";
      if (target.includes("class Spreadsheet:")) {
        return `class Spreadsheet:
  cells: [[int]]

  def __init__(self):
    self.cells = {}
  def get(self, col: str, row: int) -> int | None:
    return self.cells.get((col, row), None)
  def set(self, col: str, row: int, val: int) -> None:
    self.cells[(col, row)] = val`;
      }

      if (target.includes("def mul(x: int, y: int) -> int")) {
        return `def mul(x: int, y: int) -> int:
  return x * y`;
      }

      return `def add(x: int, y: int) -> int:
  return x + y`;
    };

    expect({
      addHash: hashSnippet("def add(x: int, y: int) -> int"),
      mulHash: hashSnippet("def mul(x: int, y: int) -> int"),
      prompts,
      test: simplifyRunResult(await runCodeSheet(sheet, "test", { complete, cache })),
      multiIncompleteTest: simplifyRunResult(await runCodeSheet(multiIncompleteSheet, "test", {
        complete,
        cache,
      })),
      cachedOnlyTest: simplifyRunResult(await runCodeSheet(
        `def add(x: int, y: int) -> int

def test():
  print(add(2,3))`,
        "test",
        { cache },
      )),
      spreadsheetClassTest: simplifyRunResult(await runCodeSheet(spreadsheetClassSheet, "test", {
        complete,
        cache,
      })),
      cache: Array.from(cache.entries()),
    }).toMatchInlineSnapshot(`
      {
        "addHash": "snippet:2aa0f79f",
        "cache": [
          [
            "completion:e0880b2b",
            "def add(x: int, y: int) -> int:
        return x + y",
          ],
          [
            "completion:f5ebccca",
            "def mul(x: int, y: int) -> int:
        return x * y",
          ],
          [
            "completion:bccc9c4a",
            "class Spreadsheet:
        cells: [[int]]

        def __init__(self):
          self.cells = {}
        def get(self, col: str, row: int) -> int | None:
          return self.cells.get((col, row), None)
        def set(self, col: str, row: int, val: int) -> None:
          self.cells[(col, row)] = val",
          ],
        ],
        "cachedOnlyTest": {
          "ok": true,
          "stdout": [
            "5",
          ],
        },
        "mulHash": "snippet:02272d70",
        "multiIncompleteTest": {
          "ok": true,
          "stdout": [
            "2",
          ],
        },
        "prompts": [
          "You are an expert software engineer building programs.

      You are tasked with assisting on the following Python code sheet:

      def add(x: int, y: int) -> int

      def test():
        print(add(1,2))

      Your job is to finish the implementation of:

      def add(x: int, y: int) -> int

      Return only implementations for declarations that appear in the requested snippet, plus any standard-library imports required by those declarations.
      Use only Python built-ins and standard-library modules; do not import third-party packages.
      Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.
      For a requested class, return only that class definition and its members. For a requested function, return only that function definition. Helper code must be nested inside the requested declaration rather than added as a sibling definition.
      Do not define a nested class or function with the same name as a top-level declaration from the sheet; use the declared top-level dependency instead.
      Do not assign local variables or loop variables with the same names as top-level helpers, classes, or constructors already present in the sheet.
      Do not call a class constructor with arguments unless the sheet declares that __init__ signature or shows that call shape in runnable/test code. If a class has no declared __init__, support no-argument construction.
      When completing a class with no declared __init__, make no-argument construction produce a valid default object for the runnable/test code; any extra __init__ parameters must be optional.
      When completing a function whose return type is a declared top-level class with no declared constructor arguments, return an instance of that top-level class using no-argument construction instead of defining a nested class, subclass, or duplicate implementation.
      Use only Python's standard library and code already present in the sheet; do not import third-party packages.
      For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.
      When generating visible output, prefer self-explanatory printing over raw value dumps:
      - Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
      - For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
      - For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
      - For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
      - Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
      - Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.",
          "You are an expert software engineer building programs.

      You are tasked with assisting on the following Python code sheet:

      def add(x: int, y: int) -> int:
        return x + y

      def mul(x: int, y: int) -> int

      def test():
        print(mul(1,2))

      Your job is to finish the implementation of:

      def mul(x: int, y: int) -> int

      Return only implementations for declarations that appear in the requested snippet, plus any standard-library imports required by those declarations.
      Use only Python built-ins and standard-library modules; do not import third-party packages.
      Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.
      For a requested class, return only that class definition and its members. For a requested function, return only that function definition. Helper code must be nested inside the requested declaration rather than added as a sibling definition.
      Do not define a nested class or function with the same name as a top-level declaration from the sheet; use the declared top-level dependency instead.
      Do not assign local variables or loop variables with the same names as top-level helpers, classes, or constructors already present in the sheet.
      Do not call a class constructor with arguments unless the sheet declares that __init__ signature or shows that call shape in runnable/test code. If a class has no declared __init__, support no-argument construction.
      When completing a class with no declared __init__, make no-argument construction produce a valid default object for the runnable/test code; any extra __init__ parameters must be optional.
      When completing a function whose return type is a declared top-level class with no declared constructor arguments, return an instance of that top-level class using no-argument construction instead of defining a nested class, subclass, or duplicate implementation.
      Use only Python's standard library and code already present in the sheet; do not import third-party packages.
      For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.
      When generating visible output, prefer self-explanatory printing over raw value dumps:
      - Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
      - For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
      - For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
      - For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
      - Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
      - Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.",
          "You are an expert software engineer building programs.

      You are tasked with assisting on the following Python code sheet:

      class Spreadsheet:
        cells: [[int]]

        def get(self, col: str, row: int) -> int | None
        def set(self, col: str, row: int, val: int) -> None

      def test():
        sheet = Spreadsheet()
        print(sheet.get("A", 1))
        sheet.set("A", 1, 7)
        print(sheet.get("A", 1))

      Your job is to finish the implementation of:

      class Spreadsheet:
        cells: [[int]]

        def get(self, col: str, row: int) -> int | None
        def set(self, col: str, row: int, val: int) -> None

      Return only implementations for declarations that appear in the requested snippet, plus any standard-library imports required by those declarations.
      Use only Python built-ins and standard-library modules; do not import third-party packages.
      Do not add sibling top-level definitions that are not already in the requested snippet. If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.
      For a requested class, return only that class definition and its members. For a requested function, return only that function definition. Helper code must be nested inside the requested declaration rather than added as a sibling definition.
      Do not define a nested class or function with the same name as a top-level declaration from the sheet; use the declared top-level dependency instead.
      Do not assign local variables or loop variables with the same names as top-level helpers, classes, or constructors already present in the sheet.
      Do not call a class constructor with arguments unless the sheet declares that __init__ signature or shows that call shape in runnable/test code. If a class has no declared __init__, support no-argument construction.
      When completing a class with no declared __init__, make no-argument construction produce a valid default object for the runnable/test code; any extra __init__ parameters must be optional.
      When completing a function whose return type is a declared top-level class with no declared constructor arguments, return an instance of that top-level class using no-argument construction instead of defining a nested class, subclass, or duplicate implementation.
      Use only Python's standard library and code already present in the sheet; do not import third-party packages.
      For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.
      When generating visible output, prefer self-explanatory printing over raw value dumps:
      - Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
      - For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
      - For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
      - For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
      - Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
      - Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      Do not include runnable/test calls, example usage, printouts, or result construction unless they are inside the requested declaration's implementation.",
        ],
        "spreadsheetClassTest": {
          "ok": true,
          "stdout": [
            "None",
            "7",
          ],
        },
        "test": {
          "ok": true,
          "stdout": [
            "3",
          ],
        },
      }
    `);
  });

  it("prompts class implementations to treat sibling result types as dependencies", async () => {
    const prompts: string[] = [];
    const spreadsheetResultSheet = `class Spreadsheet:
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet

  def __init__(self, sheet: Spreadsheet) -> None:
    self.sheet = sheet`;

    await completeSheet(new Map(), spreadsheetResultSheet, (prompt) => {
      prompts.push(prompt);
      return `class Spreadsheet:
  def eval(self) -> SpreadsheetResult:
    return SpreadsheetResult(self)`;
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("class SpreadsheetResult:");
    expect(prompts[0]).toContain("Do not add sibling top-level definitions that are not already in the requested snippet.");
    expect(prompts[0]).toContain(
      "If another class, result type, helper, or function is referenced elsewhere in the sheet, use it as an existing dependency and do not define it here.",
    );
    expect(prompts[0]).toContain("For a requested class, return only that class definition and its members.");
  });

  it("runs the formula spreadsheet eval sample with separate class completions", async () => {
    const fixture = sampleEvalCases.find((item) => item.name === "formula spreadsheet precedence and parentheses");
    expect(fixture).toBeDefined();
    if (fixture === undefined || !("expectedStdout" in fixture)) {
      throw new Error("Missing formula spreadsheet fixture");
    }

    const result = await runCodeSheet(fixture.sheet, fixture.runnable, {
      complete(prompt) {
        const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
        if (target.includes("def parse_expr(str) -> Expr | None")) {
          return `def parse_expr(source):
  text = source.strip()

  def tokenize(raw):
    tokens = []
    index = 0
    while index < len(raw):
      ch = raw[index]
      if ch.isspace():
        index += 1
      elif ch.isdigit():
        start = index
        while index < len(raw) and raw[index].isdigit():
          index += 1
        tokens.append(("int", int(raw[start:index])))
      elif ch.isalpha():
        start = index
        while index < len(raw) and raw[index].isalpha():
          index += 1
        col = raw[start:index]
        start = index
        while index < len(raw) and raw[index].isdigit():
          index += 1
        if start == index:
          return []
        tokens.append(("cell", col, int(raw[start:index])))
      elif ch in "+-*/()":
        tokens.append(ch)
        index += 1
      else:
        return []
    return tokens

  def parse_tokens(tokens):
    position = 0

    def parse_factor():
      nonlocal position
      if position >= len(tokens):
        return None
      token = tokens[position]
      if isinstance(token, tuple) and token[0] == "int":
        position += 1
        return Val(token[1])
      if isinstance(token, tuple) and token[0] == "cell":
        position += 1
        return Cell(token[1], token[2])
      if token == "(":
        position += 1
        expr = parse_sum()
        if expr is None or position >= len(tokens) or tokens[position] != ")":
          return None
        position += 1
        return expr
      return None

    def parse_product():
      nonlocal position
      expr = parse_factor()
      while expr is not None and position < len(tokens) and tokens[position] in ("*", "/"):
        op = tokens[position]
        position += 1
        right = parse_factor()
        if right is None:
          return None
        expr = BinOp(Mul() if op == "*" else Div(), expr, right)
      return expr

    def parse_sum():
      nonlocal position
      expr = parse_product()
      while expr is not None and position < len(tokens) and tokens[position] in ("+", "-"):
        op = tokens[position]
        position += 1
        right = parse_product()
        if right is None:
          return None
        expr = BinOp(Add() if op == "+" else Sub(), expr, right)
      return expr

    expr = parse_sum()
    if expr is None or position != len(tokens):
      return None
    return expr

  parsed = parse_tokens(tokenize(text))
  if parsed is None and text.endswith(")"):
    parsed = parse_tokens(tokenize(text[:-1]))
  return parsed`;
        }

        if (target.includes("def pretty_expr(expr) -> str")) {
          return `def pretty_expr(expr) -> str:
  return str(expr)`;
        }

        if (target.includes("def c(str) -> CellAddress")) {
          return `def c(source):
  return ("".join(ch for ch in source if ch.isalpha()), int("".join(ch for ch in source if ch.isdigit())))`;
        }

        if (target.includes("class SpreadsheetResult:")) {
          return `class SpreadsheetResult:
  sheet: Spreadsheet
  cache: dict

  def __init__(self, sheet):
    self.sheet = sheet
    self.cache = {}

  def eval(self, cell):
    return self.eval_inner([], cell)

  def eval_inner(self, stack, cell):
    if cell in stack:
      return RecursiveError(stack + [cell])
    col, row = cell
    if col in self.cache and row in self.cache[col]:
      return self.cache[col][row]
    expr = self.sheet.get(cell)
    if expr is None:
      return None
    result = self.eval_expr(expr, stack + [cell])
    self.cache.setdefault(col, {})[row] = result
    return result

  def eval_expr(self, expr, stack):
    if isinstance(expr, Val):
      return expr.value
    if isinstance(expr, Cell):
      return self.eval_inner(stack, (expr.col, expr.row))
    left = self.eval_expr(expr.left, stack)
    if isinstance(left, (RecursiveError, DivByZero)):
      return left
    right = self.eval_expr(expr.right, stack)
    if isinstance(right, (RecursiveError, DivByZero)):
      return right
    if isinstance(expr.op, Add):
      return left + right
    if isinstance(expr.op, Sub):
      return left - right
    if isinstance(expr.op, Mul):
      return left * right
    if right == 0:
      return DivByZero()
    return left // right`;
        }

        if (target.includes("class Spreadsheet:")) {
          return `class Spreadsheet:
  cells: dict

  def __init__(self):
    self.cells = {}

  def get(self, cell):
    col, row = cell
    return self.cells.get(col, {}).get(row)

  def set(self, cell, expr):
    col, row = cell
    self.cells.setdefault(col, {})[row] = parse_expr(expr)

  def eval(self):
    return SpreadsheetResult(self)`;
        }

        throw new Error(`unexpected prompt: ${prompt}`);
      },
    });

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: fixture.expectedStdout,
    });
  });

  it("supports interactive stdin while a run is active", async () => {
    const run = await startInteractiveCodeSheet(
      `def main():
  while True:
    try:
      word = input("> ")
    except EOFError:
      break
    if word == "quit":
      break
    print(word[::-1])`,
      "main",
      { cache: new Map() },
    );

    expect(await waitForInteractiveOutput(run.session, "> ")).toContain("> ");
    expect(run.session.writeInput("logos\n")).toBe(true);
    expect(await waitForInteractiveOutput(run.session, "sogol")).toContain("sogol");
    expect(run.session.writeInput("quit\n")).toBe(true);
    await waitForInteractiveExit(run.session);
    expect(run.session.status()).toMatchObject({ state: "exited", code: 0 });
  });

  it("lowers sum types to dataclasses before completion", async () => {
    const sumTypeSheet = `type Op = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Op, Expr, Expr)

def test():
  print(Val(7))`;
    const cache: CodeCache = new Map();

    expect({
      parsed: parse(sumTypeSheet),
      lowered: lower(parse(sumTypeSheet)).source,
      run: simplifyRunResult(await runCodeSheet(sumTypeSheet, "test", { cache })),
      completed: (await completeSheet(cache, sumTypeSheet)).source,
    }).toMatchInlineSnapshot(`
      {
        "completed": "from dataclasses import dataclass

      @dataclass(frozen=True)
      class Mul:
        pass

      @dataclass(frozen=True)
      class Div:
        pass

      @dataclass(frozen=True)
      class Add:
        pass

      @dataclass(frozen=True)
      class Sub:
        pass

      @dataclass(frozen=True)
      class Val:
        value: int

      @dataclass(frozen=True)
      class BinOp:
        op: "Op"
        left: "Expr"
        right: "Expr"

      Op = Mul | Div | Add | Sub

      Expr = Val | BinOp


      def test():
        print(Val(7))",
        "lowered": "from dataclasses import dataclass

      @dataclass(frozen=True)
      class Mul:
        pass

      @dataclass(frozen=True)
      class Div:
        pass

      @dataclass(frozen=True)
      class Add:
        pass

      @dataclass(frozen=True)
      class Sub:
        pass

      @dataclass(frozen=True)
      class Val:
        value: int

      @dataclass(frozen=True)
      class BinOp:
        op: "Op"
        left: "Expr"
        right: "Expr"

      Op = Mul | Div | Add | Sub

      Expr = Val | BinOp


      def test():
        print(Val(7))",
        "parsed": {
          "classDecls": [],
          "declarations": [
            {
              "kind": "sum-type",
              "line": 1,
              "name": "Op",
              "source": "type Op = Mul | Div | Add | Sub",
            },
            {
              "kind": "sum-type",
              "line": 2,
              "name": "Expr",
              "source": "type Expr = Val(int) | BinOp(Op, Expr, Expr)",
            },
          ],
          "incompleteSnippets": [],
          "runnables": [
            {
              "line": 4,
              "name": "test",
            },
          ],
          "source": "type Op = Mul | Div | Add | Sub
      type Expr = Val(int) | BinOp(Op, Expr, Expr)

      def test():
        print(Val(7))",
          "sumTypes": [
            {
              "line": 1,
              "name": "Op",
              "source": "type Op = Mul | Div | Add | Sub",
              "variants": [
                {
                  "fields": [],
                  "name": "Mul",
                },
                {
                  "fields": [],
                  "name": "Div",
                },
                {
                  "fields": [],
                  "name": "Add",
                },
                {
                  "fields": [],
                  "name": "Sub",
                },
              ],
            },
            {
              "line": 2,
              "name": "Expr",
              "source": "type Expr = Val(int) | BinOp(Op, Expr, Expr)",
              "variants": [
                {
                  "fields": [
                    "int",
                  ],
                  "name": "Val",
                },
                {
                  "fields": [
                    "Op",
                    "Expr",
                    "Expr",
                  ],
                  "name": "BinOp",
                },
              ],
            },
          ],
          "topLevelComments": [],
          "typeAliases": [],
        },
        "run": {
          "ok": true,
          "stdout": [
            "Val(value=7)",
          ],
        },
      }
    `);
  });

  it("lowers multiline commented sum types with logos annotations", async () => {
    const sudokuSyntaxSheet = `type SudokuStrategy =
  UniqueBoxSolve # there is only one square for a number to go in, in a box
  | UniqueLineSolve # there is only one square for a number to go in, in a row/column
  | HiddenDoubleInBox # two numbers
  | # a row/col is complete except for values in the same box
    # the same box
    LineCompleteExceptForBox
  | HiddenSingle
type CellAnnotation = Solved(int) | Annotations(list[int])

class SudokuState:
  grid: list[list[CellAnnotation]]

@logos.debug.print()
def main():
  print(UniqueBoxSolve())
  print(Solved(7))`;

    const lowered = lower(parse(sudokuSyntaxSheet)).source;

    expect(lowered).toContain("class UniqueBoxSolve:");
    expect(lowered).toContain("class LineCompleteExceptForBox:");
    expect(lowered).toContain("class Solved:");
    expect(lowered).not.toContain("type SudokuStrategy");
    const completed = await runCodeSheet(sudokuSyntaxSheet, "main", { cache: new Map() });
    expect(completed.completed.source).not.toContain("@logos.debug.print()");
    expect(simplifyRunResult(completed)).toEqual({
      ok: true,
      stdout: ["UniqueBoxSolve()", "Solved(value=7)"],
    });
  });

  it("lowers tuple type aliases used by parser helpers", () => {
    const parsedSheet = `type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | Cell(str, int)
type CellAddress = (str, int)

def parse_cell(str) -> CellAddress | None

def test():
  print(parse_cell("A1"))`;

    expect({
      parsed: parse(parsedSheet),
      lowered: lower(parse(parsedSheet)).source,
    }).toMatchInlineSnapshot(`
      {
        "lowered": "from dataclasses import dataclass

      @dataclass(frozen=True)
      class Mul:
        pass

      @dataclass(frozen=True)
      class Div:
        pass

      @dataclass(frozen=True)
      class Add:
        pass

      @dataclass(frozen=True)
      class Sub:
        pass

      @dataclass(frozen=True)
      class Val:
        value: int

      @dataclass(frozen=True)
      class Cell:
        col: str
        row: int

      Operator = Mul | Div | Add | Sub

      Expr = Val | Cell

      CellAddress = tuple[str, int]


      def parse_cell(str) -> CellAddress | None

      def test():
        print(parse_cell("A1"))",
        "parsed": {
          "classDecls": [],
          "declarations": [
            {
              "kind": "sum-type",
              "line": 1,
              "name": "Operator",
              "source": "type Operator = Mul | Div | Add | Sub",
            },
            {
              "kind": "sum-type",
              "line": 2,
              "name": "Expr",
              "source": "type Expr = Val(int) | Cell(str, int)",
            },
            {
              "kind": "incomplete",
              "line": 5,
              "snippetKind": "function",
              "source": "def parse_cell(str) -> CellAddress | None",
            },
          ],
          "incompleteSnippets": [
            {
              "kind": "function",
              "line": 5,
              "snippet": "def parse_cell(str) -> CellAddress | None",
            },
          ],
          "runnables": [
            {
              "line": 7,
              "name": "test",
            },
          ],
          "source": "type Operator = Mul | Div | Add | Sub
      type Expr = Val(int) | Cell(str, int)
      type CellAddress = (str, int)

      def parse_cell(str) -> CellAddress | None

      def test():
        print(parse_cell("A1"))",
          "sumTypes": [
            {
              "line": 1,
              "name": "Operator",
              "source": "type Operator = Mul | Div | Add | Sub",
              "variants": [
                {
                  "fields": [],
                  "name": "Mul",
                },
                {
                  "fields": [],
                  "name": "Div",
                },
                {
                  "fields": [],
                  "name": "Add",
                },
                {
                  "fields": [],
                  "name": "Sub",
                },
              ],
            },
            {
              "line": 2,
              "name": "Expr",
              "source": "type Expr = Val(int) | Cell(str, int)",
              "variants": [
                {
                  "fields": [
                    "int",
                  ],
                  "name": "Val",
                },
                {
                  "fields": [
                    "str",
                    "int",
                  ],
                  "name": "Cell",
                },
              ],
            },
          ],
          "topLevelComments": [],
          "typeAliases": [
            {
              "line": 3,
              "name": "CellAddress",
              "source": "type CellAddress = (str, int)",
              "target": "(str, int)",
            },
          ],
        },
      }
    `);
  });

  it("type checks obvious function, method, constructor, and return mismatches", () => {
    const typedSheet = `type Op = Mul | Div
type Expr = Val(int) | Empty

def add(x: int, y: int) -> int:
  return "wrong"

class Spreadsheet:
  def set(self, col: str, row: int, val: int) -> None

def test():
  sheet = Spreadsheet()
  print(add("1", 2))
  print(Val("7"))
  sheet.set("A", "1", 7)`;
    const diagnostics = typeCheck(parse(typedSheet));

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Return type str is not assignable to int.",
      "Argument 1 to add has type str, expected int.",
      "Argument 1 to Val has type str, expected int.",
      "Argument 2 to sheet.set has type str, expected int.",
    ]);
    expect(diagnostics.map(({ line, column, endColumn }) => ({ line, column, endColumn }))).toEqual([
      { line: 5, column: 3, endColumn: 17 },
      { line: 12, column: 13, endColumn: 16 },
      { line: 13, column: 13, endColumn: 16 },
      { line: 14, column: 18, endColumn: 21 },
    ]);
  });

  it("type checks valid sample-level calls without diagnostics", () => {
    const typedSheet = `type Expr = Val(int) | Empty
type CellAddress = (str, int)

def c(address: str) -> CellAddress

class Spreadsheet:
  def set(self, cell: CellAddress, expr: Expr) -> None

def test():
  sheet = Spreadsheet()
  sheet.set(c("A1"), Val(7))`;

    expect(typeCheck(parse(typedSheet))).toEqual([]);
  });

  it("lowers conservative function and dataclass shorthand syntax", async () => {
    const shorthandSheet = `class Point(x: int, y: int)

fn origin() -> Point:
  return Point(0, 0)

fn test():
  print(origin())`;

    const parsed = parse(shorthandSheet);
    const lowered = lower(parsed).source;

    expect(runnables(shorthandSheet)).toEqual([
      { name: "origin", line: 3 },
      { name: "test", line: 6 },
    ]);
    expect(parsed.classDecls).toEqual([
      {
        name: "Point",
        line: 1,
        snippet: "class Point(x: int, y: int)",
      },
    ]);
    expect(lowered).toContain(`from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
  x: int
  y: int`);
    expect(lowered).toContain("def origin() -> Point:");
    expect(simplifyRunResult(await runCodeSheet(shorthandSheet, "test", { cache: new Map() }))).toEqual({
      ok: true,
      stdout: ["Point(x=0, y=0)"],
    });
  });

  it("does not lower uppercase constructor calls as dataclass shorthand inside function bodies", async () => {
    const constructorCallSheet = `class Point(x: int, y: int)

def test():
  point = Point(0, 1)
  print(point)`;

    const lowered = lower(parse(constructorCallSheet)).source;

    expect(lowered).toContain("point = Point(0, 1)");
    expect(lowered).not.toContain("  class Point:");
    expect(simplifyRunResult(await runCodeSheet(constructorCallSheet, "test", { cache: new Map() }))).toEqual({
      ok: true,
      stdout: ["Point(x=0, y=1)"],
    });
  });

  it("completes fn signatures after lowering them to Python defs", async () => {
    const fnSheet = `fn add(x: int, y: int) -> int

fn test():
  print(add(1, 2))`;
    const prompts: string[] = [];

    const result = await runCodeSheet(fnSheet, "test", {
      cache: new Map(),
      complete(prompt) {
        prompts.push(prompt);
        return `def add(x: int, y: int) -> int:
  return x + y`;
      },
    });

    expect(simplifyRunResult(result)).toEqual({ ok: true, stdout: ["3"] });
    expect(prompts[0]).toContain("Your job is to finish the implementation of:\n\ndef add");
    expect(prompts[0]).not.toContain("Your job is to finish the implementation of:\n\nfn add");
  });

  it("exposes compiler hashes for lowered snippets", () => {
    const fnSheet = `fn add(x: int, y: int) -> int

fn test():
  print(add(1, 2))`;
    const parsed = parse(fnSheet);

    expect(hashCompletionInput(parsed, parsed.incompleteSnippets[0]!.snippet)).not.toBe(
      completionSnippetHashes(parsed)[0],
    );
    expect(completionSnippetHashes(parsed)[0]).toBe(
      hashCompletionInput(parsed, "def add(x: int, y: int) -> int"),
    );
  });

  it("completes methods inside dataclass shorthand classes", async () => {
    const classSheet = `class Counter(value: int):
  fn next(self) -> int

fn test():
  print(Counter(4).next())`;
    const cache: CodeCache = new Map();

    const result = await runCodeSheet(classSheet, "test", {
      cache,
      complete() {
        return `class Counter:
  value: int

  def next(self) -> int:
    return self.value + 1`;
      },
    });

    expect(simplifyRunResult(result)).toEqual({ ok: true, stdout: ["5"] });
    expect(Array.from(cache.values())[0]).toContain("def next(self) -> int:");
  });

  it("supports deeper definition-only function aliases", async () => {
    const functionSheet = `add(x: int, y: int) -> int

async load_total(x: int) -> int

test():
  print(add(2, 3))`;
    const prompts: string[] = [];

    const parsed = parse(functionSheet);
    const lowered = lower(parsed).source;

    expect(parsed.incompleteSnippets.map((snippet) => snippet.snippet)).toEqual([
      "add(x: int, y: int) -> int",
      "async load_total(x: int) -> int",
    ]);
    expect(lowered).toContain("def add(x: int, y: int) -> int");
    expect(lowered).toContain("async def load_total(x: int) -> int");

    const result = await runCodeSheet(functionSheet, "test", {
      cache: new Map(),
      complete(prompt) {
        prompts.push(prompt);
        const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
        if (target.includes("async def load_total")) {
          return `async def load_total(x: int) -> int:
  return x`;
        }

        return `def add(x: int, y: int) -> int:
  return x + y`;
      },
    });

    expect(simplifyRunResult(result)).toEqual({ ok: true, stdout: ["5"] });
    expect(prompts[0]).toContain("Your job is to finish the implementation of:\n\ndef add");
    expect(prompts[1]).toContain("Your job is to finish the implementation of:\n\nasync def");
  });

  it("lowers bare record definitions with defaults", async () => {
    const recordSheet = `User(name: str, active: bool = true):
  function label(self) -> str:
    return f"{self.name}:{self.active}"

test():
  print(User("Ada").label())`;

    const lowered = lower(parse(recordSheet)).source;

    expect(lowered).toContain(`@dataclass(frozen=True)
class User:
  name: str
  active: bool = True`);
    expect(lowered).toContain("def label(self) -> str:");
    expect(simplifyRunResult(await runCodeSheet(recordSheet, "test", { cache: new Map() }))).toEqual({
      ok: true,
      stdout: ["Ada:True"],
    });
  });

  it("lowers block records as class definitions", async () => {
    const definitionSheet = `record MemoryStore:
  items: dict[str, str]

  function get(self, key: str) -> str | None:
    return self.items.get(key)

function test():
  store = MemoryStore({"a": "1"})
  print(store.get("a"))
  print(MemoryStore.__name__)`;

    const lowered = lower(parse(definitionSheet)).source;

    expect(lowered).toContain(`@dataclass(frozen=True)
class MemoryStore:
  items: dict[str, str]`);
    expect(simplifyRunResult(await runCodeSheet(definitionSheet, "test", { cache: new Map() }))).toEqual({
      ok: true,
      stdout: ["1", "MemoryStore"],
    });
  });

  it("does not treat expression-bodied forms as supported function declarations", () => {
    const expressionFunctionSheet = `function add(x: int, y: int) -> int = x + y

function test():
  print(add(1, 2))`;

    const parsed = parse(expressionFunctionSheet);

    expect(parsed.incompleteSnippets).toEqual([]);
    expect(runnables(expressionFunctionSheet)).toEqual([{ name: "test", line: 3 }]);
    expect(lower(parsed).source).toContain("function add(x: int, y: int) -> int = x + y");
  });

  it("lowers bare type declarations and indentation-sensitive record blocks", async () => {
    const bareSheet = `Operator = Mul | Div
CellAddress = (str, int)

Cell:
  address: CellAddress
  active: bool = false

describe(cell: Cell) -> str:
  return f"{cell.address}:{cell.active}"

test():
  print(describe(Cell(("A", 1))))`;

    const lowered = lower(parse(bareSheet)).source;

    expect(lowered).toContain("Operator = Mul | Div");
    expect(lowered).toContain("CellAddress = tuple[str, int]");
    expect(lowered).toContain(`@dataclass(frozen=True)
class Cell:
  address: "CellAddress"
  active: bool = False`);
    expect(lowered).toContain("def describe(cell: Cell) -> str:");
    expect(simplifyRunResult(await runCodeSheet(bareSheet, "test", { cache: new Map() }))).toEqual({
      ok: true,
      stdout: ["('A', 1):False"],
    });
  });

  it("completes adjacent parser helper signatures as separate snippets", async () => {
    const parserSheet = `type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def parse_cell(str) -> CellAddress | None

def test():
  print(parse_cell("A1"))`;
    const prompts: string[] = [];

    await completeSheet(new Map(), parserSheet, (prompt) => {
      prompts.push(prompt);
      const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
      if (target.includes("def parse_cell")) {
        return `def parse_cell(source) -> CellAddress | None:
  return ("A", 1)`;
      }

      return `def parse_expr(source) -> None:
  return None`;
    });

    expect(prompts.map(completionPromptTarget)).toEqual([
      "def parse_expr(str) -> Expr | None",
      "def parse_cell(str) -> CellAddress | None",
    ]);
  });

  it("supports the CellAddress shorthand helper as a separate parser migration", async () => {
    const parserSheet = `type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def c(str) -> CellAddress

def test():
  print(c("A1"))`;
    const prompts: string[] = [];

    await completeSheet(new Map(), parserSheet, (prompt) => {
      prompts.push(prompt);
      const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
      if (target.includes("def c")) {
        return `def c(source) -> CellAddress:
  return ("A", 1)`;
      }

      return `def parse_expr(source) -> None:
  return None`;
    });

    expect(prompts.map(completionPromptTarget)).toEqual([
      "def parse_expr(str) -> Expr | None",
      "def c(str) -> CellAddress",
    ]);
  });

  it("uses dependency-aware completion hashes", () => {
    const baseSheet = `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr)
type EvalError = RecursiveError(list) | DivByZero

class Spreadsheet:
  cells: [[Expr]]

  def __init__(self) -> None
  def get(self, col: str, row: int) -> Expr | None
  def set(self, col: str, row: int, expr: Expr) -> None
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None
  def eval(self, col: str, row: int) -> int | EvalError | None
  def eval_inner(self, stack: list, col: str, row: int) -> int | EvalError | None`;
    const cellSheet = baseSheet.replace(
      "type Expr = Val(int) | BinOp(Operator, Expr, Expr)",
      "type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)",
    );
    const baseParsed = parse(baseSheet);
    const cellParsed = parse(cellSheet);
    const spreadsheetSnippet = baseParsed.classDecls.find((decl) => decl.name === "Spreadsheet")?.snippet ?? "";
    const resultSnippet = baseParsed.classDecls.find((decl) => decl.name === "SpreadsheetResult")?.snippet ?? "";
    const addSnippet = "def add(x: int, y: int) -> int";

    const baseSpreadsheetHash = hashCompletionInput(baseParsed, spreadsheetSnippet);
    const cellSpreadsheetHash = hashCompletionInput(cellParsed, spreadsheetSnippet);
    const baseResultHash = hashCompletionInput(baseParsed, resultSnippet);
    const cellResultHash = hashCompletionInput(cellParsed, resultSnippet);

    expect({
      rawSpreadsheetHashStable: hashSnippet(spreadsheetSnippet) === hashSnippet(spreadsheetSnippet),
      spreadsheetInvalidatedByExprChange: baseSpreadsheetHash !== cellSpreadsheetHash,
      resultInvalidatedByExprChange: baseResultHash !== cellResultHash,
      addUnaffectedByExprChange:
        hashCompletionInput(baseParsed, addSnippet) === hashCompletionInput(cellParsed, addSnippet),
      baseSpreadsheetHash,
      cellSpreadsheetHash,
      baseResultHash,
      cellResultHash,
    }).toMatchInlineSnapshot(`
      {
        "addUnaffectedByExprChange": true,
        "baseResultHash": "completion:4fc83828",
        "baseSpreadsheetHash": "completion:d3b9936c",
        "cellResultHash": "completion:55b5ca1d",
        "cellSpreadsheetHash": "completion:9fa11615",
        "rawSpreadsheetHashStable": true,
        "resultInvalidatedByExprChange": true,
        "spreadsheetInvalidatedByExprChange": true,
      }
    `);
  });

  it("reuses an explicitly referenced class when a natural snippet specifies size", async () => {
    const cache: CodeCache = new Map();
    const completionTargets: string[] = [];
    const sheetWithRequest = (request: string): string => `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def gen_magic_square():
  \`\`\`
  ${request} using {MagicSquare}
  pretty print it
  check the magic square is valid, and show the work
  \`\`\``;

    const complete = (prompt: string): string => {
      const isNatural = prompt.includes("Your job is to replace this natural-language Python fragment");
      completionTargets.push(isNatural ? "natural" : "class");

      if (!isNatural) {
        return `class MagicSquare:
  size: int

  def __init__(self, size: int = 7):
    self.size = size
    self.grid = []
  def gen(self) -> MagicSquare:
    return self
  def pretty(self) -> str:
    return ""`;
      }

      return `square = MagicSquare(${prompt.includes("size 7") ? 7 : 3}).gen()
print(square.pretty())`;
    };

    const baseParsed = parse(sheetWithRequest("generate a magic square"));
    const sizeParsed = parse(sheetWithRequest("generate a magic square of size 7"));
    const magicSquareSnippet = baseParsed.classDecls.find((decl) => decl.name === "MagicSquare")?.snippet ?? "";
    const naturalSnippet = baseParsed.incompleteSnippets.find((snippet) => snippet.kind === "natural")?.snippet ?? "";
    const changedClassParsed = parse(
      sheetWithRequest("generate a magic square").replace("size: int", "size: int\n  cells: list"),
    );
    expect(hashCompletionInput(baseParsed, magicSquareSnippet)).toBe(
      hashCompletionInput(sizeParsed, magicSquareSnippet),
    );
    expect(hashCompletionInput(baseParsed, naturalSnippet)).not.toBe(
      hashCompletionInput(changedClassParsed, naturalSnippet),
    );

    await completeSheet(cache, sheetWithRequest("generate a magic square"), complete);
    await completeSheet(cache, sheetWithRequest("generate a magic square of size 7"), complete);

    expect(completionTargets).toEqual(["class", "natural", "natural"]);
  });

  it("streams compilation events and renders partial and completed IR", async () => {
    const cache: CodeCache = new Map();
    const events: CompilationEvent[] = [];
    async function* complete(): AsyncIterable<string> {
      yield "def add(x: int, y: int) -> int:\n";
      yield "  return x + y";
    }

    for await (const event of compile(cache, sheet, complete)) {
      events.push(event);
    }

    const compiled = events.find((event) => event.kind === "compiled");
    if (compiled?.kind !== "compiled") {
      throw new Error("expected compiled event");
    }

    expect(events.map((event) => event.kind)).toEqual([
      "parsed",
      "typecheck",
      "implementation",
      "readiness",
      "llm-start",
      "llm-token",
      "llm-token",
      "llm-complete",
      "implementation",
      "readiness",
      "compiled",
    ]);
    expect(renderImplementation(compiled.completed.ir)).toContain(
      "def add(x: int, y: int) -> int:\n  return x + y",
    );
    expect(cache.get(compiled.completed.completions[0].hash)).toBe(
      "def add(x: int, y: int) -> int:\n  return x + y",
    );
  });

  it("agentic compilation produces a whole-sheet cache entry that run can reuse", async () => {
    const cache: CodeCache = new Map();
    const events: CompilationEvent[] = [];
    const prompts: string[] = [];

    for await (const event of compile(
      cache,
      sheet,
      (prompt) => {
        prompts.push(prompt);
        return `def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1,2))`;
      },
      { strategy: "agentic" },
    )) {
      events.push(event);
    }

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("compile this Logos worksheet");
    expect(events.map((event) => event.kind)).toContain("llm-start");
    await expect(cachedCompiledSheet(cache, sheet)).resolves.toMatchObject({
      source: expect.stringContaining("return x + y"),
    });

    const result = await runCodeSheet(sheet, "test", {
      cache,
      complete: () => {
        throw new Error("run should use cached compiled sheet");
      },
    });
    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["3"],
    });
  });

  it("can start independent completions in parallel", async () => {
    const sheetWithTwoSnippets = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(add(1, 2))
  print(mul(2, 3))`;
    const started: string[] = [];
    const resolvers: Array<(value: string) => void> = [];
    const compileTask = (async (): Promise<CompilationEvent[]> => {
      const events: CompilationEvent[] = [];
      for await (const event of compile(
        new Map(),
        sheetWithTwoSnippets,
        (prompt) => {
          const target = completionPromptTarget(prompt).includes("def add(") ? "add" : "mul";
          started.push(target);
          return new Promise<string>((resolve) => {
            resolvers.push(resolve);
          });
        },
        { strategy: "parallel" },
      )) {
        events.push(event);
      }
      return events;
    })();

    for (let attempt = 0; attempt < 20 && resolvers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(started.sort()).toEqual(["add", "mul"]);
    expect(resolvers).toHaveLength(2);

    resolvers[0](`def add(x: int, y: int) -> int:
  return x + y`);
    resolvers[1](`def mul(x: int, y: int) -> int:
  return x * y`);

    const events = await compileTask;
    const compiled = events.find((event) => event.kind === "compiled");
    if (compiled?.kind !== "compiled") {
      throw new Error("expected compiled event");
    }

    expect(renderImplementation(compiled.completed.ir)).toContain("return x + y");
    expect(renderImplementation(compiled.completed.ir)).toContain("return x * y");
  });

  it("streams tokens from parallel completions before all snippets finish", async () => {
    const sheetWithTwoSnippets = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(add(1, 2))
  print(mul(2, 3))`;
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const events: CompilationEvent[] = [];
    const compileTask = (async (): Promise<CompilationEvent[]> => {
      for await (const event of compile(
        new Map(),
        sheetWithTwoSnippets,
        (prompt) => {
          const target = completionPromptTarget(prompt).includes("def add(") ? "add" : "mul";
          async function* completion(): AsyncIterable<string> {
            started.push(target);
            if (target === "add") {
              yield "def add(x: int, y: int) -> int:\n";
            } else {
              yield "def mul(x: int, y: int) -> int:\n";
            }
            await new Promise<void>((resolve) => releases.push(resolve));
            yield target === "add" ? "  return x + y" : "  return x * y";
          }
          return completion();
        },
        { strategy: "parallel" },
      )) {
        events.push(event);
      }
      return events;
    })();

    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    await eventually(() => expect(events.filter((event) => event.kind === "llm-token")).toHaveLength(2));
    expect(events.some((event) => event.kind === "llm-complete")).toBe(false);

    for (const release of releases) {
      release();
    }

    const finalEvents = await compileTask;
    expect(finalEvents.filter((event) => event.kind === "llm-token")).toHaveLength(4);
    expect(finalEvents.filter((event) => event.kind === "llm-complete")).toHaveLength(2);
    expect(finalEvents.at(-1)?.kind).toBe("compiled");
  });

  it("can compile to a partial implementation when snippets are unresolved", async () => {
    const events: CompilationEvent[] = [];

    for await (const event of compile(new Map(), sheet)) {
      events.push(event);
    }

    const compiled = events.find((event) => event.kind === "compiled");
    if (compiled?.kind !== "compiled") {
      throw new Error("expected compiled event");
    }

    expect(events.map((event) => event.kind)).toEqual([
      "parsed",
      "typecheck",
      "implementation",
      "readiness",
      "compiled",
    ]);
    expect(compiled.completed.completions).toEqual([]);
    expect(renderImplementation(compiled.completed.ir)).toBe(sheet);
  });

  it("emits cache hits without invoking the LLM", async () => {
    const cache: CodeCache = new Map();
    const first = await completeSheet(cache, sheet, () => `def add(x: int, y: int) -> int:
  return x + y`);
    const events: CompilationEvent[] = [];

    for await (const event of compile(cache, sheet, () => {
      throw new Error("should not complete cached snippet");
    })) {
      events.push(event);
    }

    expect(first.completions).toHaveLength(1);
    expect(events.map((event) => event.kind)).toEqual([
      "parsed",
      "typecheck",
      "cache-hit",
      "implementation",
      "readiness",
      "compiled",
    ]);
  });

  it("can compile cached sheets without emitting intermediate progress", async () => {
    const cache: CodeCache = new Map();
    const first = await completeSheet(cache, sheet, () => `def add(x: int, y: int) -> int:
  return x + y`);
    const events: CompilationEvent[] = [];

    for await (const event of compile(cache, sheet, () => {
      throw new Error("should not complete cached snippet");
    }, {
      emitProgress: false,
      streamTokens: false,
    })) {
      events.push(event);
    }

    const compiled = events[0];
    if (compiled?.kind !== "compiled") {
      throw new Error("expected compiled event");
    }

    expect(first.completions).toHaveLength(1);
    expect(events.map((event) => event.kind)).toEqual(["compiled"]);
    expect(compiled.completed.completions).toEqual([
      expect.objectContaining({ cached: true, replacement: first.completions[0].replacement }),
    ]);
  });

  it("preserves top-level helper constants returned with class completions", async () => {
    const completed = await completeSheet(
      new Map(),
      `class Greeter:
  def greet(self, name: str) -> str

def test():
  print(Greeter().greet("Ada"))`,
      () => `PREFIX = "Hello"

class Greeter:
  def greet(self, name: str) -> str:
    return Entry(f"{PREFIX}, {name}{SUFFIX}").value

SUFFIX = "!"

class Entry:
  def __init__(self, value: str):
    self.value = value

class Unused:
  pass`,
    );

    expect(completed.source).toContain(`PREFIX = "Hello"`);
    expect(completed.source).toContain(`SUFFIX = "!"`);
    expect(completed.source).toContain("class Entry:");
    expect(completed.source).toContain("class Greeter:");
    expect(completed.source).not.toContain("class Unused:");
    expect(simplifyRunResult(await runCodeSheet(completed.source, "test"))).toEqual({
      ok: true,
      stdout: ["Hello, Ada!"],
    });
  });

  it("preserves top-level imports returned before unrelated class completion helpers", async () => {
    const result = await runCodeSheet(
      `class Store:
  def __init__(self) -> None
  def set(self, key: str, value: int) -> None
  def get(self, key: str) -> int | None

def test():
  store = Store()
  store.set("a", 7)
  print(store.get("a"))`,
      "test",
      {
        complete() {
          return `from collections import defaultdict

def unrelated_helper():
  return "extra"

class Store:
  def __init__(self) -> None:
    self.values = defaultdict(lambda: None)

  def set(self, key: str, value: int) -> None:
    self.values[key] = value

  def get(self, key: str) -> int | None:
    return self.values[key]`;
        },
      },
    );

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["7"],
    });
    expect(result.completed.source).toContain("from collections import defaultdict");
    expect(result.completed.source).not.toContain("def unrelated_helper");
  });

  it("preserves top-level helper functions returned with class completions", async () => {
    const completed = await completeSheet(
      new Map(),
      `class Greeter:
  def greet(self, name: str) -> str

def test():
  print(Greeter().greet("Ada"))
  print(shout("bye"))`,
      () => `def prefix() -> str:
  return "Hello"

class Greeter:
  def greet(self, name: str) -> str:
    return f"{prefix()}, {name}"

def shout(message: str) -> str:
  return message.upper()`,
    );

    expect(completed.source).toContain("def prefix() -> str:");
    expect(completed.source).toContain("class Greeter:");
    expect(completed.source).toContain("def shout(message: str) -> str:");
    expect(simplifyRunResult(await runCodeSheet(completed.source, "test"))).toEqual({
      ok: true,
      stdout: ["Hello, Ada", "BYE"],
    });
  });

  it("preserves top-level helper functions returned with function completions", async () => {
    const completed = await completeSheet(
      new Map(),
      `def greet(name: str) -> str

def test():
  print(greet("Ada"))
  print(shout("bye"))`,
      () => `def prefix() -> str:
  return "Hello"

def greet(name: str) -> str:
  return f"{prefix()}, {name}"

def shout(message: str) -> str:
  return message.upper()`,
    );

    expect(completed.source).toContain("def prefix() -> str:");
    expect(completed.source).toContain("def greet(name: str) -> str:");
    expect(completed.source).toContain("def shout(message: str) -> str:");
    expect(simplifyRunResult(await runCodeSheet(completed.source, "test"))).toEqual({
      ok: true,
      stdout: ["Hello, Ada", "BYE"],
    });
  });

  it("supports natural-language backtick expressions anywhere", async () => {
    const cache: CodeCache = new Map();
    const calls: string[] = [];
    const expressionSheet = `def test():
  foo = \`add 1 and 2\`
  bar = \`multiply 3 and 4\`
  return foo + bar

def main():
  print(test())`;
    const complete = (prompt: string): string => {
      calls.push(prompt);
      if (prompt.includes("`add 1 and 2`")) {
        return "1 + 2";
      }

      if (prompt.includes("`multiply 3 and 4`")) {
        return "3 * 4";
      }

      throw new Error(`unexpected prompt: ${prompt}`);
    };

    const first = await runCodeSheet(expressionSheet, "main", { complete, cache });
    const second = await runCodeSheet(expressionSheet, "main", {
      cache,
      complete: () => {
        throw new Error("should not complete cached snippet");
      },
    });

    expect({
      calls: calls.map((prompt) => prompt.split("Your job is to replace this natural-language Python fragment with valid Python code:").at(-1)?.trim()),
      first: simplifyRunResult(first),
      second: simplifyRunResult(second),
      cache: Array.from(cache.entries()),
    }).toMatchInlineSnapshot(`
      {
        "cache": [
          [
            "completion:8951e575",
            "1 + 2",
          ],
          [
            "completion:0547a7cc",
            "3 * 4",
          ],
        ],
        "calls": [
          "\`add 1 and 2\`

      Return only the replacement code for the fragment, without backticks or fences.
      This is a single-backtick natural-language fragment. Return a Python expression by default, especially for calculation/value requests such as calculate, sum, count, or find. Return statements only when the fragment explicitly asks for an imperative side effect such as printing, assignment, mutation, raising, sleeping, looping, rendering, displaying, or showing output. For render/display/show requests that produce a string, make the result visible with print(...). Do not wrap expression results in print unless the fragment explicitly asks for visible output.
      If imports are needed, include normal Python import/from lines before the replacement; those imports will be added to the file top.
      Use only Python's standard library and code already present in the sheet; do not import third-party packages.
      For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.
      When generating visible output, prefer self-explanatory printing over raw value dumps:
      - Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
      - For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
      - For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
      - For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
      - Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
      - Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.
      Do not assign local variables, loop variables, classes, or functions with the same names as top-level helpers, classes, or constructors already present in the sheet.
      Use normal Python and preserve the intended public behavior shown in the runnable/test functions.",
          "\`multiply 3 and 4\`

      Return only the replacement code for the fragment, without backticks or fences.
      This is a single-backtick natural-language fragment. Return a Python expression by default, especially for calculation/value requests such as calculate, sum, count, or find. Return statements only when the fragment explicitly asks for an imperative side effect such as printing, assignment, mutation, raising, sleeping, looping, rendering, displaying, or showing output. For render/display/show requests that produce a string, make the result visible with print(...). Do not wrap expression results in print unless the fragment explicitly asks for visible output.
      If imports are needed, include normal Python import/from lines before the replacement; those imports will be added to the file top.
      Use only Python's standard library and code already present in the sheet; do not import third-party packages.
      For colored terminal output, use raw ANSI SGR escape sequences such as "\\033[32m" for green and "\\033[0m" to reset. Do not use colorama, rich, blessed, termcolor, or other terminal-color packages.
      When generating visible output, prefer self-explanatory printing over raw value dumps:
      - Prefer labels and prefixes such as print("Total:", total) over print(total) when the value is not obvious from the output alone.
      - For multi-section output, print a clear section header, then a blank line before that section's content, and print a blank line between sections.
      - For grids, boards, tables, puzzles, or ASCII art, render an aligned or bordered text layout instead of printing Python lists or object reprs.
      - For tables, include column headers and row labels when they help the user understand the data; keep enough spacing between columns for values and formulas to scan cleanly.
      - Use ANSI colors sparingly to clarify terminal drawings, status, or validation, while keeping the output readable without color.
      - Do not assume helper methods such as pretty(), render(), or __str__ exist unless the sheet declares them or you implement them inside the requested class.
      Do not assign local variables, loop variables, classes, or functions with the same names as top-level helpers, classes, or constructors already present in the sheet.
      Use normal Python and preserve the intended public behavior shown in the runnable/test functions.",
        ],
        "first": {
          "ok": true,
          "stdout": [
            "15",
          ],
        },
        "second": {
          "ok": true,
          "stdout": [
            "15",
          ],
        },
      }
    `);
  });

  it("ignores natural-language backticks in comments", () => {
    const parsed = parse(`# Click the run button to run this class once it is compiled.
# Click \`test\` in the code view to see its implementation.
def test():
  value = \`add 1 and 2\`
  # Ignore \`this comment fragment\` too.
  return value`);

    expect(parsed.incompleteSnippets.map((snippet) => snippet.snippet)).toEqual([
      "`add 1 and 2`",
    ]);
  });

  it("hoists imports returned for natural-language expressions", async () => {
    const completed = await runCodeSheet(
      `def add(x: int, y: int) -> int

def test():
  print(\`the square root of 5\`)`,
      "test",
      {
        complete: (prompt) => {
          if (
            prompt.includes("Your job is to replace this natural-language Python fragment") &&
            prompt.includes("`the square root of 5`")
          ) {
            return `import math
math.sqrt(5)`;
          }

          if (
            prompt.includes("Your job is to finish the implementation of:") &&
            prompt.includes("def add(x: int, y: int) -> int")
          ) {
            return `def add(x: int, y: int) -> int:
  return x + y`;
          }

          throw new Error(`unexpected prompt: ${prompt}`);
        },
      },
    );

    expect({
      source: completed.completed.source,
      run: simplifyRunResult(completed),
    }).toMatchInlineSnapshot(`
      {
        "run": {
          "ok": true,
          "stdout": [
            "2.23606797749979",
          ],
        },
        "source": "import math

      def add(x: int, y: int) -> int:
        return x + y

      def test():
        print(math.sqrt(5))",
      }
    `);
  });

  it("asks single-backtick calculations to produce expressions by default", async () => {
    const calls: string[] = [];
    const completed = await runCodeSheet(
      `def main():
  print(\`calculate the sum of all primes less than 50\`)`,
      "main",
      {
        complete(prompt) {
          calls.push(prompt);
          expect(prompt).toContain("This is a single-backtick natural-language fragment.");
          expect(prompt).toContain("Return a Python expression by default");
          expect(prompt).toContain("Do not wrap expression results in print");
          return "sum(candidate for candidate in range(2, 50) if all(candidate % divisor != 0 for divisor in range(2, candidate)))";
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect({
      source: completed.completed.source,
      run: simplifyRunResult(completed),
    }).toMatchInlineSnapshot(`
      {
        "run": {
          "ok": true,
          "stdout": [
            "328",
          ],
        },
        "source": "def main():
        print(sum(candidate for candidate in range(2, 50) if all(candidate % divisor != 0 for divisor in range(2, candidate))))",
      }
    `);
  });

  it("injects logos debug print annotation context into natural block completion prompts", async () => {
    const calls: string[] = [];
    const annotatedSheet = [
      "@logos.debug.print()",
      "def test():",
      "  ```",
      "  define a sheet",
      "  A1 -> None",
      "  A1 = 7",
      "  A1 -> 7",
      "  ```",
    ].join("\n");

    const completed = await completeSheet(new Map(), annotatedSheet, (prompt) => {
      calls.push(prompt);
      expect(prompt).toContain("This is a triple-backtick natural-language block.");
      expect(prompt).toContain("Apply these Logos annotation contexts while generating the replacement:");
      expect(prompt).toContain(
        "logos.debug.print(): when generating code, make sure to add thoughtful and reasonable print statements",
      );
      expect(prompt).not.toContain("@logos.debug.print()");
      return [
        "sheet = {}",
        'print("A1 ->", sheet.get("A1"))',
        'sheet["A1"] = 7',
        'print("A1 ->", sheet.get("A1"))',
      ].join("\n");
    });

    expect(calls).toHaveLength(1);
    expect(completed.source).not.toContain("@logos");
    expect(completed.source).toMatchInlineSnapshot(`
      "def test():
        sheet = {}
        print("A1 ->", sheet.get("A1"))
        sheet["A1"] = 7
        print("A1 ->", sheet.get("A1"))"
    `);
  });

  it("includes logos annotation contexts in natural snippet completion hashes", () => {
    const plainSheet = [
      "def test():",
      "  ```",
      "  define a sheet",
      "  A1 -> None",
      "  ```",
    ].join("\n");
    const annotatedSheet = [
      "@logos.debug.print()",
      "def test():",
      "  ```",
      "  define a sheet",
      "  A1 -> None",
      "  ```",
    ].join("\n");
    const plainParsed = parse(plainSheet);
    const annotatedParsed = parse(annotatedSheet);
    const plainSnippet = plainParsed.incompleteSnippets[0];
    const annotatedSnippet = annotatedParsed.incompleteSnippets[0];

    expect(annotatedSnippet?.annotationContexts).toEqual([
      expect.objectContaining({
        annotation: "logos.debug.print()",
        cacheKey: "logos.debug.print-v1",
      }),
    ]);
    expect(plainSnippet?.snippet).toBe(annotatedSnippet?.snippet);
    expect(
      hashCompletionInput(plainParsed, plainSnippet?.snippet ?? "", plainSnippet?.annotationContexts),
    ).not.toBe(
      hashCompletionInput(
        annotatedParsed,
        annotatedSnippet?.snippet ?? "",
        annotatedSnippet?.annotationContexts,
      ),
    );
  });

  it("strips logos annotations from runnable functions without snippets", async () => {
    const completed = await runCodeSheet(
      `@logos.debug.print()
def test():
  print("ready")`,
      "test",
    );

    expect({
      source: completed.completed.source,
      run: simplifyRunResult(completed),
    }).toEqual({
      source: `def test():
  print("ready")`,
      run: {
        ok: true,
        stdout: ["ready"],
      },
    });
  });

  it("supports natural-language backtick statements anywhere", async () => {
    const statementSheet = `def test():
  \`print all primes smaller than 50\``;
    const completed = await completeSheet(new Map(), statementSheet, () => `for candidate in range(2, 50):
  if all(candidate % divisor != 0 for divisor in range(2, candidate)):
    print(candidate)`);

    expect({
      source: completed.source,
      run: simplifyRunResult(await runCodeSheet(completed.source, "test")),
    }).toMatchInlineSnapshot(`
      {
        "run": {
          "ok": true,
          "stdout": [
            "2",
            "3",
            "5",
            "7",
            "11",
            "13",
            "17",
            "19",
            "23",
            "29",
            "31",
            "37",
            "41",
            "43",
            "47",
          ],
        },
        "source": "def test():
        for candidate in range(2, 50):
          if all(candidate % divisor != 0 for divisor in range(2, candidate)):
            print(candidate)",
      }
    `);
  });

  it("strips prose prefixes from natural-language statement completions", async () => {
    const completed = await runCodeSheet(
      `def test():
  \`print hello\``,
      "test",
      {
        complete: () => `Here is the replacement code for the natural-language fragment:
print("hello")`,
      },
    );

    expect({
      source: completed.completed.source,
      run: simplifyRunResult(completed),
    }).toEqual({
      source: `def test():
  print("hello")`,
      run: {
        ok: true,
        stdout: ["hello"],
      },
    });
  });

  it("can observe the first stdout line from a generated delayed loop before later sleeps finish", async () => {
    const delayMs = 500;
    const fractalSheet = `def add(x: int, y: int) -> int

def test():
  \`a for loop where a random fractal is printed every 10 seconds and printed in ascii of width 20 (no delay on the first print)\``;
    const startedAt = Date.now();
    let firstFractalLineMs: number | null = null;

    const result = await runCodeSheet(fractalSheet, "test", {
      complete(prompt) {
        if (prompt.includes("Your job is to finish the implementation of:")) {
          return `def add(x: int, y: int) -> int:
  return x + y`;
        }

        return `import time

for i in range(3):
  if i != 0:
    time.sleep(${delayMs / 1000})
  print(f"fractal {i}")
  for row in range(10):
    print("#" * 20 if row in (0, 9) else "#" + "." * 18 + "#")`;
      },
      onStdoutLine(line) {
        if (line === "fractal 0" && firstFractalLineMs === null) {
          firstFractalLineMs = Date.now() - startedAt;
        }
      },
    });

    expect(result.ok).toBe(true);
    expect(firstFractalLineMs).not.toBeNull();
    expect(firstFractalLineMs ?? Number.POSITIVE_INFINITY).toBeLessThan(delayMs);
    expect(result.stdout.slice(0, 11)).toEqual([
      "fractal 0",
      "####################",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "####################",
    ]);
    expect(result.stdout).toHaveLength(33);
  });

  it("supports fenced natural-language snippets", async () => {
    const cache: CodeCache = new Map();
    const calls: string[] = [];
    const sheet = `def test():
  total = \`\`\`
add one and two
then multiply by three
\`\`\`
  \`\`\`
print the total
on its own line
\`\`\``;

    const completed = await runCodeSheet(sheet, "test", {
      cache,
      complete(prompt) {
        calls.push(prompt);
        if (prompt.includes("add one and two")) {
          return "(1 + 2) * 3";
        }

        if (prompt.includes("print the total")) {
          return "print(total)";
        }

        throw new Error(`unexpected prompt: ${prompt}`);
      },
    });

    expect(simplifyRunResult(completed)).toEqual({ ok: true, stdout: ["9"] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`\`\`\`
add one and two
then multiply by three
\`\`\``);
    expect(calls[1]).toContain(`\`\`\`
print the total
on its own line
\`\`\``);
    expect(Array.from(cache.values())).toEqual(["(1 + 2) * 3", "print(total)"]);
  });

  it("does not double-indent mixed-indentation fenced statement completions", async () => {
    const sheet = `# Render fractals in the command line.
# Outputs are 24 characters tall, 64 characters wide.
# Use only these density characters, from empty to bright: " .:-=+*#%@".
# Keep the background mostly empty, with detail clustered into readable forms.

class AsciiArt:
  def render() -> str
  def rotate() -> AsciiArt

# Return a deterministic ASCII mandelbrot fractal.
def mandelbrot() -> AsciiArt

def main():
  \`\`\`
  print mandelbrot regularly and then rotated by 90*
  \`\`\``;

    const result = await runCodeSheet(sheet, "main", {
      cache: new Map(),
      complete(prompt) {
        if (prompt.includes("Your job is to replace this natural-language Python fragment")) {
          return `art = mandelbrot()
  print(art.render())
  print()
  rotated = art.rotate()
  print(rotated.render())`;
        }

        const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
        if (target.includes("class AsciiArt:")) {
          return `class AsciiArt:
  def __init__(self, value: str):
    self.value = value

  def render(self) -> str:
    return self.value

  def rotate(self) -> AsciiArt:
    return AsciiArt(f"{self.value} rotated")`;
        }

        if (target.includes("def mandelbrot() -> AsciiArt")) {
          return `def mandelbrot() -> AsciiArt:
  return AsciiArt("@")`;
        }

        throw new Error(`unexpected prompt: ${prompt}`);
      },
    });

    expect(simplifyRunResult(result)).toEqual({ ok: true, stdout: ["@", "", "@ rotated"] });
    expect(result.completed.source).toContain(`def main():
  art = mandelbrot()
  print(art.render())
  print()
  rotated = art.rotate()
  print(rotated.render())`);
  });

  it("does not lower code-like text inside fenced natural-language snippets", async () => {
    const sheet = `def test():
  \`\`\`
User(name: str, active: bool = true):
  function label(self) -> str
\`\`\``;
    const parsed = parse(sheet);
    const lowered = lower(parsed).source;

    expect(parsed.incompleteSnippets.map((snippet) => snippet.kind)).toEqual(["natural"]);
    expect(parsed.incompleteSnippets[0]?.snippet).toContain("function label(self) -> str");
    expect(lowered).toContain("User(name: str, active: bool = true):");
    expect(lowered).toContain("function label(self) -> str");
    expect(lowered).not.toContain("@dataclass");
    expect(lowered).not.toContain("def label(self) -> str");
  });

  it("models readiness through incomplete definitions and dependencies", async () => {
    const cache: CodeCache = new Map();
    const parsed = parse(sheet);

    expect(definitionReadiness(parsed, cache)).toEqual([
      {
        name: "add",
        line: 1,
        kind: "function",
        ready: false,
        reason: "implementation",
        dependencies: [],
        blockingDependencies: [],
      },
      {
        name: "test",
        line: 3,
        kind: "function",
        ready: false,
        reason: "dependency",
        dependencies: ["add"],
        blockingDependencies: ["add"],
      },
    ]);

    await completeSheet(cache, sheet, () => `def add(x: int, y: int) -> int:
  return x + y`);

    expect(definitionReadiness(parsed, cache)).toEqual([
      {
        name: "add",
        line: 1,
        kind: "function",
        ready: true,
        dependencies: [],
        blockingDependencies: [],
      },
      {
        name: "test",
        line: 3,
        kind: "function",
        ready: true,
        dependencies: ["add"],
        blockingDependencies: [],
      },
    ]);
  });

  it("does not mark a runnable with only comments ready when its dependencies are ready", () => {
    const parsed = parse(`def helper():
  return 1

def test():
  # helper is ready, but this runnable has no executable body`);

    expect(definitionReadiness(parsed, new Map()).find((definition) => definition.name === "test")).toMatchObject({
      name: "test",
      ready: false,
      reason: "implementation",
      dependencies: ["helper"],
      blockingDependencies: [],
    });
  });

  it("finds implementation targets for complete functions and classes", () => {
    const source = `class Counter:
  def next(self) -> int:
    return 1

def main():
  print(Counter().next())`;
    const classTarget = implementationTargetAtLine(source, 2);
    const functionTarget = implementationTargetAtLine(source, 5);

    expect(classTarget).toEqual({
      kind: "class",
      name: "Counter",
      line: 1,
      endLine: 3,
      source: `class Counter:
  def next(self) -> int:
    return 1`,
    });
    expect(functionTarget).toEqual({
      kind: "function",
      name: "main",
      line: 5,
      endLine: 6,
      source: `def main():
  print(Counter().next())`,
    });
  });

  it("maps cursor locations inside a multi-line function to the enclosing implementation", () => {
    const { source, positions } = sourceWithCursorMarkers(`def test_basic():|
  # In Logos, |you can use regular python...
  print(mul(add(1, 2), 3))|
|
  # Or use a snippet to have |the LLM write it for you...
  \`print mul of (add one and two) and 3\`
  |print(mul(add(\`the number one\`, \`the number two\`), \`the number three\`))
|
  added = \`add 1 and 2\`
  product = \`mul 3 and 4\`
  print(added)
  print(product)`);

    expect(positions).toHaveLength(7);
    expect(positions.map((position) => {
      const context = selectionContextAtPosition(source, position.line, position.column);
      return context.kind === "implementation" ? context.target.name : context.kind;
    })).toEqual([
      "test_basic",
      "test_basic",
      "test_basic",
      "test_basic",
      "test_basic",
      "test_basic",
      "test_basic",
    ]);
  });

  it("maps exact natural-snippet cursor locations to snippets before the enclosing function", () => {
    const { source, positions } = sourceWithCursorMarkers(`def test_basic():
  added = \`add 1 |and 2\`
  print(added)`);
    const context = selectionContextAtPosition(source, positions[0]!.line, positions[0]!.column);

    expect(context.kind).toBe("snippet");
    if (context.kind === "snippet") {
      expect(context.snippet.kind).toBe("natural");
      expect(context.snippet.snippet).toBe("`add 1 and 2`");
    }
  });

  it("maps cursor locations immediately after backtick snippets to the preceding snippet", () => {
    const { source, positions } = sourceWithCursorMarkers(`def main():
  \`foo\`|
  \`bar\`|`);

    expect(positions).toHaveLength(2);
    expect(positions.map((position) => {
      const context = selectionContextAtPosition(source, position.line, position.column);
      return context.kind === "snippet" ? context.snippet.snippet : context.kind;
    })).toEqual([
      "`foo`",
      "`bar`",
    ]);
  });

  it("extracts the generated implementation for a clicked function with natural statements", () => {
    const source = `def main():
  \`print 4\`
  \`print 1 + 2\`

  foo = \`calculate the sum of all primes less than 50\`
  print(foo)`;
    const implementation = `def main():
  print(4)
  print(1 + 2)

  foo = 328
  print(foo)`;
    const target = implementationTargetAtLine(source, 1);

    expect(target?.name).toBe("main");
    expect(target).not.toBeNull();
    expect(implementationBlockForTarget(implementation, target!)).toBe(implementation);
  });

  it("extracts the generated implementation for a clicked class method", () => {
    const source = `class Counter:
  def next(self) -> int

def main():
  print(Counter().next())`;
    const implementation = `class Counter:
  def next(self) -> int:
    return 1

def main():
  print(Counter().next())`;
    const target = implementationTargetAtLine(source, 2);

    expect(target?.kind).toBe("class");
    expect(implementationBlockForTarget(implementation, target!)).toBe(`class Counter:
  def next(self) -> int:
    return 1`);
  });

  it("finds the full implementation target for a typed class with incomplete methods", () => {
    const source = `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def gen_magic_square():
  pass`;
    const target = implementationTargetAtLine(source, 1);

    expect(target).toEqual({
      kind: "class",
      name: "MagicSquare",
      line: 1,
      endLine: 5,
      source: `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str`,
    });
  });

  it("keeps completed cache entries after cancelling an in-progress compile", async () => {
    const cache: CodeCache = new Map();
    const abortController = new AbortController();
    const firstEvents: CompilationEvent[] = [];
    const calls: string[] = [];
    const complete = (prompt: string): string => {
      calls.push(prompt);
      abortController.abort();
      return `def add(x: int, y: int) -> int:
  return x + y`;
    };

    for await (const event of compile(cache, multiIncompleteSheet, complete, {
      signal: abortController.signal,
    })) {
      firstEvents.push(event);
    }

    expect(firstEvents.map((event) => event.kind)).toEqual([
      "parsed",
      "typecheck",
      "implementation",
      "readiness",
      "llm-start",
    ]);
    expect(calls).toHaveLength(1);
    expect(cache.size).toBe(1);

    const secondEvents: CompilationEvent[] = [];
    const secondComplete = (prompt: string): string => {
      calls.push(prompt);
      return `def mul(x: int, y: int) -> int:
  return x * y`;
    };

    for await (const event of compile(cache, multiIncompleteSheet, secondComplete)) {
      secondEvents.push(event);
    }

    expect(secondEvents.map((event) => event.kind)).toEqual([
      "parsed",
      "typecheck",
      "cache-hit",
      "implementation",
      "readiness",
      "llm-start",
      "llm-complete",
      "implementation",
      "readiness",
      "compiled",
    ]);
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(2);
  });

  it("can start independent completions in parallel", async () => {
    const started: string[] = [];
    const resolvers: Array<(replacement: string) => void> = [];

    const eventsPromise = (async () => {
      const events: CompilationEvent[] = [];
      for await (const event of compile(
        new Map(),
        multiIncompleteSheet,
        (prompt) => {
          const target = completionPromptTarget(prompt).includes("def mul(") ? "mul" : "add";
          started.push(target);
          return new Promise<string>((resolve) => {
            resolvers.push(resolve);
          });
        },
        { strategy: "parallel" },
      )) {
        events.push(event);
      }
      return events;
    })();

    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    expect(resolvers).toHaveLength(2);
    resolvers[0](`def add(x: int, y: int) -> int:
  return x + y`);
    resolvers[1](`def mul(x: int, y: int) -> int:
  return x * y`);

    const events = await eventsPromise;
    expect(events.filter((event) => event.kind === "llm-start")).toHaveLength(2);
    expect(events.at(-1)?.kind).toBe("compiled");
  });

  it("passes parallel strategy through the runner", async () => {
    const started: string[] = [];
    const resolvers: Array<(replacement: string) => void> = [];

    const runPromise = runCodeSheet(multiIncompleteSheet, "test", {
      compilationStrategy: "parallel",
      complete(prompt) {
        const target = completionPromptTarget(prompt).includes("def mul(") ? "mul" : "add";
        started.push(target);
        return new Promise<string>((resolve) => {
          resolvers.push(resolve);
        });
      },
    });

    await eventually(() => expect([...started].sort()).toEqual(["add", "mul"]));
    expect(resolvers).toHaveLength(2);
    resolvers[0](`def add(x: int, y: int) -> int:
  return x + y`);
    resolvers[1](`def mul(x: int, y: int) -> int:
  return x * y`);

    expect(simplifyRunResult(await runPromise)).toEqual({
      ok: true,
      stdout: ["2"],
    });
  });

  it("agentic strategy edits the whole file and retries after runtime feedback", async () => {
    const prompts: string[] = [];
    const result = await runCodeSheet(sheet, "test", {
      compilationStrategy: "agentic",
      agenticMaxIterations: 3,
      complete(prompt) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return JSON.stringify({
            tool: "replace_file",
            source: `def add(x: int, y: int) -> int:
  raise RuntimeError("bad draft")

def test():
  print(add(1, 2))`,
          });
        }

        return JSON.stringify({
          tool: "replace_file",
          source: `def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1, 2))`,
        });
      },
    });

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["3"],
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("bad draft");
  });

  it("agentic strategy can patch exact incomplete snippets instead of replacing the whole file", async () => {
    const prompts: string[] = [];
    const snippet = `def add(x: int, y: int) -> int`;
    const result = await runCodeSheet(sheet, "test", {
      compilationStrategy: "agentic",
      agenticMaxIterations: 3,
      complete(prompt) {
        prompts.push(prompt);
        expect(prompt).toContain(JSON.stringify(snippet));
        return JSON.stringify({
          tool: "replace_snippets",
          replacements: [{
            snippet,
            replacement: `def add(x: int, y: int) -> int:
  return x + y`,
          }],
        });
      },
    });

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["3"],
    });
    expect(prompts).toHaveLength(1);
    expect(result.completed.source).toBe(`def add(x: int, y: int) -> int:
  return x + y

def test():
  print(add(1,2))`);
  });

  it("agentic methods strategy completes sibling class methods in parallel", async () => {
    const methodSheet = `class IsoScene:
  def render(self) -> str
  def rotate_y(self, turns: int = 1) -> "IsoScene"

def cube_stack() -> IsoScene

def test():
  print(cube_stack().render())
  print(cube_stack().rotate_y().render())`;
    const started: string[] = [];
    const resolvers: Array<(replacement: string) => void> = [];

    const runPromise = runCodeSheet(methodSheet, "test", {
      compilationStrategy: "agentic-methods",
      complete(prompt) {
        const targetSnippet = prompt.match(/Target snippet:\n```python\n([\s\S]*?)\n```/)?.[1] ?? "";
        if (targetSnippet.length === 0) {
          throw new Error(`unexpected fallback prompt: ${prompt}`);
        }
        const target = targetSnippet.includes("def rotate_y(") ? "rotate_y" : "render";
        started.push(target);
        return new Promise<string>((resolve) => {
          resolvers.push((replacement) => {
            resolve(JSON.stringify({ replacement }));
          });
        });
      },
    });

    await eventually(() => expect([...started].sort()).toEqual(["render", "rotate_y"]));
    expect(resolvers).toHaveLength(2);
    resolvers[started.indexOf("render")](`  def render(self) -> str:
    return "ok"`);
    resolvers[started.indexOf("rotate_y")](`  def rotate_y(self, turns: int = 1) -> "IsoScene":
    return self`);

    expect(simplifyRunResult(await runPromise)).toEqual({
      ok: true,
      stdout: ["ok", "ok"],
    });
  });

  it("parallel methods strategy completes sibling class methods with single-shot prompts", async () => {
    const methodSheet = `class IsoScene:
  def render(self) -> str
  def rotate_y(self, turns: int = 1) -> "IsoScene"

def cube_stack() -> IsoScene

def test():
  print(cube_stack().render())
  print(cube_stack().rotate_y().render())`;
    const started: string[] = [];
    const resolvers: Array<(replacement: string) => void> = [];

    const runPromise = runCodeSheet(methodSheet, "test", {
      compilationStrategy: "parallel-methods",
      complete(prompt) {
        const targetSnippet = completionPromptTarget(prompt);
        const target = targetSnippet.includes("def rotate_y(") ? "rotate_y" : "render";
        started.push(target);
        return new Promise<string>((resolve) => {
          resolvers.push(resolve);
        });
      },
    });

    await eventually(() => expect([...started].sort()).toEqual(["render", "rotate_y"]));
    expect(resolvers).toHaveLength(2);
    resolvers[started.indexOf("render")](`def render(self) -> str:
  return "ok"`);
    resolvers[started.indexOf("rotate_y")](`def rotate_y(self, turns: int = 1) -> "IsoScene":
  return self`);

    expect(simplifyRunResult(await runPromise)).toEqual({
      ok: true,
      stdout: ["ok", "ok"],
    });
  });

  it("synthesizes zero-argument class factories without skipping parameterized factories", async () => {
    const factorySheet = `class IsoScene:
  def render(self) -> str

def cube_stack() -> IsoScene

def julia(seed: str = "dragon") -> IsoScene

def test():
  print(cube_stack().render())
  print(julia().render())`;
    const targets: string[] = [];
    const completed = await completeSheet(
      new Map(),
      factorySheet,
      (prompt) => {
        const target = completionPromptTarget(prompt);
        if (target.includes("def cube_stack(")) {
          throw new Error("zero-argument factory should be synthesized");
        }

        if (target.includes("class IsoScene:")) {
          targets.push("class");
          return `class IsoScene:
  def render(self) -> str:
    return "ok"`;
        }

        if (target.includes("def julia(")) {
          targets.push("julia");
          return `def julia(seed: str = "dragon") -> IsoScene:
  return IsoScene()`;
        }

        throw new Error(`unexpected prompt: ${prompt}`);
      },
      { strategy: "parallel" },
    );

    expect([...targets].sort()).toEqual(["class", "julia"]);
    expect(completed.source).toContain(`def cube_stack() -> IsoScene:
  return IsoScene()`);
  });

  it("auto strategy commits only the first successful strategy cache fork", async () => {
    const cache: CodeCache = new Map();
    const calls: string[] = [];
    let mulCalls = 0;
    const badMul = `def mul(x: int, y: int) -> int:
  raise RuntimeError("parallel failed")`;
    const goodMul = `def mul(x: int, y: int) -> int:
  return x * y`;

    const result = await runCodeSheet(multiIncompleteSheet, "test", {
      cache,
      compilationStrategy: "auto",
      complete(prompt) {
        const target = completionPromptTarget(prompt).includes("def mul(") ? "mul" : "add";
        calls.push(target);
        if (target === "mul") {
          mulCalls += 1;
          return mulCalls === 1 ? badMul : goodMul;
        }

        return `def add(x: int, y: int) -> int:
  return x + y`;
      },
    });

    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: ["2"],
    });
    expect(calls).toEqual(["add", "mul", "add", "mul"]);
    expect([...cache.values()]).toContain(goodMul);
    expect([...cache.values()]).not.toContain(badMul);
  });
});

function completionPromptTarget(prompt: string): string {
  const match = prompt.match(/Your job is to finish the implementation of:\n\n([\s\S]*?)\n\nReturn (?:just|only implementations)/);
  if (!match) {
    throw new Error(`Could not extract completion target from prompt: ${prompt}`);
  }

  return match[1];
}

function simplifyRunResult(result: RunResult): { ok: true; stdout: string[] } | { ok: false; error: string; stdout: string[] } {
  if (result.ok) {
    return { ok: true, stdout: result.stdout };
  }

  return { ok: false, error: result.error, stdout: result.stdout };
}

async function waitForInteractiveOutput(
  session: InteractivePythonRun,
  expected: string,
): Promise<string> {
  let output = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    output += session.drainOutput().map((chunk) => chunk.text).join("");
    if (output.includes(expected)) {
      return output;
    }
    await delay(20);
  }

  session.stop();
  throw new Error(`Timed out waiting for ${expected}. Output: ${output}`);
}

async function waitForInteractiveExit(session: InteractivePythonRun): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (session.status().state === "exited") {
      return;
    }
    await delay(20);
  }

  session.stop();
  throw new Error("Timed out waiting for interactive run to exit");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(5);
    }
  }

  throw lastError;
}
