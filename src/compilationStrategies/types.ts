import type { CompilationStrategy } from "../codeSheet";

export type ExperimentalCompilationStrategy = "parallel-methods" | "agentic-methods";
export type RunnerStrategy = CompilationStrategy | ExperimentalCompilationStrategy;
export type CompilationMode = RunnerStrategy | "auto";

export const stableCompilationStrategies = ["parallel", "sequential", "agentic"] as const satisfies readonly CompilationStrategy[];
export const experimentalCompilationStrategies = [
  "parallel-methods",
  "agentic-methods",
] as const satisfies readonly ExperimentalCompilationStrategy[];

export const legacyAutoStrategyOrder = ["parallel", "sequential", "agentic"] as const satisfies readonly RunnerStrategy[];

export function isCompilationMode(value: unknown): value is CompilationMode {
  return value === "auto" || isRunnerStrategy(value);
}

export function isRunnerStrategy(value: unknown): value is RunnerStrategy {
  return isStableCompilationStrategy(value) || isExperimentalCompilationStrategy(value);
}

export function isStableCompilationStrategy(value: unknown): value is CompilationStrategy {
  return typeof value === "string" && stableCompilationStrategies.includes(value as CompilationStrategy);
}

export function isExperimentalCompilationStrategy(value: unknown): value is ExperimentalCompilationStrategy {
  return typeof value === "string" &&
    experimentalCompilationStrategies.includes(value as ExperimentalCompilationStrategy);
}
