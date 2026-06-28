import { describe, expect, it } from "vitest";
import { parse } from "./codeSheet";
import { lowerSheetForPyright, typeCheckManyWithPyright } from "./pyrightTypeCheck";
import { typeCheck } from "./typeCheck";

type EvalCase = {
  id: string;
  sheet: string;
  expected: Array<{
    line: number;
    includes: string;
  }>;
};

const evals: EvalCase[] = [
  {
    id: "function_arg_1",
    sheet: `def add(x: int, y: int) -> int: ...

def test():
  add("1", 2)`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'x'" }],
  },
  {
    id: "function_arg_2",
    sheet: `def label(name: str, count: int) -> str: ...

def test():
  label("Ada", "2")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'count'" }],
  },
  {
    id: "too_few_args",
    sheet: `def add(x: int, y: int) -> int: ...

def test():
  add(1)`,
    expected: [{ line: 4, includes: "Argument missing for parameter 'y'" }],
  },
  {
    id: "too_many_args",
    sheet: `def add(x: int, y: int) -> int: ...

def test():
  add(1, 2, 3)`,
    expected: [{ line: 4, includes: "Expected 2 positional arguments" }],
  },
  {
    id: "return_str_for_int",
    sheet: `def add(x: int) -> int:
  return "bad"`,
    expected: [{ line: 2, includes: "not assignable to return type 'int'" }],
  },
  {
    id: "return_none_for_str",
    sheet: `def name() -> str:
  return None`,
    expected: [{ line: 2, includes: "not assignable to return type 'str'" }],
  },
  {
    id: "inferred_variable_arg",
    sheet: `def takes_str(value: str) -> None: ...

def test():
  value = 3
  takes_str(value)`,
    expected: [{ line: 5, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "method_arg_type",
    sheet: `class Store:
  def set(self, key: str, value: int) -> None

def test():
  store = Store()
  store.set("a", "1")`,
    expected: [{ line: 6, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "method_missing_arg",
    sheet: `class Store:
  def set(self, key: str, value: int) -> None

def test():
  store = Store()
  store.set("a")`,
    expected: [{ line: 6, includes: "Argument missing for parameter 'value'" }],
  },
  {
    id: "dataclass_constructor_field",
    sheet: `class Point(x: int, y: int)

def test():
  Point("0", 1)`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'x'" }],
  },
  {
    id: "dataclass_constructor_arity",
    sheet: `class Point(x: int, y: int)

def test():
  Point(0, 1, 2)`,
    expected: [{ line: 4, includes: "Expected 2 positional arguments" }],
  },
  {
    id: "record_constructor_field",
    sheet: `record User:
  name: str
  age: int

def test():
  User("Ada", "37")`,
    expected: [{ line: 6, includes: "cannot be assigned to parameter 'age'" }],
  },
  {
    id: "block_record_field_default",
    sheet: `record User:
  name: str
  active: bool = "yes"`,
    expected: [{ line: 3, includes: "not assignable to declared type 'bool'" }],
  },
  {
    id: "sum_type_variant_arg",
    sheet: `type Expr = Val(int) | Empty

def test():
  Val("7")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "sum_type_variant_nested_arg",
    sheet: `type Op = Mul | Div
type Expr = Val(int) | BinOp(Op, Expr, Expr)

def test():
  BinOp("mul", Val(1), Val(2))`,
    expected: [{ line: 5, includes: "cannot be assigned to parameter 'op'" }],
  },
  {
    id: "sum_type_constructor_missing",
    sheet: `type Expr = Val(int) | Empty

def test():
  Val()`,
    expected: [{ line: 4, includes: "Argument missing for parameter 'value'" }],
  },
  {
    id: "tuple_alias_arg",
    sheet: `type CellAddress = (str, int)

def get(cell: CellAddress) -> int: ...

def test():
  get(("A", "1"))`,
    expected: [{ line: 6, includes: "cannot be assigned to parameter 'cell'" }],
  },
  {
    id: "tuple_alias_return",
    sheet: `type CellAddress = (str, int)

def c() -> CellAddress:
  return ("A", "1")`,
    expected: [{ line: 4, includes: "not assignable to return type" }],
  },
  {
    id: "optional_arg_type",
    sheet: `def set_ttl(key: str, ttl: int | None = None) -> None: ...

def test():
  set_ttl("a", "soon")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'ttl'" }],
  },
  {
    id: "optional_arg_arity",
    sheet: `def set_ttl(key: str, ttl: int | None = None) -> None: ...

def test():
  set_ttl("a", 1, 2)`,
    expected: [{ line: 4, includes: "Expected 2 positional arguments" }],
  },
  {
    id: "bool_expected",
    sheet: `def set_active(active: bool) -> None: ...

def test():
  set_active("true")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'active'" }],
  },
  {
    id: "list_element",
    sheet: `def total(values: list[int]) -> int: ...

def test():
  total(["1"])`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'values'" }],
  },
  {
    id: "dict_value",
    sheet: `def save(values: dict[str, int]) -> None: ...

def test():
  save({"a": "1"})`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'values'" }],
  },
  {
    id: "set_element",
    sheet: `def save(values: set[int]) -> None: ...

def test():
  save({"1"})`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'values'" }],
  },
  {
    id: "return_sum_alias",
    sheet: `type Expr = Val(int) | Empty

def make() -> Expr:
  return 1`,
    expected: [{ line: 4, includes: "not assignable to return type" }],
  },
  {
    id: "union_arg",
    sheet: `def parse(value: int | str) -> str: ...

def test():
  parse([])`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "method_return",
    sheet: `class Counter:
  def next(self) -> int:
    return "1"`,
    expected: [{ line: 3, includes: "not assignable to return type 'int'" }],
  },
  {
    id: "fn_keyword_arg",
    sheet: `fn add(x: int, y: int) -> int

fn test():
  add("1", 2)`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'x'" }],
  },
  {
    id: "function_keyword_return",
    sheet: `function add(x: int) -> int:
  return "bad"`,
    expected: [{ line: 2, includes: "not assignable to return type 'int'" }],
  },
  {
    id: "bare_signature_arg",
    sheet: `add(x: int, y: int) -> int

test():
  add("1", 2)`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'x'" }],
  },
  {
    id: "async_bare_signature_arg",
    sheet: `async load_total(x: int) -> int

async def test():
  await load_total("1")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'x'" }],
  },
  {
    id: "unknown_type",
    sheet: `def make() -> Missing:
  return 1`,
    expected: [{ line: 1, includes: "'Missing' is not defined" }],
  },
  {
    id: "unknown_call",
    sheet: `def test():
  missing()`,
    expected: [{ line: 2, includes: "'missing' is not defined" }],
  },
  {
    id: "unknown_member",
    sheet: `class Store:
  def get(self) -> int

def test():
  store = Store()
  store.missing()`,
    expected: [{ line: 6, includes: "Cannot access attribute 'missing'" }],
  },
  {
    id: "annotated_assignment",
    sheet: `def test():
  count: int = "1"`,
    expected: [{ line: 2, includes: "not assignable to declared type 'int'" }],
  },
  {
    id: "shorthand_default",
    sheet: `User(name: str, active: bool = "yes")

def test():
User("Ada")`,
    expected: [{ line: 1, includes: "not assignable to declared type 'bool'" }],
  },
  {
    id: "none_to_required",
    sheet: `def takes_int(value: int) -> None: ...

def test():
  takes_int(None)`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "none_union_rejects_str",
    sheet: `def takes_optional(value: int | None) -> None: ...

def test():
  takes_optional("1")`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'value'" }],
  },
  {
    id: "nested_map_assignment",
    sheet: `def save(cells: [[int]]) -> None: ...

def test():
  save({"A": {"one": 1}})`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'cells'" }],
  },
  {
    id: "nested_map_value",
    sheet: `def save(cells: [[int]]) -> None: ...

def test():
  save({"A": {1: "x"}})`,
    expected: [{ line: 4, includes: "cannot be assigned to parameter 'cells'" }],
  },
  {
    id: "class_init_arg",
    sheet: `class Clock:
  def __init__(self, now: int) -> None

def test():
  Clock("0")`,
    expected: [{ line: 5, includes: "cannot be assigned to parameter 'now'" }],
  },
];

describe("pyright type-check spike", () => {
  it("catalogs the custom syntax that has to be lowered before real Python tools can run", () => {
    const lowered = lowerSheetForPyright(`type Expr = Val(int) | Empty
type CellAddress = (str, int)

record Store:
  cells: [[Expr]]

class Point(x: int, y: int)

fn add(x: int, y: int) -> int
function test():
  add("1", 2)`);

    expect(lowered.nonPythonForms).toEqual([
      "bodyless-signature",
      "dataclass-shorthand",
      "function-keyword",
      "nested-map",
      "record",
      "sum-type",
      "tuple-alias",
    ]);
  });

  it("lowers dataclass shorthand into a Pyright-visible constructor", async () => {
    const sheet = `class Point(x: int, y: int)

def test():
  Point("0", 1)`;
    const result = (await typeCheckManyWithPyright([{ id: "point", sheet }])).get("point");

    expect(result?.lowered.source).toContain(`@dataclass(frozen=True)
class Point:
  x: int
  y: int`);
    expect(result?.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Argument of type 'Literal['0']' cannot be assigned to parameter 'x' of type 'int' in function '__init__'",
    ]);
  }, 30000);

  it("maps Pyright diagnostics back to sheet lines across the diagnostic eval suite", async () => {
    expect(evals.length).toBeGreaterThanOrEqual(40);

    const results = await typeCheckManyWithPyright(evals.map(({ id, sheet }) => ({ id, sheet })));
    for (const item of evals) {
      const result = results.get(item.id);
      expect(result, item.id).toBeDefined();
      if (!result) {
        continue;
      }

      const mapped = result.diagnostics.map((diagnostic) => ({
        line: diagnostic.line,
        column: diagnostic.column,
        message: diagnostic.message,
      }));
      for (const expected of item.expected) {
        expect(
          mapped.some((diagnostic) => {
            return diagnostic.line === expected.line && diagnostic.message.includes(expected.includes);
          }),
          `${item.id}: expected line ${expected.line} to include ${expected.includes}; got ${JSON.stringify(mapped)}`,
        ).toBe(true);
      }
    }
  }, 30000);

  it("shows why Pyright lowering is materially stronger than the manual checker", async () => {
    const sheet = `def total(values: list[int]) -> int: ...

def test():
  total(["1"])`;
    const pyright = (await typeCheckManyWithPyright([{ id: "generic", sheet }])).get("generic");
    const manual = typeCheck(parse(sheet));

    expect(pyright?.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Argument of type 'list[str]' cannot be assigned to parameter 'values' of type 'list[int]' in function 'total'",
    ]);
    expect(manual.map((diagnostic) => diagnostic.message)).toEqual([]);
  }, 30000);
});
