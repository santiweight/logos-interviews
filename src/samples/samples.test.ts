import { describe, expect, it } from "vitest";
import { runnables } from "../domain/codeSheet";
import { defaultProjectIds, sampleEvalCases, sampleGroups, samples, sampleTemplateGroups } from "./";

describe("product samples", () => {
  it("groups every sample exactly once", () => {
    const groupedIds = sampleGroups.flatMap((group) => group.samples.map((sample) => sample.id));

    expect(groupedIds).toHaveLength(new Set(groupedIds).size);
    expect(samples.map((sample) => sample.id)).toEqual(groupedIds);
  });

  it("uses valid default tabs", () => {
    const sampleIds = new Set(samples.map((sample) => sample.id));

    expect(defaultProjectIds).toHaveLength(new Set(defaultProjectIds).size);
    expect(defaultProjectIds.every((id) => sampleIds.has(id))).toBe(true);
  });

  it("loads every sample from the template menu exactly once", () => {
    const sampleIds = samples.map((sample) => sample.id);
    const templateIds = sampleTemplateGroups.flatMap((group) => group.sampleIds);

    expect(templateIds).toHaveLength(new Set(templateIds).size);
    expect(new Set(templateIds)).toEqual(new Set(sampleIds));
  });

  it("keeps the product UI scoped to the three TypeScript examples", () => {
    expect(samples.map((sample) => sample.id)).toEqual([
      "starter-arithmetic",
      "beyond-basics",
      "todo-cli",
    ]);
    expect(sampleTemplateGroups).toEqual([{
      label: "Getting started",
      sampleIds: ["starter-arithmetic", "beyond-basics", "todo-cli"],
    }]);
  });

  it("keeps legacy eval fixtures import-safe while hidden from the product menu", () => {
    for (const testCase of sampleEvalCases) {
      expect(runnables(testCase.sheet), testCase.name).toEqual([
        { line: expect.any(Number), name: testCase.runnable },
      ]);
      if (testCase.expectedStdout) {
        expect(testCase.expectedStdout.length, testCase.name).toBeGreaterThan(0);
      } else {
        expect(testCase.stdoutCheck.description.length, testCase.name).toBeGreaterThan(0);
      }
    }
  });

  it("accepts ASCII fractal output with trailing blank rows trimmed by stdout capture", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "mandelbrot render and rotate natural snippet");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const blank = " ".repeat(64);
    const visible = ".:-=+*#%@".repeat(2).padStart(38, " ").padEnd(64, " ");
    const normal = Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? visible : blank));
    const rotated = Array.from({ length: 20 }, (_, index) => {
      return index < 12 ? "@%#*+=-:.".repeat(2).padStart(32, " ").padEnd(64, " ") : blank;
    });
    rotated[11] = rotated[11].trimEnd();

    expect(testCase.stdoutCheck.matches([...normal, "", ...rotated])).toBe(true);
  });

  it("accepts denser rotated ASCII fractal frames", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "mandelbrot render and rotate natural snippet");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const blank = " ".repeat(64);
    const normalVisible = "  .:-=+*#%@".repeat(4).padEnd(64, " ");
    const rotatedVisible = ".:-=+*#%@".repeat(5).padEnd(64, " ");
    const normal = Array.from({ length: 24 }, (_, index) => {
      return index >= 4 && index < 20 ? normalVisible : blank;
    });
    const rotated = Array.from({ length: 18 }, () => rotatedVisible);

    expect(testCase.stdoutCheck.matches([...normal, "", ...rotated])).toBe(true);
  });

  it("accepts ASCII fractal frames that use a sparse density subset", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "mandelbrot render and rotate natural snippet");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const blank = " ".repeat(64);
    const normalVisible = "@@@@@@@@@@@@....::::".padStart(40, " ").padEnd(64, " ");
    const rotatedVisible = ":::@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@:::".padStart(56, " ").padEnd(64, " ");
    const normal = Array.from({ length: 24 }, (_, index) => {
      return index >= 5 && index < 19 ? normalVisible : blank;
    });
    const rotated = Array.from({ length: 18 }, (_, index) => {
      return index >= 2 ? rotatedVisible : blank;
    });

    expect(testCase.stdoutCheck.matches([...normal, "", ...rotated])).toBe(true);
  });

  it("accepts dotted ASCII fractal backgrounds with minor width drift", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "mandelbrot render and rotate natural snippet");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const normalVisible = `${".".repeat(16)}${":".repeat(8)}${"@".repeat(24)}${"-".repeat(4)}${".".repeat(12)}`;
    const rotatedVisible = `${".".repeat(10)}${":".repeat(3)}${"@".repeat(40)}${":".repeat(3)}${".".repeat(9)}`;
    const normal = Array.from({ length: 24 }, () => normalVisible);
    const rotated = Array.from({ length: 24 }, () => rotatedVisible);

    expect(normalVisible).toHaveLength(64);
    expect(rotatedVisible).toHaveLength(65);
    expect(testCase.stdoutCheck.matches([...normal, "", ...rotated])).toBe(true);
  });

  it("accepts transposed rotated ASCII fractal output", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "mandelbrot render and rotate natural snippet");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const blank = " ".repeat(64);
    const normalVisible = ".:-=+*#%@".repeat(4).padStart(44, " ").padEnd(64, " ");
    const normal = Array.from({ length: 24 }, (_, index) => {
      return index >= 4 && index < 20 ? normalVisible : blank;
    });
    const rotatedBlank = " ".repeat(24);
    const rotatedVisible = ".:-=+*#%@".repeat(2).padStart(22, " ").padEnd(24, " ");
    const rotated = Array.from({ length: 40 }, (_, index) => {
      return index >= 20 ? rotatedVisible : rotatedBlank;
    });

    expect(testCase.stdoutCheck.matches([...normal, "", ...rotated])).toBe(true);
  });

  it("accepts isometric cube stack rotation checks with any visible edge glyph family", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "isometric cube stack rotation contract");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    expect(testCase.stdoutCheck.matches([
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
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "18 48",
      "True",
      "True",
      "True",
      "True",
      "True",
      "True",
      "False",
      "False",
      "True",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "18 48",
      "True",
      "True",
      "True",
      "True",
      "False",
      "True",
      "False",
      "False",
      "True",
    ])).toBe(false);
  });

  it("accepts spreadsheet renders that use row and column headers", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "formula spreadsheet strings and rendering");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    expect(testCase.stdoutCheck.matches([
      "(empty spreadsheet)",
      "None",
      "Val(value=7)",
      "5",
      "48",
      "",
      "=== Unevaluated Expressions ===",
      "          A           B           C      ",
      "1         7         2 + 3    (B1 + A1) * 4",
      "",
      "=== Evaluated Values ===",
      "          A           B           C      ",
      "1         7           5           48",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "A1 -> None",
      "A1 = 7",
      "A1 -> 7",
      "B1 = 2 + 3",
      "B1 -> 5",
      "C1 = (B1 + A1) * 4",
      "C1 -> 48",
      "",
      "=== Unevaluated Expressions ===",
      "          A           B           C      ",
      "1         7         2 + 3    (B1 + A1) * 4",
      "2                   10",
      "3                   10",
    ])).toBe(true);
  });

  it("requires annotated maze path color to be attached to visible glyphs", () => {
    const testCase = sampleEvalCases.find((item) => {
      return item.name === "annotated maze generation and visible colored astar path";
    });
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    const base = [
      "Maze:",
      "############",
      "#O         #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#         X#",
      "#          #",
      "############",
      "",
      "Solved Maze (path in color):",
    ];

    expect(testCase.stdoutCheck.matches([
      ...base,
      "############",
      "#O\x1b[32m·\x1b[0m        #",
      "# \x1b[32m·\x1b[0m        #",
      "# \x1b[32m·\x1b[0m        #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#         X#",
      "#          #",
      "############",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      ...base,
      "############",
      "#O\x1b[32m \x1b[0m        #",
      "# \x1b[32m \x1b[0m        #",
      "# \x1b[32m \x1b[0m        #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#         X#",
      "#          #",
      "############",
    ])).toBe(false);

    expect(testCase.stdoutCheck.matches([
      ...base,
      "############",
      "#O\x1b[32m.\x1b[0m        #",
      "# \x1b[32m.\x1b[0m        #",
      "# \x1b[32m.\x1b[0m        #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#          #",
      "#         X#",
      "#          #",
      "############",
    ])).toBe(false);

    expect(testCase.stdoutCheck.matches([
      "Maze:",
      "#############",
      "#O          #",
      "#############",
      "",
      "Solved Maze (path in color):",
      "#############",
      "#O\x1b[32m·\x1b[0m         #",
      "#############",
    ])).toBe(false);
  });

  it("accepts pretty magic square puzzle solver output", () => {
    const testCase = sampleEvalCases.find((item) => {
      return item.name === "isolated magic square puzzle solver idea";
    });
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    expect(testCase.stdoutCheck.matches([
      "Puzzle:",
      "Magic Square Puzzle (size=3, magic sum=15)",
      "",
      "+---+---+---+",
      "| ? | ? | 6 |",
      "+---+---+---+",
      "| 3 | ? | ? |",
      "+---+---+---+",
      "| 4 | ? | 2 |",
      "+---+---+---+",
      "",
      "Solution:",
      "Magic Square Puzzle (size=3, magic sum=15)",
      "",
      "+---+---+---+",
      "| 8 | 1 | 6 |",
      "+---+---+---+",
      "| 3 | 5 | 7 |",
      "+---+---+---+",
      "| 4 | 9 | 2 |",
      "+---+---+---+",
      "",
      "Solved puzzle is: VALID",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "Magic Square Puzzle  (size=3, ~45% filled)",
      "Magic sum = 15",
      "",
      "Puzzle (· = empty cell):",
      "",
      "+---+---+---+",
      "|\x1b[90m · \x1b[0m|\x1b[90m · \x1b[0m|\x1b[97m 6 \x1b[0m|",
      "+---+---+---+",
      "|\x1b[97m 3 \x1b[0m|\x1b[90m · \x1b[0m|\x1b[97m 7 \x1b[0m|",
      "+---+---+---+",
      "|\x1b[90m · \x1b[0m|\x1b[97m 9 \x1b[0m|\x1b[90m · \x1b[0m|",
      "+---+---+---+",
      "",
      "Solution:",
      "",
      "+---+---+---+",
      "|\x1b[97m 8 \x1b[0m|\x1b[97m 1 \x1b[0m|\x1b[97m 6 \x1b[0m|",
      "+---+---+---+",
      "|\x1b[97m 3 \x1b[0m|\x1b[97m 5 \x1b[0m|\x1b[97m 7 \x1b[0m|",
      "+---+---+---+",
      "|\x1b[97m 4 \x1b[0m|\x1b[97m 9 \x1b[0m|\x1b[97m 2 \x1b[0m|",
      "+---+---+---+",
      "",
      "\x1b[32mSolution verified: all cells filled.\x1b[0m",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "=== Magic Square Puzzle (Size 3, ~45% filled) ===",
      "",
      "\x1b[36m  8\x1b[0m \x1b[36m  1\x1b[0m \x1b[90m  .\x1b[0m",
      "\x1b[90m  .\x1b[0m \x1b[90m  .\x1b[0m \x1b[90m  .\x1b[0m",
      "\x1b[36m  4\x1b[0m \x1b[90m  .\x1b[0m \x1b[36m  2\x1b[0m",
      "",
      "=== Magic Square Solution (Size 3) ===",
      "",
      "\x1b[32m  8\x1b[0m \x1b[32m  1\x1b[0m \x1b[32m  6\x1b[0m",
      "\x1b[32m  3\x1b[0m \x1b[32m  5\x1b[0m \x1b[32m  7\x1b[0m",
      "\x1b[32m  4\x1b[0m \x1b[32m  9\x1b[0m \x1b[32m  2\x1b[0m",
      "",
      "Magic constant (each row/col/diagonal sums to): \x1b[33m15\x1b[0m",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "Puzzle:",
      "_ _ _",
      "_ _ _",
      "_ _ _",
      "",
      "Solution:",
      "2 7 6",
      "9 5 1",
      "4 3 8",
    ])).toBe(false);

    expect(testCase.stdoutCheck.matches([
      "Puzzle:",
      "_ _ _",
      "Solution:",
      "1 2 3",
      "4 5 6",
      "7 8 9",
    ])).toBe(false);
  });

  it("accepts primes rendered as a grid and rejects raw list output", () => {
    const testCase = sampleEvalCases.find((item) => {
      return item.name === "natural language primes grid print quality";
    });
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    expect(testCase.stdoutCheck.matches([
      "   2    3    5    7   11   13   17   19   23   29",
      "  31   37   41   43   47   53   59   61   67   71",
      "  73   79   83   89   97",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "Primes less than 100:",
      "",
      "  2    3    5    7   11   13   17   19   23   29  ",
      " 31   37   41   43   47   53   59   61   67   71  ",
      " 73   79   83   89   97",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]",
    ])).toBe(false);
  });

  it("allows debug output around the annotated maze api contract", () => {
    const testCase = sampleEvalCases.find((item) => item.name === "annotated maze api contract");
    expect(testCase?.stdoutCheck).toBeDefined();
    if (!testCase?.stdoutCheck) {
      return;
    }

    expect(testCase.stdoutCheck.matches([
      "[MazeGenerator.gen] Grid dimensions: 10x10",
      "10 10",
      "True",
      "True",
      "True",
      "True True True",
      "True",
      "True",
      "[MazeGenerator.grid] Rendered 12 rows, width=12",
      "12 12",
      "True",
      "True",
    ])).toBe(true);

    expect(testCase.stdoutCheck.matches([
      "[MazeGenerator.grid] Rendered 14 rows x 14 cols",
      "10 10",
      "True",
      "True",
      "True",
      "True True True",
      "True",
      "True",
      "14 14",
      "False",
      "True",
    ])).toBe(false);
  });
});
