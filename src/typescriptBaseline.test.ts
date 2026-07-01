import { describe, expect, it } from "vitest";
import { compile, type CompleteFunction, runnables } from "./codeSheet";
import { runCodeSheet } from "./codeSheetRunner";
import { defaultProjectIds, sampleEvalCases, samples, sampleTemplateGroups } from "./samples";
import { completeWithFixture } from "./testCompletion";
import {
  buildTypeScriptModule,
  buildTypeScriptProgram,
  buildTypeScriptWebPage,
  snippetCompletionReplacements,
  transpileTypeScript,
} from "./typescriptTarget";

describe("Logos-TS baseline samples", () => {
  it("keeps the four migrated baseline files as the product contract", () => {
    expect(defaultProjectIds).toEqual([
      "starter-arithmetic",
      "beyond-basics",
      "formula-spreadsheet",
      "annotated-maze",
    ]);
    expect(samples.map((sample) => sample.id)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
    expect(sampleTemplateGroups.flatMap((group) => group.sampleIds)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
    expect(sampleEvalCases.map((testCase) => testCase.sampleId)).toEqual([...defaultProjectIds, "portfolio-viewer"]);
  });

  it("discovers the runnable for each baseline file", () => {
    for (const testCase of sampleEvalCases) {
      expect(runnables(testCase.sheet), testCase.name).toEqual([
        { line: expect.any(Number), name: testCase.runnable },
      ]);
    }
  });

  it("keeps class-based samples in TypeScript-shaped class syntax", () => {
    for (const sampleId of ["beyond-basics", "formula-spreadsheet", "annotated-maze", "portfolio-viewer"]) {
      const sample = samples.find((item) => item.id === sampleId);
      expect(sample, sampleId).toBeDefined();
      if (!sample) continue;
      expect(sample.code, sampleId).toMatch(/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/);
      expect(sample.code, sampleId).not.toMatch(/^class\s+[A-Za-z_][A-Za-z0-9_]*\s*:/m);
      expect(sample.code, sampleId).not.toMatch(/\bfn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*self\b/);
    }
  });

  it("emits transpileable TypeScript for each baseline file", () => {
    for (const testCase of sampleEvalCases) {
      const module = buildTypeScriptModule(testCase.sheet);
      const program = buildTypeScriptProgram(testCase.sheet, testCase.runnable);
      expect(module, testCase.name).toContain("function");
      expect(() => transpileTypeScript(program), testCase.name).not.toThrow();
    }
  });

  it("emits generated Intro snippet completions instead of relying on cache", () => {
    const testCase = sampleEvalCases.find((item) => item.sampleId === "starter-arithmetic");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }

    const completions = snippetCompletionReplacements(testCase.sheet);
    const implementations = completions.map((completion) => completion.implementation);
    expect(implementations).toContain(`function add(x: number, y: number): number {
  return x + y;
}`);
    expect(implementations).toContain(`function mul(x: number, y: number): number {
  return x * y;
}`);
    expect(implementations).toContain(`console.log("Logos:", mul(add(1, 2), 3));`);
    expect(implementations).toContain("add(1, 5)");
    expect(implementations).toContain("mul(3, 4)");
  });

  it("compiles natural snippets through the completion pipeline as expressions by default", async () => {
    const sheet = `fn mul(x: number, y: number) -> number

fn main():
  product = \`mul 3 and 5\`
  console.log(product)`;
    const prompts: string[] = [];
    const complete: CompleteFunction = (prompt) => {
      prompts.push(prompt);
      if (prompt.includes("fn mul(x: number, y: number) -> number")) {
        return `function mul(x: number, y: number): number {
  return x * y;
}`;
      }
      if (prompt.includes("`mul 3 and 5`")) {
        return "mul(3, 5)";
      }
      throw new Error(`unexpected prompt: ${prompt}`);
    };

    const events = [];
    for await (const event of compile(new Map(), sheet, complete, { streamTokens: false })) {
      events.push(event);
    }

    const compiled = events.find((event) => event.kind === "compiled");
    expect(compiled?.kind).toBe("compiled");
    if (compiled?.kind !== "compiled") {
      return;
    }

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Return a TypeScript expression by default");
    expect(prompts[1]).toContain("Do not stringify, echo, or console.log the natural-language source");
    expect(compiled.completed.source).toContain("product =   mul(3, 5)");
    expect(compiled.completed.source).not.toContain('console.log("mul 3 and 5")');
  });

  it("uses cache hits through the compiler loop without calling completion", async () => {
    const sheet = `fn mul(x: number, y: number) -> number

fn main():
  product = \`mul 3 and 5\`
  console.log(product)`;
    const cache = new Map<string, string>();
    const primingComplete: CompleteFunction = (prompt) => {
      if (prompt.includes("fn mul(x: number, y: number) -> number")) {
        return `function mul(x: number, y: number): number {
  return x * y;
}`;
      }
      if (prompt.includes("`mul 3 and 5`")) {
        return "mul(3, 5)";
      }
      throw new Error(`unexpected prompt: ${prompt}`);
    };
    for await (const _event of compile(cache, sheet, primingComplete, { emitProgress: false })) {
      // Prime the cache with the real compiler path.
    }

    const events = [];
    const noComplete: CompleteFunction = () => {
      throw new Error("completion should not be called for cached snippets");
    };
    for await (const event of compile(cache, sheet, noComplete, { streamTokens: false })) {
      events.push(event);
    }

    expect(events.filter((event) => event.kind === "cache-hit")).toHaveLength(2);
    expect(events.some((event) => event.kind === "llm-start")).toBe(false);
    expect(events.some((event) => event.kind === "llm-complete")).toBe(false);
  });

  it("does not collapse edited MagicSquare natural bodies back to the canned 4x4 output", async () => {
    const sample = samples.find((item) => item.id === "beyond-basics");
    expect(sample).toBeDefined();
    if (!sample) {
      return;
    }

    const edited = sample.code.replace("Generate a MagicSquare of size 4.", "Generate a MagicSquare of size 3.");
    const result = await runCodeSheet(edited, "magic_square_example", {
      complete: completeWithFixture,
      cache: new Map(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    const stdout = result.stdout.join("\n");
    expect(stdout).toContain("3x3 Magic Square");
    expect(stdout).toContain("row sums: 15, 15, 15");
    expect(stdout).toContain("column sums: 15, 15, 15");
    expect(stdout).toContain("diagonal sums: 15, 15");
    expect(stdout).not.toContain("4x4 Magic Square");
    expect(result.completed.source).toContain("new MagicSquare(3)");
  });

  it("runs the baseline and portfolio files through the TypeScript target", async () => {
    for (const testCase of sampleEvalCases) {
      const result = await runCodeSheet(testCase.sheet, testCase.runnable);
      expect(result.ok, testCase.name).toBe(true);
      if (!result.ok) {
        throw new Error(result.error);
      }

      if (testCase.expectedStdout) {
        expect(result.stdout, testCase.name).toEqual(testCase.expectedStdout);
      } else {
        expect(testCase.stdoutCheck.matches(result.stdout), testCase.name).toBe(true);
      }
    }
  });

  it("emits a loadable portfolio viewer web page", () => {
    const testCase = sampleEvalCases.find((item) => item.sampleId === "portfolio-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }

    const html = buildTypeScriptWebPage(testCase.sheet);
    expect(html).not.toBeNull();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Portfolio Performance Monitor");
    expect(html).toContain("What Drove Performance?");
    expect(html).toContain("Top Instrument Contributors");
    expect(html).toContain("NVDA");
    expect(html).toContain("CVNA");
  });

  it("derives the portfolio viewer from source mutations instead of a canned page", () => {
    const testCase = sampleEvalCases.find((item) => item.sampleId === "portfolio-viewer");
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }

    const mutated = testCase.sheet
      .replace('page named "Portfolio Performance Monitor"', 'page named "Portfolio Risk Monitor"')
      .replaceAll("NVDA", "AMD")
      .replaceAll("NVIDIA", "Advanced Micro Devices")
      .replace("+$1.20m", "+$2.40m");

    const originalModule = buildTypeScriptModule(testCase.sheet);
    const mutatedModule = buildTypeScriptModule(mutated);
    const html = buildTypeScriptWebPage(mutated);

    expect(mutatedModule).not.toEqual(originalModule);
    expect(mutatedModule).toContain("Portfolio Risk Monitor");
    expect(mutatedModule).toContain("AMD");
    expect(mutatedModule).toContain("Advanced Micro Devices");
    expect(mutatedModule).toContain("+$2.40m");
    expect(html).not.toBeNull();
    expect(html).toContain("Portfolio Risk Monitor");
    expect(html).toContain("AMD");
    expect(html).toContain("Advanced Micro Devices");
    expect(html).not.toContain("NVDA");
  });
});
