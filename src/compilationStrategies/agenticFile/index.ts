import {
  buildCompilationIR,
  cachedImplementation,
  cacheImplementation,
  type CodeCache,
  type CodeSheet,
  parse,
  renderImplementation,
  type Runnable,
} from "../../codeSheet";
import {
  buildPythonProgram,
  collectCompletionResult,
  completedStrategySheet,
  normalizeFencedCode,
  normalizeLineEndings,
  replaceSnippet,
  runPython,
  runResult,
  type RunResult,
  type StrategyRunOptions,
  stdoutLines,
  strategyCacheKey,
  trimOuterBlankLines,
} from "../shared";

type AgenticAction = {
  tool: "replace_file" | "replace_snippets" | "finish";
  source?: string;
  replacements?: AgenticSnippetReplacement[];
};

type AgenticSnippetReplacement = {
  snippet: string;
  replacement: string;
};

type AgenticObservation = {
  iteration: number;
  action: AgenticAction["tool"];
  ok: boolean;
  stdout: string[];
  stderr: string;
};

export async function compileAndRunAgentically(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: StrategyRunOptions,
  fallback: () => Promise<RunResult>,
): Promise<RunResult> {
  if (!options.complete) {
    return fallback();
  }

  const cacheKey = strategyCacheKey("agentic-file", runnable, codeSheet);
  const cachedSource = await cachedImplementation(cache, cacheKey);
  if (cachedSource !== undefined) {
    const completed = completedStrategySheet(codeSheet, cachedSource, cacheKey, true);
    const executed = await runPython(
      buildPythonProgram(completed.source, runnable),
      options.python ?? "python3",
      options.onStdoutLine,
    );
    return runResult(executed, completed);
  }

  const maxIterations = options.agenticMaxIterations ?? 4;
  const parsed = parse(codeSheet);
  const initialSource = renderImplementation(buildCompilationIR(parsed));
  let currentSource = initialSource;
  const observations: AgenticObservation[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const prompt = buildAgenticFilePrompt({
      codeSheet,
      runnable,
      currentSource,
      incompleteSnippets: parsed.incompleteSnippets.map((snippet) => snippet.snippet),
      observations,
      iteration,
      maxIterations,
    });
    const raw = await collectCompletionResult(options.complete(prompt));
    const action = parseAgenticAction(raw);
    currentSource = applyAgenticAction(currentSource, action);

    const executed = await runPython(
      buildPythonProgram(currentSource, runnable),
      options.python ?? "python3",
    );
    observations.push({
      iteration,
      action: action.tool,
      stdout: stdoutLines(executed.stdout),
      stderr: executed.stderr.trim(),
      ok: executed.ok,
    });

    if (executed.ok || action.tool === "finish") {
      break;
    }
  }

  const completed = completedStrategySheet(codeSheet, currentSource, cacheKey, false);
  const executed = await runPython(
    buildPythonProgram(completed.source, runnable),
    options.python ?? "python3",
    options.onStdoutLine,
  );
  if (executed.ok) {
    await cacheImplementation(cache, cacheKey, currentSource);
  }
  return runResult(executed, completed);
}

function buildAgenticFilePrompt(options: {
  codeSheet: CodeSheet;
  runnable: Runnable;
  currentSource: string;
  incompleteSnippets: string[];
  observations: AgenticObservation[];
  iteration: number;
  maxIterations: number;
}): string {
  return `Your job is to compile this worksheet into one complete Python file.

You are a stateful coding agent editing a single Python source file. Use the tool protocol below instead of returning prose.

Tool protocol:
- Return exactly one JSON object.
- Prefer small edits: {"tool":"replace_snippets","replacements":[{"snippet":"<exact current snippet>","replacement":"<complete replacement code>"}]}
- To replace the whole file: {"tool":"replace_file","source":"<complete Python source without a __main__ block>"}
- To finish with the current or supplied file: {"tool":"finish"} or {"tool":"finish","source":"<complete Python source without a __main__ block>"}

Rules:
- Preserve the public behavior required by the runnable/test function.
- Use only the Python standard library.
- Keep declarations top-level unless nesting is explicitly required.
- If the worksheet declares a class without __init__, no-argument construction must produce a valid default object.
- Prefer concise code. Avoid comments, docstrings, and copied worksheet prose unless they are needed for behavior.
- Do not include an if __name__ == "__main__" block; the runner adds it.

Runnable to satisfy: ${options.runnable}
Iteration: ${options.iteration} of ${options.maxIterations}

Worksheet:
\`\`\`python
${options.codeSheet}
\`\`\`

Current file:
\`\`\`python
${options.currentSource}
\`\`\`

Exact snippets you may replace:
\`\`\`json
${JSON.stringify(options.incompleteSnippets, null, 2)}
\`\`\`

Prior tool results:
\`\`\`json
${JSON.stringify(options.observations, null, 2)}
\`\`\``;
}

function parseAgenticAction(raw: string): AgenticAction {
  const parsed = parseJsonAction(raw);
  if (parsed) {
    return parsed;
  }

  return {
    tool: "replace_file",
    source: raw,
  };
}

function parseJsonAction(raw: string): AgenticAction | null {
  const candidates = [
    raw.trim(),
    raw.trim().match(/```(?:json)?\s*\n([\s\S]*?)```/)?.[1]?.trim(),
    raw.trim().match(/({[\s\S]*})/)?.[1]?.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as {
        tool?: unknown;
        source?: unknown;
        replacements?: unknown;
      };
      if (value.tool !== "replace_file" && value.tool !== "replace_snippets" && value.tool !== "finish") {
        continue;
      }

      return {
        tool: value.tool,
        ...(typeof value.source === "string" ? { source: value.source } : {}),
        ...(value.tool === "replace_snippets"
          ? { replacements: parseAgenticSnippetReplacements(value.replacements) }
          : {}),
      };
    } catch {
      // Try the next extraction shape.
    }
  }

  return null;
}

function parseAgenticSnippetReplacements(value: unknown): AgenticSnippetReplacement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "snippet" in item &&
      "replacement" in item &&
      typeof item.snippet === "string" &&
      typeof item.replacement === "string"
    ) {
      return [{
        snippet: item.snippet,
        replacement: item.replacement,
      }];
    }

    return [];
  });
}

function applyAgenticAction(source: string, action: AgenticAction): string {
  if (action.source !== undefined) {
    return normalizeAgenticSource(action.source);
  }

  if (action.tool !== "replace_snippets") {
    return source;
  }

  return action.replacements?.reduce((current, replacement) => {
    return replaceSnippet(
      current,
      normalizeLineEndings(replacement.snippet).trimEnd(),
      normalizeFencedCode(replacement.replacement),
    );
  }, source) ?? source;
}

function normalizeAgenticSource(source: string): string {
  const trimmed = source.trim();
  const fenced = trimmed.match(/```(?:python)?\s*\n([\s\S]*?)```/)?.[1] ?? trimmed;
  const lines = normalizeLineEndings(fenced).split("\n");
  const withoutFuture = lines.filter((line) => line.trim() !== "from __future__ import annotations");
  const mainIndex = withoutFuture.findIndex((line) => /^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(line.trim()));
  return trimOuterBlankLines(mainIndex < 0 ? withoutFuture : withoutFuture.slice(0, mainIndex)).join("\n").trimEnd();
}
