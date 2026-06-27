import Anthropic from "@anthropic-ai/sdk";

export type AnthropicCompleteOptions = {
  model?: string;
  apiKey?: string;
};

export async function completeWithAnthropic(
  prompt: string,
  options: AnthropicCompleteOptions = {},
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic completion");
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: options.model ?? process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}
