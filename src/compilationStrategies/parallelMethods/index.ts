import {
  buildCompilationIR,
  buildCompletionPrompt,
  type CodeCache,
  type CodeSheet,
  hashSnippet,
  type IncompleteSnippet,
  normalizeSnippet,
  parse,
  renderImplementation,
  type Runnable,
} from "../../codeSheet";
import {
  buildPythonProgram,
  classNamesFromSnippets,
  collectCompletionResult,
  completedStrategySheet,
  extractRequestedMethodReplacement,
  methodHeadersFromClassSnippet,
  normalizeFencedCode,
  replaceSnippet,
  runPython,
  runResult,
  type RunResult,
  type StrategyRunOptions,
  strategyCacheKey,
  synthesizeNoArgClassFactory,
} from "../shared";

type ParallelMethodTask = {
  snippet: string;
  kind: IncompleteSnippet["kind"];
  prompt: string;
  synthesized?: string;
  method?: boolean;
};

export async function compileAndRunParallelMethods(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: StrategyRunOptions,
  fallback: () => Promise<RunResult>,
): Promise<RunResult> {
  if (!options.complete) {
    return fallback();
  }

  const parsed = parse(codeSheet);
  let currentSource = renderImplementation(buildCompilationIR(parsed));
  const tasks = buildParallelMethodTasks(currentSource, parsed.incompleteSnippets);
  if (!tasks.some((task) => task.method)) {
    return fallback();
  }

  const replacements = await Promise.all(tasks.map(async (task) => {
    const hash = hashSnippet(`parallel-methods:${task.kind}\n${task.snippet}`);
    const cached = cache.get(hash);
    if (cached !== undefined) {
      return { snippet: task.snippet, replacement: cached };
    }

    const replacement = task.synthesized ?? normalizeParallelMethodReplacement(
      await collectCompletionResult(options.complete?.(task.prompt) ?? ""),
      task,
    );
    cache.set(hash, replacement);
    return { snippet: task.snippet, replacement };
  }));

  for (const replacement of replacements) {
    currentSource = replaceSnippet(currentSource, replacement.snippet, replacement.replacement);
  }

  const completed = completedStrategySheet(
    codeSheet,
    currentSource,
    strategyCacheKey("parallel-methods", runnable, codeSheet),
    false,
  );
  const executed = await runPython(
    buildPythonProgram(completed.source, runnable),
    options.python ?? "python3",
    options.onStdoutLine,
  );
  if (!executed.ok) {
    return fallback();
  }
  return runResult(executed, completed);
}

function buildParallelMethodTasks(
  currentSource: CodeSheet,
  snippets: IncompleteSnippet[],
): ParallelMethodTask[] {
  const classNames = classNamesFromSnippets(snippets.map((snippet) => snippet.snippet));
  return snippets.flatMap((snippet) => {
    if (snippet.kind === "class") {
      const methodSnippets = methodHeadersFromClassSnippet(snippet.snippet);
      return methodSnippets.map((methodSnippet) => ({
        snippet: methodSnippet,
        kind: "function" as const,
        method: true,
        prompt: buildParallelMethodPrompt(currentSource, methodSnippet),
      }));
    }

    const synthesized = synthesizeNoArgClassFactory(snippet.snippet, classNames);
    return [{
      snippet: snippet.snippet,
      kind: snippet.kind,
      ...(synthesized === null
        ? { prompt: buildCompletionPrompt(currentSource, snippet.snippet, snippet.kind) }
        : { prompt: "", synthesized }),
    }];
  });
}

function buildParallelMethodPrompt(currentSource: CodeSheet, methodSnippet: string): string {
  return `${buildCompletionPrompt(currentSource, methodSnippet, "function")}

The requested declaration is a method inside an existing class.
Return only the requested method definition and any nested local helpers.
Do not return the class header, sibling methods, top-level functions, runnable/test code, JSON, or prose.
Preserve the method indentation from the requested snippet.
Do not implement, redefine, restate, or include sibling methods.
Parallel method completions are independent: do not depend on a sibling method or constructor adding hidden state unless the worksheet explicitly declares that state.
If the class has no declared __init__, the method must work on a no-argument instance with no preexisting attributes.
Use getattr defaults for optional state.
If this method handles rotation or turns, use _rotation as the shared rotation state unless the target snippet already names another state field.
When returning a new instance from a method, copy existing attributes with new_instance.__dict__.update(getattr(self, "__dict__", {})) before changing the state this method owns.
Do not require undeclared attributes such as _cubes, _points, _width, or _height to exist before this method is called.
${renderMethodGuidance(methodSnippet)}`;
}

function renderMethodGuidance(methodSnippet: string): string {
  if (!/^\s*def\s+render\s*\(/.test(methodSnippet)) {
    return "";
  }

  return `For render methods, prefer one compact deterministic implementation over a general rendering engine.
If the worksheet specifies a fixed canvas size, use a small list-of-lists canvas or explicit string templates.
Avoid exploratory comments, alternate implementations, painter's algorithms, 3D geometry engines, and unused helper functions unless the tests require them.
Keep the returned method under roughly 80 lines when a direct fixed-size ASCII drawing can satisfy the contract.`;
}

function normalizeParallelMethodReplacement(raw: string, task: ParallelMethodTask): string {
  if (!task.method) {
    return normalizeSnippet(raw, task.kind, task.snippet);
  }

  return indentMethodReplacement(
    extractRequestedMethodReplacement(normalizeFencedCode(raw), task.snippet),
    methodIndent(task.snippet),
  );
}

function methodIndent(snippet: string): string {
  return snippet.match(/^\s*/)?.[0] ?? "";
}

function indentMethodReplacement(replacement: string, indent: string): string {
  const lines = replacement.split("\n");
  if (lines.length === 0) {
    return replacement;
  }

  const firstIndent = lines[0].match(/^\s*/)?.[0] ?? "";
  if (firstIndent.length >= indent.length && lines[0].startsWith(indent)) {
    return replacement;
  }

  return lines.map((line, index) => {
    if (line.trim().length === 0) {
      return line;
    }
    return index === 0 || /^\s+/.test(line) ? `${indent}${line}` : line;
  }).join("\n");
}
