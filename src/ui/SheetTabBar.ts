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
  onMoveSheet: (sheetId: string, insertIndex: number) => void;
  onAddScratch: () => void;
  onOpenTemplate: (sampleId: string) => void;
};

type DropSlot = {
  insertIndex: number;
  markerX: number;
  isNoop: boolean;
};

export function SheetTabBar(props: SheetTabBarProps) {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
  const tabListRef = React.useRef<HTMLDivElement | null>(null);
  const draggedSheetIdRef = React.useRef<string | null>(null);
  const [draggedSheetId, setDraggedSheetId] = React.useState<string | null>(null);
  const [dropSlot, setDropSlot] = React.useState<DropSlot | null>(null);
  const [separatorPositions, setSeparatorPositions] = React.useState<number[]>([]);

  const measureSeparators = React.useCallback(() => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    tabList.style.setProperty("--tab-hairline-width", devicePixelWidth(1));
    tabList.closest<HTMLElement>(".source-tabs-bar")?.style.setProperty("--tab-hairline-width", devicePixelWidth(1));

    const shells = Array.from(tabList.querySelectorAll<HTMLElement>("[data-source-tab-shell-id]"));
    const stripRect = tabList.getBoundingClientRect();
    const nextPositions = shells.length === 0
      ? []
      : shells
          .slice(1)
          .map((shell) => sourceTabRelativeX(shell.getBoundingClientRect().left, stripRect, tabList))
          .concat(sourceTabRelativeX(shells[shells.length - 1].getBoundingClientRect().right, stripRect, tabList));

    setSeparatorPositions((current) => sameNumberList(current, nextPositions) ? current : nextPositions);
  }, []);

  React.useLayoutEffect(() => {
    measureSeparators();
    const tabList = tabListRef.current;
    if (!tabList) return;

    const resizeObserver = new ResizeObserver(measureSeparators);
    resizeObserver.observe(tabList);
    tabList.querySelectorAll<HTMLElement>("[data-source-tab-shell-id]").forEach((shell) => {
      resizeObserver.observe(shell);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [props.sheets, props.activeSheetId, props.compilingSheetIds, measureSeparators]);

  const clearDragState = React.useCallback(() => {
    draggedSheetIdRef.current = null;
    setDraggedSheetId(null);
    setDropSlot(null);
  }, []);

  const dropMarkerActive = dropSlot !== null && !dropSlot.isNoop;
  const tabListStyle = dropMarkerActive
    ? {
        "--source-tab-drop-x": `${dropSlot.markerX}px`,
        "--source-tab-drop-width": devicePixelWidth(2),
        "--source-tab-drop-offset": `-${devicePixelWidth(1)}`,
      } as React.CSSProperties
    : undefined;

  return e(
    "div",
    { className: "source-tabs-bar" },
    e(
      "div",
      {
        id: "source-tabs",
        ref: tabListRef,
        className: `source-tabs${draggedSheetId ? " source-tabs-dragging" : ""}${dropMarkerActive ? " source-tabs-drop-active" : ""}`,
        role: "tablist",
        "aria-label": "Open source projects",
        style: tabListStyle,
        onScroll: measureSeparators,
        onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
          if (!draggedSheetIdRef.current) return;
          const slot = sourceTabDropSlot(event.clientX, draggedSheetIdRef.current, props.sheets, tabListRef.current);
          if (!slot) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          setDropSlot(slot);
        },
        onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
          const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
            setDropSlot(null);
          }
        },
        onDrop: (event: React.DragEvent<HTMLDivElement>) => {
          const draggedId = draggedSheetIdRef.current;
          if (!draggedId) return;
          const slot = sourceTabDropSlot(event.clientX, draggedId, props.sheets, tabListRef.current);
          if (!slot) {
            clearDragState();
            return;
          }
          event.preventDefault();
          if (!slot.isNoop) {
            props.onMoveSheet(draggedId, slot.insertIndex);
          }
          clearDragState();
        },
        onDragEnd: clearDragState,
      },
      props.sheets.map((sheet) => {
        const selected = sheet.id === props.activeSheetId;
        const compiling = props.compilingSheetIds.has(sheet.id);
        return e(
          "div",
          {
            key: sheet.id,
            className: `source-tab-shell${draggedSheetId === sheet.id ? " source-tab-shell-dragging" : ""}`,
            role: "presentation",
            draggable: true,
            "data-source-tab-shell-id": sheet.id,
            onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
              const target = event.target;
              if (!(target instanceof HTMLElement) || target.closest("[data-close-tab-id]") || props.sheets.length < 2) {
                event.preventDefault();
                return;
              }

              draggedSheetIdRef.current = sheet.id;
              setDraggedSheetId(sheet.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", sheet.id);
              event.dataTransfer.setDragImage(transparentDragImage(), 0, 0);
            },
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
      separatorPositions.map((left, index) =>
        e("span", {
          key: `separator-${index}`,
          className: "source-tab-separator",
          "data-source-tab-separator": "true",
          "aria-hidden": "true",
          style: { left: `${left}px`, width: devicePixelWidth(1) },
        }),
      ),
    ),
    e(
      "details",
      { id: "sample-menu", className: "sample-menu" },
      e(
        "summary",
        { className: "source-add-tab", "aria-label": "Add file", title: "Add file" },
        e("span", { className: "source-add-tab-icon", "aria-hidden": "true" }),
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

function sourceTabDropSlot(
  clientX: number,
  draggedSheetId: string,
  sheets: SourceTab[],
  tabList: HTMLElement | null,
): DropSlot | null {
  if (!tabList) return null;

  const draggedIndex = sheets.findIndex((sheet) => sheet.id === draggedSheetId);
  if (draggedIndex === -1) return null;

  const shells = Array.from(tabList.querySelectorAll<HTMLElement>("[data-source-tab-shell-id]"));
  const remainingShells = shells.filter((shell) => shell.dataset.sourceTabShellId !== draggedSheetId);
  if (remainingShells.length === 0) return null;

  let insertIndex = remainingShells.length;
  let nonDraggedTabsBefore = 0;

  for (const shell of shells) {
    const rect = shell.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      insertIndex = nonDraggedTabsBefore;
      break;
    }

    if (shell.dataset.sourceTabShellId !== draggedSheetId) {
      nonDraggedTabsBefore += 1;
    }
  }

  return {
    insertIndex,
    markerX: sourceTabDropMarkerX(remainingShells, insertIndex, tabList),
    isNoop: insertIndex === draggedIndex,
  };
}

function sourceTabDropMarkerX(remainingShells: HTMLElement[], insertIndex: number, tabList: HTMLElement): number {
  const stripRect = tabList.getBoundingClientRect();
  const boundedIndex = Math.min(Math.max(insertIndex, 0), remainingShells.length);
  const markerClientX = boundedIndex === remainingShells.length
    ? remainingShells[remainingShells.length - 1].getBoundingClientRect().right
    : remainingShells[boundedIndex].getBoundingClientRect().left;
  return sourceTabRelativeX(markerClientX, stripRect, tabList);
}

function sourceTabRelativeX(clientX: number, stripRect: DOMRect, tabList: HTMLElement): number {
  return snapCssPixel(clientX - stripRect.left + tabList.scrollLeft);
}

function snapCssPixel(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function devicePixelWidth(pixelCount: number): string {
  const ratio = window.devicePixelRatio || 1;
  return `${pixelCount / ratio}px`;
}

function transparentDragImage(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("[data-transparent-drag-image]");
  if (existing) return existing;

  const image = document.createElement("div");
  image.dataset.transparentDragImage = "true";
  image.style.position = "fixed";
  image.style.top = "-1px";
  image.style.left = "-1px";
  image.style.width = "1px";
  image.style.height = "1px";
  image.style.opacity = "0";
  image.style.pointerEvents = "none";
  document.body.append(image);
  return image;
}

function sameNumberList(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
