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
      expect(testCase.expectedStdout.length, testCase.name).toBeGreaterThan(0);
    }
  });
});
