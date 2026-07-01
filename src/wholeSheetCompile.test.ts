import { describe, expect, it } from "vitest";
import { buildWholeSheetCompletionPrompt, compile, parse, type CompilationEvent } from "./codeSheet";

describe("whole-sheet Claude compiler", () => {
  it("sends the whole sheet in one completion request", async () => {
    const sheet = `function add(x: number, y: number): number;
function mul(x: number, y: number): number;

function main(): void {
  console.log(add(1, 2));
  console.log(mul(3, 4));
}`;
    const calls: string[] = [];
    const events: CompilationEvent[] = [];

    for await (const event of compile(new Map(), sheet, (prompt) => {
      calls.push(prompt);
      return `function add(x: number, y: number): number {
  return x + y;
}
function mul(x: number, y: number): number {
  return x * y;
}

function main(): void {
  console.log(add(1, 2));
  console.log(mul(3, 4));
}`;
    })) {
      events.push(event);
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("compile this Logos-TS worksheet into one complete TypeScript code sheet");
    expect(calls[0]).toContain("function add(x: number, y: number): number;");
    expect(calls[0]).toContain("function mul(x: number, y: number): number;");
    expect(events.filter((event) => event.kind === "llm-start")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "llm-complete")).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe("compiled");
  });

  it("strips Claude-generated WebPage aliases from completed sheets", async () => {
    const sheet = `function main(): WebPage {
  \`render ok\`
}`;
    const events: CompilationEvent[] = [];

    for await (const event of compile(new Map(), sheet, () => `type WebPage = string;

function main(): WebPage {
  return "<!doctype html><html><body>ok</body></html>";
}`)) {
      events.push(event);
    }

    const compiled = events.find((event) => event.kind === "compiled");
    expect(compiled?.kind).toBe("compiled");
    if (compiled?.kind !== "compiled") return;
    expect(compiled.completed.source).not.toContain("type WebPage");
    expect(compiled.completed.source).toContain("function main(): WebPage");
  });

  it("injects ReactApp guidance for React app natural snippets", () => {
    const prompt = buildWholeSheetCompletionPrompt(parse(`function main(): ReactApp {
  \`\`\`
  render a clickable counter
  \`\`\`
}`));

    expect(prompt).toContain("The surrounding function returns ReactApp");
    expect(prompt).toContain("return reactApp(componentSource, props, options)");
    expect(prompt).toContain("Do not return HTML strings, shadcn.renderApp");
  });
});
