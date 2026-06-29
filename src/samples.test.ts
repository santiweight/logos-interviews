import { describe, expect, it } from "vitest";
import { runnables } from "./codeSheet";
import { defaultProjectIds, sampleEvalCases, sampleGroups, samples } from "./samples";

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

  it("has runnable eval fixtures for every product sample", () => {
    const sampleIds = samples
      .map((sample) => sample.id)
      .filter((id) => id !== "interactive-reverse");
    const evalIds = sampleEvalCases.map((testCase) => testCase.sampleId);

    expect(new Set(evalIds)).toEqual(new Set(sampleIds));
    for (const testCase of sampleEvalCases) {
      expect(sampleIds, testCase.name).toContain(testCase.sampleId);
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

  it("keeps the reverse CLI sample as an interactive natural-language prompt", () => {
    const sample = samples.find((item) => item.id === "interactive-reverse");

    expect(sample?.code).toBe(`def main():
  \`\`\`
  A CLI loop where user is prompted for a line, and the CLI prints the reversed word.
  \`\`\``);
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
  });
});
