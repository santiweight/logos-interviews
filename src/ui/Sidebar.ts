import * as React from "react";
import type { CompilationMode } from "./types";

const e = React.createElement;

export type PageEntry = {
  id: string;
  title: string;
};

type SidebarProps = {
  pages: PageEntry[];
  activePageId: string;
  collapsed: boolean;
  compilationStrategy: CompilationMode;
  onSelectPage: (pageId: string) => void;
  onToggleCollapse: () => void;
  onChangeCompilationStrategy: (strategy: CompilationMode) => void;
  onCopySessionId: () => void;
  onClearCodeCache: () => void;
  onResetWorkspace: () => void;
};

const strategies: Array<{ value: CompilationMode; label: string }> = [
  { value: "parallel", label: "Parallel (default)" },
  { value: "sequential", label: "Sequential" },
  { value: "agentic", label: "Agentic" },
  { value: "parallel-methods", label: "Parallel methods" },
  { value: "agentic-methods", label: "Agentic methods" },
];

export function Sidebar(props: SidebarProps) {
  return e(
    "aside",
    { className: "app-sidebar", "aria-label": "Application pages" },
    e(
      "div",
      { className: "app-sidebar-brand" },
      e(
        "span",
        { className: "logos-wordmark" },
        e("span", { className: "logos-mark" }, "λ"),
        e("span", { className: "logos-name" }, "ogos"),
      ),
      e(
        "button",
        {
          id: "sidebar-collapse-button",
          className: "sidebar-collapse-button",
          type: "button",
          "aria-label": props.collapsed ? "Expand sidebar" : "Collapse sidebar",
          "aria-expanded": props.collapsed ? "false" : "true",
          title: props.collapsed ? "Expand sidebar" : "Collapse sidebar",
          onClick: props.onToggleCollapse,
        },
        e("span", { className: "sidebar-toggle-icon", "aria-hidden": "true" }, "‹"),
      ),
    ),
    e(
      "nav",
      { id: "app-nav", className: "app-nav", "aria-label": "Pages" },
      props.pages.map((page) =>
        e(
          "button",
          {
            key: page.id,
            className: `app-nav-item${page.id === props.activePageId ? " active" : ""}`,
            type: "button",
            "aria-current": page.id === props.activePageId ? "page" : undefined,
            "data-app-page": page.id,
            onClick: () => props.onSelectPage(page.id),
          },
          e("span", null, page.title),
        ),
      ),
    ),
    e(
      "div",
      { className: "app-sidebar-footer" },
      e(
        "details",
        { id: "workspace-menu", className: "workspace-menu" },
        e(
          "summary",
          {
            className: "sidebar-menu-trigger",
            "aria-label": "Open settings menu",
            title: "Settings",
          },
          e("span", { className: "workspace-menu-icon", "aria-hidden": "true" }, "⚙"),
          e("span", { className: "sidebar-menu-label" }, "Settings"),
        ),
        e(
          "div",
          { className: "menu-popover workspace-popover", role: "menu" },
          e(
            "label",
            { className: "settings-toggle menu-setting-row", htmlFor: "compilation-strategy-select" },
            e(
              "span",
              { className: "settings-toggle-copy" },
              e("span", { className: "settings-toggle-title" }, "Code generation strategy"),
              e("span", { className: "settings-toggle-description" }, "Choose how Logos compiles this sheet."),
            ),
            e(
              "select",
              {
                id: "compilation-strategy-select",
                className: "settings-select",
                value: props.compilationStrategy,
                onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                  props.onChangeCompilationStrategy(event.target.value as CompilationMode),
              },
              strategies.map((strategy) =>
                e("option", { key: strategy.value, value: strategy.value }, strategy.label),
              ),
            ),
          ),
          e("div", { className: "menu-separator", role: "separator" }),
          e(
            "button",
            {
              id: "copy-session-id-button",
              className: "menu-item",
              type: "button",
              role: "menuitem",
              onClick: props.onCopySessionId,
            },
            "Copy session ID",
          ),
          e(
            "button",
            {
              id: "clear-code-cache-button",
              className: "menu-item",
              type: "button",
              role: "menuitem",
              onClick: props.onClearCodeCache,
            },
            "Clear code cache",
          ),
          e(
            "button",
            {
              id: "reset-workspace-button",
              className: "menu-item menu-item-danger",
              type: "button",
              role: "menuitem",
              onClick: props.onResetWorkspace,
            },
            "Reset workspace",
          ),
        ),
      ),
    ),
  );
}
