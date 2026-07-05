import * as React from "react";
import { AgentView } from "./AgentView";
import { ImplementationView } from "./ImplementationView";
import { OutputTabBar } from "./OutputTabBar";
import { RunPanel } from "./RunPanel";
import type { RunTab } from "./types";

const e = React.createElement;

type OutputPaneProps = {
  implementation: string;
  compileSessionId: string | null;
  compiling: boolean;
  runTabs: RunTab[];
  activeTabId: string | null;
  runStatusText: string;
  runStatusState: string;
  onSelectTab: (tabId: string | null) => void;
  onCloseRunTab: (tabId: string) => void;
  onRunInput: (runTabId: string, input: string) => void;
  onRunResize: (runTabId: string, cols: number, rows: number) => void;
  onShareSession: () => void;
};

export function OutputPane(props: OutputPaneProps) {
  return e(
    "section",
    { id: "output-pane", className: "output-pane", "aria-label": "Program output panel" },
    e(
      "div",
      { className: "source-tabs-bar output-tabs-bar" },
      e(OutputTabBar, {
        activeTabId: props.activeTabId,
        runTabs: props.runTabs,
        onSelectTab: props.onSelectTab,
        onCloseRunTab: props.onCloseRunTab,
      }),
      e("span", { id: "run-status", className: "status", "data-state": props.runStatusState }, props.runStatusText),
      e(
        "div",
        { className: "feedback-controls", "data-feedback-controls": "output" },
        e(
          "button",
          {
            className: "feedback-button share-button",
            type: "button",
            "data-share-session": true,
            "aria-label": "Share session link",
            title: "Share link",
            onClick: props.onShareSession,
          },
          "Share",
        ),
      ),
    ),
    e(
      "div",
      { id: "tool-panels", className: "tool-panels" },
      e(ImplementationView, {
        implementation: props.implementation,
        compiling: props.compiling,
        active: props.activeTabId === "implementation-view",
      }),
      e(AgentView, {
        compileSessionId: props.compileSessionId,
        active: props.activeTabId === "agent-view",
      }),
      props.runTabs.map((tab) =>
        e(RunPanel, {
          key: tab.id,
          tab,
          active: props.activeTabId === tab.id,
          onInput: props.onRunInput,
          onResize: props.onRunResize,
        }),
      ),
      e(
        "pre",
        {
          id: "run-placeholder",
          className: `output run-placeholder tab-panel${props.activeTabId === null ? " active" : ""}`,
          "aria-live": "polite",
        },
        "Runs will appear here.",
      ),
    ),
  );
}
