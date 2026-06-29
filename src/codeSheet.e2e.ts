import { describe, expect, it } from "vitest";
import { completeWithAnthropic } from "./anthropicComplete";
import {
  runnables,
  type CodeCache,
  type CodeSheet,
  type Runnable,
} from "./codeSheet";
import { runCodeSheet, type RunResult } from "./codeSheetRunner";
import { sampleEvalCases, type SampleStdoutCheck } from "./samples";

type E2ECaseBase = {
  name: string;
  sheet: CodeSheet;
  runnable: Runnable;
};

type E2ECase = E2ECaseBase & (
  | { expectedStdout: string[]; stdoutCheck?: never }
  | { expectedStdout?: never; stdoutCheck: SampleStdoutCheck }
);

const attempts = 3;

const cases: E2ECase[] = [
  {
    name: "single incomplete add",
    sheet: `def add(x: int, y: int) -> int

def test():
  print(add(1,2))`,
    runnable: "test",
    expectedStdout: ["3"],
  },
  {
    name: "single incomplete add with untyped parameters",
    sheet: `def add(x, y) -> int

def test():
  print(add(1,2))`,
    runnable: "test",
    expectedStdout: ["3"],
  },
  {
    name: "multiple incomplete functions",
    sheet: `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(mul(1,2))`,
    runnable: "test",
    expectedStdout: ["2"],
  },
  {
    name: "natural-language backtick expressions",
    sheet: `def test():
  foo = \`add 1 and 2\`
  bar = \`multiply 3 and 4\`
  print(foo + bar)`,
    runnable: "test",
    expectedStdout: ["15"],
  },
  {
    name: "incomplete spreadsheet class",
    sheet: `class Spreadsheet:
  cells: [[int]]

  def get(self, col: str, row: int) -> int | None
  def set(self, col: str, row: int, val: int) -> None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, 7)
  print(sheet.get("A", 1))`,
    runnable: "test",
    expectedStdout: ["None", "7"],
  },
  {
    name: "calculated spreadsheet with cell references",
    sheet: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
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
  def eval_inner(self, stack: list, col: str, row: int) -> int | EvalError | None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, Val(7))
  print(sheet.get("A", 1))
  sheet.set("B", 1, BinOp(Add(), Val(2), Val(3)))
  print(sheet.eval().eval("B", 1))
  sheet.set("C", 1, BinOp(Mul(), BinOp(Add(), Cell("B", 1), Cell("A", 1)), Val(4)))
  print(sheet.eval().eval("C", 1))`,
    runnable: "test",
    expectedStdout: ["None", "Val(value=7)", "5", "48"],
  },
  {
    name: "parsed spreadsheet strings",
    sheet: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.
# Parse expression strings containing ints, A1 cell refs, +, -, *, /, and parentheses.
# If an expression has one extra trailing ")" but is otherwise parseable, ignore it.

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
type EvalError = RecursiveError(list) | DivByZero
type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def parse_cell(str) -> CellAddress | None

class Spreadsheet:
  cells: [[Expr]]

  def __init__(self) -> None
  def get(self, col: str, row: int) -> Expr | None
  def set(self, col: str, row: int, expr: str) -> None
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None
  def eval(self, col: str, row: int) -> int | EvalError | None
  def eval_inner(self, stack: list, col: str, row: int) -> int | EvalError | None

def test():
  sheet = Spreadsheet()
  print(sheet.get("A", 1))
  sheet.set("A", 1, "7")
  print(sheet.get("A", 1))
  sheet.set("B1", "2 + 3")
  print(sheet.eval().eval("B1"))
  sheet.set("C1", "(B1 + A1) * 4)")
  print(sheet.eval().eval("C1"))`,
    runnable: "test",
    expectedStdout: ["None", "Val(value=7)", "5", "48"],
  },
  {
    name: "cell-address spreadsheet strings",
    sheet: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.
# Parse expression strings containing ints, A1 cell refs, +, -, *, /, and parentheses.
# If an expression has one extra trailing ")" but is otherwise parseable, ignore it.
# c("A1") returns ("A", 1).

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
type EvalError = RecursiveError(list) | DivByZero
type CellAddress = (str, int)

def parse_expr(str) -> Expr | None
def c(str) -> CellAddress

class Spreadsheet:
  cells: [[Expr]]

  def __init__(self) -> None
  def get(self, cell: CellAddress) -> Expr | None
  def set(self, cell: CellAddress, expr: str) -> None
  def eval(self) -> SpreadsheetResult

class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None
  def eval(self, cell: CellAddress) -> int | EvalError | None
  def eval_inner(self, stack: list, cell: CellAddress) -> int | EvalError | None

def test():
  sheet = Spreadsheet()
  print(sheet.get(c("A1")))
  sheet.set(c("A1"), "7")
  print(sheet.get(c("A1")))
  sheet.set(c("B1"), "2 + 3")
  print(sheet.eval().eval(c("B1")))
  sheet.set(c("C1"), "(B1 + A1) * 4)")
  print(sheet.eval().eval(c("C1")))`,
    runnable: "test",
    expectedStdout: ["None", "Val(value=7)", "5", "48"],
  },
  {
    name: "parking lot allocation service",
    sheet: `# Parking lot spots and vehicles have sizes: small < medium < large.
# A vehicle must be assigned the smallest available spot that fits it.
# Vehicle types: motorcycle fits small, car fits medium, truck fits large.
# park returns an opaque ticket id or None when no spot fits.
# unpark returns the vehicle id for a valid active ticket, otherwise None.
# active_vehicle_ids returns sorted active vehicle ids.

class ParkingLot:
  layout: dict
  occupied: dict
  tickets: dict
  next_ticket_id: int

  def __init__(self, layout: dict) -> None
  def park(self, vehicle_id: str, vehicle_type: str) -> str | None
  def unpark(self, ticket_id: str) -> str | None
  def available(self, spot_size: str) -> int
  def active_vehicle_ids(self) -> list

def test():
  lot = ParkingLot({"small": 1, "medium": 1, "large": 1})
  print(lot.available("medium"))
  motorcycle_ticket = lot.park("m1", "motorcycle")
  car_ticket = lot.park("c1", "car")
  truck_ticket = lot.park("t1", "truck")
  print(motorcycle_ticket is not None, car_ticket is not None, truck_ticket is not None)
  print(lot.available("small"), lot.available("medium"), lot.available("large"))
  print(lot.park("c2", "car"))
  print(lot.unpark(car_ticket))
  print(lot.available("medium"))
  replacement_ticket = lot.park("c2", "car")
  print(replacement_ticket is not None and replacement_ticket != car_ticket)
  print(lot.active_vehicle_ids())`,
    runnable: "test",
    expectedStdout: [
      "1",
      "True True True",
      "0 0 0",
      "None",
      "c1",
      "1",
      "True",
      "['c2', 'm1', 't1']",
    ],
  },
  {
    name: "event-driven email dispatcher",
    sheet: `# Structured events are dicts with id, type, email, and payload fields.
# templates maps event type to subject/body format strings.
# handle_event returns "sent", "duplicate", "ignored", or "dead_letter".
# Duplicate event ids are never sent twice.
# Unknown event types are ignored.
# TransientEmailError should be retried up to max_attempts.
# PermanentEmailError should go directly to dead letters.
# sent and dead_letters return event ids in the order they reach that state.

class TransientEmailError(Exception):
  pass

class PermanentEmailError(Exception):
  pass

class FakeSender:
  def __init__(self):
    self.attempts = {}

  def send(self, to: str, subject: str, body: str) -> None:
    key = (to, subject)
    self.attempts[key] = self.attempts.get(key, 0) + 1
    if to == "retry@example.com" and self.attempts[key] == 1:
      raise TransientEmailError("try again")
    if to == "bad@example.com":
      raise PermanentEmailError("blocked")

  def attempts_for(self, to: str, subject: str) -> int:
    return self.attempts.get((to, subject), 0)

class EmailDispatcher:
  sender: FakeSender
  templates: dict
  max_attempts: int
  seen_event_ids: set
  sent_event_ids: list
  dead_letter_event_ids: list

  def __init__(self, sender: FakeSender, templates: dict, max_attempts: int) -> None
  def handle_event(self, event: dict) -> str
  def sent(self) -> list
  def dead_letters(self) -> list

def test():
  templates = {
    "signup": {"subject": "Welcome {name}", "body": "Hi {name}"},
    "reset": {"subject": "Reset {name}", "body": "Code {code}"},
  }
  sender = FakeSender()
  dispatcher = EmailDispatcher(sender, templates, 2)
  print(dispatcher.handle_event({
    "id": "e1", "type": "signup", "email": "ada@example.com", "payload": {"name": "Ada"}
  }))
  print(dispatcher.handle_event({
    "id": "e1", "type": "signup", "email": "ada@example.com", "payload": {"name": "Ada"}
  }))
  print(dispatcher.handle_event({
    "id": "e2", "type": "reset", "email": "retry@example.com", "payload": {"name": "Ada", "code": "123"}
  }))
  print(dispatcher.handle_event({
    "id": "e3", "type": "invoice", "email": "ada@example.com", "payload": {}
  }))
  print(dispatcher.handle_event({
    "id": "e4", "type": "signup", "email": "bad@example.com", "payload": {"name": "Bad"}
  }))
  print(dispatcher.sent())
  print(dispatcher.dead_letters())
  print(sender.attempts_for("retry@example.com", "Reset Ada"))`,
    runnable: "test",
    expectedStdout: [
      "sent",
      "duplicate",
      "sent",
      "ignored",
      "dead_letter",
      "['e1', 'e2']",
      "['e4']",
      "2",
    ],
  },
  {
    name: "in-memory kv store with ttl and transactions",
    sheet: `# In-memory key/value store with an injectable clock.
# clock.now is an integer timestamp.
# set stores string values. ttl is optional seconds from the current time.
# A key expires when clock.now is greater than or equal to its expiration time.
# begin starts a transaction; reads inside the transaction see staged writes/deletes.
# rollback discards staged changes; commit applies them.
# items returns sorted live (key, value) pairs.

class Clock:
  def __init__(self):
    self.now = 0

class KVStore:
  clock: Clock
  data: dict
  transaction: dict

  def __init__(self, clock: Clock) -> None
  def set(self, key: str, value: str, ttl: int | None = None) -> None
  def get(self, key: str) -> str | None
  def delete(self, key: str) -> None
  def begin(self) -> None
  def rollback(self) -> None
  def commit(self) -> None
  def items(self) -> list

def test():
  clock = Clock()
  store = KVStore(clock)
  store.set("a", "1", ttl=10)
  print(store.get("a"))
  clock.now = 10
  print(store.get("a"))
  store.set("a", "1")
  store.begin()
  store.set("a", "2")
  store.set("b", "3", ttl=5)
  print(store.get("a"), store.get("b"))
  store.rollback()
  print(store.get("a"), store.get("b"))
  store.begin()
  store.delete("a")
  store.set("c", "4")
  store.commit()
  print(store.get("a"), store.get("c"))
  print(store.items())`,
    runnable: "test",
    expectedStdout: [
      "1",
      "None",
      "2 3",
      "1 None",
      "None 4",
      "[('c', '4')]",
    ],
  },
];

const allCases: E2ECase[] = [...cases, ...sampleEvalCases];

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicE2E("codeSheet Anthropic E2E reliability", () => {
  it(
    "detects runnables for every LLM case",
    () => {
      for (const testCase of allCases) {
        expect(runnables(testCase.sheet), testCase.name).toEqual([
          { line: expect.any(Number), name: testCase.runnable },
        ]);
      }
    },
    120_000,
  );

  it(
    "succeeds in every repeated full-pipeline run",
    async () => {
      const summaries = await Promise.all(
        allCases.map(async (testCase) => {
          const results = await Promise.all(
            Array.from({ length: attempts }, async (_, index) => {
              const result = await runCodeSheet(testCase.sheet, testCase.runnable, {
                complete: completeWithAnthropic,
              }).catch((error: unknown) => ({
                ok: false as const,
                error: error instanceof Error ? error.message : String(error),
                stdout: [],
              }));

              return { attempt: index + 1, result: simplifyRunResult(result) };
            }),
          );

          const successes = results.filter(({ result }) => {
            return result.ok && stdoutMatches(result.stdout, testCase);
          });

          return {
            case: testCase.name,
            attempts,
            successes: successes.length,
            expectedStdout: stdoutExpectation(testCase),
            results,
          };
        }),
      );

      for (const summary of summaries) {
        expect(summary.successes, JSON.stringify(summary, null, 2)).toBe(attempts);
      }
    },
    240_000,
  );

  it(
    "reuses cached completions when only the runnable body changes",
    async () => {
      const cache: CodeCache = new Map();
      let completionCalls = 0;
      const complete = async (prompt: string): Promise<string> => {
        completionCalls += 1;
        return completeWithAnthropic(prompt);
      };

      const baseSheet = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(add(1,2))
  print(mul(2,3))`;

      const changedTestSheet = `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(add(1,2))
  print(mul(2,3))
  print(add(2,3))`;

      const first = await runCodeSheet(baseSheet, "test", { complete, cache });
      const callsAfterFirstRun = completionCalls;
      const second = await runCodeSheet(changedTestSheet, "test", { complete, cache });

      expect({
        callsAfterFirstRun,
        callsAfterSecondRun: completionCalls,
        cacheSize: cache.size,
        first: simplifyRunResult(first),
        second: simplifyRunResult(second),
      }).toMatchInlineSnapshot(`
        {
          "cacheSize": 2,
          "callsAfterFirstRun": 2,
          "callsAfterSecondRun": 2,
          "first": {
            "ok": true,
            "stdout": [
              "3",
              "6",
            ],
          },
          "second": {
            "ok": true,
            "stdout": [
              "3",
              "6",
              "5",
            ],
          },
        }
      `);
    },
    120_000,
  );
});

describe("codeSheet definition syntax evals", () => {
  it("documents the current broken behavior when a natural snippet names a class generically", async () => {
    const sheet = `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def gen_magic_square():
  \`\`\`
  generate a magic square
  pretty print it
  check the magic square is valid, and show the work
  \`\`\``;

    const result = await runCodeSheet(sheet, "gen_magic_square", {
      complete(prompt) {
        if (prompt.includes("Your job is to finish the implementation of:")) {
          return `class MagicSquare:
  size: int

  def __init__(self, size: int = 3):
    self.size = size
    self.grid = [
      [8, 1, 6],
      [3, 5, 7],
      [4, 9, 2],
    ]

  def gen(self) -> "MagicSquare":
    return self

  def pretty(self) -> str:
    lines = ["+--+--+--+"]
    for row in self.grid:
      lines.append("|" + "|".join(f"{value} " for value in row) + "|")
      lines.append("+--+--+--+")
    return "\\n".join(lines)

  def validate_with_work(self) -> str:
    return "Magic Constant: 15"`;
        }

        return `ms = MagicSquare().gen()
print(ms.pretty())
print()
print("Magic Constant: 15")
print(ms.verify_with_work())`;
      },
    });

    expect(simplifyRunResult(result)).toEqual({
      ok: false,
      stdout: [
        "+--+--+--+",
        "|8 |1 |6 |",
        "+--+--+--+",
        "|3 |5 |7 |",
        "+--+--+--+",
        "|4 |9 |2 |",
        "+--+--+--+",
        "",
        "Magic Constant: 15",
      ],
      error: expect.stringContaining(
        "AttributeError: 'MagicSquare' object has no attribute 'verify_with_work'",
      ),
    });
  });

  it("runs when the natural snippet explicitly references the MagicSquare class", async () => {
    const sheet = `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def gen_magic_square():
  \`\`\`
  generate a {MagicSquare}
  pretty print it
  check the {MagicSquare} is valid, and show the work
  \`\`\``;
    let naturalPrompt = "";

    const result = await runCodeSheet(sheet, "gen_magic_square", {
      complete(prompt) {
        if (prompt.includes("Your job is to finish the implementation of:")) {
          return `class MagicSquare:
  size: int

  def __init__(self, size: int = 3):
    self.size = size
    self.grid = [
      [8, 1, 6],
      [3, 5, 7],
      [4, 9, 2],
    ]

  def gen(self) -> "MagicSquare":
    return self

  def pretty(self) -> str:
    lines = ["+--+--+--+"]
    for row in self.grid:
      lines.append("|" + "|".join(f"{value} " for value in row) + "|")
      lines.append("+--+--+--+")
    return "\\n".join(lines)

  def validate_with_work(self) -> str:
    return "Magic Constant: 15"`;
        }

        naturalPrompt = prompt;
        return `ms = MagicSquare().gen()
print(ms.pretty())
print()
print(ms.validate_with_work())`;
      },
    });

    expect(naturalPrompt).toContain("generate a {MagicSquare}");
    expect(naturalPrompt).toContain("def validate_with_work(self) -> str:");
    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: [
        "+--+--+--+",
        "|8 |1 |6 |",
        "+--+--+--+",
        "|3 |5 |7 |",
        "+--+--+--+",
        "|4 |9 |2 |",
        "+--+--+--+",
        "",
        "Magic Constant: 15",
      ],
    });
  });

  it("runs when the natural snippet references the MagicSquare class without braces", async () => {
    const sheet = `class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def test_magic_square():
  # Logos also support multi-line snippets.
  \`\`\`
  generate a MagicSquare
  pretty print it
  check the MagicSquare is valid, and show the work
  \`\`\``;
    let naturalPrompt = "";

    const result = await runCodeSheet(sheet, "test_magic_square", {
      complete(prompt) {
        if (prompt.includes("Your job is to finish the implementation of:")) {
          return `class MagicSquare:
  size: int

  def __init__(self, size: int = 3):
    self.size = size
    self.grid = [
      [8, 1, 6],
      [3, 5, 7],
      [4, 9, 2],
    ]

  def gen(self) -> "MagicSquare":
    return self

  def pretty(self) -> str:
    lines = ["+--+--+--+"]
    for row in self.grid:
      lines.append("|" + "|".join(f"{value} " for value in row) + "|")
      lines.append("+--+--+--+")
    return "\\n".join(lines)

  def validate_with_work(self) -> str:
    return "Rows, columns, and diagonals all sum to 15"`;
        }

        naturalPrompt = prompt;
        return `ms = MagicSquare().gen()
print(ms.pretty())
print()
print(ms.validate_with_work())`;
      },
    });

    expect(naturalPrompt).toContain("generate a MagicSquare");
    expect(naturalPrompt).toContain("class MagicSquare:");
    expect(naturalPrompt).toContain("def validate_with_work(self) -> str:");
    expect(simplifyRunResult(result)).toEqual({
      ok: true,
      stdout: [
        "+--+--+--+",
        "|8 |1 |6 |",
        "+--+--+--+",
        "|3 |5 |7 |",
        "+--+--+--+",
        "|4 |9 |2 |",
        "+--+--+--+",
        "",
        "Rows, columns, and diagonals all sum to 15",
      ],
    });
  });

  it("runs additive function and async-function definition forms", async () => {
    const sheet = `add(x: int, y: int) -> int

async load_total(x: int) -> int

test():
  print(add(2, 3))`;
    const calls: string[] = [];

    const result = await runCodeSheet(sheet, "test", {
      complete(prompt) {
        const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
        calls.push(target.trim());
        if (target.includes("async def load_total")) {
          return `async def load_total(x: int) -> int:
  return x`;
        }

        return `def add(x: int, y: int) -> int:
  return x + y`;
      },
    });

    expect({
      runnables: runnables(sheet),
      calls: calls.map((call) => call.split("\n")[0]),
      result: simplifyRunResult(result),
    }).toEqual({
      runnables: [{ name: "test", line: 5 }],
      calls: ["def add(x: int, y: int) -> int", "async def load_total(x: int) -> int"],
      result: { ok: true, stdout: ["5"] },
    });
  });

  it("runs additive class and record definition forms", async () => {
    const sheet = `class Point(x: int, y: int)

NamedPoint(x: int, y: int, name: str):
  function label(self) -> str:
    return f"{self.name}:({self.x},{self.y})"

test():
  item = NamedPoint(3, 4, "p")
  print(item.label())
  print(NamedPoint.__name__)`;

    const result = await runCodeSheet(sheet, "test");

    expect({
      runnables: runnables(sheet),
      result: simplifyRunResult(result),
    }).toEqual({
      runnables: [{ name: "test", line: 7 }],
      result: { ok: true, stdout: ["p:(3,4)", "NamedPoint"] },
    });
  });
});

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function stdoutMatches(stdout: string[], testCase: E2ECase): boolean {
  if (testCase.expectedStdout) {
    return arraysEqual(stdout, testCase.expectedStdout);
  }

  return testCase.stdoutCheck.matches(stdout);
}

function stdoutExpectation(testCase: E2ECase): string[] | string {
  return testCase.expectedStdout ?? testCase.stdoutCheck.description;
}

function simplifyRunResult(
  result: RunResult | { ok: false; error: string; stdout: string[] },
): { ok: true; stdout: string[] } | { ok: false; error: string; stdout: string[] } {
  if (result.ok) {
    return { ok: true, stdout: result.stdout };
  }

  return { ok: false, error: result.error, stdout: result.stdout };
}
