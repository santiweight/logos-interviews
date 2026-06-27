import { describe, expect, it } from "vitest";
import {
  completeSheet,
  hashCompletionInput,
  hashSnippet,
  lower,
  parse,
  runnables,
  type CodeCache,
} from "./codeSheet";
import { runCodeSheet, type RunResult } from "./codeSheetRunner";

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

  it("captures run outputs", async () => {
    const prompts: string[] = [];
    const cache: CodeCache = new Map();
    const complete = (prompt: string): string => {
      prompts.push(prompt);
      const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
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

      Return just the function or class snippet, including any standard-library imports required by that snippet.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      If helper functions are needed, include them in the returned snippet or define them inside the requested function.",
          "You are an expert software engineer building programs.

      You are tasked with assisting on the following Python code sheet:

      def add(x: int, y: int) -> int:
        return x + y

      def mul(x: int, y: int) -> int

      def test():
        print(mul(1,2))

      Your job is to finish the implementation of:

      def mul(x: int, y: int) -> int

      Return just the function or class snippet, including any standard-library imports required by that snippet.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      If helper functions are needed, include them in the returned snippet or define them inside the requested function.",
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

      Return just the function or class snippet, including any standard-library imports required by that snippet.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      If helper functions are needed, include them in the returned snippet or define them inside the requested function.",
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

  it("completes adjacent parser helper signatures as one snippet", async () => {
    const parserSheet = `type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def parse_cell(str) -> CellAddress | None

def test():
  print(parse_cell("A1"))`;
    const prompts: string[] = [];

    await completeSheet(new Map(), parserSheet, (prompt) => {
      prompts.push(prompt);
      return `def parse_expr(source) -> None:
  return None
def parse_cell(source) -> CellAddress | None:
  return ("A", 1)`;
    });

    expect(prompts.map((prompt) => prompt.split("Your job is to finish the implementation of:").at(-1)?.trim())).toMatchInlineSnapshot(`
      [
        "def parse_expr(str) -> Expr | None
      def parse_cell(str) -> CellAddress | None

      Return just the function or class snippet, including any standard-library imports required by that snippet.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      If helper functions are needed, include them in the returned snippet or define them inside the requested function.",
      ]
    `);
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
      return `def parse_expr(source) -> None:
  return None
def c(source) -> CellAddress:
  return ("A", 1)`;
    });

    expect(prompts.map((prompt) => prompt.split("Your job is to finish the implementation of:").at(-1)?.trim())).toMatchInlineSnapshot(`
      [
        "def parse_expr(str) -> Expr | None
      def c(str) -> CellAddress

      Return just the function or class snippet, including any standard-library imports required by that snippet.
      Use normal Python. Prefer dataclasses and match statements for sum types.
      Preserve the intended public behavior shown in the runnable/test functions, even if that means adapting a pseudo-code signature into a valid Python signature or accepting multiple call shapes.
      If helper functions are needed, include them in the returned snippet or define them inside the requested function.",
      ]
    `);
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
});

function simplifyRunResult(result: RunResult): { ok: true; stdout: string[] } | { ok: false; error: string; stdout: string[] } {
  if (result.ok) {
    return { ok: true, stdout: result.stdout };
  }

  return { ok: false, error: result.error, stdout: result.stdout };
}
