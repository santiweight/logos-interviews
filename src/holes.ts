export type Hole = {
  id: number;
  line: number;
  column: number;
  before: string;
  after: string;
  prompt: string;
};

export function findHoles(source: string, contextLines = 3): Hole[] {
  const lines = source.split("\n");
  const holes: Hole[] = [];

  lines.forEach((lineText, lineIndex) => {
    const matches = lineText.matchAll(/\?\?\?/g);
    for (const match of matches) {
      const column = (match.index ?? 0) + 1;
      const start = Math.max(0, lineIndex - contextLines);
      const end = Math.min(lines.length, lineIndex + contextLines + 1);
      const context = lines.slice(start, end);
      const markedContext = context
        .map((line, index) => {
          const absoluteLine = start + index + 1;
          const marker = absoluteLine === lineIndex + 1 ? ">" : " ";
          return `${marker} ${String(absoluteLine).padStart(2, " ")} | ${line}`;
        })
        .join("\n");

      const before = lineText.slice(0, column - 1).trimEnd();
      const after = lineText.slice(column + 2).trimStart();
      const id = holes.length + 1;

      holes.push({
        id,
        line: lineIndex + 1,
        column,
        before,
        after,
        prompt: [
          `Fill hole #${id} at line ${lineIndex + 1}, column ${column}.`,
          "Keep the candidate's surrounding structure intact.",
          "Return only the replacement for ???.",
          "",
          markedContext,
        ].join("\n"),
      });
    }
  });

  return holes;
}
