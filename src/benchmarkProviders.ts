import { completeWithAnthropic } from "./anthropicComplete";
import type { CompleteFunction } from "./codeSheet";

export type BenchmarkProvider = {
  id: string;
  complete: CompleteFunction;
};

type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "ollama";

type ProviderSpec = {
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
};

export function benchmarkProvidersFromEnv(): BenchmarkProvider[] {
  const specs = csvEnv("BENCH_MODELS");
  if (specs.length === 0) {
    return [benchmarkProvider("anthropic:claude-sonnet-4-6")];
  }

  return specs.map(benchmarkProvider);
}

export function benchmarkProvider(source: string): BenchmarkProvider {
  const spec = parseProviderSpec(source);
  return {
    id: providerId(spec),
    complete(prompt, options) {
      switch (spec.kind) {
        case "anthropic":
          return completeWithAnthropic(prompt, {
            model: spec.model,
            signal: options?.signal,
          });
        case "openai":
          return completeOpenAICompatible({
            prompt,
            model: spec.model,
            baseUrl: "https://api.openai.com/v1",
            apiKey: process.env.OPENAI_API_KEY,
            apiKeyName: "OPENAI_API_KEY",
            signal: options?.signal,
          });
        case "openai-compatible":
          return completeOpenAICompatible({
            prompt,
            model: spec.model,
            baseUrl: spec.baseUrl ?? process.env.OPENAI_COMPATIBLE_BASE_URL,
            apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
            apiKeyName: "OPENAI_COMPATIBLE_API_KEY",
            signal: options?.signal,
            allowMissingApiKey: true,
          });
        case "ollama":
          return completeOpenAICompatible({
            prompt,
            model: spec.model,
            baseUrl: spec.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
            apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
            apiKeyName: "OLLAMA_API_KEY",
            signal: options?.signal,
            allowMissingApiKey: true,
          });
      }
    },
  };
}

function parseProviderSpec(source: string): ProviderSpec {
  const [kindSource, rest] = splitOnce(source, ":");
  if (!rest) {
    return { kind: "anthropic", model: kindSource };
  }

  if (!isProviderKind(kindSource)) {
    throw new Error(`Unknown benchmark provider "${kindSource}" in "${source}"`);
  }

  const [model, baseUrl] = splitOnce(rest, "@");
  if (!model) {
    throw new Error(`Benchmark provider "${source}" is missing a model`);
  }

  return {
    kind: kindSource,
    model,
    ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
  };
}

async function completeOpenAICompatible(options: {
  prompt: string;
  model: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  apiKeyName: string;
  signal: AbortSignal | undefined;
  allowMissingApiKey?: boolean;
}): Promise<string> {
  if (!options.baseUrl) {
    throw new Error("OpenAI-compatible benchmark completion requires a base URL");
  }
  if (!options.apiKey && options.allowMissingApiKey !== true) {
    throw new Error(`${options.apiKeyName} is required for benchmark completion`);
  }

  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      max_tokens: 4096,
      messages: [{ role: "user", content: options.prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Completion request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

function providerId(spec: ProviderSpec): string {
  return spec.baseUrl === undefined
    ? `${spec.kind}:${spec.model}`
    : `${spec.kind}:${spec.model}@${spec.baseUrl}`;
}

function isProviderKind(value: string): value is ProviderKind {
  return value === "anthropic" ||
    value === "openai" ||
    value === "openai-compatible" ||
    value === "ollama";
}

function splitOnce(source: string, delimiter: string): [string, string | undefined] {
  const index = source.indexOf(delimiter);
  if (index < 0) {
    return [source, undefined];
  }

  return [source.slice(0, index), source.slice(index + delimiter.length)];
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
