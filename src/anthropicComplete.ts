import { anthropicClient } from "./anthropicKeyService";

export type AnthropicCompleteOptions = {
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
};

export async function completeWithAnthropic(
  prompt: string,
  options: AnthropicCompleteOptions = {},
): Promise<string> {
  const client = anthropicClient(options.apiKey);
  const message = await client.messages.create(
    messageParams(prompt, options.model),
    { signal: options.signal },
  );

  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

export async function* streamCompleteWithAnthropic(
  prompt: string,
  options: AnthropicCompleteOptions = {},
): AsyncIterable<string> {
  const client = anthropicClient(options.apiKey);
  const stream = client.messages.stream(messageParams(prompt, options.model), {
    signal: options.signal,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

function messageParams(prompt: string, model: string | undefined) {
  return {
    model: model ?? process.env.ANTHROPIC_CODEGEN_MODEL ?? process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{ role: "user" as const, content: prompt }],
  };
}
