import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type MigrationStatus = "covered" | "todo" | "obsolete-python-syntax";

type MigrationCase = {
  source: string;
  name: string;
  line: number;
  status: MigrationStatus;
  note: string;
};

const pythonTargetTestFiles = [
  "codeSheet.test.ts",
  "codeSheet.e2e.ts",
  "compileStream.test.ts",
  "codeCache.test.ts",
  "interactiveRunApi.test.ts",
  "runProgram.browser.e2e.ts",
  "defaultWorkspaceSmoke.e2e.ts",
  "samples.test.ts",
  "pyrightTypeCheck.test.ts",
] as const;

const statusOverrides = new Map<string, Pick<MigrationCase, "status" | "note">>([
  keyed("codeSheet.test.ts", "captures runnables output", "covered", "Covered by Logos-TS runnable discovery and run tests."),
  keyed("codeSheet.test.ts", "keeps adjacent top-level function signatures as separate snippets", "covered", "Covered by migrated Intro/Beyond parser smoke checks."),
  keyed("codeSheet.test.ts", "streams compilation events and renders partial and completed IR", "todo", "Important TS gap: compile stream parity needs a direct migration."),
  keyed("codeSheet.test.ts", "can start independent completions in parallel", "covered", "Covered by Logos-TS parallel completion start test."),
  keyed("codeSheet.test.ts", "streams tokens from parallel completions before all snippets finish", "covered", "Covered by Logos-TS parallel token streaming test."),
  keyed("codeSheet.test.ts", "uses dependency-aware completion hashes", "covered", "Covered by Logos-TS hash stability/invalidation tests."),
  keyed("codeSheet.test.ts", "emits cache hits without invoking the LLM", "covered", "Covered by Logos-TS function cache-hit test with throwing completion fallback."),
  keyed("codeSheet.test.ts", "can compile cached sheets without emitting intermediate progress", "todo", "Important TS gap: cached compile stream behavior needs a TS equivalent."),
  keyed("codeSheet.test.ts", "models readiness through incomplete definitions and dependencies", "covered", "Covered by Logos-TS readiness modeling, browser blocked-runnable status tests, and React Sudoku dependency graph tests."),
  keyed("codeSheet.test.ts", "keeps completed cache entries after cancelling an in-progress compile", "todo", "Important TS gap: cancellation/cache integrity needs a TS equivalent."),
  keyed("codeSheet.test.ts", "passes parallel strategy through the runner", "covered", "Covered by Logos-TS runner strategy passthrough test."),
  keyed("codeSheet.test.ts", "auto strategy commits only the first successful strategy cache fork", "todo", "Important TS gap: auto/parallel strategy cache fork behavior is not covered."),
  keyed("compileStream.test.ts", "does not stream implementation payloads after a cached runnable is ready", "covered", "Covered by Logos-TS compile stream API cached-ready event ordering test."),
  keyed("codeCache.test.ts", "hydrates persisted completions across independent cache instances", "todo", "Important TS gap: global cache persistence is outside active test config."),
  keyed("codeCache.test.ts", "supports concurrent hydration from the same persisted cache entry", "todo", "Important TS gap: concurrent cache hydration is outside active test config."),
  keyed("codeCache.test.ts", "clears both memory and the persistent backing store", "todo", "Important TS gap: clear-cache behavior must be tested with unseeded dev cache."),
  keyed("interactiveRunApi.test.ts", "starts repeated runs after compile warmed the shared cache", "todo", "Important TS gap: compile/run cache sharing should be migrated."),
  keyed("interactiveRunApi.test.ts", "starts from the global cache when compile and run use different cache instances", "todo", "Important TS gap: global cache fallback should be migrated."),
  keyed("runProgram.browser.e2e.ts", "clears the code cache from the settings menu", "todo", "Important TS gap: browser cache clearing should be migrated."),
  keyed("runProgram.browser.e2e.ts", "explains restored running sessions instead of rendering a blank terminal", "todo", "Important TS gap: restored run UI state should be migrated."),
  keyed("runProgram.browser.e2e.ts", "keeps stdin unfocused until the user focuses it, then sends keyboard input", "todo", "Interactive stdin is lower priority for WebPage-first TS but still unported."),
  keyed("runProgram.browser.e2e.ts", "focuses stdin from terminal panel clicks and disables stdin after exit", "todo", "Interactive stdin is lower priority for WebPage-first TS but still unported."),
  keyed("codeSheet.e2e.ts", "reuses cached completions when only the runnable body changes", "covered", "Covered by Logos-TS function cache reuse when main changes."),
  keyed("samples.test.ts", "groups every sample exactly once", "covered", "Covered by the Logos-TS sample contract test."),
  keyed("samples.test.ts", "uses valid default tabs", "covered", "Covered by the Logos-TS sample contract test."),
  keyed("samples.test.ts", "loads every sample from the template menu exactly once", "covered", "Covered by the Logos-TS sample contract test."),
  keyed("samples.test.ts", "has runnable eval fixtures for every product sample", "covered", "Covered for migrated stdout/app eval contracts."),
  keyed("pyrightTypeCheck.test.ts", "catalogs the custom syntax that has to be lowered before real Python tools can run", "obsolete-python-syntax", "Python/Pyright-only syntax spike does not apply to destructive TS syntax."),
  keyed("pyrightTypeCheck.test.ts", "lowers dataclass shorthand into a Pyright-visible constructor", "obsolete-python-syntax", "Python/Pyright-only syntax spike does not apply to destructive TS syntax."),
  keyed("pyrightTypeCheck.test.ts", "maps Pyright diagnostics back to sheet lines across the diagnostic eval suite", "obsolete-python-syntax", "Replace with TypeScript diagnostic mapping tests."),
  keyed("pyrightTypeCheck.test.ts", "shows why Pyright lowering is materially stronger than the manual checker", "obsolete-python-syntax", "Replace with TypeScript diagnostic mapping tests."),
]);

const migrationCases = pythonTargetTestFiles.flatMap(readMigrationCases);

describe("Python target test migration backlog", () => {
  it("discovers the old Python-target test suite", () => {
    expect(migrationCases.length).toBeGreaterThan(100);
    expect(new Set(migrationCases.map((testCase) => `${testCase.source}:${testCase.line}::${testCase.name}`)).size)
      .toBe(migrationCases.length);
  });

  for (const testCase of migrationCases) {
    const title = `${testCase.source}:${testCase.line} > ${testCase.name}`;
    if (testCase.status === "todo") {
      it.todo(`${title} [TS migration todo] ${testCase.note}`);
      continue;
    }

    it(`${title} [${testCase.status}]`, () => {
      expect(testCase.note.length).toBeGreaterThan(0);
    });
  }
});

function readMigrationCases(file: string): MigrationCase[] {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  const tests = [...source.matchAll(/\bit\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)];
  return tests.map((match) => {
    const name = match[2].replace(/\s+/g, " ").trim();
    const override = statusOverrides.get(key(file, name));
    return {
      source: file,
      name,
      line: lineNumberAt(source, match.index ?? 0),
      status: override?.status ?? "todo",
      note: override?.note ?? "Needs an explicit Logos-TS equivalent or an obsolete-syntax decision.",
    };
  });
}

function keyed(
  source: string,
  name: string,
  status: MigrationStatus,
  note: string,
): [string, Pick<MigrationCase, "status" | "note">] {
  return [key(source, name), { status, note }];
}

function key(source: string, name: string): string {
  return `${source}::${name}`;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}
