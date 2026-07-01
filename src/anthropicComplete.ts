import Anthropic from "@anthropic-ai/sdk";

export type AnthropicCompleteOptions = {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  signal?: AbortSignal;
};

export async function completeWithAnthropic(
  prompt: string,
  options: AnthropicCompleteOptions = {},
): Promise<string> {
  const client = anthropicClient(options.apiKey);
  const params = messageParams(prompt, options.model, options.maxTokens);
  const message = await client.messages.create(params, { signal: options.signal });
  throwIfMaxTokensStop(message.stop_reason, params.max_tokens);

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
  const params = messageParams(prompt, options.model, options.maxTokens);
  const stream = client.messages.stream(params, {
    signal: options.signal,
  });
  let stoppedByMaxTokens = false;

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
    if (event.type === "message_delta" && event.delta.stop_reason === "max_tokens") {
      stoppedByMaxTokens = true;
    }
  }

  if (stoppedByMaxTokens) {
    throw new Error(maxTokensStopMessage(params.max_tokens));
  }
}

function anthropicClient(apiKey: string | undefined): Anthropic {
  const resolvedApiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!resolvedApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic completion");
  }

  return new Anthropic({ apiKey: resolvedApiKey });
}

export function anthropicMaxTokens(value = process.env.ANTHROPIC_MAX_TOKENS): number {
  if (value === undefined || value.trim().length === 0) {
    return 8192;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ANTHROPIC_MAX_TOKENS must be a positive integer, got ${JSON.stringify(value)}`);
  }

  return parsed;
}

export function throwIfMaxTokensStop(stopReason: string | null, maxTokens: number): void {
  if (stopReason === "max_tokens") {
    throw new Error(maxTokensStopMessage(maxTokens));
  }
}

function maxTokensStopMessage(maxTokens: number): string {
  return `Anthropic completion stopped after reaching max_tokens=${maxTokens}. Increase ANTHROPIC_MAX_TOKENS or reduce the generated code size before caching this completion.`;
}

function messageParams(prompt: string, model: string | undefined, maxTokens: number | undefined) {
  return {
    model: model ?? process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-4-6",
    max_tokens: maxTokens ?? anthropicMaxTokens(),
    temperature: 0,
    messages: [{ role: "user" as const, content: prompt }],
  };
}
