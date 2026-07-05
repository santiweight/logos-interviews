import { describe, expect, it } from "vitest";
import {
  createImplementationFocusModel,
  incompleteSnippetTargetsForSource,
  refreshImplementationSelection,
  selectedImplementationRange,
  selectedSourceRange,
  selectImplementationAtPosition,
} from "./implementationFocus";
import type { LoadableSessionSelection } from "./types";

const source = `def add(x: int, y: int) -> int

def subtract(x: int, y: int) -> int

def main():
  print(add(1, 2))
  print(subtract(3, 1))`;

const implementation = `def add(x: int, y: int) -> int:
  return x + y

def subtract(x: int, y: int) -> int:
  return x - y

def main():
  print(add(1, 2))
  print(subtract(3, 1))`;

describe("implementation focus selection", () => {
  it("starts from the first incomplete snippet when no selection exists", () => {
    const model = createImplementationFocusModel(source);

    expect(model.snippets.map((snippet) => snippet.label)).toEqual(["add", "subtract"]);
    expect(model.selection).toEqual({ kind: "snippet", hash: model.snippets[0]!.hash });
  });

  it("keeps an existing snippet selection when the snippet still exists", () => {
    const original = createImplementationFocusModel(source);
    const selectedSnippet = original.snippets[1]!;
    const nextSource = source.replace("print(add(1, 2))", "print(add(2, 3))");
    const nextSnippets = incompleteSnippetTargetsForSource(nextSource);

    expect(refreshImplementationSelection(nextSource, nextSnippets, {
      kind: "snippet",
      hash: selectedSnippet.hash,
    })).toEqual({ kind: "snippet", hash: selectedSnippet.hash });
  });

  it("falls back to the first available snippet when a selected snippet disappears", () => {
    const original = createImplementationFocusModel(source);
    const selectedSnippet = original.snippets[1]!;
    const nextSource = source.replace("\n\ndef subtract(x: int, y: int) -> int", "");
    const nextSnippets = incompleteSnippetTargetsForSource(nextSource);

    expect(refreshImplementationSelection(nextSource, nextSnippets, {
      kind: "snippet",
      hash: selectedSnippet.hash,
    })).toEqual({ kind: "snippet", hash: nextSnippets[0]!.hash });
  });

  it("preserves a definition selection when the target identity is unchanged", () => {
    const selection: LoadableSessionSelection = {
      kind: "definition",
      line: 5,
      name: "main",
      targetKind: "function",
    };
    const nextSource = source.replace("print(add(1, 2))", "print(add(2, 3))");
    const nextSnippets = incompleteSnippetTargetsForSource(nextSource);

    expect(refreshImplementationSelection(nextSource, nextSnippets, selection)).toEqual(selection);
  });

  it("drops a stale definition selection when the source line no longer names that target", () => {
    const selection: LoadableSessionSelection = {
      kind: "definition",
      line: 5,
      name: "main",
      targetKind: "function",
    };
    const nextSource = source.replace("def main():", "def run():");
    const nextSnippets = incompleteSnippetTargetsForSource(nextSource);

    expect(refreshImplementationSelection(nextSource, nextSnippets, selection)).toEqual({
      kind: "snippet",
      hash: nextSnippets[0]!.hash,
    });
  });

  it("maps a click inside an incomplete definition to that definition", () => {
    const model = createImplementationFocusModel(source);

    expect(selectImplementationAtPosition(source, model.snippets, 1, 5)).toEqual({
      kind: "definition",
      line: 1,
      name: "add",
      targetKind: "function",
    });
  });

  it("maps a click inside a function body to the enclosing definition", () => {
    const model = createImplementationFocusModel(source);

    expect(selectImplementationAtPosition(source, model.snippets, 6, 5)).toEqual({
      kind: "definition",
      line: 5,
      name: "main",
      targetKind: "function",
    });
  });

  it("maps a click outside snippets and definitions to the whole file", () => {
    const withNotes = `${source}\n\n# notes`;
    const model = createImplementationFocusModel(withNotes);

    expect(selectImplementationAtPosition(withNotes, model.snippets, 9, 2)).toEqual({
      kind: "whole-file",
    });
  });
});

describe("implementation focus ranges", () => {
  it("highlights selected snippets in the source editor", () => {
    const model = createImplementationFocusModel(source);

    expect(selectedSourceRange(source, model)).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 31,
    });
  });

  it("highlights the first line of a selected source definition", () => {
    const model = {
      snippets: incompleteSnippetTargetsForSource(source),
      selection: {
        kind: "definition",
        line: 5,
        name: "main",
        targetKind: "function",
      } satisfies LoadableSessionSelection,
    };

    expect(selectedSourceRange(source, model)).toEqual({
      startLine: 5,
      startColumn: 1,
      endLine: 5,
      endColumn: 12,
    });
  });

  it("focuses the matching implementation range for a selected snippet while keeping the full implementation file", () => {
    const snippets = incompleteSnippetTargetsForSource(source);
    const model = {
      snippets,
      selection: {
        kind: "snippet",
        hash: snippets[0]!.hash,
      } satisfies LoadableSessionSelection,
    };

    expect(selectedImplementationRange(source, implementation, model)).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 15,
    });
  });

  it("focuses the matching implementation range for a selected definition", () => {
    const model = {
      snippets: incompleteSnippetTargetsForSource(source),
      selection: {
        kind: "definition",
        line: 5,
        name: "main",
        targetKind: "function",
      } satisfies LoadableSessionSelection,
    };

    expect(selectedImplementationRange(source, implementation, model)).toEqual({
      startLine: 7,
      startColumn: 1,
      endLine: 9,
      endColumn: 24,
    });
  });

  it("does not focus an implementation range for whole-file selection", () => {
    const model = {
      snippets: incompleteSnippetTargetsForSource(source),
      selection: { kind: "whole-file" } satisfies LoadableSessionSelection,
    };

    expect(selectedSourceRange(source, model)).toBeNull();
    expect(selectedImplementationRange(source, implementation, model)).toBeNull();
  });

  it("does not focus an implementation range when the generated code cannot be matched", () => {
    const model = createImplementationFocusModel(source);

    expect(selectedImplementationRange(source, "def multiply():\n  return 0", model)).toBeNull();
  });
});
