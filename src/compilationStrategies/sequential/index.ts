import {
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type Runnable,
} from "../../codeSheet";
import {
  buildPythonProgram,
  runPython,
  runResult,
  type RunResult,
  type StrategyRunOptions,
} from "../shared";

export async function compileAndRunSequential(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: StrategyRunOptions,
): Promise<RunResult> {
  const completed = await completeSheet(cache, codeSheet, options.complete, { strategy: "sequential" });
  const executed = await runPython(
    buildPythonProgram(completed.source, runnable),
    options.python ?? "python3",
    options.onStdoutLine,
  );
  return runResult(executed, completed);
}
