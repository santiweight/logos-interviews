import { describe, expect, it } from "vitest";
import { buildSheetAgentPrompt, runSheetAgent, type AgentChatMessage } from "./sheetAgent";

describe("sheetAgent", () => {
  it("instructs the agent to keep edits at scaffold level", () => {
    const prompt = buildSheetAgentPrompt(
      `def expr(str) -> Expr`,
      [{ role: "user", content: "define expr(str) -> Expr and migrate the test" }],
    );

    expect(prompt).toContain("architecture-level interview scaffold");
    expect(prompt).toContain("Do not add concrete implementation bodies");
    expect(prompt).toContain("If the user includes implementation code as an example");
    expect(prompt).toContain("return the entire revised code sheet");
  });

  it("parses fenced JSON agent responses", async () => {
    const messages: AgentChatMessage[] = [
      { role: "user", content: "Add a second print" },
    ];
    const result = await runSheetAgent(
      `def test():
  print(1)`,
      messages,
      () => `\`\`\`json
{
  "reply": "Added another print.",
  "sheet": "def test():\\n  print(1)\\n  print(2)"
}
\`\`\``,
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "reply": "Added another print.",
        "sheet": "def test():
        print(1)
        print(2)",
      }
    `);
  });

  it("strips python fences from returned sheets", async () => {
    const result = await runSheetAgent(
      `def test():
  print(1)`,
      [{ role: "user", content: "wrap it by accident" }],
      () => JSON.stringify({
        reply: "Updated.",
        sheet: "```python\ndef test():\n  print(2)\n```",
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "reply": "Updated.",
        "sheet": "def test():
        print(2)",
      }
    `);
  });
});
