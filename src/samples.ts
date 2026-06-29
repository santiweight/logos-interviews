import type { CodeSheet, Runnable } from "./codeSheet";

export type SampleProgram = {
  id: string;
  label: string;
  code: CodeSheet;
};

export type SampleGroup = {
  label: string;
  samples: SampleProgram[];
};

export type SampleEvalCase = {
  sampleId: string;
  name: string;
  sheet: CodeSheet;
  runnable: Runnable;
} & (
  | { expectedStdout: string[]; stdoutCheck?: never }
  | { expectedStdout?: never; stdoutCheck: SampleStdoutCheck }
);

export type SampleStdoutCheck = {
  description: string;
  matches: (stdout: string[]) => boolean;
};

export const sampleGroups: SampleGroup[] = [
  {
    label: "Product workflows",
    samples: [
      {
        id: "interactive-reverse",
        label: "Reverse CLI",
        code: `def main():
  \`an interactive cli loop, where user types a word, and the program prints back the reverse of the word\``,
      },
      {
        id: "cart-promotions",
        label: "Cart promotions",
        code: `# Items are dicts with sku, category, quantity, and price_cents.
# subtotal is the raw item total before discounts.
# BOGO_MUG is automatic: every second mug is free.
# SAVE10 subtracts 10% from the post-item-discount subtotal, rounded down.
# FREESHIP makes shipping free. Otherwise shipping is 700 cents when the post-item-discount subtotal is below 5000.
# Unknown coupon codes are ignored.
# price returns a receipt dict with subtotal, discounts, shipping, and total integer cent amounts.
# discounts is the total discount amount, not a per-discount breakdown.

class CartPricer:
  def price(self, items: list, coupon: str | None = None) -> dict

def test():
  items = [
    {"sku": "mug", "category": "mugs", "quantity": 3, "price_cents": 1200},
    {"sku": "book", "category": "books", "quantity": 1, "price_cents": 2500},
  ]
  pricer = CartPricer()
  receipt = pricer.price(items)
  print(receipt["subtotal"], receipt["discounts"], receipt["shipping"], receipt["total"])
  print(pricer.price(items, "SAVE10")["total"])
  print(pricer.price(items, "FREESHIP")["total"])
  print(pricer.price(items, "NOPE")["total"])`,
      },
      {
        id: "feature-flag-rollout",
        label: "Feature flag rollout",
        code: `# Users are dicts with id, org, plan, and country.
# Config maps flag names to rule dicts.
# allow_users and allow_orgs explicitly enable a flag.
# If a rule has plan or country, the user must match before default or rollout can enable it.
# rollout is an integer percentage from 0 to 100.
# A user's rollout bucket is the sum of character codes in their id modulo 100.
# enabled_flags returns enabled flag names sorted alphabetically.

class FeatureFlags:
  config: dict

  def __init__(self, config: dict) -> None
  def enabled(self, flag: str, user: dict) -> bool
  def enabled_flags(self, user: dict) -> list

def test():
  flags = FeatureFlags({
    "new_checkout": {"default": False, "allow_users": ["u1"], "rollout": 50},
    "beta_report": {"default": False, "allow_orgs": ["logos"], "plan": "pro"},
    "eu_banner": {"default": True, "country": "EU"},
  })
  ada = {"id": "u1", "org": "acme", "plan": "free", "country": "US"}
  ben = {"id": "u2", "org": "logos", "plan": "pro", "country": "US"}
  cy = {"id": "A", "org": "acme", "plan": "free", "country": "EU"}
  print(flags.enabled("new_checkout", ada))
  print(flags.enabled("new_checkout", ben))
  print(flags.enabled("beta_report", ben))
  print(flags.enabled("eu_banner", ada), flags.enabled("eu_banner", cy))
  print(flags.enabled_flags(ben))`,
      },
      {
        id: "calendar-availability",
        label: "Calendar availability",
        code: `# Times are integer minutes since midnight.
# Busy intervals use [start, end) semantics and may be unsorted or overlapping.
# available_slots returns maximal free intervals inside the workday that can fit duration minutes.
# Returned intervals are sorted (start, end) tuples.

def available_slots(work_start: int, work_end: int, busy: list, duration: int) -> list

def test():
  busy = [(660, 720), (570, 600), (585, 615)]
  print(available_slots(540, 780, busy, 30))
  print(available_slots(540, 780, busy, 60))
  print(available_slots(540, 780, [], 120))`,
      },
    ],
  },
  {
    label: "Operation systems",
    samples: [
      {
        id: "notification-retries",
        label: "Notification retries",
        code: `# Structured events are dicts with id, type, email, and payload fields.
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

class NotificationDispatcher:
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
  dispatcher = NotificationDispatcher(sender, templates, 2)
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
      },
      {
        id: "rate-limiter",
        label: "Rate limiter",
        code: `# Fixed-window rate limiter with an injectable clock.
# clock.now is an integer timestamp in seconds.
# Each key gets an independent window starting at its first allowed request.
# allow returns False after limit allowed requests until clock.now reaches the window reset time.
# remaining returns live requests left in the active window.
# reset_at returns the active window reset timestamp, or None if the key has no active window.

class Clock:
  def __init__(self):
    self.now = 0

class RateLimiter:
  clock: Clock
  limit: int
  window: int
  hits: dict

  def __init__(self, clock: Clock, limit: int, window: int) -> None
  def allow(self, key: str) -> bool
  def remaining(self, key: str) -> int
  def reset_at(self, key: str) -> int | None

def test():
  clock = Clock()
  limiter = RateLimiter(clock, 2, 10)
  print(limiter.allow("u1"), limiter.allow("u1"), limiter.allow("u1"))
  print(limiter.remaining("u1"))
  clock.now = 9
  print(limiter.reset_at("u1"))
  clock.now = 10
  print(limiter.allow("u1"), limiter.remaining("u1"))
  print(limiter.allow("u2"), limiter.remaining("u2"))`,
      },
      {
        id: "job-queue",
        label: "Job queue",
        code: `# In-memory queue with visibility timeouts.
# clock.now is an integer timestamp in seconds.
# enqueue returns ids like "job-1".
# reserve returns the oldest available job id, or None.
# Reserved jobs are invisible until clock.now reaches reserved_at + visibility_timeout.
# ack removes a reserved job and returns True; unknown jobs return False.
# fail releases a reserved job and increments attempts.
# A job moves to dead letters after max_attempts failures.
# pending and dead_letters return job ids in queue order.

class Clock:
  def __init__(self):
    self.now = 0

class JobQueue:
  clock: Clock
  visibility_timeout: int
  max_attempts: int
  jobs: dict
  order: list
  dead: list
  next_id: int

  def __init__(self, clock: Clock, visibility_timeout: int, max_attempts: int) -> None
  def enqueue(self, payload: str) -> str
  def reserve(self, worker_id: str) -> str | None
  def ack(self, job_id: str) -> bool
  def fail(self, job_id: str) -> bool
  def pending(self) -> list
  def dead_letters(self) -> list

def test():
  clock = Clock()
  queue = JobQueue(clock, 5, 2)
  j1 = queue.enqueue("email")
  j2 = queue.enqueue("report")
  print(j1, j2)
  print(queue.reserve("w1"))
  print(queue.ack(j1))
  print(queue.reserve("w2"))
  print(queue.reserve("w3"))
  clock.now = 5
  print(queue.reserve("w3"))
  print(queue.fail(j2))
  print(queue.reserve("w1"))
  print(queue.fail(j2))
  print(queue.dead_letters())
  print(queue.pending())`,
      },
    ],
  },
  {
    label: "Advanced modeling",
    samples: [
      {
        id: "starter-arithmetic",
        label: "Intro to Logos",
        code: `# In Logos, LLMs will complete partial code for you.
# Click \`add\` in the code view to see its implementation.
def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

# Click the run button to run this class (once it's been compiled).
# Click \`main\` in the code view to see its implementation.
def main():
  # In Logos, you can use regular python...
  print(mul(add(1, 2), 3))

  # Or use a snippet to have the LLM write it for you...
  \`print mul of (add one and two) and 3\`
  print(mul(add(\`the number one\`, \`the number two\`), \`the number three\`))

  added = \`add 1 and 2\`
  product = \`mul 3 and 4\`
  print(added)
  print(product)`,
      },
      {
        id: "beyond-basics",
        label: "Beyond Basics",
        code: `# You can also define classes, even if they're not complete!
# Notice how the agent internally generates a field for tracking the grid.

class MagicSquare:
  size: int

  def gen() -> MagicSquare
  def pretty() -> str

def test_magic_square():
  # Logos also support multi-line snippets.
  \`\`\`
  generate a MagicSquare
  pretty print it
  check the MagicSquare is valid, and show the work
  \`\`\``,
      },
      {
        id: "ascii-fractal",
        label: "ASCII fractal",
        code: `# Fractal rendering file.
# Results must be exactly 24 strings, each 64 characters wide.
# through the middle, and nested coastline or root contours near the ground.
# Use only these density characters, from empty to bright: " .:-=+*#%@".
# Keep the background mostly empty, with detail clustered into readable forms.
# Return a deterministic ASCII mandelbrot fractal.

def fractal() -> list

def test():
  for line in fractal():
    print(line)`,
      },
      {
        id: "formula-spreadsheet",
        label: "Formula spreadsheet",
        code: `# Spreadsheet cell storage uses A1-style addressing.
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
      },
      {
        id: "sudoku-state",
        label: "Sudoku state",
        code: `# SudokuState stores a 9x9 board as list[list[int]], using 0 for blank cells.
# generate_sudoku returns a valid puzzle with blanks and at least one solution.
# solve mutates the board in place using backtracking.
# pretty_print prints a table-style grid with these exact conventions:
# +-------+-------+-------+ before row 0, row 3, row 6, and after row 8.
# Each row begins "| ", separates every 3 columns with "| ", ends with "|", and prints 0 as ".".
# Use this boxed, grouped style as the canonical pretty-print format for grid and table examples.

class SudokuState:
  board: list[list[int]]

  def __init__(self, board: list[list[int]] | None = None) -> None
  def generate_sudoku() -> "SudokuState"
  def solve(self) -> None
  def pretty_print(self) -> None

def main():
  state = SudokuState.generate_sudoku()
  print("Puzzle:")
  state.pretty_print()
  state.solve()
  print("Solution:")
  state.pretty_print()`,
      },
    ],
  },
];

export const samples: SampleProgram[] = sampleGroups.flatMap((group) => group.samples);

export const defaultProjectIds = [
  "starter-arithmetic",
  "beyond-basics",
  "ascii-fractal",
  "formula-spreadsheet",
];

export const sampleEvalCases: SampleEvalCase[] = [
  {
    sampleId: "cart-promotions",
    name: "cart promotions receipt",
    sheet: sampleById("cart-promotions").code,
    runnable: "test",
    expectedStdout: ["6100 1200 700 5600", "5110", "4900", "5600"],
  },
  {
    sampleId: "cart-promotions",
    name: "cart promotions bogo and shipping threshold",
    sheet: withTest("cart-promotions", `def test():
  pricer = CartPricer()
  mugs = [{"sku": "mug", "category": "mugs", "quantity": 4, "price_cents": 1000}]
  receipt = pricer.price(mugs)
  print(receipt["subtotal"], receipt["discounts"], receipt["shipping"], receipt["total"])
  threshold = [{"sku": "lamp", "category": "home", "quantity": 1, "price_cents": 5000}]
  receipt = pricer.price(threshold, "SAVE10")
  print(receipt["subtotal"], receipt["discounts"], receipt["shipping"], receipt["total"])`),
    runnable: "test",
    expectedStdout: ["4000 2000 700 2700", "5000 500 0 4500"],
  },
  {
    sampleId: "feature-flag-rollout",
    name: "feature flag rollout policy",
    sheet: sampleById("feature-flag-rollout").code,
    runnable: "test",
    expectedStdout: ["True", "False", "True", "False True", "['beta_report']"],
  },
  {
    sampleId: "feature-flag-rollout",
    name: "feature flag gates and unknown flags",
    sheet: withTest("feature-flag-rollout", `def test():
  flags = FeatureFlags({
    "everyone": {"default": False, "rollout": 100},
    "nobody": {"default": False, "rollout": 0},
    "pro_only": {"default": True, "plan": "pro"},
    "us_only": {"default": True, "country": "US"},
  })
  free_eu = {"id": "abc", "org": "acme", "plan": "free", "country": "EU"}
  pro_us = {"id": "z", "org": "acme", "plan": "pro", "country": "US"}
  print(flags.enabled("everyone", free_eu), flags.enabled("nobody", free_eu))
  print(flags.enabled("pro_only", free_eu), flags.enabled("pro_only", pro_us))
  print(flags.enabled("us_only", free_eu), flags.enabled("us_only", pro_us))
  print(flags.enabled("missing", pro_us))
  print(flags.enabled_flags(pro_us))`),
    runnable: "test",
    expectedStdout: [
      "True False",
      "False True",
      "False True",
      "False",
      "['everyone', 'pro_only', 'us_only']",
    ],
  },
  {
    sampleId: "calendar-availability",
    name: "calendar availability intervals",
    sheet: sampleById("calendar-availability").code,
    runnable: "test",
    expectedStdout: [
      "[(540, 570), (615, 660), (720, 780)]",
      "[(720, 780)]",
      "[(540, 780)]",
    ],
  },
  {
    sampleId: "calendar-availability",
    name: "calendar availability merges clipped busy intervals",
    sheet: withTest("calendar-availability", `def test():
  busy = [(500, 550), (540, 560), (600, 620), (620, 630), (800, 900)]
  print(available_slots(540, 660, busy, 20))
  print(available_slots(540, 660, busy, 45))
  print(available_slots(0, 100, [(20, 40), (70, 80)], 30))`),
    runnable: "test",
    expectedStdout: ["[(560, 600), (630, 660)]", "[]", "[(40, 70)]"],
  },
  {
    sampleId: "notification-retries",
    name: "notification retry dispatcher",
    sheet: sampleById("notification-retries").code,
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
    sampleId: "notification-retries",
    name: "notification permanent failures are not retried",
    sheet: withTest("notification-retries", `def test():
  templates = {"signup": {"subject": "Welcome {name}", "body": "Hi {name}"}}
  sender = FakeSender()
  dispatcher = NotificationDispatcher(sender, templates, 3)
  print(dispatcher.handle_event({
    "id": "e1", "type": "signup", "email": "bad@example.com", "payload": {"name": "Bad"}
  }))
  print(sender.attempts_for("bad@example.com", "Welcome Bad"))
  print(dispatcher.handle_event({
    "id": "e2", "type": "signup", "email": "ada@example.com", "payload": {"name": "Ada"}
  }))
  print(dispatcher.sent())
  print(dispatcher.dead_letters())`),
    runnable: "test",
    expectedStdout: ["dead_letter", "1", "sent", "['e2']", "['e1']"],
  },
  {
    sampleId: "rate-limiter",
    name: "fixed-window rate limiter",
    sheet: sampleById("rate-limiter").code,
    runnable: "test",
    expectedStdout: ["True True False", "0", "10", "True 1", "True 1"],
  },
  {
    sampleId: "rate-limiter",
    name: "rate limiter keeps independent windows",
    sheet: withTest("rate-limiter", `def test():
  clock = Clock()
  limiter = RateLimiter(clock, 1, 5)
  print(limiter.reset_at("missing"))
  print(limiter.allow("a"), limiter.allow("a"))
  print(limiter.allow("b"), limiter.remaining("b"), limiter.reset_at("b"))
  clock.now = 5
  print(limiter.allow("a"), limiter.remaining("a"), limiter.reset_at("a"))`),
    runnable: "test",
    expectedStdout: ["None", "True False", "True 0 5", "True 0 10"],
  },
  {
    sampleId: "job-queue",
    name: "job queue visibility timeout",
    sheet: sampleById("job-queue").code,
    runnable: "test",
    expectedStdout: [
      "job-1 job-2",
      "job-1",
      "True",
      "job-2",
      "None",
      "job-2",
      "True",
      "job-2",
      "True",
      "['job-2']",
      "[]",
    ],
  },
  {
    sampleId: "job-queue",
    name: "job queue empty and unknown operations",
    sheet: withTest("job-queue", `def test():
  clock = Clock()
  queue = JobQueue(clock, 5, 1)
  print(queue.reserve("w1"))
  print(queue.ack("missing"), queue.fail("missing"))
  j1 = queue.enqueue("email")
  print(queue.pending())
  print(queue.reserve("w1"))
  print(queue.fail(j1))
  print(queue.dead_letters())
  print(queue.reserve("w2"))`),
    runnable: "test",
    expectedStdout: ["None", "False False", "['job-1']", "job-1", "True", "['job-1']", "None"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "simple add and multiply",
    sheet: `def add(x: int, y: int) -> int

def multiply(x: int, y: int) -> int

def test():
  print(add(1, 2))
  print(multiply(2, 3))`,
    runnable: "test",
    expectedStdout: ["3", "6"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "natural language arithmetic snippets",
    sheet: `def test():
  total = \`add 1 and 2\`
  product = \`multiply 3 and 4\`
  print(total)
  print(product)`,
    runnable: "test",
    expectedStdout: ["3", "12"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "starter arithmetic definitions and natural snippets",
    sheet: `def add(x: int, y: int) -> int

def multiply(x: int, y: int) -> int

def test():
  print(add(1, 2))
  print(multiply(2, 3))
  total = \`add 1 and 2\`
  product = \`multiply 3 and 4\`
  print(total)
  print(product)`,
    runnable: "test",
    expectedStdout: ["3", "6", "3", "12"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "logos intro test_basic arithmetic and snippets",
    sheet: `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test_basic():
  print(mul(add(1, 2), 3))
  \`print mul of (add one and two) and 3\`
  print(mul(add(\`the number one\`, \`the number two\`), \`the number three\`))
  added = \`add 1 and 2\`
  product = \`mul 3 and 4\`
  print(added)
  print(product)`,
    runnable: "test_basic",
    expectedStdout: ["9", "9", "9", "12"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "logos intro main arithmetic and snippets",
    sheet: sampleById("starter-arithmetic").code,
    runnable: "main",
    expectedStdout: ["9", "9", "9", "12"],
  },
  {
    sampleId: "beyond-basics",
    name: "completed magic square pretty print",
    sheet: `class MagicSquare:
  def __init__(self, grid: list):
    self.grid = grid
    self.size = len(grid)

  def gen() -> MagicSquare:
    return MagicSquare([
      [8, 1, 6],
      [3, 5, 7],
      [4, 9, 2],
    ])

  def pretty(self) -> str:
    return "\\n".join(" ".join(str(value) for value in row) for row in self.grid)

def test():
  square = MagicSquare.gen()
  print(square.size)
  print(square.pretty())`,
    runnable: "test",
    expectedStdout: ["3", "8 1 6", "3 5 7", "4 9 2"],
  },
  {
    sampleId: "beyond-basics",
    name: "unbraced magic square natural language template",
    sheet: sampleById("beyond-basics").code,
    runnable: "test_magic_square",
    stdoutCheck: {
      description: "prints a valid magic square and shows validation work",
      matches(stdout) {
        const joined = stdout.join("\n");
        return (
          stdout.length > 0 &&
          /\b15\b/.test(joined) &&
          /(?:valid|row|column|diagonal|magic)/i.test(joined)
        );
      },
    },
  },
  {
    sampleId: "ascii-fractal",
    name: "sierpinski ascii fractal",
    sheet: `# Return a deterministic Sierpinski-style ASCII triangle.
# The triangle has 8 rows and 15 columns.
# Use "#" for filled cells and spaces for empty cells.
# The exact rows are:
# "       #       "
# "      # #      "
# "     #   #     "
# "    # # # #    "
# "   #       #   "
# "  # #     # #  "
# " #   #   #   # "
# "# # # # # # # #"

def fractal() -> list

def test():
  for line in fractal():
    print(line)`,
    runnable: "test",
    expectedStdout: [
      "       #       ",
      "      # #      ",
      "     #   #     ",
      "    # # # #    ",
      "   #       #   ",
      "  # #     # #  ",
      " #   #   #   # ",
      "# # # # # # # #",
    ],
  },
  {
    sampleId: "ascii-fractal",
    name: "deterministic ascii mandelbrot contract",
    sheet: withTest("ascii-fractal", `def test():
  palette = set(" .:-=+*#%@")
  first = fractal()
  second = fractal()
  filled = sum(char != " " for row in first for char in row)
  used = {char for row in first for char in row if char != " "}
  rows_with_marks = sum(any(char != " " for char in row) for row in first)
  print(len(first), len(first[0]) if first else 0)
  print(all(len(row) == 64 for row in first))
  print(all(char in palette for row in first for char in row))
  print(first == second)
  print(100 <= filled <= 700)
  print(rows_with_marks >= 14)
  print(len(set(first)) >= 12)
  print(len(used) >= 5)
  print(any(char in "#%@" for row in first for char in row))`),
    runnable: "test",
    expectedStdout: ["24 64", "True", "True", "True", "True", "True", "True", "True", "True"],
  },
  {
    sampleId: "ascii-fractal",
    name: "mandelbrot render natural snippet",
    sheet: `# Fractal rendering file.
# Results must be exactly 24 strings, each 64 characters wide.
# through the middle, and nested coastline or root contours near the ground.
# Use only these density characters, from empty to bright: " .:-=+*#%@".
# Keep the background mostly empty, with detail clustered into readable forms.

class AsciiArt:
  def render() -> str

def mandelbrot() -> AsciiArt
  # Return a deterministic ASCII mandelbrot fractal.

def main():
  \`generate and render the {mandelbrot} fractal\``,
    runnable: "main",
    stdoutCheck: {
      description:
        "prints a visible Mandelbrot-style ASCII rendering using the density palette",
      matches: isVisibleAsciiFractalStdout,
    },
  },
  {
    sampleId: "formula-spreadsheet",
    name: "formula spreadsheet strings",
    sheet: sampleById("formula-spreadsheet").code,
    runnable: "test",
    expectedStdout: ["None", "Val(value=7)", "5", "48"],
  },
  {
    sampleId: "formula-spreadsheet",
    name: "formula spreadsheet precedence and parentheses",
    sheet: withTest("formula-spreadsheet", `def test():
  sheet = Spreadsheet()
  sheet.set(c("A1"), "10 - 2 * 3")
  sheet.set(c("B1"), "(10 - 2) * 3")
  sheet.set(c("C1"), "B1 / 4 + A1")
  print(sheet.eval().eval(c("A1")))
  print(sheet.eval().eval(c("B1")))
  print(sheet.eval().eval(c("C1")))`),
    runnable: "test",
    expectedStdout: ["4", "24", "10"],
  },
  {
    sampleId: "sudoku-state",
    name: "sudoku pretty grid and solver",
    sheet: withMain("sudoku-state", `def main():
  state = SudokuState([
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
  ])
  state.pretty_print()
  state.solve()
  print(state.board[0])
  print(state.board[8])`),
    runnable: "main",
    expectedStdout: [
      "+-------+-------+-------+",
      "| 5 3 . | . 7 . | . . . |",
      "| 6 . . | 1 9 5 | . . . |",
      "| . 9 8 | . . . | . 6 . |",
      "+-------+-------+-------+",
      "| 8 . . | . 6 . | . . 3 |",
      "| 4 . . | 8 . 3 | . . 1 |",
      "| 7 . . | . 2 . | . . 6 |",
      "+-------+-------+-------+",
      "| . 6 . | . . . | 2 8 . |",
      "| . . . | 4 1 9 | . . 5 |",
      "| . . . | . 8 . | . 7 9 |",
      "+-------+-------+-------+",
      "[5, 3, 4, 6, 7, 8, 9, 1, 2]",
      "[3, 4, 5, 2, 8, 6, 1, 7, 9]",
    ],
  },
];

function sampleById(id: string): SampleProgram {
  const sample = samples.find((item) => item.id === id);
  if (!sample) {
    throw new Error(`Missing sample: ${id}`);
  }

  return sample;
}

function withTest(sampleId: string, testSource: string): CodeSheet {
  const code = sampleById(sampleId).code;
  const marker = "\ndef test():\n";
  const markerIndex = code.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Sample has no test runnable: ${sampleId}`);
  }

  return `${code.slice(0, markerIndex)}\n\n${testSource}`;
}

function withMain(sampleId: string, mainSource: string): CodeSheet {
  const code = sampleById(sampleId).code;
  const marker = "\ndef main():\n";
  const markerIndex = code.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Sample has no main runnable: ${sampleId}`);
  }

  return `${code.slice(0, markerIndex)}\n\n${mainSource}`;
}

function isVisibleAsciiFractalStdout(stdout: string[]): boolean {
  const palette = new Set(" .:-=+*#%@");
  const visibleRows = stdout.filter((row) => row.trim().length > 0);
  const filled = stdout.reduce((total, row) => {
    return total + [...row].filter((char) => char !== " ").length;
  }, 0);
  const used = new Set(stdout.join("").replaceAll(" ", ""));

  return (
    stdout.length >= 14 &&
    stdout.length <= 24 &&
    stdout.every((row) => row.length <= 64 && [...row].every((char) => palette.has(char))) &&
    visibleRows.length >= 12 &&
    stdout.some((row) => row.length >= 40) &&
    filled >= 100 &&
    filled <= 800 &&
    used.size >= 5 &&
    stdout.some((row) => /[#%@]/.test(row))
  );
}
