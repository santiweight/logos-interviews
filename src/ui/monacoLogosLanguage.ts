import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  conf as typeScriptLanguageConfiguration,
  language as typeScriptLanguage,
} from "monaco-editor/esm/vs/basic-languages/typescript/typescript.js";

export const logosTypeScriptLanguageId = "logos-typescript";

export function registerLogosTypeScriptLanguage(): void {
  if (monaco.languages.getLanguages().some((language) => language.id === logosTypeScriptLanguageId)) {
    return;
  }

  monaco.languages.register({
    id: logosTypeScriptLanguageId,
    aliases: ["Logos TypeScript", "logos-typescript"],
    mimetypes: ["text/x-logos-typescript"],
  });
  monaco.languages.setLanguageConfiguration(
    logosTypeScriptLanguageId,
    typeScriptLanguageConfiguration,
  );
  monaco.languages.setMonarchTokensProvider(logosTypeScriptLanguageId, {
    ...typeScriptLanguage,
    tokenPostfix: ".logos-typescript",
    tokenizer: {
      ...typeScriptLanguage.tokenizer,
      root: [
        typeScriptLanguage.tokenizer.root[0],
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"],
        [/\bl`/, "naturalSnippet.delimiter", "@logosNaturalSnippet"],
        ...typeScriptLanguage.tokenizer.root.slice(1),
      ],
      logosNaturalSnippet: [
        [/[^`]+/, "naturalSnippet"],
        [/`/, "naturalSnippet.delimiter", "@pop"],
      ],
    },
  });
}

export function defineInterviewLightTheme(): void {
  monaco.editor.defineTheme("interview-light", {
    base: "vs",
    inherit: false,
    rules: [
      { token: "", foreground: "20242a" },
      { token: "comment", foreground: "6f7f68" },
      { token: "keyword", foreground: "7a5268", fontStyle: "normal" },
      { token: "identifier", foreground: "20242a" },
      { token: "number", foreground: "3f6f6a" },
      { token: "number.hex", foreground: "3f6f6a" },
      { token: "string", foreground: "7a5a3a" },
      { token: "string.escape", foreground: "8a6844" },
      { token: "delimiter", foreground: "aca59b" },
      { token: "delimiter.curly", foreground: "aca59b" },
      { token: "delimiter.bracket", foreground: "aca59b" },
      { token: "delimiter.parenthesis", foreground: "aca59b" },
      { token: "operator", foreground: "8e8375" },
      { token: "type", foreground: "3f6f6a" },
      { token: "predefined", foreground: "4f677c" },
      { token: "naturalSnippet", foreground: "b74716" },
      { token: "naturalSnippet.delimiter", foreground: "9b4d2e" },
      { token: "comment.logos-typescript", foreground: "6f7f68" },
      {
        token: "keyword.logos-typescript",
        foreground: "7a5268",
        fontStyle: "normal",
      },
      { token: "identifier.logos-typescript", foreground: "20242a" },
      { token: "number.logos-typescript", foreground: "3f6f6a" },
      { token: "number.hex.logos-typescript", foreground: "3f6f6a" },
      { token: "string.logos-typescript", foreground: "7a5a3a" },
      { token: "string.escape.logos-typescript", foreground: "8a6844" },
      { token: "delimiter.logos-typescript", foreground: "aca59b" },
      { token: "delimiter.curly.logos-typescript", foreground: "aca59b" },
      { token: "delimiter.bracket.logos-typescript", foreground: "aca59b" },
      { token: "delimiter.parenthesis.logos-typescript", foreground: "aca59b" },
      { token: "operator.logos-typescript", foreground: "8e8375" },
      { token: "type.logos-typescript", foreground: "3f6f6a" },
      { token: "predefined.logos-typescript", foreground: "4f677c" },
      { token: "naturalSnippet.logos-typescript", foreground: "b74716" },
      {
        token: "naturalSnippet.delimiter.logos-typescript",
        foreground: "9b4d2e",
      },
    ],
    colors: {
      "editor.background": "#fbfaf6",
      "editorGutter.background": "#fbfaf6",
      "editor.foreground": "#20242a",
      "editorLineNumber.foreground": "#74767a",
      "editorLineNumber.activeForeground": "#07080a",
      "editor.selectionBackground": "#d8e3eb",
      "editor.lineHighlightBackground": "#f1eee7",
      "editor.wordHighlightBackground": "#00000000",
      "editor.wordHighlightStrongBackground": "#00000000",
      "editor.wordHighlightTextBackground": "#00000000",
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#00000000",
      "editorBracketHighlight.foreground1": "#aca59b",
      "editorBracketHighlight.foreground2": "#aca59b",
      "editorBracketHighlight.foreground3": "#aca59b",
      "editorBracketHighlight.foreground4": "#aca59b",
      "editorBracketHighlight.foreground5": "#aca59b",
      "editorBracketHighlight.foreground6": "#aca59b",
      "editorBracketHighlight.unexpectedBracket.foreground": "#aca59b",
      "editorIndentGuide.background1": "#e2ddd4",
      "editorIndentGuide.activeBackground1": "#adc0d6",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#5b606933",
      "scrollbarSlider.hoverBackground": "#5b60694d",
      "scrollbarSlider.activeBackground": "#5b606966",
    },
  });
}
