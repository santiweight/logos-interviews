import { describe, expect, it } from "vitest";
import { completeWithAnthropic } from "./anthropicComplete";
import {
  runnables,
  type CodeCache,
  type CodeSheet,
  type Runnable,
} from "./codeSheet";
import { runCodeSheet, type RunResult } from "./codeSheetRunner";

type E2ECase = {
  name: string;
  sheet: CodeSheet;
  runnable: Runnable;
  expectedStdout: string[];
};

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
    name: "multiple incomplete functions",
    sheet: `def add(x: int, y: int) -> int

def mul(x: int, y: int) -> int

def test():
  print(mul(1,2))`,
    runnable: "test",
    expectedStdout: ["2"],
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
];

const describeIfAnthropicKey = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfAnthropicKey("codeSheet Anthropic E2E reliability", () => {
  it(
    "detects runnables for every LLM case",
    () => {
      expect(
        Object.fromEntries(
          cases.map((testCase) => [testCase.name, runnables(testCase.sheet)]),
        ),
      ).toMatchInlineSnapshot(`
        {
          "calculated spreadsheet with cell references": [
            {
              "line": 25,
              "name": "test",
            },
          ],
          "incomplete spreadsheet class": [
            {
              "line": 7,
              "name": "test",
            },
          ],
          "multiple incomplete functions": [
            {
              "line": 5,
              "name": "test",
            },
          ],
          "single incomplete add": [
            {
              "line": 3,
              "name": "test",
            },
          ],
        }
      `);
    },
    120_000,
  );

  it(
    "succeeds in every repeated full-pipeline run",
    async () => {
      const summaries = await Promise.all(
        cases.map(async (testCase) => {
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
            return result.ok && arraysEqual(result.stdout, testCase.expectedStdout);
          });

          return {
            case: testCase.name,
            attempts,
            successes: successes.length,
            expectedStdout: testCase.expectedStdout,
            results,
          };
        }),
      );

      expect(summaries).toMatchInlineSnapshot(`
        [
          {
            "attempts": 3,
            "case": "single incomplete add",
            "expectedStdout": [
              "3",
            ],
            "results": [
              {
                "attempt": 1,
                "result": {
                  "ok": true,
                  "stdout": [
                    "3",
                  ],
                },
              },
              {
                "attempt": 2,
                "result": {
                  "ok": true,
                  "stdout": [
                    "3",
                  ],
                },
              },
              {
                "attempt": 3,
                "result": {
                  "ok": true,
                  "stdout": [
                    "3",
                  ],
                },
              },
            ],
            "successes": 3,
          },
          {
            "attempts": 3,
            "case": "multiple incomplete functions",
            "expectedStdout": [
              "2",
            ],
            "results": [
              {
                "attempt": 1,
                "result": {
                  "ok": true,
                  "stdout": [
                    "2",
                  ],
                },
              },
              {
                "attempt": 2,
                "result": {
                  "ok": true,
                  "stdout": [
                    "2",
                  ],
                },
              },
              {
                "attempt": 3,
                "result": {
                  "ok": true,
                  "stdout": [
                    "2",
                  ],
                },
              },
            ],
            "successes": 3,
          },
          {
            "attempts": 3,
            "case": "incomplete spreadsheet class",
            "expectedStdout": [
              "None",
              "7",
            ],
            "results": [
              {
                "attempt": 1,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "7",
                  ],
                },
              },
              {
                "attempt": 2,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "7",
                  ],
                },
              },
              {
                "attempt": 3,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "7",
                  ],
                },
              },
            ],
            "successes": 3,
          },
          {
            "attempts": 3,
            "case": "calculated spreadsheet with cell references",
            "expectedStdout": [
              "None",
              "Val(value=7)",
              "5",
              "48",
            ],
            "results": [
              {
                "attempt": 1,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "Val(value=7)",
                    "5",
                    "48",
                  ],
                },
              },
              {
                "attempt": 2,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "Val(value=7)",
                    "5",
                    "48",
                  ],
                },
              },
              {
                "attempt": 3,
                "result": {
                  "ok": true,
                  "stdout": [
                    "None",
                    "Val(value=7)",
                    "5",
                    "48",
                  ],
                },
              },
            ],
            "successes": 3,
          },
        ]
      `);

      for (const summary of summaries) {
        expect(summary.successes).toBe(attempts);
      }
    },
    120_000,
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

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function simplifyRunResult(
  result: RunResult | { ok: false; error: string; stdout: string[] },
): { ok: true; stdout: string[] } | { ok: false; error: string; stdout: string[] } {
  if (result.ok) {
    return { ok: true, stdout: result.stdout };
  }

  return { ok: false, error: result.error, stdout: result.stdout };
}
