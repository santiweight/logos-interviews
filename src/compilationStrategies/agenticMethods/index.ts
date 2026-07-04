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
  buildTypeScriptProgram,
  classNamesFromSnippets,
  collectCompletionResult,
  completedStrategySheet,
  extractRequestedMethodReplacement,
  methodHeadersFromClassSnippet,
  normalizeLineEndings,
  replaceSnippet,
  runTypeScript,
  runResult,
  type RunResult,
  type StrategyRunOptions,
  strategyCacheKey,
  synthesizeNoArgClassFactory,
} from "../shared";

type MethodAgentTask = {
  snippet: string;
  prompt: string;
  synthesized?: string;
};

export async function compileAndRunAgenticMethods(
  cache: CodeCache,
  codeSheet: CodeSheet,
  runnable: Runnable,
  options: StrategyRunOptions,
  fallback: () => Promise<RunResult>,
): Promise<RunResult> {
  if (!options.complete) {
    return fallback();
  }

  const cacheKey = strategyCacheKey("agentic-methods", runnable, codeSheet);
  const cachedSource = await cachedImplementation(cache, cacheKey);
  if (cachedSource !== undefined) {
    const completed = completedStrategySheet(codeSheet, cachedSource, cacheKey, true);
    const executed = await runTypeScript(
      buildTypeScriptProgram(completed.source, runnable),
      options.tsx,
      options.onStdoutLine,
    );
    return runResult(executed, completed);
  }

  const parsed = parse(codeSheet);
  let currentSource = renderImplementation(buildCompilationIR(parsed));
  const snippets = parsed.incompleteSnippets.map((snippet) => snippet.snippet);
  const tasks = buildMethodAgentTasks(codeSheet, runnable, snippets);
  if (tasks.length === 0) {
    return fallback();
  }

  const replacements = await Promise.all(tasks.map(async (task) => ({
    snippet: task.snippet,
    replacement: task.synthesized ?? parseMethodAgentReplacement(
      await collectCompletionResult(options.complete?.(task.prompt) ?? ""),
      task.snippet,
    ),
  })));

  for (const replacement of replacements) {
    currentSource = replaceSnippet(currentSource, replacement.snippet, replacement.replacement);
  }

  const trial = await runTypeScript(buildTypeScriptProgram(currentSource, runnable), options.tsx);
  if (!trial.ok) {
    return fallback();
  }

  const completed = completedStrategySheet(codeSheet, currentSource, cacheKey, false);
  const executed = await runTypeScript(
    buildTypeScriptProgram(completed.source, runnable),
    options.tsx,
    options.onStdoutLine,
  );
  if (executed.ok) {
    await cacheImplementation(cache, cacheKey, currentSource);
  }
  return runResult(executed, completed);
}

function buildMethodAgentTasks(
  codeSheet: CodeSheet,
  runnable: Runnable,
  snippets: string[],
): MethodAgentTask[] {
  const classNames = classNamesFromSnippets(snippets);
  return snippets.flatMap((snippet) => {
    if (snippet.trimStart().startsWith("class ")) {
      const methodSnippets = methodHeadersFromClassSnippet(snippet);
      return methodSnippets.map((methodSnippet) => ({
        snippet: methodSnippet,
        prompt: buildMethodAgentPrompt({
          codeSheet,
          runnable,
          targetSnippet: methodSnippet,
          siblingSnippets: methodSnippets.filter((sibling) => sibling !== methodSnippet),
          targetKind: "method",
        }),
      }));
    }

    const synthesized = synthesizeNoArgClassFactory(snippet, classNames);
    return [{
      snippet,
      ...(synthesized === null
        ? {
            prompt: buildMethodAgentPrompt({
              codeSheet,
              runnable,
              targetSnippet: snippet,
              siblingSnippets: snippets.filter((sibling) => sibling !== snippet),
              targetKind: "snippet",
            }),
          }
        : { prompt: "", synthesized }),
    }];
  });
}

function buildMethodAgentPrompt(options: {
  codeSheet: CodeSheet;
  runnable: Runnable;
  targetSnippet: string;
  siblingSnippets: string[];
  targetKind: "method" | "snippet";
}): string {
  return `You are one of several parallel coding agents compiling a TypeScript worksheet.

Return exactly one JSON object and no other text: {"replacement":"<complete TypeScript code that replaces the target snippet>"}.
The first character of your response must be "{" and the last character must be "}". Do not include markdown, prose, notes, or reasoning.

Rules:
- You own exactly the target snippet and no other declaration.
- Replace only the exact target snippet.
- Do not implement, redefine, restate, or include any sibling method, class, top-level function, runnable, or test.
- If another declaration is needed, assume it will be implemented separately and only call it by its declared name.
- Preserve the public behavior required by the runnable/test function.
- Use only the Node.js standard library.
- Keep the replacement concise.
- For class methods, the replacement is inserted inside the existing class at the same indentation as the target method.
- For class methods, return only the requested method definition and its nested local helpers. Do not include sibling methods, the class header, or top-level functions.
- Helpers are allowed only when nested inside the requested declaration.
- For top-level functions, do not define nested replacements for methods on declared classes. Construct the declared class and set ordinary instance state only.
- Do not monkey-patch declared classes or assign methods onto instances or classes. Avoid MethodType, setattr for methods, and assignments such as obj.render = ... or ClassName.render = ....
- For classes without constructors, methods must work with no-argument construction. Use ordinary optional properties or nullish defaults rather than requiring constructor arguments.
- Parallel agents may complete sibling methods independently, so do not depend on a sibling method adding hidden state during construction.
- If this method handles rotation or turns, use _rotation as the shared rotation state unless the target snippet already names another state field.
- Do not include an top-level main() call.

Runnable to satisfy: ${options.runnable}
Target kind: ${options.targetKind}

Worksheet:
\`\`\`typescript
${options.codeSheet}
\`\`\`

Sibling declarations for context only. Do not implement these:
\`\`\`typescript
${options.siblingSnippets.join("\n")}
\`\`\`

Target snippet:
\`\`\`typescript
${options.targetSnippet}
\`\`\``;
}

function parseMethodAgentReplacement(raw: string, targetSnippet: string): string {
  const candidates = [
    raw.trim(),
    raw.trim().match(/```(?:json)?\s*\n([\s\S]*?)```/)?.[1]?.trim(),
    raw.trim().match(/({[\s\S]*})/)?.[1]?.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as { replacement?: unknown };
      if (typeof value.replacement === "string") {
        return extractRequestedMethodReplacement(
          normalizeMethodAgentReplacement(value.replacement),
          targetSnippet,
        );
      }
    } catch {
      // Try the next extraction shape.
    }
  }

  return extractRequestedMethodReplacement(normalizeMethodAgentReplacement(raw), targetSnippet);
}

function normalizeMethodAgentReplacement(source: string): string {
  const withoutCarriageReturns = normalizeLineEndings(source);
  const fenced = withoutCarriageReturns.trim().match(/```(?:typescript|ts|python)?\s*\n([\s\S]*?)```/)?.[1];
  return (fenced ?? withoutCarriageReturns).replace(/^\n+/, "").trimEnd();
}
