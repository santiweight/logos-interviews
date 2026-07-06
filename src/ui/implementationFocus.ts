import {
  completionSnippetHashes,
  hashCompletionInput,
  implementationMatchForIncompleteSnippet,
  implementationMatchForTarget,
  implementationTargetAtLine,
  parse,
  selectionContextAtPosition,
  type IncompleteSnippet,
  type ImplementationTarget,
  type SnippetHash,
  UNKNOWN_IMPLEMENTATION_MATCH_TEXT,
} from "../domain/codeSheet";
import type { LoadableSessionSelection } from "./types";

export type EditorRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type IncompleteSnippetTarget = EditorRange & {
  hash: SnippetHash;
  kind: IncompleteSnippet["kind"];
  snippet: string;
  label: string;
};

export type ImplementationFocusModel = {
  selection: LoadableSessionSelection;
  snippets: IncompleteSnippetTarget[];
};

export function createImplementationFocusModel(
  source: string,
  previousSelection: LoadableSessionSelection = { kind: "none" },
): ImplementationFocusModel {
  const snippets = incompleteSnippetTargetsForSource(source);
  return {
    snippets,
    selection: refreshImplementationSelection(source, snippets, previousSelection),
  };
}

export function refreshImplementationSelection(
  source: string,
  snippets: IncompleteSnippetTarget[],
  selection: LoadableSessionSelection,
): LoadableSessionSelection {
  if (selection.kind === "definition") {
    const target = safeImplementationTargetAtLine(source, selection.line);
    if (
      target !== null &&
      target.kind === selection.targetKind &&
      target.name === selection.name &&
      target.className === selection.className
    ) {
      return selectionFromDefinitionTarget(target);
    }
  }

  if (selection.kind === "whole-file") {
    return selection;
  }

  if (selection.kind === "snippet" && selection.hash !== null && snippets.some((snippet) => snippet.hash === selection.hash)) {
    return selection;
  }

  const firstSnippet = snippets[0];
  return firstSnippet === undefined ? { kind: "none" } : { kind: "snippet", hash: firstSnippet.hash };
}

export function selectImplementationAtPosition(
  source: string,
  snippets: IncompleteSnippetTarget[],
  lineNumber: number,
  column: number,
  lineMaxColumn?: number,
): LoadableSessionSelection {
  const exactSnippet = snippetPopupTargetForClick(snippets, lineNumber, column, lineMaxColumn);
  const context = safeSelectionContextAtPosition(source, lineNumber, column);

  if (context?.kind === "snippet" && exactSnippet) {
    return { kind: "snippet", hash: exactSnippet.hash };
  }

  if (context?.kind === "implementation") {
    return selectionFromDefinitionTarget(context.target);
  }

  return { kind: "whole-file" };
}

export function selectedSourceRange(source: string, model: ImplementationFocusModel): EditorRange | null {
  if (model.selection.kind === "snippet" && model.selection.hash !== null) {
    const selectedHash = model.selection.hash;
    const snippet = model.snippets.find((candidate) => candidate.hash === selectedHash);
    return snippet === undefined ? null : {
      startLine: snippet.startLine,
      startColumn: snippet.startColumn,
      endLine: snippet.endLine,
      endColumn: snippet.endColumn,
    };
  }

  if (model.selection.kind === "definition") {
    const target = safeImplementationTargetAtLine(source, model.selection.line);
    if (
      target === null ||
      target.kind !== model.selection.targetKind ||
      target.name !== model.selection.name ||
      target.className !== model.selection.className
    ) {
      return null;
    }

    return sourceDefinitionHighlightRange(source, target);
  }

  return null;
}

export function selectedImplementationRange(
  source: string,
  implementation: string,
  model: ImplementationFocusModel,
): EditorRange | null {
  if (model.selection.kind === "snippet" && model.selection.hash !== null) {
    const selectedHash = model.selection.hash;
    const snippet = model.snippets.find((candidate) => candidate.hash === selectedHash);
    if (!snippet) {
      return null;
    }

    const match = implementationMatchForIncompleteSnippet(source, implementation, {
      kind: snippet.kind,
      line: snippet.startLine,
      column: snippet.startColumn,
      snippet: snippet.snippet,
    });

    return implementationRangeFromMatch(implementation, match);
  }

  if (model.selection.kind === "definition") {
    const target = safeImplementationTargetAtLine(source, model.selection.line);
    if (
      target === null ||
      target.kind !== model.selection.targetKind ||
      target.name !== model.selection.name ||
      target.className !== model.selection.className
    ) {
      return null;
    }

    return implementationRangeFromMatch(implementation, implementationMatchForTarget(implementation, target));
  }

  return null;
}

export function incompleteSnippetTargetsForSource(source: string): IncompleteSnippetTarget[] {
  try {
    const parsed = parse(source);
    const compilerHashes = completionSnippetHashes(parsed);
    return parsed.incompleteSnippets.map((snippet, index) => {
      const range = snippetRange(source, snippet);
      return {
        hash: compilerHashes[index] ?? hashCompletionInput(parsed, snippet.snippet),
        startLine: range.startLine,
        startColumn: range.startColumn,
        endLine: range.endLine,
        endColumn: range.endColumn,
        kind: snippet.kind,
        snippet: snippet.snippet,
        label: incompleteSnippetLabel(snippet),
      };
    });
  } catch {
    return [];
  }
}

function implementationRangeFromMatch(
  implementation: string,
  match: { code: string; range: { start: number; end: number } | null } | null,
): EditorRange | null {
  if (
    match === null ||
    match.code === UNKNOWN_IMPLEMENTATION_MATCH_TEXT ||
    match.code.trim().length === 0 ||
    match.range === null
  ) {
    return null;
  }

  return offsetRangeToEditorRange(implementation, match.range.start, match.range.end);
}

function selectionFromDefinitionTarget(target: ImplementationTarget): LoadableSessionSelection {
  return {
    kind: "definition",
    line: target.line,
    name: target.name,
    targetKind: target.kind,
    ...(target.className === undefined ? {} : { className: target.className }),
  };
}

function sourceDefinitionHighlightRange(source: string, target: ImplementationTarget): EditorRange | null {
  const line = source.split("\n")[target.line - 1] ?? "";
  const startColumn = (line.match(/^\s*/)?.[0].length ?? 0) + 1;
  const highlightLength = firstLineLength(target.source.trimStart());
  if (highlightLength <= 0) {
    return null;
  }

  return {
    startLine: target.line,
    startColumn,
    endLine: target.line,
    endColumn: startColumn + highlightLength,
  };
}

function safeSelectionContextAtPosition(source: string, lineNumber: number, column: number) {
  try {
    return selectionContextAtPosition(source, lineNumber, column);
  } catch {
    return null;
  }
}

function safeImplementationTargetAtLine(source: string, lineNumber: number): ImplementationTarget | null {
  try {
    return implementationTargetAtLine(source, lineNumber);
  } catch {
    return null;
  }
}

function snippetPopupTargetForClick<Target extends EditorRange>(
  targets: Target[],
  lineNumber: number,
  column: number,
  lineMaxColumn?: number,
): Target | null {
  return targets.find((target) => (
    snippetTargetContainsPosition(target, lineNumber, column, lineMaxColumn)
  )) ?? null;
}

function snippetTargetContainsPosition(
  target: EditorRange,
  lineNumber: number,
  column: number,
  lineMaxColumn?: number,
): boolean {
  if (lineMaxColumn !== undefined && column >= lineMaxColumn) {
    return false;
  }

  if (lineNumber < target.startLine || lineNumber > target.endLine) {
    return false;
  }

  if (lineNumber === target.startLine && column < target.startColumn) {
    return false;
  }

  return lineNumber !== target.endLine || column < target.endColumn;
}

function incompleteSnippetLabel(snippet: IncompleteSnippet): string {
  if (snippet.kind === "natural") {
    return naturalSnippetLabelText(snippet.snippet);
  }

  const firstLine = snippet.snippet.trim().split("\n")[0] ?? "";
  const match = firstLine.match(/(?:class|def|fn|function)?\s*([A-Za-z_][\w]*)/);
  return truncateLabel(match?.[1] ?? firstLine);
}

function naturalSnippetLabelText(snippet: string): string {
  const stripped = snippet
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/^`/, "")
    .replace(/`$/, "")
    .trim();
  const lines = stripped.split("\n").map((line) => line.trim()).filter(Boolean);
  const previewLines = lines.slice(0, 2).map((line) => truncateText(line, 28));
  const suffix = lines.length > previewLines.length ? "..." : "";
  return truncateLabel(`${previewLines.join(", ")}${suffix}`);
}

function truncateText(source: string, maxLength: number): string {
  return source.length <= maxLength ? source : `${source.slice(0, Math.max(0, maxLength - 1))}...`;
}

function truncateLabel(source: string): string {
  return truncateText(source, 48);
}

function snippetRange(source: string, snippet: IncompleteSnippet): EditorRange {
  if (snippet.range) {
    return offsetRangeToEditorRange(source, snippet.range.start, snippet.range.end);
  }

  const lines = snippet.snippet.split("\n");
  const startLine = snippet.line;
  const startColumn = snippet.column ?? 1;
  const endLine = startLine + lines.length - 1;
  const endColumn = lines.length === 1
    ? startColumn + firstLineLength(snippet.snippet)
    : (lines.at(-1)?.length ?? 0) + 1;

  return { startLine, startColumn, endLine, endColumn };
}

function offsetRangeToEditorRange(source: string, start: number, end: number): EditorRange {
  const lineStarts = sourceLineStartOffsets(source);
  const startPosition = offsetToEditorPosition(lineStarts, start);
  const endPosition = offsetToEditorPosition(lineStarts, end);
  return {
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
  };
}

function sourceLineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToEditorPosition(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1,
  };
}

function firstLineLength(source: string): number {
  return source.split("\n")[0]?.length ?? source.length;
}
