import * as React from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import radixThemesCss from "@radix-ui/themes/styles.css?inline";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip,
} from "@radix-ui/themes";
import { iframeScrollbarCss } from "./scrollbars";
import type { RunTab } from "./types";

const e = React.createElement;

const logosRadix = {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Popover,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip,
};

type RunPanelProps = {
  tab: RunTab;
  active: boolean;
  onInput: (runTabId: string, input: string) => void;
  onResize: (runTabId: string, cols: number, rows: number) => void;
};

export function RunPanel({ tab, active, onInput, onResize }: RunPanelProps) {
  return e(
    "div",
    {
      id: runPanelId(tab.id),
      className: `output terminal-output tab-panel${active ? " active" : ""}${tab.renderMode === "react" ? " react-app-mode" : " terminal-xterm-mode"}${tab.status?.state === "running" ? " terminal-running" : ""}`,
      role: "tabpanel",
      "data-run-panel-id": tab.id,
      "aria-labelledby": runTabButtonId(tab.id),
      "aria-live": "polite",
      onClick: () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          `[data-run-panel-id="${cssEscape(tab.id)}"] .xterm-helper-textarea`,
        );
        textarea?.focus();
      },
    },
    e(TerminalPanel, { tab, hidden: tab.renderMode !== "terminal", onInput, onResize }),
    e(
      "div",
      {
        className: "react-app-run-host",
        hidden: tab.renderMode !== "react",
        "data-react-run-host-id": tab.id,
      },
      tab.renderMode === "react" && tab.reactAppCode
        ? e(ReactAppFrame, { appCode: tab.reactAppCode, runnable: tab.runnable })
        : null,
    ),
  );
}

function TerminalPanel(props: {
  tab: RunTab;
  hidden: boolean;
  onInput: (runTabId: string, input: string) => void;
  onResize: (runTabId: string, cols: number, rows: number) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const renderedLengthRef = React.useRef(0);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current || props.hidden) return;

    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      convertEol: false,
      fontFamily: terminalFontFamily(),
      fontSize: 14,
      lineHeight: 1.12,
      theme: {
        background: "#111827",
        foreground: "#f9fafb",
        cursor: "#f9fafb",
        selectionBackground: "#2563eb",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        props.onInput(props.tab.id, event.shiftKey ? "\x1b[Z" : "\t");
        terminal.focus();
        requestAnimationFrame(() => terminal.focus());
        return false;
      }
      return true;
    });
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    const inputDisposable = terminal.onData((input) => props.onInput(props.tab.id, input));

    const fit = () => {
      try {
        fitAddon.fit();
        props.onResize(props.tab.id, terminal.cols, terminal.rows);
      } catch {
        // Ignore fit failures while the panel is hidden or mid-layout.
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    requestAnimationFrame(fit);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      renderedLengthRef.current = 0;
    };
  }, [props.hidden, props.tab.id]);

  React.useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const next = props.tab.terminalText;
    const previousLength = renderedLengthRef.current;
    if (next.length < previousLength) {
      terminal.reset();
      terminal.write(next);
    } else if (next.length > previousLength) {
      terminal.write(next.slice(previousLength));
    }
    renderedLengthRef.current = next.length;
  }, [props.tab.terminalText]);

  React.useEffect(() => {
    if (!props.hidden) requestAnimationFrame(() => fitRef.current?.fit());
  }, [props.hidden]);

  return e("div", {
    ref: hostRef,
    className: "terminal-xterm-host",
    hidden: props.hidden,
    "data-run-xterm-id": props.tab.id,
  });
}

function ReactAppFrame(props: { appCode: string; runnable: string }) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [iframeBody, setIframeBody] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    doc.open();
    doc.write(`<!doctype html><html><head><style>
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
body {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: auto;
}
body > * {
  min-height: 100%;
}
${styleTagContent(iframeScrollbarCss)}
${styleTagContent(radixThemesCss)}
</style></head><body></body></html>`);
    doc.close();
    setIframeBody(doc.body);
  }, [props.appCode]);

  let element: React.ReactNode = null;
  try {
    const run = new Function("React", "radix", `${props.appCode}\nreturn ${props.runnable}();`);
    element = run(React, logosRadix) as React.ReactNode;
  } catch (error) {
    element = e(
      "pre",
      {
        style: {
          boxSizing: "border-box",
          minHeight: "100vh",
          margin: 0,
          padding: 16,
          color: "#991b1b",
          background: "#fef2f2",
          whiteSpace: "pre-wrap",
          font: "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
      },
      error instanceof Error && error.stack ? error.stack : String(error),
    );
  }

  return e(
    React.Fragment,
    null,
    e("iframe", {
      ref: iframeRef,
      className: "react-app-run-frame",
      title: `Run ${props.runnable}`,
    }),
    iframeBody
      ? createPortal(
          e(Theme, { appearance: "light", accentColor: "blue", grayColor: "slate" }, element),
          iframeBody,
        )
      : null,
  );
}

export function runTabButtonId(runTabId: string): string {
  return `${runTabId}-tab`;
}

export function runPanelId(runTabId: string): string {
  return `${runTabId}-panel`;
}

function terminalFontFamily(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--terminal-font")
    .trim();
  return value || 'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
}

function styleTagContent(css: string): string {
  return css.replaceAll("</style", "<\\/style");
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replaceAll('"', '\\"');
}
