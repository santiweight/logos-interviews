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
  llmJudge?: {
    instructions: string;
  };
};

const starterArithmetic = `# Logos-TS supports TypeScript function declarations, natural snippets, and TypeScript-target execution.

function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log("Regular TypeScript:", mul(add(1, 2), 3));
  \`print Logos: mul of (add one and two) and 3\`
  console.log("Mixed Logos:", mul(add(\`the number one\`, \`the number two\`), \`the number three\`));
  const added = \`add 1 and 5\`;
  const product = \`mul 3 and 4\`;
  \`output added + product\`
}`;

const beyondBasics = `# Logos-TS supports classes, incomplete methods, and natural-language runnable bodies.

class MagicSquare {
  size: number;

  gen(): MagicSquare;
  grid(): number[][];
  pretty(): string;
}

function magic_square_example(): void {
  \`\`\`
  Generate a MagicSquare of size 4.

  Pretty print it, including the sums of columns/rows.

  Check the MagicSquare is valid, and show the work.
  \`\`\`
}`;

const formulaSpreadsheet = `# Spreadsheet cell storage uses A1-style addressing.
# Treat Record<string, Record<number, T>> as a nested mapping keyed by column then row.
# Parse expression strings containing ints, A1 refs, +, -, *, /, and parentheses.

type Operator = "Mul" | "Div" | "Add" | "Sub";
type Expr = { kind: "Val"; field0: number } | { kind: "BinOp"; field0: Operator; field1: Expr; field2: Expr } | { kind: "Cell"; field0: string; field1: number };
type EvalError = { kind: "RecursiveError"; field0: CellAddress[] } | "DivByZero";
type CellAddress = [string, number];

function parse_expr(source: string): Expr | null;
function pretty_expr(expr: Expr): string;
function c(source: string): CellAddress;

class Spreadsheet {
  cells: Record<string, Record<number, Expr>>;

  get(cell: CellAddress): Expr | null;
  set(cell: CellAddress, expr: string): void;
  eval(): SpreadsheetResult;
}

class SpreadsheetResult {
  sheet: Spreadsheet;
  cache: Record<string, number>;

  eval(cell: CellAddress): number | EvalError | null;
  eval_inner(stack: CellAddress[], cell: CellAddress): number | EvalError | null;
}

@logos.debug.print()
function main(): void {
  \`\`\`
  print results of each step...
  A1 -> None
  A1 = 7
  A1 -> 7
  B1 = 2 + 3
  B1 -> 5
  C1 = (B1 + A1) * 4
  C1 -> ?
  D[1:3] = B[1:3] * 2

  render + print sheet as unevaluated expressions in an excel-like table
  \`\`\`
}`;

const annotatedMaze = `# Maze generator, renderer, and solver.
# A size 10 maze has 10 rows and 10 columns of cells.
# When printed, it has outside edge walls added, so it is 12 rows tall and 12 columns wide.

class Maze {
  grid: string[][];
  start: [number, number];
  goal: [number, number];
}

function maze_is_solvable(maze: Maze): boolean;

@logos.debug.print()
class MazeGenerator {
  size: number = 8;

  gen(): Maze;
  grid(): string[];
}

function astar_solve(maze: Maze): [number, number][];

@logos.debug.print()
function main(): void {
  \`\`\`
  Build a 10x10 maze using MazeGenerator, and then solve it using A*.

  Print the maze, and then the solved maze.

  Use colors to make it clear where the path went.
  \`\`\`
}`;

const portfolioViewer = `# Portfolio Performance Monitor
# Why did we make or lose money today?

type AssetClass = "Equities" | "Credit" | "Rates" | "Commodities" | "Fx";
type Side = "Long" | "Short";
type Dollars = number;
type Percent = number;
type Time = string;
type App = WebPage;

class Instrument {
  ticker: string;
  name: string;
  assetClass: AssetClass;
}

class Holding {
  instrument: Instrument;
  side: Side;
  quantity: number;
}

class Portfolio {
  cash: Dollars;
  holdings: Holding[];
}

class HoldingValue {
  holding: Holding;
  timestamp: Time;
  value: Dollars;
}

class PortfolioValue {
  timestamp: Time;
  portfolio: Portfolio;

  holding_values(): HoldingValue[];
  nav(): Dollars;
}

class HeadlinePerformance {
  date: string;
  nav: Dollars;
  pnl: Dollars;
  returnValue: Percent;
  benchmarkReturn: Percent;
  activeReturn: Percent;
  grossExposure: Percent;
  netExposure: Percent;
  cashWeight: Percent;
}

class AssetClassContribution {
  assetClass: AssetClass;
  pnl: Dollars;
  contribution: Percent;
  weight: Percent;
  activeWeight: Percent;
}

class InstrumentContribution {
  ticker: string;
  name: string;
  side: Side;
  assetClass: AssetClass;
  pnl: Dollars;
  contribution: Percent;
}

class DailyPerformanceReadout {
  headline: HeadlinePerformance;
  byAssetClass: AssetClassContribution[];
  topContributors: InstrumentContribution[];
  topDetractors: InstrumentContribution[];
}

function test_portfolio(): Portfolio;
function calculate_readout(portfolio: Portfolio, start: Time, end: Time): DailyPerformanceReadout;

function main(): App {
  \`\`\`
  Render one PM readout page named "Portfolio Performance Monitor".

  Use test_portfolio and calculate_readout as the fixture-backed state source.

  Wireframe:

  +----------------------------------------------------------------------------------+
  | Portfolio Performance                                        Tue Jun 30, 2026     |
  |----------------------------------------------------------------------------------|
  | NAV            Daily P&L        Return        Benchmark       Active Return       |
  | $100.0m        +$750k           +0.76%        +0.41%          +0.35%              |
  |                                                                                  |
  | Gross Exposure 112%        Net Exposure 64%        Cash 8%                       |
  +----------------------------------------------------------------------------------+

  +----------------------------------------------------------------------------------+
  | What Drove Performance?                                                          |
  |----------------------------------------------------------------------------------|
  | Asset Class      P&L        Contribution      Weight        Active Weight         |
  | Equities         +$910k     +0.92%            72.0%         +8.0%                 |
  | Credit           +$35k      +0.04%            10.5%         -1.5%                 |
  | Rates            -$80k      -0.08%            7.2%          +2.2%                 |
  | Commodities      -$12k      -0.01%            2.3%          +0.3%                 |
  | Fx               -$103k     -0.10%            0.0%          -1.0%                 |
  +----------------------------------------------------------------------------------+

  +----------------------------------------------------------------------------------+
  | Top Instrument Contributors                                                       |
  |----------------------------------------------------------------------------------|
  | Ticker   Name                  Side    Asset Class    P&L        Contribution     |
  | NVDA     NVIDIA                Long    Equities       +$1.20m    +1.21%           |
  | MSFT     Microsoft             Long    Equities       +$180k     +0.18%           |
  | HYG      High Yield ETF        Long    Credit         +$35k      +0.04%           |
  +----------------------------------------------------------------------------------+

  +----------------------------------------------------------------------------------+
  | Top Instrument Detractors                                                         |
  |----------------------------------------------------------------------------------|
  | Ticker   Name                  Side    Asset Class    P&L        Contribution     |
  | CVNA     Carvana               Short   Equities       -$470k     -0.47%           |
  | TLT      20Y Treasury ETF      Long    Rates          -$80k      -0.08%           |
  | EURUSD   Euro / Dollar         Long    Fx             -$103k     -0.10%           |
  +----------------------------------------------------------------------------------+
  \`\`\`
}`;

export const sampleGroups: SampleGroup[] = [
  {
    label: "Baseline Logos-TS",
    samples: [
      {
        id: "starter-arithmetic",
        label: "Intro to Logos",
        code: starterArithmetic,
      },
      {
        id: "beyond-basics",
        label: "Beyond Basics",
        code: beyondBasics,
      },
      {
        id: "formula-spreadsheet",
        label: "Formula spreadsheet",
        code: formulaSpreadsheet,
      },
      {
        id: "annotated-maze",
        label: "Annotated maze",
        code: annotatedMaze,
      },
      {
        id: "portfolio-viewer",
        label: "Portfolio viewer",
        code: portfolioViewer,
      },
    ],
  },
];

export const samples: SampleProgram[] = sampleGroups.flatMap((group) => group.samples);

export const defaultProjectIds = [
  "starter-arithmetic",
  "beyond-basics",
  "formula-spreadsheet",
  "annotated-maze",
];

export const sampleTemplateGroups: SampleTemplateGroup[] = [
  {
    label: "Baseline Logos-TS",
    sampleIds: [...defaultProjectIds],
  },
  {
    label: "Applications",
    sampleIds: ["portfolio-viewer"],
  },
];

export const sampleEvalCases: SampleEvalCase[] = [
  {
    sampleId: "starter-arithmetic",
    name: "logos-ts intro arithmetic and snippets",
    sheet: sampleById("starter-arithmetic").code,
    runnable: "main",
    expectedStdout: [
      "Regular TypeScript: 9",
      "Logos: 9",
      "Mixed Logos: 9",
      "18",
    ],
  },
  {
    sampleId: "beyond-basics",
    name: "logos-ts magic square baseline",
    sheet: sampleById("beyond-basics").code,
    runnable: "magic_square_example",
    stdoutCheck: {
      description: "prints a valid 4x4 magic square and shows validation work",
      matches(stdout) {
        const joined = stdout.map(stripAnsi).join("\n");
        return (
          stdout.length > 0 &&
          /\b34\b/.test(joined) &&
          /(?:valid|row|column|diagonal|magic)/i.test(joined)
        );
      },
    },
  },
  {
    sampleId: "formula-spreadsheet",
    name: "logos-ts formula spreadsheet baseline",
    sheet: sampleById("formula-spreadsheet").code,
    runnable: "main",
    stdoutCheck: {
      description:
        "prints the core spreadsheet results and at least one rendered table-like view with cell addresses",
      matches: isRenderedSpreadsheetStdout,
    },
  },
  {
    sampleId: "annotated-maze",
    name: "logos-ts annotated maze baseline",
    sheet: sampleById("annotated-maze").code,
    runnable: "main",
    stdoutCheck: {
      description:
        "prints a solvable 10x10 maze and a solved 12x12 rendered maze with visible ANSI-colored path dots",
      matches: isMazeMainStdout,
    },
  },
  {
    sampleId: "portfolio-viewer",
    name: "logos-ts portfolio viewer compiles and runs",
    sheet: sampleById("portfolio-viewer").code,
    runnable: "main",
    stdoutCheck: {
      description: "prints the core portfolio performance readout",
      matches: isPortfolioViewerStdout,
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

function isRenderedSpreadsheetStdout(stdout: string[]): boolean {
  const clean = stdout.map(stripAnsi);
  const joined = clean.join("\n");
  return (
    /A1 ->\s+(?:None|null)/.test(joined) &&
    /A1 = 7/.test(joined) &&
    /A1 ->\s+7/.test(joined) &&
    /B1 = 2 \+ 3/.test(joined) &&
    /B1 ->\s+5/.test(joined) &&
    /C1 = \(B1 \+ A1\) \* 4/.test(joined) &&
    /C1 ->\s+48/.test(joined) &&
    /Unevaluated Expressions/i.test(joined) &&
    /Evaluated Values/i.test(joined) &&
    /\bA\b.*\bB\b.*\bC\b/.test(joined) &&
    /\bA1\b|\bB1\b|\bC1\b|2 \+ 3/.test(joined)
  );
}

function isPortfolioViewerStdout(stdout: string[]): boolean {
  const joined = stdout.join("\n");
  return (
    /Portfolio Performance Monitor/.test(joined) &&
    /NAV\s+\$100\.0m/.test(joined) &&
    /Daily P&L\s+\+\$750k/.test(joined) &&
    /Return\s+\+0\.76%/.test(joined) &&
    /Asset Classes.*Equities:\+\$910k.*Fx:-\$103k/.test(joined) &&
    /Top Contributors\s+NVDA, MSFT, HYG/.test(joined) &&
    /Top Detractors\s+CVNA, TLT, EURUSD/.test(joined) &&
    /HTML bytes\s+\d+/.test(joined)
  );
}

function isMazeMainStdout(stdout: string[]): boolean {
  const clean = stdout.map(stripAnsi);
  const mazeIndex = clean.findIndex((line) => /^Maze:/i.test(line));
  const solvedIndex = clean.findIndex((line) => /^Solved Maze/i.test(line));
  if (mazeIndex < 0 || solvedIndex < 0 || solvedIndex <= mazeIndex) {
    return false;
  }

  const maze = clean.slice(mazeIndex + 1, solvedIndex).filter((line) => line.length > 0);
  const solved = clean.slice(solvedIndex + 1).filter((line) => line.length > 0);
  const visibleColoredDots = stdout.some((line) => /\x1b\[(?:0;)?(?:32|92)m·\x1b\[0m/.test(line));

  return (
    maze.length === 12 &&
    solved.length === 12 &&
    maze.every((line) => stripAnsi(line).length === 12) &&
    solved.every((line) => stripAnsi(line).length === 12) &&
    maze[0] === "#".repeat(12) &&
    maze[11] === "#".repeat(12) &&
    maze.some((line) => line.includes("O")) &&
    maze.some((line) => line.includes("X")) &&
    visibleColoredDots
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
