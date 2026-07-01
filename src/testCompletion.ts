import type { CompleteOptions } from "./codeSheet";

export async function completeWithFixture(prompt: string, _options: CompleteOptions = {}): Promise<string> {
  return fixtureCompletion(prompt);
}

export async function* streamCompleteWithFixture(prompt: string, _options: CompleteOptions = {}): AsyncIterable<string> {
  yield fixtureCompletion(prompt);
}

function fixtureCompletion(prompt: string): string {
  const snippet = requestedSnippet(prompt);

  switch (snippet) {
    case "fn add(x: number, y: number) -> number":
      return `function add(x: number, y: number): number {
  return x + y;
}`;
    case "fn mul(x: number, y: number) -> number":
      return `function mul(x: number, y: number): number {
  return x * y;
}`;
    case "`print Logos: mul of (add one and two) and 3`":
      return `console.log("Logos:", mul(add(1, 2), 3));`;
    case "`the number one`":
      return "1";
    case "`the number two`":
      return "2";
    case "`the number three`":
      return "3";
    case "`add 1 and 5`":
      return "add(1, 5)";
    case "`mul 3 and 4`":
      return "mul(3, 4)";
    case "`mul 3 and 5`":
      return "mul(3, 5)";
    case "`output added + product`":
      return "console.log(added + product);";
    default:
      if (/Generate a MagicSquare of size (?<size>\d+)/i.test(snippet)) {
        const size = snippet.match(/Generate a MagicSquare of size (?<size>\d+)/i)?.groups?.size ?? "4";
        return `const square = new MagicSquare(${size}).gen();
console.log("${size}x${size} Magic Square");
console.log(square.pretty());
const grid = square.grid();
const rowSums = grid.map((row) => row.reduce((sum, value) => sum + value, 0));
const columnSums = grid[0].map((_, column) => grid.reduce((sum, row) => sum + row[column], 0));
const diagonals = [
  grid.reduce((sum, row, index) => sum + row[index], 0),
  grid.reduce((sum, row, index) => sum + row[grid.length - index - 1], 0),
];
console.log("row sums:", rowSums.join(", "));
console.log("column sums:", columnSums.join(", "));
console.log("diagonal sums:", diagonals.join(", "));
console.log("valid magic square:", [...rowSums, ...columnSums, ...diagonals].every((value) => value === 34));`;
      }
      throw new Error(`No fixture completion for snippet: ${snippet}`);
  }
}

function requestedSnippet(prompt: string): string {
  const natural = prompt.match(/replace this natural-language Logos fragment with valid TypeScript code:\n\n([\s\S]*?)\n\nReturn only/);
  if (natural) {
    return natural[1].trim();
  }

  const implementation = prompt.match(/finish the implementation of:\n\n([\s\S]*?)\n\nReturn only/);
  if (implementation) {
    return implementation[1].trim();
  }

  throw new Error("Could not find requested snippet in prompt");
}
