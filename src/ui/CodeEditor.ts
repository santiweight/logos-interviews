import * as React from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  definitionReadiness,
  definitionReadinessFromImplementation,
  parse,
  runnables,
  type DefinitionReadiness,
  type Runnable,
} from "../codeSheet";
import { logosTypeScriptLanguageId } from "./monacoLogosLanguage";
import { installMonacoShortcutGuard } from "./monacoShortcutGuard";
import { sleekMonacoScrollbar } from "./scrollbars";
import type { EditorRange } from "./implementationFocus";
import type { EditorSnapshot } from "./types";

const e = React.createElement;

export type CodeEditorHandle = {
  setValue: (source: string) => void;
  snapshot: () => EditorSnapshot;
  restoreSnapshot: (snapshot: Partial<EditorSnapshot>) => void;
  layout: () => void;
};

type CodeEditorProps = {
  source: string;
  implementation: string;
  compiling: boolean;
  selectedRange: EditorRange | null;
  onChange: (source: string) => void;
  onRun: (runnable: Runnable) => void;
  onPointerDown?: () => void;
  onImplementationSelect?: (lineNumber: number, column: number, lineMaxColumn?: number) => void;
};

type RunnableState = {
  name: Runnable;
  line: number;
  ready: boolean;
  compiling: boolean;
  blockingDependencies: string[];
};

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(props, ref) {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const viewZoneIdsRef = React.useRef<string[]>([]);
    const selectedDecorationsRef = React.useRef<string[]>([]);
    const suppressChangeRef = React.useRef(false);
    const onChangeRef = React.useRef(props.onChange);
    const propsRef = React.useRef(props);

    onChangeRef.current = props.onChange;
    propsRef.current = props;

    React.useImperativeHandle(ref, () => ({
      setValue(source: string) {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== source) {
          suppressChangeRef.current = true;
          editor.setValue(source);
          suppressChangeRef.current = false;
        }
      },
      snapshot() {
        const editor = editorRef.current;
        const position = editor?.getPosition() ?? null;
        return {
          value: editor?.getValue() ?? propsRef.current.source,
          cursor: position,
          scrollTop: editor?.getScrollTop() ?? 0,
          scrollLeft: editor?.getScrollLeft() ?? 0,
        };
      },
      restoreSnapshot(snapshot: Partial<EditorSnapshot>) {
        const editor = editorRef.current;
        if (!editor) return;
        if (snapshot.cursor) {
          editor.setPosition(snapshot.cursor);
          editor.revealPositionInCenterIfOutsideViewport(snapshot.cursor);
        }
        if (typeof snapshot.scrollTop === "number") editor.setScrollTop(snapshot.scrollTop);
        if (typeof snapshot.scrollLeft === "number") editor.setScrollLeft(snapshot.scrollLeft);
      },
      layout() {
        editorRef.current?.layout();
      },
    }));

    React.useEffect(() => {
      const host = hostRef.current;
      if (!host || editorRef.current) return;

      installMonacoShortcutGuard(host);

      const editor = monaco.editor.create(host, {
        value: props.source,
        language: logosTypeScriptLanguageId,
        theme: "interview-light",
        automaticLayout: true,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: 14,
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        wrappingIndent: "same",
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
      editorRef.current = editor;

      const changeDisposable = editor.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return;
        onChangeRef.current(editor.getValue());
      });
      const mouseDisposable = editor.onMouseDown((event) => {
        if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          return;
        }

        const position = event.target.position;
        if (!position) {
          return;
        }

        const lineMaxColumn = editor.getModel()?.getLineMaxColumn(position.lineNumber);
        propsRef.current.onImplementationSelect?.(position.lineNumber, position.column, lineMaxColumn);
      });
      return () => {
        editor.changeViewZones((accessor) => {
          for (const id of viewZoneIdsRef.current) accessor.removeZone(id);
          viewZoneIdsRef.current = [];
        });
        changeDisposable.dispose();
        mouseDisposable.dispose();
        editor.dispose();
        editorRef.current = null;
      };
    }, []);

    React.useEffect(() => {
      const editor = editorRef.current;
      if (!editor || editor.getValue() === props.source) return;
      suppressChangeRef.current = true;
      editor.setValue(props.source);
      suppressChangeRef.current = false;
    }, [props.source]);

    React.useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const states = runnableStates(props.source, props.implementation, props.compiling);
      editor.changeViewZones((accessor) => {
        for (const id of viewZoneIdsRef.current) accessor.removeZone(id);
        viewZoneIdsRef.current = states.map((state) =>
          accessor.addZone({
            afterLineNumber: Math.max(0, state.line - 1),
            heightInPx: 22,
            domNode: createRunWidget(state, props.onRun),
          }),
        );
      });
    }, [props.source, props.implementation, props.compiling, props.onRun]);

    React.useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;

      selectedDecorationsRef.current = editor.deltaDecorations(
        selectedDecorationsRef.current,
        props.selectedRange === null
          ? []
          : [{
              range: monacoRange(props.selectedRange),
              options: {
                isWholeLine: false,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                inlineClassName: "snippet-source-inline-selected",
              },
            }],
      );
    }, [props.selectedRange]);

    return e("div", {
      id: "editor",
      ref: hostRef,
      className: "editor",
      "aria-label": "Code editor",
      onPointerDown: props.onPointerDown,
    });
  },
);

function monacoRange(range: EditorRange): monaco.Range {
  return new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
}

function runnableStates(source: string, implementation: string, compiling: boolean): RunnableState[] {
  const readiness = readinessForSource(source, implementation);
  const readinessByName = new Map(readiness.map((item) => [item.name, item]));
  return runnables(source).map((runnable) => {
    const state = readinessByName.get(runnable.name);
    return {
      name: runnable.name,
      line: runnable.line,
      ready: !compiling && (state?.ready ?? false),
      compiling,
      blockingDependencies: state?.blockingDependencies ?? [],
    };
  });
}

function readinessForSource(source: string, implementation: string): DefinitionReadiness[] {
  try {
    const parsed = parse(source);
    if (implementation.trim().length === 0) {
      return definitionReadiness(parsed, new Map());
    }
    try {
      return definitionReadinessFromImplementation(parsed, implementation);
    } catch {
      return definitionReadiness(parsed, new Map());
    }
  } catch {
    return [];
  }
}

function createRunWidget(runnable: RunnableState, onRun: (runnable: Runnable) => void): HTMLElement {
  const zone = document.createElement("div");
  zone.className = "runnable-run-zone";

  const node = document.createElement("button");
  node.className = runnable.ready
    ? "runnable-run-widget"
    : "runnable-run-widget runnable-run-widget-disabled";
  node.type = "button";
  node.textContent = `▶ Run ${displayName(runnable.name)}`;
  node.title = runnable.ready ? `Run ${runnable.name}` : disabledTitle(runnable);
  node.dataset.ready = runnable.ready ? "true" : "false";
  node.setAttribute("aria-disabled", runnable.ready ? "false" : "true");
  node.addEventListener("mousedown", (event) => event.preventDefault());
  node.addEventListener("click", () => {
    if (runnable.ready) onRun(runnable.name);
  });

  zone.append(node);
  return zone;
}

function displayName(name: string): string {
  return name.length === 0 ? name : `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
}

function disabledTitle(runnable: RunnableState): string {
  if (runnable.compiling) return "Claude is still compiling this sheet.";
  if (runnable.blockingDependencies.length > 0) {
    return `${runnable.name} is waiting for ${runnable.blockingDependencies.join(", ")}.`;
  }
  return `${runnable.name} is waiting for its implementation.`;
}
