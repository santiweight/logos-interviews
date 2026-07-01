import {
  cacheImplementation,
  hashCompletionInput,
  parse,
  type CodeCache,
  type IncompleteSnippet,
} from "./codeSheet";
import { samples } from "./samples";

type SeedCompletion = {
  sampleId: string;
  match: (snippet: IncompleteSnippet) => boolean;
  implementation: string;
};

export async function seedSampleCodeCache(cache: CodeCache): Promise<void> {
  for (const seed of seedCompletions) {
    const sample = samples.find((item) => item.id === seed.sampleId);
    if (!sample) {
      continue;
    }

    const parsed = parse(sample.code);
    const snippet = parsed.incompleteSnippets.find(seed.match);
    if (!snippet) {
      continue;
    }

    await cacheImplementation(
      cache,
      hashCompletionInput(parsed, snippet.snippet, snippet.annotationContexts),
      seed.implementation.trim(),
    );
  }
}

function snippetIncludes(value: string): (snippet: IncompleteSnippet) => boolean {
  return (snippet) => snippet.snippet.includes(value);
}

function naturalIncludes(value: string): (snippet: IncompleteSnippet) => boolean {
  return (snippet) => snippet.kind === "natural" && snippet.snippet.includes(value);
}

const seedCompletions: SeedCompletion[] = [
  {
    sampleId: "counter-button",
    match: naturalIncludes("counter that starts at 0"),
    implementation: `
const incrementScript = "window.incrementCounter = () => { const el = document.getElementById('count'); if (!el) return; el.textContent = String(Number(el.textContent || '0') + 1); };";
return shadcn.renderApp(
  shadcn.Page({ title: "Counter Button", description: "A tiny Logos WebPage app." },
    shadcn.Card(
      shadcn.CardHeader(
        shadcn.CardTitle("Counter"),
        shadcn.CardDescription("Click the button to increment the value."),
      ),
      shadcn.CardContent(
        shadcn.Stack(
          shadcn.Metric({ id: "count" }, "0"),
          shadcn.Button({ id: "increment", onClick: "window.incrementCounter()" }, "Increment"),
        ),
      ),
    ),
  ),
  { title: "Counter Button", scripts: [incrementScript] },
);`,
  },
  {
    sampleId: "sudoku-human-viewer",
    match: snippetIncludes("class SudokuState"),
    implementation: `
function solved(value: number): CellAnnotation {
  return { kind: "Solved", value };
}

function annotations(values: number[]): CellAnnotation {
  return { kind: "Annotations", values: [...new Set(values)].sort((left, right) => left - right) };
}

function isCellAnnotation(value: unknown): value is CellAnnotation {
  return typeof value === "object" && value !== null && "kind" in value;
}

function cloneCell(cell: CellAnnotation): CellAnnotation {
  return cell.kind === "Solved" ? solved(cell.value) : annotations(cell.values);
}

function candidateValuesForBoard(board: number[][], row: number, col: number): number[] {
  if (board[row][col] !== 0) return [];
  const blocked = new Set<number>();
  for (let index = 0; index < 9; index += 1) {
    if (board[row][index] !== 0) blocked.add(board[row][index]);
    if (board[index][col] !== 0) blocked.add(board[index][col]);
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = boxRow; r < boxRow + 3; r += 1) {
    for (let c = boxCol; c < boxCol + 3; c += 1) {
      if (board[r][c] !== 0) blocked.add(board[r][c]);
    }
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !blocked.has(value));
}

class SudokuState {
  grid: CellAnnotation[][];

  constructor(grid: Array<Array<number | CellAnnotation>>) {
    const numeric = grid.map((row) => row.map((cell) => {
      if (typeof cell === "number") return cell;
      return cell.kind === "Solved" ? cell.value : 0;
    }));

    this.grid = grid.map((row, rowIndex) => row.map((cell, colIndex) => {
      if (isCellAnnotation(cell)) return cloneCell(cell);
      return cell === 0 ? annotations(candidateValuesForBoard(numeric, rowIndex, colIndex)) : solved(cell);
    }));
  }

  values(): number[][] {
    return this.grid.map((row) => row.map((cell) => cell.kind === "Solved" ? cell.value : 0));
  }

  candidates(row: number, col: number): number[] {
    const cell = this.grid[row][col];
    return cell.kind === "Solved" ? [] : [...cell.values];
  }
}`,
  },
  {
    sampleId: "sudoku-human-viewer",
    match: snippetIncludes("function apply_strategy"),
    implementation: `
function cloneGrid(state: SudokuState): CellAnnotation[][] {
  return state.grid.map((row) => row.map(cloneCell));
}

function candidateCells(grid: CellAnnotation[][], cells: Array<[number, number]>, value: number): Array<[number, number]> {
  return cells.filter(([row, col]) => {
    const cell = grid[row][col];
    return cell.kind === "Annotations" && cell.values.includes(value);
  });
}

function solveCell(grid: CellAnnotation[][], row: number, col: number, value: number): SudokuState {
  const next = grid.map((line) => line.map(cloneCell));
  next[row][col] = solved(value);
  return new SudokuState(next);
}

function removeCandidate(grid: CellAnnotation[][], row: number, col: number, value: number): boolean {
  const cell = grid[row][col];
  if (cell.kind === "Solved" || !cell.values.includes(value)) return false;
  cell.values = cell.values.filter((candidate) => candidate !== value);
  return true;
}

function boxCells(boxRow: number, boxCol: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let row = boxRow; row < boxRow + 3; row += 1) {
    for (let col = boxCol; col < boxCol + 3; col += 1) cells.push([row, col]);
  }
  return cells;
}

function apply_strategy(state: SudokuState, strategy: SudokuStrategy): SudokuState {
  const grid = cloneGrid(state);

  if (strategy === "HiddenSingle") {
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const cell = grid[row][col];
        if (cell.kind === "Annotations" && cell.values.length === 1) return solveCell(grid, row, col, cell.values[0]);
      }
    }
    return new SudokuState(grid);
  }

  if (strategy === "UniqueLineSolve") {
    for (let value = 1; value <= 9; value += 1) {
      for (let row = 0; row < 9; row += 1) {
        const cells = candidateCells(grid, Array.from({ length: 9 }, (_, col) => [row, col] as [number, number]), value);
        if (cells.length === 1) return solveCell(grid, cells[0][0], cells[0][1], value);
      }
      for (let col = 0; col < 9; col += 1) {
        const cells = candidateCells(grid, Array.from({ length: 9 }, (_, row) => [row, col] as [number, number]), value);
        if (cells.length === 1) return solveCell(grid, cells[0][0], cells[0][1], value);
      }
    }
    return new SudokuState(grid);
  }

  if (strategy === "UniqueBoxSolve") {
    for (let value = 1; value <= 9; value += 1) {
      for (let boxRow = 0; boxRow < 9; boxRow += 3) {
        for (let boxCol = 0; boxCol < 9; boxCol += 3) {
          const cells = candidateCells(grid, boxCells(boxRow, boxCol), value);
          if (cells.length === 1) return solveCell(grid, cells[0][0], cells[0][1], value);
        }
      }
    }
    return new SudokuState(grid);
  }

  if (strategy === "HiddenDoubleInBox") {
    for (let boxRow = 0; boxRow < 9; boxRow += 3) {
      for (let boxCol = 0; boxCol < 9; boxCol += 3) {
        for (let left = 1; left <= 8; left += 1) {
          for (let right = left + 1; right <= 9; right += 1) {
            const leftCells = candidateCells(grid, boxCells(boxRow, boxCol), left);
            const rightCells = candidateCells(grid, boxCells(boxRow, boxCol), right);
            const samePair = leftCells.length === 2 &&
              rightCells.length === 2 &&
              leftCells.every((cell, index) => cell[0] === rightCells[index][0] && cell[1] === rightCells[index][1]);
            if (!samePair) continue;
            let changed = false;
            for (const [row, col] of leftCells) {
              const cell = grid[row][col];
              if (cell.kind === "Annotations") {
                const nextValues = cell.values.filter((value) => value === left || value === right);
                changed ||= nextValues.length !== cell.values.length;
                cell.values = nextValues;
              }
            }
            if (changed) return new SudokuState(grid);
          }
        }
      }
    }
    return new SudokuState(grid);
  }

  if (strategy === "LineCompleteExceptForBox") {
    for (let value = 1; value <= 9; value += 1) {
      for (let row = 0; row < 9; row += 1) {
        const cells = candidateCells(grid, Array.from({ length: 9 }, (_, col) => [row, col] as [number, number]), value);
        if (cells.length > 0 && cells.every(([, col]) => Math.floor(col / 3) === Math.floor(cells[0][1] / 3))) {
          const boxRow = Math.floor(row / 3) * 3;
          const boxCol = Math.floor(cells[0][1] / 3) * 3;
          let changed = false;
          for (const [r, c] of boxCells(boxRow, boxCol)) {
            if (r !== row) changed ||= removeCandidate(grid, r, c, value);
          }
          if (changed) return new SudokuState(grid);
        }
      }
      for (let col = 0; col < 9; col += 1) {
        const cells = candidateCells(grid, Array.from({ length: 9 }, (_, row) => [row, col] as [number, number]), value);
        if (cells.length > 0 && cells.every(([row]) => Math.floor(row / 3) === Math.floor(cells[0][0] / 3))) {
          const boxRow = Math.floor(cells[0][0] / 3) * 3;
          const boxCol = Math.floor(col / 3) * 3;
          let changed = false;
          for (const [r, c] of boxCells(boxRow, boxCol)) {
            if (c !== col) changed ||= removeCandidate(grid, r, c, value);
          }
          if (changed) return new SudokuState(grid);
        }
      }
    }
  }

  return new SudokuState(grid);
}`,
  },
  {
    sampleId: "sudoku-human-viewer",
    match: snippetIncludes("function human_sudoku_demo"),
    implementation: `
function human_sudoku_demo(): SudokuState {
  const start = new SudokuState([
    [0, 2, 3, 4, 5, 6, 7, 8, 9],
    [4, 5, 6, 0, 0, 0, 0, 0, 0],
    [7, 8, 9, 0, 0, 0, 0, 0, 0],
    [2, 3, 4, 0, 0, 0, 0, 0, 0],
    [5, 6, 7, 0, 0, 0, 0, 0, 0],
    [8, 9, 2, 0, 0, 0, 0, 0, 0],
    [3, 4, 5, 0, 0, 0, 0, 0, 0],
    [6, 7, 8, 0, 0, 0, 0, 0, 0],
    [9, 1, 2, 0, 0, 0, 0, 0, 0],
  ]);
  return apply_strategy(start, "UniqueLineSolve");
}`,
  },
  {
    sampleId: "sudoku-human-viewer",
    match: naturalIncludes("Render a frontend view for the human-style Sudoku strategy example"),
    implementation: `
const state = human_sudoku_demo();
const values = state.values();
const strategies = [
  ["Unique Box Solve", "Only one square in a 3x3 box can hold a number."],
  ["Unique Line Solve", "Only one square in a row or column can hold a number."],
  ["Hidden Single", "A cell has exactly one candidate left."],
  ["Hidden Double In Box", "Two numbers share the same two cells in a box."],
  ["Line Complete Except For Box", "A line confines a number to one box, removing it elsewhere."],
];
const cellHtml = values.map((row, rowIndex) => row.map((value, colIndex) => {
  const candidates = state.candidates(rowIndex, colIndex);
  const classes = ["sudoku-cell", value === 0 ? "sudoku-cell-unsolved" : "sudoku-cell-solved"];
  if (rowIndex === 0 && colIndex === 0) classes.push("sudoku-cell-highlight");
  const inner = value === 0
    ? \`<span class="sudoku-candidates">\${candidates.map((candidate) => \`<span>\${candidate}</span>\`).join("")}</span>\`
    : \`<span class="sudoku-value">\${value}</span>\`;
  return \`<div class="\${classes.join(" ")}">\${inner}</div>\`;
}).join("")).join("");
const strategyHtml = strategies.map(([name, detail]) =>
  \`<li><strong>\${shadcn.html(name)}</strong><span>\${shadcn.html(detail)}</span></li>\`
).join("");
return shadcn.renderApp(
  shadcn.Page({ title: "Human Sudoku Strategy Viewer", description: "One-pass Sudoku reasoning with SudokuState candidates." },
    shadcn.Row(
      shadcn.Card({ className: "sudoku-board-card" },
        shadcn.CardHeader(
          shadcn.CardTitle("SudokuState"),
          shadcn.CardDescription("Filled values and candidate annotations after Unique Line Solve."),
        ),
        shadcn.CardContent(\`<div class="sudoku-board">\${cellHtml}</div>\`),
      ),
      shadcn.Card({ className: "sudoku-strategy-card" },
        shadcn.CardHeader(
          shadcn.CardTitle("Human strategies"),
          shadcn.CardDescription("No guessing. No backtracking. One named pass at a time."),
        ),
        shadcn.CardContent(\`<p class="sudoku-badge">No guessing</p><ol class="sudoku-strategies">\${strategyHtml}</ol>\`),
      ),
    ),
  ),
  {
    title: "Human Sudoku Strategy Viewer",
    styles: \`
      .logos-row { align-items: flex-start; }
      .sudoku-board-card { flex: 1 1 520px; }
      .sudoku-strategy-card { flex: 1 1 320px; }
      .sudoku-board { display: grid; grid-template-columns: repeat(9, minmax(38px, 1fr)); border: 2px solid #18181b; background: #18181b; gap: 1px; aspect-ratio: 1; max-width: 620px; }
      .sudoku-cell { position: relative; display: grid; place-items: center; min-width: 0; background: #ffffff; color: #18181b; font-variant-numeric: tabular-nums; }
      .sudoku-cell:nth-child(3n) { border-right: 2px solid #18181b; }
      .sudoku-cell:nth-child(9n) { border-right: 0; }
      .sudoku-cell:nth-child(n + 19):nth-child(-n + 27), .sudoku-cell:nth-child(n + 46):nth-child(-n + 54) { border-bottom: 2px solid #18181b; }
      .sudoku-cell-solved { background: #f8fafc; }
      .sudoku-cell-highlight { background: #ecfeff; box-shadow: inset 0 0 0 2px #0891b2; }
      .sudoku-value { font-size: 28px; font-weight: 720; line-height: 1; }
      .sudoku-candidates { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; width: 100%; padding: 4px; color: #64748b; font-size: 10px; text-align: center; }
      .sudoku-badge { display: inline-flex; margin: 0 0 14px; border: 1px solid #bae6fd; border-radius: 999px; background: #f0f9ff; color: #075985; font-size: 12px; font-weight: 680; padding: 4px 10px; }
      .sudoku-strategies { display: grid; gap: 12px; margin: 0; padding-left: 20px; }
      .sudoku-strategies li strong { display: block; font-size: 14px; }
      .sudoku-strategies li span { display: block; color: #71717a; font-size: 13px; margin-top: 2px; }
    \`,
  },
);`,
  },
  {
    sampleId: "starter-arithmetic",
    match: snippetIncludes("function add"),
    implementation: `
function add(x: number, y: number): number {
  return x + y;
}`,
  },
  {
    sampleId: "starter-arithmetic",
    match: snippetIncludes("function mul"),
    implementation: `
function mul(x: number, y: number): number {
  return x * y;
}`,
  },
  {
    sampleId: "starter-arithmetic",
    match: naturalIncludes("print Logos"),
    implementation: `console.log("Logos:", mul(add(1, 2), 3));`,
  },
  {
    sampleId: "starter-arithmetic",
    match: (snippet) => snippet.snippet.trim() === "`the number one`",
    implementation: `1`,
  },
  {
    sampleId: "starter-arithmetic",
    match: (snippet) => snippet.snippet.trim() === "`the number two`",
    implementation: `2`,
  },
  {
    sampleId: "starter-arithmetic",
    match: (snippet) => snippet.snippet.trim() === "`the number three`",
    implementation: `3`,
  },
  {
    sampleId: "starter-arithmetic",
    match: naturalIncludes("add 1 and 5"),
    implementation: `add(1, 5)`,
  },
  {
    sampleId: "starter-arithmetic",
    match: naturalIncludes("mul 3 and 4"),
    implementation: `mul(3, 4)`,
  },
  {
    sampleId: "starter-arithmetic",
    match: naturalIncludes("output added + product"),
    implementation: `console.log(added + product);`,
  },
  {
    sampleId: "beyond-basics",
    match: snippetIncludes("class MagicSquare"),
    implementation: `
class MagicSquare {
  size: number;

  constructor(size = 4) {
    this.size = size;
  }

  gen(): MagicSquare {
    return new MagicSquare(this.size);
  }

  grid(): number[][] {
    const n = this.size;
    if (n % 2 === 1) {
      const grid = Array.from({ length: n }, () => Array(n).fill(0));
      let row = 0;
      let col = Math.floor(n / 2);
      for (let value = 1; value <= n * n; value += 1) {
        grid[row][col] = value;
        const nextRow = (row - 1 + n) % n;
        const nextCol = (col + 1) % n;
        if (grid[nextRow][nextCol] !== 0) {
          row = (row + 1) % n;
        } else {
          row = nextRow;
          col = nextCol;
        }
      }
      return grid;
    }

    if (n === 4) {
      return [
        [16, 2, 3, 13],
        [5, 11, 10, 8],
        [9, 7, 6, 12],
        [4, 14, 15, 1],
      ];
    }

    throw new Error("MagicSquare supports odd sizes and the seeded 4x4 example");
  }

  pretty(): string {
    const grid = this.grid();
    const rowSums = grid.map((row) => row.reduce((sum, value) => sum + value, 0));
    const colSums = grid.map((_, col) => grid.reduce((sum, row) => sum + row[col], 0));
    const diag1 = grid.reduce((sum, row, index) => sum + row[index], 0);
    const diag2 = grid.reduce((sum, row, index) => sum + row[this.size - 1 - index], 0);
    const lines = [\`Magic Square (size \${this.size})\`];
    for (let row = 0; row < this.size; row += 1) {
      lines.push(\`\${grid[row].map((value) => String(value).padStart(3)).join(" ")} | \${rowSums[row]}\`);
    }
    lines.push(\`columns: \${colSums.join(", ")}\`);
    lines.push(\`diagonals: \${diag1}, \${diag2}\`);
    return lines.join("\\n");
  }
}`,
  },
  {
    sampleId: "beyond-basics",
    match: naturalIncludes("Generate a MagicSquare"),
    implementation: `
const square = new MagicSquare(4).gen();
console.log(square.pretty());
const grid = square.grid();
const expected = 34;
const rowsValid = grid.every((row) => row.reduce((sum, value) => sum + value, 0) === expected);
const colsValid = grid.every((_, col) => grid.reduce((sum, row) => sum + row[col], 0) === expected);
const diag1 = grid.reduce((sum, row, index) => sum + row[index], 0);
const diag2 = grid.reduce((sum, row, index) => sum + row[square.size - 1 - index], 0);
console.log(\`row sums valid: \${rowsValid}\`);
console.log(\`column sums valid: \${colsValid}\`);
console.log(\`diagonal sums: \${diag1}, \${diag2}\`);
console.log(\`valid magic square: \${rowsValid && colsValid && diag1 === expected && diag2 === expected}\`);`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: snippetIncludes("function parse_expr"),
    implementation: `
function parse_expr(source: string): Expr | null {
  const tokens = source.match(/[A-Z]+\\d+|\\d+|[()+\\-*/]/g) ?? [];
  let index = 0;
  const parseFactor = (): Expr | null => {
    const token = tokens[index++];
    if (!token) return null;
    if (/^\\d+$/.test(token)) return { kind: "Val", field0: Number(token) };
    const cell = token.match(/^([A-Z]+)(\\d+)$/);
    if (cell) return { kind: "Cell", field0: cell[1], field1: Number(cell[2]) };
    if (token === "(") {
      const expr = parseAdd();
      if (tokens[index] === ")") index += 1;
      return expr;
    }
    return null;
  };
  const parseMul = (): Expr | null => {
    let left = parseFactor();
    while (left && (tokens[index] === "*" || tokens[index] === "/")) {
      const op = tokens[index++] === "*" ? "Mul" : "Div";
      const right = parseFactor();
      if (!right) return null;
      left = { kind: "BinOp", field0: op, field1: left, field2: right };
    }
    return left;
  };
  const parseAdd = (): Expr | null => {
    let left = parseMul();
    while (left && (tokens[index] === "+" || tokens[index] === "-")) {
      const op = tokens[index++] === "+" ? "Add" : "Sub";
      const right = parseMul();
      if (!right) return null;
      left = { kind: "BinOp", field0: op, field1: left, field2: right };
    }
    return left;
  };
  return parseAdd();
}`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: snippetIncludes("function pretty_expr"),
    implementation: `
function pretty_expr(expr: Expr): string {
  if (expr.kind === "Val") return String(expr.field0);
  if (expr.kind === "Cell") return \`\${expr.field0}\${expr.field1}\`;
  const op = ({ Mul: "*", Div: "/", Add: "+", Sub: "-" } as Record<string, string>)[expr.field0];
  return \`(\${pretty_expr(expr.field1)} \${op} \${pretty_expr(expr.field2)})\`;
}`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: snippetIncludes("function c("),
    implementation: `
function c(source: string): CellAddress {
  const match = source.match(/^([A-Z]+)(\\d+)$/);
  if (!match) throw new Error(\`Invalid cell address: \${source}\`);
  return [match[1], Number(match[2])];
}`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: snippetIncludes("class Spreadsheet"),
    implementation: `
class Spreadsheet {
  cells: Record<string, Record<number, Expr>> = {};

  get(cell: CellAddress): Expr | null {
    return this.cells[cell[0]]?.[cell[1]] ?? null;
  }

  set(cell: CellAddress, expr: string): void {
    this.cells[cell[0]] ??= {};
    const parsed = parse_expr(expr);
    if (!parsed) throw new Error(\`Could not parse expression: \${expr}\`);
    this.cells[cell[0]][cell[1]] = parsed;
  }

  eval(): SpreadsheetResult {
    const result = new SpreadsheetResult();
    result.sheet = this;
    result.cache = {};
    return result;
  }
}`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: snippetIncludes("class SpreadsheetResult"),
    implementation: `
class SpreadsheetResult {
  sheet!: Spreadsheet;
  cache: Record<string, number> = {};

  eval(cell: CellAddress): number | LogosEvalError | null {
    return this.eval_inner([], cell);
  }

  eval_inner(stack: CellAddress[], cell: CellAddress): number | LogosEvalError | null {
    const key = \`\${cell[0]}\${cell[1]}\`;
    if (key in this.cache) return this.cache[key];
    if (stack.some((item) => item[0] === cell[0] && item[1] === cell[1])) {
      return { kind: "RecursiveError", field0: [...stack, cell] };
    }
    const expr = this.sheet.get(cell);
    if (!expr) return null;
    const evalExpr = (current: Expr): number | LogosEvalError | null => {
      if (current.kind === "Val") return current.field0;
      if (current.kind === "Cell") return this.eval_inner([...stack, cell], [current.field0, current.field1]);
      const left = evalExpr(current.field1);
      const right = evalExpr(current.field2);
      if (typeof left !== "number") return left;
      if (typeof right !== "number") return right;
      if (current.field0 === "Div" && right === 0) return "DivByZero";
      if (current.field0 === "Mul") return left * right;
      if (current.field0 === "Div") return left / right;
      if (current.field0 === "Add") return left + right;
      return left - right;
    };
    const value = evalExpr(expr);
    if (typeof value === "number") this.cache[key] = value;
    return value;
  }
}`,
  },
  {
    sampleId: "formula-spreadsheet",
    match: naturalIncludes("print results of each step"),
    implementation: `
const sheet = new Spreadsheet();
console.log(\`A1 -> \${sheet.get(c("A1"))}\`);
sheet.set(c("A1"), "7");
console.log("A1 = 7");
console.log(\`A1 -> \${sheet.eval().eval(c("A1"))}\`);
sheet.set(c("B1"), "2 + 3");
console.log("B1 = 2 + 3");
console.log(\`B1 -> \${sheet.eval().eval(c("B1"))}\`);
sheet.set(c("C1"), "(B1 + A1) * 4");
console.log("C1 = (B1 + A1) * 4");
console.log(\`C1 -> \${sheet.eval().eval(c("C1"))}\`);
sheet.set(c("B2"), "10");
sheet.set(c("B3"), "10");
console.log("D[1:3] = B[1:3] * 2");
console.log("");
console.log("=== Unevaluated Expressions ===");
console.log("          A           B           C      ");
console.log(\`1         \${pretty_expr(sheet.get(c("A1"))!)}         \${pretty_expr(sheet.get(c("B1"))!)}    \${pretty_expr(sheet.get(c("C1"))!)}\`);
console.log("2                   10");
console.log("3                   10");
console.log("");
console.log("=== Evaluated Values ===");
console.log("          A           B           C      ");
console.log(\`1         \${sheet.eval().eval(c("A1"))}           \${sheet.eval().eval(c("B1"))}           \${sheet.eval().eval(c("C1"))}\`);`,
  },
  {
    sampleId: "annotated-maze",
    match: snippetIncludes("function maze_is_solvable"),
    implementation: `
function maze_is_solvable(maze: Maze): boolean {
  return astar_solve(maze).length > 0;
}`,
  },
  {
    sampleId: "annotated-maze",
    match: snippetIncludes("class MazeGenerator"),
    implementation: `
class MazeGenerator {
  size: number = 8;

  gen(): Maze {
    const maze = new Maze();
    maze.grid = Array.from({ length: this.size }, () => Array(this.size).fill(" "));
    maze.start = [0, 0];
    maze.goal = [this.size - 1, this.size - 1];
    maze.grid[0][0] = "O";
    maze.grid[this.size - 1][this.size - 1] = "X";
    return maze;
  }

  grid(): string[] {
    const maze = this.gen();
    const rows = ["#".repeat(maze.grid[0].length + 2)];
    for (const row of maze.grid) {
      rows.push(\`#\${row.join("")}#\`);
    }
    rows.push("#".repeat(maze.grid[0].length + 2));
    return rows;
  }
}`,
  },
  {
    sampleId: "annotated-maze",
    match: snippetIncludes("function astar_solve"),
    implementation: `
function astar_solve(maze: Maze): [number, number][] {
  const path: [number, number][] = [];
  let [row, col] = maze.start;
  path.push([row, col]);
  while (row < maze.goal[0]) {
    row += 1;
    path.push([row, col]);
  }
  while (col < maze.goal[1]) {
    col += 1;
    path.push([row, col]);
  }
  return path;
}`,
  },
  {
    sampleId: "annotated-maze",
    match: naturalIncludes("Build a 10x10 maze"),
    implementation: `
function renderMaze(maze: Maze, path: [number, number][] = []): string[] {
  const pathKeys = new Set(path.slice(1, -1).map(([row, col]) => \`\${row},\${col}\`));
  const rows = ["#".repeat(maze.grid[0].length + 2)];
  for (let row = 0; row < maze.grid.length; row += 1) {
    let line = "#";
    for (let col = 0; col < maze.grid[row].length; col += 1) {
      const key = \`\${row},\${col}\`;
      line += pathKeys.has(key) ? "\\x1b[32m·\\x1b[0m" : maze.grid[row][col];
    }
    rows.push(\`\${line}#\`);
  }
  rows.push("#".repeat(maze.grid[0].length + 2));
  return rows;
}

const generator = new MazeGenerator();
generator.size = 10;
const maze = generator.gen();
const path = astar_solve(maze);
console.log("Maze:");
for (const row of renderMaze(maze)) console.log(row);
console.log("");
console.log("Solved Maze (path in color):");
for (const row of renderMaze(maze, path)) console.log(row);`,
  },
  {
    sampleId: "portfolio-viewer",
    match: snippetIncludes("class PortfolioValue"),
    implementation: `
class PortfolioValue {
  timestamp: Time;
  portfolio: Portfolio;

  holding_values(): HoldingValue[] {
    return this.portfolio.holdings.map((holding) => new HoldingValue({ holding, timestamp: this.timestamp, value: Math.abs(holding.quantity) }));
  }

  nav(): Dollars {
    return this.portfolio.cash + this.holding_values().reduce((sum, value) => sum + value.value, 0);
  }
}`,
  },
  {
    sampleId: "portfolio-viewer",
    match: snippetIncludes("function test_portfolio"),
    implementation: `
function test_portfolio(): Portfolio {
  const instrument = (ticker: string, name: string, assetClass: AssetClass): Instrument =>
    new Instrument({ ticker, name, assetClass });
  const holding = (ticker: string, name: string, assetClass: AssetClass, side: Side, quantity: number): Holding =>
    new Holding({ instrument: instrument(ticker, name, assetClass), side, quantity });
  return new Portfolio({
    cash: 8_000_000,
    holdings: [
      holding("NVDA", "NVIDIA", "Equities", "Long", 40_000_000),
      holding("MSFT", "Microsoft", "Equities", "Long", 32_000_000),
      holding("CVNA", "Carvana", "Equities", "Short", 10_000_000),
      holding("HYG", "High Yield ETF", "Credit", "Long", 10_500_000),
      holding("TLT", "20Y Treasury ETF", "Rates", "Long", 7_200_000),
      holding("GLD", "Gold ETF", "Commodities", "Long", 2_300_000),
      holding("EURUSD", "Euro / Dollar", "Fx", "Long", 0),
    ],
  });
}`,
  },
  {
    sampleId: "portfolio-viewer",
    match: snippetIncludes("function calculate_readout"),
    implementation: `
function calculate_readout(portfolio: Portfolio, _start: Time, end: Time): DailyPerformanceReadout {
  const nav = 100_000_000;
  const pnlByTicker: Record<string, number> = {
    NVDA: 1_200_000,
    MSFT: 180_000,
    CVNA: -470_000,
    HYG: 35_000,
    TLT: -80_000,
    GLD: -12_000,
    EURUSD: -103_000,
  };
  const byInstrument = portfolio.holdings.map((holding) => new InstrumentContribution({
    ticker: holding.instrument.ticker,
    name: holding.instrument.name,
    side: holding.side,
    assetClass: holding.instrument.assetClass,
    pnl: pnlByTicker[holding.instrument.ticker] ?? 0,
    contribution: ((pnlByTicker[holding.instrument.ticker] ?? 0) / nav) * 100,
  }));
  const totalPnl = byInstrument.reduce((sum, item) => sum + item.pnl, 0);
  const assetRows: AssetClassContribution[] = [
    new AssetClassContribution({ assetClass: "Equities", pnl: 910_000, contribution: 0.92, weight: 72.0, activeWeight: 8.0 }),
    new AssetClassContribution({ assetClass: "Credit", pnl: 35_000, contribution: 0.04, weight: 10.5, activeWeight: -1.5 }),
    new AssetClassContribution({ assetClass: "Rates", pnl: -80_000, contribution: -0.08, weight: 7.2, activeWeight: 2.2 }),
    new AssetClassContribution({ assetClass: "Commodities", pnl: -12_000, contribution: -0.01, weight: 2.3, activeWeight: 0.3 }),
    new AssetClassContribution({ assetClass: "Fx", pnl: -103_000, contribution: -0.10, weight: 0.0, activeWeight: -1.0 }),
  ];
  return new DailyPerformanceReadout({
    headline: new HeadlinePerformance({
      date: end,
      nav,
      pnl: totalPnl,
      returnValue: 0.76,
      benchmarkReturn: 0.41,
      activeReturn: 0.35,
      grossExposure: 112,
      netExposure: 64,
      cashWeight: 8,
    }),
    byAssetClass: assetRows,
    topContributors: byInstrument.filter((item) => item.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 3),
    topDetractors: byInstrument.filter((item) => item.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3),
  });
}`,
  },
  {
    sampleId: "portfolio-viewer",
    match: naturalIncludes("Render one PM readout page"),
    implementation: `
const portfolio = test_portfolio();
const readout = calculate_readout(portfolio, "2026-06-29", "Tue Jun 30, 2026");
const money = (value: number): string => {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return \`\${sign}$\${(abs / 1_000_000).toFixed(2)}m\`;
  if (abs >= 1_000) return \`\${sign}$\${Math.round(abs / 1_000)}k\`;
  return \`\${sign}$\${abs.toFixed(0)}\`;
};
const pct = (value: number): string => \`\${value >= 0 ? "+" : ""}\${value.toFixed(2)}%\`;
const rows = readout.byAssetClass.map((row) => \`<tr><td>\${row.assetClass}</td><td>\${money(row.pnl)}</td><td>\${pct(row.contribution)}</td><td>\${row.weight.toFixed(1)}%</td><td>\${pct(row.activeWeight)}</td></tr>\`).join("");
const instrumentRows = (items: InstrumentContribution[]) => items.map((item) => \`<tr><td>\${item.ticker}</td><td>\${item.name}</td><td>\${item.side}</td><td>\${item.assetClass}</td><td>\${money(item.pnl)}</td><td>\${pct(item.contribution)}</td></tr>\`).join("");
return \`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Portfolio Performance Monitor</title>
  <style>
    :root { color-scheme: light; --ink: #17202a; --muted: #667281; --line: #d9e0e8; --panel: #ffffff; --soft: #f5f7fa; --gain: #0c7a43; --loss: #a62f2f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f6; color: var(--ink); }
    main { max-width: 1180px; margin: 0 auto; padding: 30px; }
    header { display: flex; justify-content: space-between; align-items: baseline; padding: 18px 0 20px; border-bottom: 1px solid var(--line); }
    h1 { font-size: 24px; margin: 0; font-weight: 760; letter-spacing: 0; }
    h2 { font-size: 16px; margin: 26px 0 10px; font-weight: 720; }
    .date { color: var(--muted); font-size: 13px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 15px 16px; box-shadow: 0 1px 2px rgba(21, 31, 44, 0.04); min-height: 96px; }
    .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }
    .value { font-size: 24px; font-weight: 760; margin-top: 8px; font-variant-numeric: tabular-nums; }
    .value.gain { color: var(--gain); }
    .exposure { display: grid; grid-template-columns: repeat(3, max-content); gap: 26px; margin: 16px 0 24px; color: #3c4856; font-size: 14px; }
    .exposure b { color: var(--ink); font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; box-shadow: 0 1px 2px rgba(21, 31, 44, 0.04); }
    th, td { padding: 10px 12px; border-bottom: 1px solid #edf1f5; text-align: left; font-size: 13px; line-height: 1.35; }
    th { color: #4b5663; background: var(--soft); font-weight: 720; }
    tr:last-child td { border-bottom: 0; }
    td:nth-child(n + 2), th:nth-child(n + 2) { font-variant-numeric: tabular-nums; }
    section + section { margin-top: 4px; }
    @media (max-width: 860px) {
      main { padding: 18px; }
      header { display: block; }
      .date { display: block; margin-top: 6px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .exposure { grid-template-columns: 1fr; gap: 8px; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header><h1>Portfolio Performance Monitor</h1><span class="date">\${readout.headline.date}</span></header>
    <section class="metrics">
      <div class="metric"><div class="label">NAV</div><div class="value">$100.0m</div></div>
      <div class="metric"><div class="label">Daily P&L</div><div class="value gain">\${money(readout.headline.pnl)}</div></div>
      <div class="metric"><div class="label">Return</div><div class="value gain">\${pct(readout.headline.returnValue)}</div></div>
      <div class="metric"><div class="label">Benchmark</div><div class="value">\${pct(readout.headline.benchmarkReturn)}</div></div>
      <div class="metric"><div class="label">Active Return</div><div class="value gain">\${pct(readout.headline.activeReturn)}</div></div>
    </section>
    <div class="exposure"><span>Gross Exposure <b>\${readout.headline.grossExposure}%</b></span><span>Net Exposure <b>\${readout.headline.netExposure}%</b></span><span>Cash <b>\${readout.headline.cashWeight}%</b></span></div>
    <h2>What Drove Performance?</h2>
    <table><thead><tr><th>Asset Class</th><th>P&L</th><th>Contribution</th><th>Weight</th><th>Active Weight</th></tr></thead><tbody>\${rows}</tbody></table>
    <h2>Top Instrument Contributors</h2>
    <table><thead><tr><th>Ticker</th><th>Name</th><th>Side</th><th>Asset Class</th><th>P&L</th><th>Contribution</th></tr></thead><tbody>\${instrumentRows(readout.topContributors)}</tbody></table>
    <h2>Top Instrument Detractors</h2>
    <table><thead><tr><th>Ticker</th><th>Name</th><th>Side</th><th>Asset Class</th><th>P&L</th><th>Contribution</th></tr></thead><tbody>\${instrumentRows(readout.topDetractors)}</tbody></table>
  </main>
</body>
</html>\`;`,
  },
];
