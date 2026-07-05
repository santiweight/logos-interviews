export function installMonacoShortcutGuard(target: HTMLElement): void {
  target.addEventListener(
    "keydown",
    (event) => {
      if (shouldMonacoHandleKeydown(event)) {
        return;
      }

      event.stopImmediatePropagation();
    },
    { capture: true },
  );
}

function shouldMonacoHandleKeydown(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return true;
  }

  if (event.ctrlKey && event.altKey && !event.metaKey) {
    return true;
  }

  return !isBrowserLocationBarShortcut(event);
}

function isBrowserLocationBarShortcut(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return false;
  }

  const key = event.key.toLowerCase();
  return key === "l" || event.code === "KeyL";
}
