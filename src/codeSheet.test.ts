import { describe, expect, it } from "vitest";
import {
  compile,
  definitionReadiness,
  completeSheet,
  hashCompletionInput,
  hashSnippet,
  lower,
  parse,
  renderImplementation,
  runnables,
  type CodeCache,
  type CompilationEvent,
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
      "readiness",
      "implementation",
      "llm-start",
      "llm-token",
      "llm-token",
      "llm-complete",
      "readiness",
      "implementation",
      "compiled",
    ]);
    expect(renderImplementation(compiled.completed.ir)).toContain(
      "def add(x: int, y: int) -> int:\n  return x + y",
    );
    expect(cache.get(compiled.completed.completions[0].hash)).toBe(
      "def add(x: int, y: int) -> int:\n  return x + y",
    );
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
      "readiness",
      "implementation",
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
      "readiness",
      "implementation",
      "cache-hit",
      "readiness",
      "implementation",
      "compiled",
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
    return f"{PREFIX}, {name}"`,
    );

    expect(completed.source).toContain(`PREFIX = "Hello"`);
    expect(completed.source).toContain("class Greeter:");
    expect(simplifyRunResult(await runCodeSheet(completed.source, "test"))).toEqual({
      ok: true,
      stdout: ["Hello, Ada"],
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
            "completion:2fbec6c6",
            "1 + 2",
          ],
          [
            "completion:664f3ac5",
            "3 * 4",
          ],
        ],
        "calls": [
          "\`add 1 and 2\`

      Return only the replacement code for the fragment, without backticks or fences.
      If the fragment appears inside an expression, return a Python expression.
      If the fragment appears as a statement, return one or more Python statements.
      If imports are needed, include normal Python import/from lines before the replacement; those imports will be added to the file top.
      Use normal Python and preserve the intended public behavior shown in the runnable/test functions.",
          "\`multiply 3 and 4\`

      Return only the replacement code for the fragment, without backticks or fences.
      If the fragment appears inside an expression, return a Python expression.
      If the fragment appears as a statement, return one or more Python statements.
      If imports are needed, include normal Python import/from lines before the replacement; those imports will be added to the file top.
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
      "readiness",
      "implementation",
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
      "readiness",
      "implementation",
      "cache-hit",
      "readiness",
      "implementation",
      "llm-start",
      "llm-complete",
      "readiness",
      "implementation",
      "compiled",
    ]);
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(2);
  });
});

function simplifyRunResult(result: RunResult): { ok: true; stdout: string[] } | { ok: false; error: string; stdout: string[] } {
  if (result.ok) {
    return { ok: true, stdout: result.stdout };
  }

  return { ok: false, error: result.error, stdout: result.stdout };
}
