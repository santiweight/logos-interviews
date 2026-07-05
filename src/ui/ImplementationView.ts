import * as React from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { EditorRange } from "./implementationFocus";
import { logosTypeScriptLanguageId } from "./monacoLogosLanguage";
import { sleekMonacoScrollbar } from "./scrollbars";

const e = React.createElement;

type ImplementationViewProps = {
  implementation: string;
  focusRange: EditorRange | null;
  compiling: boolean;
  active: boolean;
};

export function ImplementationView({ implementation, focusRange, compiling, active }: ImplementationViewProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || editorRef.current) return;

    editorRef.current = monaco.editor.create(host, {
      value: implementationText(implementation, compiling),
      language: logosTypeScriptLanguageId,
      theme: "interview-light",
      automaticLayout: true,
      readOnly: true,
      domReadOnly: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: true,
      lineNumbers: "off",
      scrollbar: sleekMonacoScrollbar,
      folding: false,
      matchBrackets: "never",
      occurrencesHighlight: "off",
      selectionHighlight: false,
      bracketPairColorization: { enabled: false },
      padding: { top: 12, bottom: 12 },
    });

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const next = implementationText(implementation, compiling);
    const editor = editorRef.current;
    if (editor && editor.getValue() !== next) {
      editor.setValue(next);
    }
  }, [implementation, compiling]);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      focusRange === null
        ? []
        : [{
            range: monacoRange(focusRange),
            options: {
              isWholeLine: false,
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              className: "snippet-source-inline-selected",
              inlineClassName: "snippet-source-inline-selected",
            },
          }],
    );

    if (focusRange !== null && active) {
      revealRangeIfNeeded(editor, monacoRange(focusRange));
      return;
    }

    if (focusRange === null) {
      editor.setScrollTop(editor.getScrollHeight());
    }
  }, [focusRange, active, implementation, compiling]);

  return e(
    "div",
    {
      id: "implementation-view-panel",
      ref: hostRef,
      className: `output implementation-output tab-panel${active ? " active" : ""}`,
      role: "tabpanel",
      "aria-labelledby": "implementation-view-tab",
      "aria-live": "polite",
    },
  );
}

function monacoRange(range: EditorRange): monaco.Range {
  return new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
}

function revealRangeIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, range: monaco.Range): void {
  if (rangeHasFullyVisibleLine(editor, range)) {
    return;
  }

  editor.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate);
  editor.setSelection(range);
}

function rangeHasFullyVisibleLine(editor: monaco.editor.IStandaloneCodeEditor, range: monaco.Range): boolean {
  const model = editor.getModel();
  if (!model) {
    return false;
  }

  const lineCount = model.getLineCount();
  const startLineNumber = Math.max(1, Math.min(range.startLineNumber, lineCount));
  const endLineNumber = Math.max(
    startLineNumber,
    Math.min(range.endColumn <= 1 && range.endLineNumber > startLineNumber
      ? range.endLineNumber - 1
      : range.endLineNumber, lineCount),
  );
  const viewportTop = editor.getScrollTop();
  const viewportBottom = viewportTop + editor.getLayoutInfo().height;
  const tolerance = 0.5;

  for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
    const lineTop = editor.getTopForLineNumber(lineNumber);
    const lineBottom = editor.getBottomForLineNumber(lineNumber);
    if (lineTop >= viewportTop - tolerance && lineBottom <= viewportBottom + tolerance) {
      return true;
    }
  }

  return false;
}

function implementationText(implementation: string, compiling: boolean): string {
  if (implementation.trim().length > 0) return implementation;
  return compiling ? "Code is being generated..." : "No implementation yet.";
}
