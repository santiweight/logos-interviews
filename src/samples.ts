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

export type SampleTemplateGroup = {
  label: string;
  sampleIds: string[];
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

const humanSudokuStrategyTemplate = `# Human-style Sudoku strategies.
# apply_strategy performs one named strategy pass: no guessing or backtracking.

type SudokuStrategy =
  UniqueBoxSolve # there is only one square for a number to go in, in a box
  | UniqueLineSolve # there is only one square for a number to go in, in a row/column
  | HiddenDoubleInBox # two numbers appear in the same two cells of a box
  | # a row/col's possible squares for a number are all in the same box,
    # so that number can be removed from the rest of that box
    LineCompleteExceptForBox
  | HiddenSingle
type CellAnnotation = Solved(int) | Annotations(list[int])

class SudokuState:
  grid: list[list[CellAnnotation]]

  def __init__(self, grid: list) -> None
  def values(self) -> list[list[int]]
  def candidates(self, row: int, col: int) -> list[int]
  def pretty_print(self) -> None

def apply_strategy(state: SudokuState, strategy: SudokuStrategy) -> SudokuState

@logos.debug.print()
def main():
  \`\`\`
  Demonstrate the five strategies on a small set of Sudoku examples.
  Print each strategy name, the board before and after, and any candidate changes.
  \`\`\``;

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

class WindowState:
  def __init__(self, start: int, count: int):
    self.start = start
    self.count = count

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

class Job:
  def __init__(self, job_id: str, payload: str):
    self.job_id = job_id
    self.payload = payload
    self.reserved_by = None
    self.reserved_at = None
    self.attempts = 0

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

def mandelbrot() -> list

def test():
  for line in mandelbrot():
    print(line)`,
      },
      {
        id: "weather-map",
        label: "Weather map",
        code: `# Terminal weather map.
# WeatherMap is a generated 40-column by 16-row map, not a screenshot.
# render() returns exactly 16 newline-separated rows, each exactly 40 columns.
# Use only these map symbols:
# " " clear air, "." cloud, ":" heavy cloud, "~" rain band, "*" lightning,
# "L" low pressure, "H" high pressure, and "^>v<" wind arrows.
# Keep the background mostly whitespace with clustered weather systems.
# pan(dx, dy) returns a new map shifted east/west and north/south.
# rotate_wind(turns) returns a new map where wind arrows rotate 90 degrees per turn.
# The generated output is deterministic.
# If you use helpers or constants such as WIDTH, HEIGHT, or SYMBOLS, define
# them in the completion rather than assuming they already exist.

class WeatherMap:
  def render(self) -> str
  def pan(self, dx: int, dy: int) -> "WeatherMap"
  def rotate_wind(self, turns: int = 1) -> "WeatherMap"

def sample_weather() -> WeatherMap

def main():
  view = sample_weather()
  print(view.render())
  while True:
    command = input("wasd pan, qe rotate wind, x exit> ").strip().lower()
    if command == "x":
      break
    for key in command:
      if key == "w":
        view = view.pan(0, -1)
      elif key == "s":
        view = view.pan(0, 1)
      elif key == "a":
        view = view.pan(-1, 0)
      elif key == "d":
        view = view.pan(1, 0)
      elif key == "q":
        view = view.rotate_wind(-1)
      elif key == "e":
        view = view.rotate_wind(1)
    print(view.render())`,
      },
      {
        id: "maze-renderer",
        label: "Maze renderer",
        code: `# Interactive ASCII maze.
# The maze is a fixed 13-column by 7-row grid.
# render() returns exactly 7 newline-separated rows, each exactly 13 columns.
# Use "#" for walls, " " for corridors, "@" for the player, and "E" for the exit.
# The outer border is all walls except no gaps; the player cannot move through "#".
# The sample maze starts the player at coordinate (1, 1), with an open corridor to the right.
# move(command) accepts one of "w", "a", "s", "d" and returns a new Maze.
# Invalid moves return an unchanged maze.
# solved() is True only when the player reaches the exit cell.
# The sample maze is deterministic and has at least one path from start to exit.
# Keep the fixed grid or any helper constants in the completion.

class Maze:
  def render(self) -> str
  def move(self, command: str) -> "Maze"
  def position(self) -> tuple[int, int]
  def solved(self) -> bool

def sample_maze() -> Maze

def main():
  maze = sample_maze()
  print(maze.render())
  while not maze.solved():
    command = input("wasd move, x exit> ").strip().lower()
    if command == "x":
      break
    for key in command:
      maze = maze.move(key)
    print(maze.render())
  if maze.solved():
    print("solved")`,
      },
      {
        id: "julia-set-explorer",
        label: "Julia set explorer",
        code: `# Julia set explorer.
# AsciiArt is a generated 64-column by 24-row density image.
# render() returns exactly 24 newline-separated rows, each exactly 64 columns.
# Use only these density characters, from empty to bright: " .:-=+*#%@".
# Keep the background mostly whitespace and the fractal body opaque.
# pan(dx, dy), zoom(factor), and rotate() return new AsciiArt views.
# For rotate(), re-render transformed sample coordinates while preserving 24x64;
# do not transpose the rendered text grid.
# julia(seed) is deterministic for the same seed.
# If you use helper functions or constants such as ROWS, COLS, or PALETTE,
# define them in the completion rather than assuming they already exist.

class AsciiArt:
  def render(self) -> str
  def pan(self, dx: float, dy: float) -> "AsciiArt"
  def zoom(self, factor: float) -> "AsciiArt"
  def rotate(self) -> "AsciiArt"

def julia(seed: str = "dragon") -> AsciiArt

def main():
  art = julia()
  print(art.render())
  while True:
    command = input("wasd pan, z/c zoom, qe rotate, x exit> ").strip().lower()
    if command == "x":
      break
    for key in command:
      if key == "w":
        art = art.pan(0, -0.12)
      elif key == "s":
        art = art.pan(0, 0.12)
      elif key == "a":
        art = art.pan(-0.12, 0)
      elif key == "d":
        art = art.pan(0.12, 0)
      elif key == "z":
        art = art.zoom(1.25)
      elif key == "c":
        art = art.zoom(0.8)
      elif key in ("q", "e"):
        art = art.rotate()
    print(art.render())`,
      },
      {
        id: "isometric-cube-stack",
        label: "Isometric cubes",
        code: `# Isometric cube stack.
# IsoScene is a deterministic 48-column by 18-row ASCII scene.
# render() returns exactly 18 newline-separated rows, each exactly 48 columns.
# Use mostly whitespace plus these structural characters: "/\\_|.+#".
# Cues should read as stacked isometric cubes with top, left, and right faces.
# rotate_y(turns) returns a new scene rotated around the vertical axis.
# rotate_y must be chainable: always return an IsoScene, never None.
# rotate_y(1).render() must differ from render(); four clockwise rotations must return to the original view.
# cube_stack returns the declared top-level IsoScene class; do not define a nested replacement IsoScene.
# For directional glyphs, rotate face orientation intentionally; do not simply
# reverse strings or transpose the rendered text.
# Keep cube coordinates, dimensions, and helper functions in the completion.

class IsoScene:
  def render(self) -> str
  def rotate_y(self, turns: int = 1) -> "IsoScene"

def cube_stack() -> IsoScene

def main():
  scene = cube_stack()
  print(scene.render())
  while True:
    command = input("q/e rotate, x exit> ").strip().lower()
    if command == "x":
      break
    for key in command:
      if key == "q":
        scene = scene.rotate_y(-1)
      elif key == "e":
        scene = scene.rotate_y(1)
    print(scene.render())`,
      },
      {
        id: "formula-spreadsheet",
        label: "Formula spreadsheet",
        code: `# Spreadsheet cell storage uses A1-style addressing.
# Treat [[T]] as a nested mapping keyed by column then row:
# cells["A"][1] is A1, cells["B"][2] is B2.
# Parse expression strings containing ints, A1 cell refs, +, -, *, /, and parentheses.
# eval returns integer results; division of evenly divisible integers should print as an int, not a float.
# If an expression has one extra trailing ")" but is otherwise parseable, ignore it.
# c("A1") returns ("A", 1).

type Operator = Mul | Div | Add | Sub
type Expr = Val(int) | BinOp(Operator, Expr, Expr) | Cell(str, int)
type EvalError = RecursiveError(list) | DivByZero
type CellAddress = (str, int)

def parse_expr(str) -> Expr | None

def pretty_expr(expr) -> str

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
  \`render + print sheet\`
  print(sheet.get(c("A1")))
  sheet.set(c("A1"), "7")
  print(sheet.get(c("A1")))
  sheet.set(c("B1"), "2 + 3")
  print(sheet.eval().eval(c("B1")))
  sheet.set(c("C1"), "(B1 + A1) * 4)")
  print(sheet.eval().eval(c("C1")))
  \`\`\`
  render + print sheet as unevaluated expressions and then as an excel-like table
  print as pretty tables
  use pretty_expr
  \`\`\``,
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
      {
        id: "annotated-maze",
        label: "Annotated maze",
        code: `# Maze.grid is a rectangular list of rows.
# Use "#" for walls, " " for open cells, "S" for start, and "G" for goal.
# start and goal are (row, col) coordinates.
# MazeGenerator.gen returns a deterministic, solvable maze of the configured size.
# astar_solve returns a shortest path from start to goal, including both endpoints.

class Maze(grid: list[list[str]], start: tuple[int, int], goal: tuple[int, int])

def maze_is_solvable(maze: Maze) -> bool

@logos.debug.print()
class MazeGenerator:
  size: int = 8

  # Generates a solvable maze using classical graph techniques.
  # Start with a connected grid graph, choose two opposing reachable nodes,
  # and remove enough edges or cells to make the route interesting while
  # preserving at least one path between start and goal.
  # Use maze_is_solvable for validation rather than undeclared helpers.
  def gen(self) -> Maze

def astar_solve(maze: Maze) -> list[tuple[int, int]]

@logos.debug.print()
def main():
  \`\`\`
  build a 10x10 maze using MazeGenerator, and then solve it using A*.
  only generate solvable mazes.
  use maze_is_solvable to check the generated maze before solving it.
  print the maze, the start and goal, the path length, and the solved maze
  with the path marked.
  use colors to make it clear where the path is
  \`\`\``,
      },
      {
        id: "sudoku-human-strategies",
        label: "Human Sudoku strategies",
        code: humanSudokuStrategyTemplate,
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
  "annotated-maze",
];

export const sampleTemplateGroups: SampleTemplateGroup[] = [
  {
    label: "Getting started",
    sampleIds: ["starter-arithmetic", "beyond-basics", "interactive-reverse"],
  },
  {
    label: "Product workflows",
    sampleIds: ["cart-promotions", "feature-flag-rollout", "calendar-availability"],
  },
  {
    label: "Backend systems",
    sampleIds: ["notification-retries", "rate-limiter", "job-queue"],
  },
  {
    label: "Modeling and data",
    sampleIds: ["formula-spreadsheet", "sudoku-state", "sudoku-human-strategies", "annotated-maze"],
  },
  {
    label: "ASCII art",
    sampleIds: [
      "ascii-fractal",
      "weather-map",
      "maze-renderer",
      "julia-set-explorer",
      "isometric-cube-stack",
    ],
  },
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
    name: "ansi green terminal output",
    sheet: `def main():
  \`\`\`
  print a green 8
  \`\`\``,
    runnable: "main",
    stdoutCheck: {
      description: "prints 8 wrapped in an ANSI green SGR sequence",
      matches(stdout) {
        return stdout.length === 1 && /^\x1b\[(?:0;)?(?:32|92)m8\x1b\[0m$/.test(stdout[0] ?? "");
      },
    },
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
    name: "logos intro main arithmetic and snippets",
    sheet: sampleById("starter-arithmetic").code,
    runnable: "main",
    expectedStdout: ["9", "9", "9", "3", "12"],
  },
  {
    sampleId: "starter-arithmetic",
    name: "logos intro main arithmetic and snippets",
    sheet: sampleById("starter-arithmetic").code,
    runnable: "main",
    expectedStdout: ["9", "9", "9", "3", "12"],
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
  first = mandelbrot()
  second = mandelbrot()
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
    name: "mandelbrot render and rotate natural snippet",
    sheet: `# Fractal rendering file.
# AsciiArt represents a generated image, not just a finished text buffer.
# render() returns exactly 24 newline-separated rows, each exactly 64 columns.
# rotate() returns a new AsciiArt view rotated 90 degrees clockwise.
# For generated images, rotate by re-rendering transformed sample coordinates,
# preserving the 24x64 output size; do not transpose the rendered text grid.
# Keep every rendered character in this density palette, from empty to bright:
# " .:-=+*#%@".
# Keep the background mostly whitespace and make the main shape opaque.
# Mandelbrot should have a compact body with a bulb, a horizontal waist,
# nested coastline detail, and deterministic output.

class AsciiArt:
  def render(self) -> str
  def rotate(self) -> "AsciiArt"

def mandelbrot() -> AsciiArt
  # Return a deterministic ASCII mandelbrot fractal.

def main():
  \`generate and render the {mandelbrot} fractal, then print a blank line, then print its rotated view\``,
    runnable: "main",
    stdoutCheck: {
      description:
        "prints normal and rotated 24x64 Mandelbrot-style ASCII renderings using the density palette",
      matches: isVisibleRotatedAsciiFractalStdout,
    },
  },
  {
    sampleId: "weather-map",
    name: "weather map render and controls contract",
    sheet: withMain("weather-map", `def test():
  allowed = set(" .:~*LH^>v<")
  base = sample_weather()
  rows = base.render().splitlines()
  shifted = base.pan(2, -1).render().splitlines()
  wind = base.rotate_wind(1).render().splitlines()
  filled = sum(char != " " for row in rows for char in row)
  print(len(rows), len(rows[0]) if rows else 0)
  print(all(len(row) == 40 for row in rows + shifted + wind))
  print(all(char in allowed for row in rows + shifted + wind for char in row))
  print(rows == sample_weather().render().splitlines())
  print(rows != shifted)
  print(rows != wind)
  print(filled >= 40)
  print(any(char in "LH" for row in rows for char in row))
  print(any(char in "^>v<" for row in rows for char in row))
  print(any(char in "~*" for row in rows for char in row))`),
    runnable: "test",
    expectedStdout: [
      "16 40",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
    ],
  },
  {
    sampleId: "maze-renderer",
    name: "maze renderer movement contract",
    sheet: withMain("maze-renderer", `def test():
  maze = sample_maze()
  rows = maze.render().splitlines()
  start = maze.position()
  blocked = maze.move("a")
  moved = maze.move("d")
  print(len(rows), len(rows[0]) if rows else 0)
  print(all(len(row) == 13 for row in rows))
  print(all(char in set("# @E") for row in rows for char in row))
  print(start == (1, 1))
  print(blocked.position() == start)
  print(moved.position() != start)
  print(moved.render() != maze.render())
  print(not maze.solved())
  print(sum(row.count("@") for row in rows))
  print(sum(row.count("E") for row in rows))`),
    runnable: "test",
    expectedStdout: [
      "7 13",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "1",
      "1",
    ],
  },
  {
    sampleId: "julia-set-explorer",
    name: "julia set explorer view contract",
    sheet: withMain("julia-set-explorer", `def test():
  palette = set(" .:-=+*#%@")
  art = julia("dragon")
  rows = art.render().splitlines()
  shifted = art.pan(0.2, -0.1).render().splitlines()
  zoomed = art.zoom(1.2).render().splitlines()
  rotated = art.rotate().render().splitlines()
  repeat = julia("dragon").render().splitlines()
  filled = sum(char != " " for row in rows for char in row)
  print(len(rows), len(rows[0]) if rows else 0)
  print(all(len(row) == 64 for row in rows + shifted + zoomed + rotated))
  print(all(char in palette for row in rows + shifted + zoomed + rotated for char in row))
  print(rows == repeat)
  print(rows != shifted)
  print(rows != zoomed)
  print(rows != rotated)
  print(50 <= filled <= 1200)
  print(any(char != " " for row in rows for char in row))
  print(any(char in "#%@" for row in rows for char in row))`),
    runnable: "test",
    expectedStdout: [
      "24 64",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
    ],
  },
  {
    sampleId: "isometric-cube-stack",
    name: "isometric cube stack rotation contract",
    sheet: withMain("isometric-cube-stack", `def test():
  allowed = set(" /\\\\_|.+#")
  scene = cube_stack()
  rows = scene.render().splitlines()
  def rotated(source, turns=1):
    result = source.rotate_y(turns)
    return source if result is None else result
  once = rotated(scene, 1).render().splitlines()
  four_scene = cube_stack()
  for _ in range(4):
    four_scene = rotated(four_scene, 1)
  four = four_scene.render().splitlines()
  filled = sum(char != " " for row in rows for char in row)
  print(len(rows), len(rows[0]) if rows else 0)
  print(all(len(row) == 48 for row in rows + once + four))
  print(all(char in allowed for row in rows + once + four for char in row))
  print(rows == cube_stack().render().splitlines())
  print(rows != once)
  print(rows == four)
  print(40 <= filled <= 500)
  print(any("/" in row for row in rows))
  print(any("\\\\" in row for row in rows))
  print(any("_" in row or "|" in row for row in rows))`),
    runnable: "test",
    expectedStdout: [
      "18 48",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
    ],
  },
  {
    sampleId: "formula-spreadsheet",
    name: "formula spreadsheet strings and rendering",
    sheet: sampleById("formula-spreadsheet").code,
    runnable: "test",
    stdoutCheck: {
      description:
        "prints the core spreadsheet results and at least one rendered table-like view with cell addresses",
      matches: isRenderedSpreadsheetStdout,
    },
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
    sampleId: "sudoku-human-strategies",
    name: "human sudoku strategy semantics",
    sheet: withMain("sudoku-human-strategies", `def main():
  def annotation_grid(values: list[int]) -> list:
    return [[Annotations(list(values)) for _ in range(9)] for _ in range(9)]

  def solved_count(state: SudokuState) -> int:
    return sum(1 for row in state.values() for value in row if value != 0)

  line_state = SudokuState([
    [0, 2, 3, 4, 5, 6, 7, 8, 9],
    [4, 5, 6, 0, 0, 0, 0, 0, 0],
    [7, 8, 9, 0, 0, 0, 0, 0, 0],
    [2, 3, 4, 0, 0, 0, 0, 0, 0],
    [5, 6, 7, 0, 0, 0, 0, 0, 0],
    [8, 9, 2, 0, 0, 0, 0, 0, 0],
    [3, 4, 5, 0, 0, 0, 0, 0, 0],
    [6, 7, 8, 0, 0, 0, 0, 0, 0],
    [9, 1, 2, 0, 0, 0, 0, 0, 0],
  ])
  before = solved_count(line_state)
  line_state = apply_strategy(line_state, UniqueLineSolve())
  print(line_state.values()[0][0] == 1 and solved_count(line_state) == before + 1)

  box_state = SudokuState([
    [0, 2, 3, 0, 0, 0, 0, 0, 0],
    [4, 5, 6, 0, 0, 0, 0, 0, 0],
    [7, 8, 9, 0, 0, 0, 0, 0, 0],
    [2, 3, 4, 0, 0, 0, 0, 0, 0],
    [5, 6, 7, 0, 0, 0, 0, 0, 0],
    [8, 9, 2, 0, 0, 0, 0, 0, 0],
    [3, 4, 5, 0, 0, 0, 0, 0, 0],
    [6, 7, 8, 0, 0, 0, 0, 0, 0],
    [9, 1, 2, 0, 0, 0, 0, 0, 0],
  ])
  before = solved_count(box_state)
  box_state = apply_strategy(box_state, UniqueBoxSolve())
  print(box_state.values()[0][0] == 1 and solved_count(box_state) == before + 1)

  single_state = SudokuState([
    [0, 2, 3, 4, 5, 6, 7, 8, 9],
    [4, 5, 6, 0, 0, 0, 0, 0, 0],
    [7, 8, 9, 0, 0, 0, 0, 0, 0],
    [2, 3, 4, 0, 0, 0, 0, 0, 0],
    [5, 6, 7, 0, 0, 0, 0, 0, 0],
    [8, 9, 2, 0, 0, 0, 0, 0, 0],
    [3, 4, 5, 0, 0, 0, 0, 0, 0],
    [6, 7, 8, 0, 0, 0, 0, 0, 0],
    [9, 1, 2, 0, 0, 0, 0, 0, 0],
  ])
  before = solved_count(single_state)
  single_state = apply_strategy(single_state, HiddenSingle())
  print(single_state.values()[0][0] == 1 and solved_count(single_state) == before + 1)

  double_grid = annotation_grid([3, 4, 5, 6, 7, 8, 9])
  double_grid[0][0] = Annotations([1, 2, 3])
  double_grid[0][1] = Annotations([1, 2, 4])
  double_state = apply_strategy(SudokuState(double_grid), HiddenDoubleInBox())
  print(double_state.values()[0][0] == 0 and double_state.candidates(0, 0) == [1, 2] and double_state.candidates(0, 1) == [1, 2])

  line_box_grid = annotation_grid([2, 3, 4, 5])
  line_box_grid[0][0] = Annotations([1, 2])
  line_box_grid[0][1] = Annotations([1, 3])
  line_box_grid[0][2] = Annotations([1, 4])
  line_box_grid[1][0] = Annotations([1, 5])
  line_box_state = apply_strategy(SudokuState(line_box_grid), LineCompleteExceptForBox())
  print(line_box_state.values()[1][0] == 0 and line_box_state.candidates(1, 0) == [5])`),
    runnable: "main",
    expectedStdout: ["True", "True", "True", "True", "True"],
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
  {
    sampleId: "annotated-maze",
    name: "annotated maze generation and astar debug output",
    sheet: sampleById("annotated-maze").code,
    runnable: "main",
    stdoutCheck: {
      description:
        "prints maze generation/debug details, a visible maze, and an A* path length",
      matches: isMazeDebugStdout,
    },
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

function isRenderedSpreadsheetStdout(stdout: string[]): boolean {
  const coreOutputs = ["None", /^Val\b.*7/, "5", "48"];
  let cursor = 0;
  for (const line of stdout) {
    if (cursor >= coreOutputs.length) {
      break;
    }
    const expected = coreOutputs[cursor];
    if (typeof expected === "string" ? line === expected : expected.test(line)) {
      cursor += 1;
    }
  }

  const joined = stdout.join("\n");
  const hasA1Addresses = ["A1", "B1", "C1"].every((address) => joined.includes(address));
  const hasGridAddresses =
    stdout.some((line) => /\bA\b.*\bB\b.*\bC\b/.test(line)) &&
    stdout.some((line) => /^\s*1\b/.test(line) && /7/.test(line) && /2\s*\+\s*3/.test(line));
  const hasFormulaCells = hasA1Addresses || hasGridAddresses;
  const hasPrettyFormula = /2\s*\+\s*3/.test(joined) && /B1\s*\+\s*A1/.test(joined);
  const tableLikeRows = stdout.filter((line) => {
    return /[|+]/.test(line) || /-{3,}/.test(line) || /\bA\b.*\bB\b.*\bC\b/.test(line) || /^\s*1\b/.test(line);
  }).length;

  return cursor === coreOutputs.length && hasFormulaCells && hasPrettyFormula && tableLikeRows >= 2;
}

function isVisibleRotatedAsciiFractalStdout(stdout: string[]): boolean {
  const blankIndex = stdout.findIndex((row) => row.length === 0);
  if (blankIndex <= 0 || blankIndex >= stdout.length - 1) {
    return false;
  }

  const normal = padTrailingBlankAsciiRows(stdout.slice(0, blankIndex), 24, 64);
  const rotated = padTrailingBlankAsciiRows(stdout.slice(blankIndex + 1), 24, 64);
  const overlapRows = normal.reduce((total, row, index) => {
    return total + (row.trim().length > 0 && row === rotated[index] ? 1 : 0);
  }, 0);

  return (
    isVisibleAsciiFractalFrame(normal) &&
    isVisibleAsciiFractalFrame(rotated) &&
    normal.length === rotated.length &&
    normal.every((row) => row.length === 64) &&
    rotated.every((row) => row.length === 64) &&
    normal.join("\n") !== rotated.join("\n") &&
    overlapRows <= 10
  );
}

function padTrailingBlankAsciiRows(stdout: string[], rows: number, cols: number): string[] {
  if (stdout.length > rows || stdout.some((row) => row.length > cols)) {
    return stdout;
  }

  return [
    ...stdout.map((row) => row.padEnd(cols, " ")),
    ...Array.from({ length: rows - stdout.length }, () => " ".repeat(cols)),
  ];
}

function isVisibleAsciiFractalFrame(stdout: string[]): boolean {
  const palette = new Set(" .:-=+*#%@");
  const visibleRows = stdout.filter((row) => row.trim().length > 0);
  const filled = stdout.reduce((total, row) => {
    return total + [...row].filter((char) => char !== " ").length;
  }, 0);
  const used = new Set(stdout.join("").replaceAll(" ", ""));

  return (
    stdout.length === 24 &&
    stdout.every((row) => row.length === 64 && [...row].every((char) => palette.has(char))) &&
    visibleRows.length >= 12 &&
    filled >= 100 &&
    filled <= 700 &&
    used.size >= 5 &&
    stdout.some((row) => /[#%@]/.test(row))
  );
}

function isMazeDebugStdout(stdout: string[]): boolean {
  const joined = stdout.join("\n");
  const mazeRows = stdout.filter((row) => /^[#.*SG ]{6,}$/.test(row));
  const pathLength = stdout.some((row) => /path\s*(length|len)?\D+\d+/i.test(row));

  return (
    stdout.length >= 6 &&
    mazeRows.length >= 4 &&
    /start/i.test(joined) &&
    /goal/i.test(joined) &&
    /(?:a\*|astar|path)/i.test(joined) &&
    pathLength
  );
}
