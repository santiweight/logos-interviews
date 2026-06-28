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
  expectedStdout: string[];
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
    label: "Operational systems",
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
    ],
  },
];

export const samples: SampleProgram[] = sampleGroups.flatMap((group) => group.samples);

export const defaultProjectIds = [
  "interactive-reverse",
  "notification-retries",
  "feature-flag-rollout",
  "rate-limiter",
  "cart-promotions",
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
