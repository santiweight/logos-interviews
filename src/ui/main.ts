import "./styles.css";
import "@xterm/xterm/css/xterm.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  defineInterviewLightTheme,
  registerLogosTypeScriptLanguage,
} from "./monacoLogosLanguage";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

registerLogosTypeScriptLanguage();
defineInterviewLightTheme();

const root = document.querySelector("#app");
if (!root) {
  throw new Error("Missing #app root");
}

createRoot(root).render(React.createElement(App));
