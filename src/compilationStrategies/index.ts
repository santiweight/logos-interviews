import type {
  CodeCache,
  CodeSheet,
  Runnable,
} from "../codeSheet";
import { compileAndRunAgentically } from "./agenticFile";
import { compileAndRunAgenticMethods } from "./agenticMethods";
import { compileAndRunParallel } from "./parallel";
import { compileAndRunParallelMethods } from "./parallelMethods";
import { compileAndRunSequential } from "./sequential";
import type {
  RunResult,
  StrategyRunOptions,
} from "./shared";
import type { RunnerStrategy } from "./types";

export type StrategyContext = {
  cache: CodeCache;
  codeSheet: CodeSheet;
  runnable: Runnable;
  options: StrategyRunOptions;
};

export type StrategyDefinition = {
  name: RunnerStrategy;
  stability: "stable" | "experimental";
  fallback?: RunnerStrategy;
  run: (context: StrategyContext, fallback: () => Promise<RunResult>) => Promise<RunResult>;
};

export const compilationStrategies = {
  sequential: {
    name: "sequential",
    stability: "stable",
    run: ({ cache, codeSheet, runnable, options }) => compileAndRunSequential(cache, codeSheet, runnable, options),
  },
  parallel: {
    name: "parallel",
    stability: "stable",
    run: ({ cache, codeSheet, runnable, options }) => compileAndRunParallel(cache, codeSheet, runnable, options),
  },
  agentic: {
    name: "agentic",
    stability: "stable",
    fallback: "sequential",
    run: ({ cache, codeSheet, runnable, options }, fallback) => {
      return compileAndRunAgentically(cache, codeSheet, runnable, options, fallback);
    },
  },
  "parallel-methods": {
    name: "parallel-methods",
    stability: "experimental",
    fallback: "parallel",
    run: ({ cache, codeSheet, runnable, options }, fallback) => {
      return compileAndRunParallelMethods(cache, codeSheet, runnable, options, fallback);
    },
  },
  "agentic-methods": {
    name: "agentic-methods",
    stability: "experimental",
    fallback: "agentic",
    run: ({ cache, codeSheet, runnable, options }, fallback) => {
      return compileAndRunAgenticMethods(cache, codeSheet, runnable, options, fallback);
    },
  },
} as const satisfies Record<RunnerStrategy, StrategyDefinition>;
