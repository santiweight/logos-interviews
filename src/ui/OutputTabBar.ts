import * as React from "react";
import type { RunTab } from "./types";
import { runPanelId, runTabButtonId } from "./RunPanel";

const e = React.createElement;

type OutputTabBarProps = {
  activeTabId: string | null;
  runTabs: RunTab[];
  onSelectTab: (tabId: string | null) => void;
  onCloseRunTab: (tabId: string) => void;
};

export function OutputTabBar(props: OutputTabBarProps) {
  return e(
    "div",
    { id: "tool-tabs-list", className: "source-tabs output-tabs", role: "tablist", "aria-label": "Run output views" },
    e(
      "div",
      { className: "source-tab-shell output-tab-shell", "data-implementation-tab-shell": true },
      e(
        "button",
        {
          id: "implementation-view-tab",
          className: `source-tab output-tab${props.activeTabId === "implementation-view" ? " active" : ""}`,
          type: "button",
          role: "tab",
          "data-tool-tab-id": "implementation-view",
          "aria-selected": props.activeTabId === "implementation-view" ? "true" : "false",
          "aria-controls": "implementation-view-panel",
          onClick: () => props.onSelectTab("implementation-view"),
        },
        "Implementation",
      ),
    ),
    e(
      "div",
      { className: "source-tab-shell output-tab-shell" },
      e(
        "button",
        {
          id: "agent-view-tab",
          className: `source-tab output-tab${props.activeTabId === "agent-view" ? " active" : ""}`,
          type: "button",
          role: "tab",
          "data-tool-tab-id": "agent-view",
          "aria-selected": props.activeTabId === "agent-view" ? "true" : "false",
          "aria-controls": "agent-view-panel",
          onClick: () => props.onSelectTab("agent-view"),
        },
        "Agent View",
      ),
    ),
    props.runTabs.map((tab) =>
      e(
        "div",
        {
          key: tab.id,
          className: "source-tab-shell output-tab-shell",
          "data-run-tab-shell-id": tab.id,
        },
        e(
          "button",
          {
            id: runTabButtonId(tab.id),
            className: `source-tab output-tab${props.activeTabId === tab.id ? " active" : ""}`,
            type: "button",
            role: "tab",
            "data-run-tab-id": tab.id,
            "aria-selected": props.activeTabId === tab.id ? "true" : "false",
            "aria-controls": runPanelId(tab.id),
            onClick: () => props.onSelectTab(tab.id),
          },
          `Run ${tab.runnable}`,
        ),
        e(
          "button",
          {
            className: "source-tab-close output-tab-close",
            type: "button",
            "data-close-run-tab-id": tab.id,
            "aria-label": `Close run ${tab.runnable}`,
            onClick: (event: React.MouseEvent) => {
              event.stopPropagation();
              props.onCloseRunTab(tab.id);
            },
          },
          "×",
        ),
      ),
    ),
  );
}
