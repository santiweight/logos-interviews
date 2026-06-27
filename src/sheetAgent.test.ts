import { describe, expect, it } from "vitest";
import { runSheetAgent, type AgentChatMessage } from "./sheetAgent";

describe("sheetAgent", () => {
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
