import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("frontend compilation policy", () => {
  it("does not automatically compile inactive sheets", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).not.toContain("compileInactiveSheets");
    expect(source).not.toContain("inactiveQueue");
  });

  it("models implementation state as sheet cache plus active compile session", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("type SheetImplementationCacheEntry");
    expect(source).toContain("type CompileSession");
    expect(source).toContain("session: CompileSession");
    expect(source).toContain("draftImplementation: string | null");
    expect(source).toContain("lastImplementation: string");
    expect(source).toContain("function visibleImplementationForState");
    expect(source).not.toContain("implementation: next.implementation + event.token");
  });

  it("shows a generating message instead of no implementation during active compilation", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('"Code is being generated..."');
    expect(source).toContain('compilationPending\n    ? "Code is being generated..."');
  });

  it("renders the implementation view through the highlighted Logos editor", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("const implementationViewEditor = monaco.editor.create");
    expect(source).toContain("implementationViewEditor.setValue");
    expect(source).toContain(`language: logosPythonLanguageId`);
    expect(source).not.toContain("implementationViewPanel.textContent");
  });
});
