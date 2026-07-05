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
  onChange: (source: string) => void;
  onRun: (runnable: Runnable) => void;
  onPointerDown?: () => void;
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
    const widgetsRef = React.useRef<monaco.editor.IContentWidget[]>([]);
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
        glyphMargin: true,
        lineNumbers: "off",
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
      return () => {
        for (const widget of widgetsRef.current) editor.removeContentWidget(widget);
        widgetsRef.current = [];
        changeDisposable.dispose();
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
      for (const widget of widgetsRef.current) editor.removeContentWidget(widget);
      const states = runnableStates(props.source, props.implementation, props.compiling);
      widgetsRef.current = states.map((state) => createRunWidget(editor, state, props.onRun));
      for (const widget of widgetsRef.current) editor.addContentWidget(widget);
    }, [props.source, props.implementation, props.compiling, props.onRun]);

    return e("div", {
      id: "editor",
      ref: hostRef,
      className: "editor",
      "aria-label": "Code editor",
      onPointerDown: props.onPointerDown,
    });
  },
);

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

function createRunWidget(
  editor: monaco.editor.IStandaloneCodeEditor,
  runnable: RunnableState,
  onRun: (runnable: Runnable) => void,
): monaco.editor.IContentWidget {
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

  return {
    allowEditorOverflow: true,
    suppressMouseDown: true,
    getId: () => `runnable-run-widget-${runnable.line}-${runnable.name}`,
    getDomNode: () => node,
    getPosition: () => ({
      position: {
        lineNumber: runnable.line,
        column: Math.max(1, editor.getModel()?.getLineMaxColumn(runnable.line) ?? 1),
      },
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW,
      ],
    }),
  };
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
