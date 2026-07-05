import {
  completeSheet,
  type CodeCache,
  type CodeSheet,
  type Runnable,
} from "../../../domain/codeSheet";
import {
  buildTypeScriptProgram,
  runTypeScript,
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
  const executed = await runTypeScript(
    buildTypeScriptProgram(completed.source, runnable),
    options.tsx,
    options.onStdoutLine,
  );
  return runResult(executed, completed);
}
