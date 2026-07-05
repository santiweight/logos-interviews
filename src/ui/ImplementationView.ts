import * as React from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { logosTypeScriptLanguageId } from "./monacoLogosLanguage";
import { sleekMonacoScrollbar } from "./scrollbars";

const e = React.createElement;

type ImplementationViewProps = {
  implementation: string;
  compiling: boolean;
  active: boolean;
};

export function ImplementationView({ implementation, compiling, active }: ImplementationViewProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

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

  return e("div", {
    id: "implementation-view-panel",
    ref: hostRef,
    className: `output implementation-output tab-panel${active ? " active" : ""}`,
    role: "tabpanel",
    "aria-labelledby": "implementation-view-tab",
    "aria-live": "polite",
  });
}

function implementationText(implementation: string, compiling: boolean): string {
  if (implementation.trim().length > 0) return implementation;
  return compiling ? "Code is being generated..." : "No implementation yet.";
}
