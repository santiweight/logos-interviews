export type SnippetHitTarget = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export function snippetTargetContainsPosition(
  target: SnippetHitTarget,
  lineNumber: number,
  column: number,
  lineMaxColumn?: number,
): boolean {
  if (lineMaxColumn !== undefined && column >= lineMaxColumn) {
    return false;
  }

  if (lineNumber < target.startLine || lineNumber > target.endLine) {
    return false;
  }

  if (lineNumber === target.startLine && column < target.startColumn) {
    return false;
  }

  return lineNumber !== target.endLine || column < target.endColumn;
}

export function snippetPopupTargetForClick<Target extends SnippetHitTarget>(
  targets: Target[],
  lineNumber: number,
  column: number,
  lineMaxColumn?: number,
): Target | null {
  return targets.find((target) => (
    snippetTargetContainsPosition(target, lineNumber, column, lineMaxColumn)
  )) ?? null;
}
