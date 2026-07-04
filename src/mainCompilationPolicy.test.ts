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

  it("uses inferred splice matches when snippet previews have no direct implementation", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("implementationForIncompleteSnippet");
    expect(source).toContain("function inferredImplementationForSnippet");
    expect(source).toContain("inferredImplementation ??");
  });

  it("reveals selected snippets inside the implementation view when it is active", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("function revealImplementationForSnippet");
    expect(source).toContain("function revealImplementationForDefinition");
    expect(source).toContain("implementationMatchForTarget");
    expect(source).toContain("function updateImplementationSnippetDecorations");
    expect(source).toContain("implementationMatchForIncompleteSnippet");
    expect(source).toContain("activeToolTabId === implementationToolTabId");
    expect(source).toContain("implementationViewEditor.revealRangeInCenter");
    expect(source).toContain('"snippet-source-inline-selected"');
  });

  it("uses matching blue source-code highlights for selected definitions", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("function sourceDefinitionHighlightRange");
    expect(source).toContain("firstLineLength(target.source.trimStart())");
    expect(source).toContain('inlineClassName: "snippet-source-inline-selected"');
    expect(source).not.toContain('className: "definition-implementation-line-selected"');
  });

  it("keeps source snippet highlighting when implementation-view snippet navigation hides the popup", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("function revealImplementationForSnippet");
    expect(source).toContain("snippetGuideHash = target.hash");
    expect(source).toContain("updateIncompleteSnippetDecorations();");
  });

  it("does not auto-focus the implementation view when navigating to a selection", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).not.toContain("implementationViewEditor.focus()");
  });

  it("does not show snippet hover popups while the implementation view is active", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("editor.onMouseMove((event) => {");
    expect(source).toContain("if (activeToolTabId === implementationToolTabId)");
    expect(source).toContain("hideSnippetPopup();");
  });
});
