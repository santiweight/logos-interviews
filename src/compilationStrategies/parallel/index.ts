import {
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type Runnable,
} from "../../codeSheet";
import {
  buildTypeScriptProgram,
  runTypeScript,
  runResult,
  type RunResult,
  type StrategyRunOptions,
} from "../shared";

export async function compileAndRunParallel(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: StrategyRunOptions,
): Promise<RunResult> {
  const completed = await completeSheet(cache, codeSheet, options.complete, { strategy: "parallel" });
  const executed = await runTypeScript(
    buildTypeScriptProgram(completed.source, runnable),
    options.tsx,
    options.onStdoutLine,
  );
  return runResult(executed, completed);
}
