import * as React from "react";
import { sampleTemplateGroups, samples } from "../samples";
import type { SourceTab } from "./types";

const e = React.createElement;

type SheetTabBarProps = {
  sheets: SourceTab[];
  activeSheetId: string | null;
  compilingSheetIds: Set<string>;
  onSelectSheet: (sheetId: string) => void;
  onCloseSheet: (sheetId: string) => void;
  onAddScratch: () => void;
  onOpenTemplate: (sampleId: string) => void;
};

export function SheetTabBar(props: SheetTabBarProps) {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));

  return e(
    "div",
    { className: "source-tabs-bar" },
    e(
      "div",
      { id: "source-tabs", className: "source-tabs", role: "tablist", "aria-label": "Open source projects" },
      props.sheets.map((sheet) => {
        const selected = sheet.id === props.activeSheetId;
        const compiling = props.compilingSheetIds.has(sheet.id);
        return e(
          "div",
          {
            key: sheet.id,
            className: "source-tab-shell",
            role: "presentation",
            draggable: true,
            "data-source-tab-shell-id": sheet.id,
          },
          e(
            "button",
            {
              className: `source-tab${selected ? " active" : ""}${compiling ? " source-tab-compiling" : ""}`,
              type: "button",
              role: "tab",
              "aria-selected": selected ? "true" : "false",
              "data-source-tab-id": sheet.id,
              onClick: () => props.onSelectSheet(sheet.id),
            },
            sheet.title,
          ),
          compiling
            ? e("button", {
                className: "source-tab-compiling-indicator",
                type: "button",
                tabIndex: -1,
                "aria-label": `${sheet.title} is compiling`,
                "aria-disabled": "true",
                title: "Compiling",
              })
            : null,
          e(
            "button",
            {
              className: "source-tab-close",
              type: "button",
              "aria-label": `Close ${sheet.title}`,
              "data-close-tab-id": sheet.id,
              onClick: (event: React.MouseEvent) => {
                event.stopPropagation();
                props.onCloseSheet(sheet.id);
              },
            },
            "×",
          ),
        );
      }),
    ),
    e(
      "details",
      { id: "sample-menu", className: "sample-menu" },
      e(
        "summary",
        { className: "source-add-tab", "aria-label": "Add file", title: "Add file" },
        "+",
      ),
      e(
        "div",
        { className: "menu-popover sample-popover", role: "menu" },
        e(
          "div",
          { className: "menu-section" },
          e(
            "button",
            {
              id: "scratch-file-button",
              className: "menu-item scratch-file-menu-item",
              type: "button",
              role: "menuitem",
              onClick: props.onAddScratch,
            },
            e("span", { className: "menu-item-icon", "aria-hidden": "true" }, "+"),
            e("span", null, "Scratch new file"),
          ),
          e("div", { className: "menu-separator", role: "separator" }),
          e("div", { className: "menu-section-title" }, "Templates"),
          sampleTemplateGroups.map((group) =>
            e(
              "details",
              { key: group.label, className: "sample-menu-group", open: true },
              e(
                "summary",
                { className: "sample-menu-group-title" },
                e("span", null, group.label),
                e("span", { className: "sample-menu-group-chevron", "aria-hidden": "true" }, "›"),
              ),
              e(
                "div",
                { className: "sample-menu-list" },
                group.sampleIds.map((sampleId) => {
                  const sample = sampleById.get(sampleId);
                  if (!sample) return null;
                  return e(
                    "button",
                    {
                      key: sample.id,
                      className: "menu-item sample-menu-item",
                      type: "button",
                      role: "menuitem",
                      "data-sample-id": sample.id,
                      onClick: () => props.onOpenTemplate(sample.id),
                    },
                    sample.label,
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
