import Anthropic from "@anthropic-ai/sdk";

export function requireAnthropicApiKey(): string {
  const key = process.env.LOGOS_ANTHROPIC_API_KEY;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("LOGOS_ANTHROPIC_API_KEY is not set. Set it before starting the server.");
  }
  return key;
}

export function anthropicClient(apiKey?: string): Anthropic {
  return new Anthropic({ apiKey: apiKey ?? requireAnthropicApiKey() });
}
