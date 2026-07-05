import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const sleekMonacoScrollbar: monaco.editor.IEditorScrollbarOptions = {
  arrowSize: 0,
  horizontal: "auto",
  horizontalScrollbarSize: 8,
  horizontalSliderSize: 8,
  vertical: "auto",
  verticalScrollbarSize: 8,
  verticalSliderSize: 8,
  useShadows: false,
};

export const iframeScrollbarCss = `
:root {
  scrollbar-color: rgba(91, 96, 105, 0.42) transparent;
}

* {
  scrollbar-width: thin;
  scrollbar-color: rgba(91, 96, 105, 0.42) transparent;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  min-width: 44px;
  min-height: 44px;
  border: 3px solid transparent;
  border-radius: 999px;
  background: rgba(91, 96, 105, 0.36);
  background-clip: content-box;
}

*::-webkit-scrollbar-thumb:hover {
  background-color: rgba(91, 96, 105, 0.56);
}
`;
