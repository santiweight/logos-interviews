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
const minimumSuccessfulAttempts = 1;

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
  sheet.set("B", 1, "2 + 3")
  print(sheet.eval().eval("B", 1))
  sheet.set("C", 1, "(B1 + A1) * 4)")
  print(sheet.eval().eval("C", 1))`,
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

class Entry:
  def __init__(self, value: str, expires_at: int | None):
    self.value = value
    self.expires_at = expires_at

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
  {
    name: "url router path params and query strings",
    sheet: `# Router matches HTTP method + path patterns in registration order.
# Patterns can include named segments like /users/:id/orders/:order_id.
# dispatch returns {"handler": name, "params": dict, "query": dict} or None.
# Query strings are separated by ? and split on & and =. Missing values become "".
# URL decoding is not required.

class Router:
  routes: list

  def __init__(self) -> None
  def add(self, method: str, pattern: str, handler: str) -> None
  def dispatch(self, method: str, url: str) -> dict | None

def test():
  router = Router()
  router.add("GET", "/users/:id", "show_user")
  router.add("GET", "/users/:id/orders/:order_id", "show_order")
  router.add("POST", "/users", "create_user")
  print(router.dispatch("GET", "/users/42"))
  print(router.dispatch("GET", "/users/42/orders/abc?expand=items&debug="))
  print(router.dispatch("POST", "/users"))
  print(router.dispatch("DELETE", "/users/42"))`,
    runnable: "test",
    expectedStdout: [
      "{'handler': 'show_user', 'params': {'id': '42'}, 'query': {}}",
      "{'handler': 'show_order', 'params': {'id': '42', 'order_id': 'abc'}, 'query': {'expand': 'items', 'debug': ''}}",
      "{'handler': 'create_user', 'params': {}, 'query': {}}",
      "None",
    ],
  },
  {
    name: "lru cache eviction and recency",
    sheet: `# LRUCache stores string keys and integer values.
# get returns None for a miss and marks a hit as most recently used.
# put inserts or updates a key and evicts the least recently used key when capacity is exceeded.
# keys returns keys from least recently used to most recently used.

class LRUCache:
  capacity: int

  def __init__(self, capacity: int) -> None
  def get(self, key: str) -> int | None
  def put(self, key: str, value: int) -> None
  def keys(self) -> list

def test():
  cache = LRUCache(2)
  cache.put("a", 1)
  cache.put("b", 2)
  print(cache.keys())
  print(cache.get("a"))
  cache.put("c", 3)
  print(cache.get("b"), cache.keys())
  cache.put("a", 10)
  print(cache.get("a"), cache.keys())`,
    runnable: "test",
    expectedStdout: [
      "['a', 'b']",
      "1",
      "None ['a', 'c']",
      "10 ['c', 'a']",
    ],
  },
  {
    name: "inventory reservations with expiration",
    sheet: `# Inventory tracks on-hand stock and reservations against an injectable clock.
# reserve(sku, qty, ttl) returns deterministic ids "res-1", "res-2", ... or None when not enough available stock.
# commit(id) consumes stock and removes the reservation.
# release(id) cancels an active, unexpired reservation without consuming stock.
# Expired reservations no longer count against availability.
# available(sku) returns on-hand minus active reserved quantity.

class Clock:
  def __init__(self):
    self.now = 0

class Inventory:
  clock: Clock
  stock: dict
  reservations: dict

  def __init__(self, clock: Clock) -> None
  def add(self, sku: str, qty: int) -> None
  def available(self, sku: str) -> int
  def reserve(self, sku: str, qty: int, ttl: int) -> str | None
  def commit(self, reservation_id: str) -> bool
  def release(self, reservation_id: str) -> bool

def test():
  clock = Clock()
  inv = Inventory(clock)
  inv.add("tea", 5)
  r1 = inv.reserve("tea", 3, 10)
  print(r1, inv.available("tea"))
  print(inv.reserve("tea", 3, 10))
  clock.now = 10
  print(inv.available("tea"))
  r2 = inv.reserve("tea", 5, 10)
  print(r2, inv.commit(r2), inv.available("tea"))
  print(inv.release(r1), inv.available("tea"))`,
    runnable: "test",
    expectedStdout: [
      "res-1 2",
      "None",
      "5",
      "res-2 True 0",
      "False 0",
    ],
  },
  {
    name: "markdown table parser and projection",
    sheet: `# parse_markdown_table parses a simple GitHub-flavored markdown table.
# Ignore leading/trailing blank lines.
# The second row is a separator row and should be ignored.
# Return a list of dicts mapping header names to cell strings.
# project_rows returns selected columns in order, as tuples.

def parse_markdown_table(source: str) -> list
def project_rows(rows: list, columns: list) -> list

def test():
  source = """
| name | age | city |
| --- | ---: | --- |
| Ada | 36 | London |
| Ben | 41 | Paris |
"""
  rows = parse_markdown_table(source)
  print(rows)
  print(project_rows(rows, ["city", "name"]))`,
    runnable: "test",
    expectedStdout: [
      "[{'name': 'Ada', 'age': '36', 'city': 'London'}, {'name': 'Ben', 'age': '41', 'city': 'Paris'}]",
      "[('London', 'Ada'), ('Paris', 'Ben')]",
    ],
  },
  {
    name: "ledger running balances and reversal entries",
    sheet: `# Ledger posts signed integer amounts by account.
# post returns monotonically increasing entry ids like "entry-1".
# balance(account) is the sum of every posted entry for that account, including reversing entries.
# reverse(entry_id) appends a reversing entry with the opposite amount and returns its id; the original entry remains in history and balance.
# entries(account) returns (id, amount, memo) tuples for that account in posting order.

class Ledger:
  entries_by_id: dict
  order: list

  def __init__(self) -> None
  def post(self, account: str, amount: int, memo: str) -> str
  def reverse(self, entry_id: str) -> str | None
  def balance(self, account: str) -> int
  def entries(self, account: str) -> list

def test():
  ledger = Ledger()
  e1 = ledger.post("cash", 100, "deposit")
  e2 = ledger.post("cash", -30, "snacks")
  ledger.post("ar", 50, "invoice")
  print(e1, e2, ledger.balance("cash"))
  print(ledger.reverse(e2), ledger.balance("cash"))
  print(ledger.reverse("missing"))
  print(ledger.entries("cash"))`,
    runnable: "test",
    expectedStdout: [
      "entry-1 entry-2 70",
      "entry-4 100",
      "None",
      "[('entry-1', 100, 'deposit'), ('entry-2', -30, 'snacks'), ('entry-4', 30, 'reversal of entry-2')]",
    ],
  },
  {
    name: "sessionize events by idle gap",
    sheet: `# Events are dicts with user, ts, and action fields.
# sessionize groups events per user into sessions.
# A new session starts when the gap from the previous event for that user is greater than max_gap.
# Events may be unsorted. Return sessions sorted by user then start time.
# Each session dict has user, start, end, and actions fields.

def sessionize(events: list, max_gap: int) -> list

def test():
  events = [
    {"user": "b", "ts": 20, "action": "view"},
    {"user": "a", "ts": 0, "action": "open"},
    {"user": "a", "ts": 4, "action": "click"},
    {"user": "a", "ts": 20, "action": "buy"},
    {"user": "b", "ts": 28, "action": "close"},
  ]
  print(sessionize(events, 10))`,
    runnable: "test",
    expectedStdout: [
      "[{'user': 'a', 'start': 0, 'end': 4, 'actions': ['open', 'click']}, {'user': 'a', 'start': 20, 'end': 20, 'actions': ['buy']}, {'user': 'b', 'start': 20, 'end': 28, 'actions': ['view', 'close']}]",
    ],
  },
];

const allCases: E2ECase[] = [...cases, ...sampleEvalCases];

const describeIfAnthropicE2E = process.env.RUN_ANTHROPIC_E2E === "true" && process.env.LOGOS_ANTHROPIC_API_KEY
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
    "meets the repeated full-pipeline success threshold",
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
        expect(summary.successes, JSON.stringify(summary, null, 2)).toBeGreaterThanOrEqual(minimumSuccessfulAttempts);
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
  it.skip("runs the rendered formula spreadsheet sample without crashing", async () => {
    const testCase = sampleEvalCases.find((item) => item.name === "formula spreadsheet strings and rendering");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }
    const stdoutCheck = testCase.stdoutCheck;
    expect(stdoutCheck).toBeDefined();
    if (!stdoutCheck) {
      return;
    }

    const result = await runCodeSheet(testCase.sheet, testCase.runnable, {
      complete(prompt) {
        if (prompt.includes("Your job is to finish the implementation of:")) {
          const target = prompt.split("Your job is to finish the implementation of:").at(-1) ?? "";
          if (target.includes("def parse_expr")) {
            return `def parse_expr(source) -> Expr | None:
  source = source.strip()
  if source.endswith(")") and source.count(")") > source.count("("):
    source = source[:-1].strip()
  if source.isdigit():
    return Val(int(source))
  if source == "2 + 3":
    return BinOp(Add(), Val(2), Val(3))
  if source == "(B1 + A1) * 4":
    return BinOp(Mul(), BinOp(Add(), Cell("B", 1), Cell("A", 1)), Val(4))
  if source and source[0].isalpha():
    col, row = c(source)
    return Cell(col, row)
  return None`;
          }

          if (target.includes("def pretty_expr")) {
            return `def pretty_expr(expr) -> str:
  if expr is None:
    return ""
  if isinstance(expr, Val):
    return str(expr.value)
  if isinstance(expr, Cell):
    return f"{expr.col}{expr.row}"
  symbol = {Add: "+", Sub: "-", Mul: "*", Div: "/"}[type(expr.op)]
  return f"({pretty_expr(expr.left)} {symbol} {pretty_expr(expr.right)})"`;
          }

          if (target.includes("def c")) {
            return `def c(source) -> CellAddress:
  source = source.strip().upper()
  col = "".join(ch for ch in source if ch.isalpha())
  row = int("".join(ch for ch in source if ch.isdigit()))
  return (col, row)`;
          }

          if (target.includes("class SpreadsheetResult:")) {
            return `class SpreadsheetResult:
  sheet: Spreadsheet
  cache: [[int]]

  def __init__(self, sheet: Spreadsheet) -> None:
    self.sheet = sheet
    self.cache = {}

  def eval(self, cell: CellAddress) -> int | EvalError | None:
    return self.eval_inner([], cell)

  def eval_inner(self, stack: list, cell: CellAddress) -> int | EvalError | None:
    if cell in self.cache:
      return self.cache[cell]
    if cell in stack:
      return RecursiveError(stack + [cell])
    expr = self.sheet.get(cell)
    if expr is None:
      return None
    value = self._eval_expr(expr, stack + [cell])
    if isinstance(value, (RecursiveError, DivByZero)):
      return value
    self.cache[cell] = value
    return value

  def _eval_expr(self, expr, stack):
    if isinstance(expr, Val):
      return expr.value
    if isinstance(expr, Cell):
      return self.eval_inner(stack, (expr.col, expr.row))
    left = self._eval_expr(expr.left, stack)
    if isinstance(left, (RecursiveError, DivByZero)):
      return left
    right = self._eval_expr(expr.right, stack)
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
  cells: [[Expr]]

  def __init__(self) -> None:
    self.cells = {}

  def get(self, cell: CellAddress) -> Expr | None:
    col, row = cell
    return self.cells.get(col, {}).get(row)

  def set(self, cell: CellAddress, expr: str) -> None:
    col, row = cell
    parsed = parse_expr(expr)
    if parsed is not None:
      self.cells.setdefault(col, {})[row] = parsed

  def eval(self) -> SpreadsheetResult:
    return SpreadsheetResult(self)`;
          }
        }

        if (
          prompt.includes("print results of each step") ||
          prompt.includes("excel-like table") ||
          prompt.includes("unevaluated expressions")
        ) {
          return `print(f"A1 -> {sheet.get(c('A1'))}")
sheet.set(c("A1"), "7")
print("A1 = 7")
print(f"A1 -> {sheet.eval().eval(c('A1'))}")
sheet.set(c("B1"), "2 + 3")
print("B1 = 2 + 3")
print(f"B1 -> {sheet.eval().eval(c('B1'))}")
sheet.set(c("C1"), "(B1 + A1) * 4)")
print("C1 = (B1 + A1) * 4")
print(f"C1 -> {sheet.eval().eval(c('C1'))}")
for row in range(1, 4):
  b_value = sheet.eval().eval(("B", row))
  if isinstance(b_value, int):
    sheet.set(("D", row), str(b_value * 2))
print("+------+----------------+")
print("| cell | expr           |")
for col in sorted(sheet.cells):
  for row in sorted(sheet.cells[col]):
    print(f"| {col}{row}   | {pretty_expr(sheet.cells[col][row]):<14} |")
print("+------+----------------+")
print("+------+-------+")
print("| cell | value |")
result = sheet.eval()
for col in sorted(sheet.cells):
  for row in sorted(sheet.cells[col]):
    print(f"| {col}{row}   | {result.eval((col, row)):<5} |")
print("+------+-------+")`;
        }

        return `print("+-------+")
print("| empty |")
print("+-------+")`;
      },
    });

    if (!result.ok) {
      throw new Error(`${result.error}\n\n${result.completed.source}`);
    }
    if (!stdoutCheck.matches(result.stdout)) {
      throw new Error(`Rendered spreadsheet stdout did not match:\n${result.stdout.join("\n")}`);
    }
  });

  it.skip("documents the current broken behavior when a natural snippet names a class generically", async () => {
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

  it.skip("runs when the natural snippet explicitly references the MagicSquare class", async () => {
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

  it.skip("runs when the natural snippet references the MagicSquare class without braces", async () => {
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

  it.skip("runs additive function and async-function definition forms", async () => {
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

  it.skip("runs additive class and record definition forms", async () => {
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
