import type { Page } from "playwright";
import {
  compileCodeSheetToTypeScript,
  transpileTypeScript,
  type TypeScriptCompileResult,
} from "./typescriptTarget";
import type { CodeCache, CodeSheet, CompleteFunction, Runnable } from "./codeSheet";

export type CheckResult = {
  ok: boolean;
  failures: string[];
};

export type GeneratedCode = {
  code: string;
  completedSource: string;
  compiled: TypeScriptCompileResult;
};

export type GenerateCodeOptions = {
  cache?: CodeCache;
  complete?: CompleteFunction;
};

export type CheckCodeOptions = {
  expectedKind?: "program" | "webpage";
  promptFragments?: string[];
  requiredSubstrings?: string[];
  forbiddenPatterns?: Array<RegExp | string>;
};

export type CheckWebPageOptions = {
  expectShadcn?: boolean;
  minVisibleTextLength?: number;
};

export async function generateCode(
  sheet: CodeSheet,
  runnable: Runnable,
  options: GenerateCodeOptions = {},
): Promise<GeneratedCode> {
  const compiled = await compileCodeSheetToTypeScript(sheet, runnable, {
    cache: options.cache ?? new Map(),
    complete: options.complete,
  });

  return {
    code: compiled.program,
    completedSource: compiled.completed.source,
    compiled,
  };
}

export function checkCode(code: string, options: CheckCodeOptions = {}): CheckResult {
  const failures: string[] = [];
  const source = code.trim();

  if (source.length === 0) {
    failures.push("generated code is empty");
  }

  try {
    transpileTypeScript(code);
  } catch (error) {
    failures.push(`generated code does not typecheck: ${errorMessage(error)}`);
  }

  const genericForbidden: Array<[RegExp, string]> = [
    [/```/, "generated code still contains markdown fences"],
    [/\bTODO\b|throw new Error\(["'`]No implementation for /, "generated code contains placeholder implementation text"],
    [/\[object Object\]/, "generated code contains [object Object]"],
    [/\bundefined\b\s*\+\s*["'`]|["'`]\s*\+\s*\bundefined\b/, "generated code appears to concatenate undefined into output"],
  ];
  for (const [pattern, message] of genericForbidden) {
    if (pattern.test(code)) {
      failures.push(message);
    }
  }

  for (const fragment of options.promptFragments ?? []) {
    const trimmed = fragment.trim();
    if (trimmed.length > 0 && code.toLowerCase().includes(trimmed.toLowerCase())) {
      failures.push(`generated code appears to echo prompt fragment: ${trimmed}`);
    }
  }

  for (const required of options.requiredSubstrings ?? []) {
    if (!code.includes(required)) {
      failures.push(`generated code is missing required substring: ${required}`);
    }
  }

  for (const forbidden of options.forbiddenPatterns ?? []) {
    const matched = typeof forbidden === "string" ? code.includes(forbidden) : forbidden.test(code);
    if (matched) {
      failures.push(`generated code matched forbidden pattern: ${String(forbidden)}`);
    }
  }

  if (options.expectedKind === "webpage") {
    if (!/\bshadcn\.renderApp\b/.test(code)) {
      failures.push("generated WebPage code does not use shadcn.renderApp");
    }
    if (!/\bconst __logosResult = /.test(code)) {
      failures.push("generated WebPage code is not wrapped as a runnable program");
    }
    if (hasStringHandlerShadcnButton(code)) {
      failures.push("generated WebPage code passes a string handler as Button text instead of an onClick prop");
    }
    if (/\b(?:alert|confirm|prompt)\s*\(/.test(code)) {
      failures.push("generated WebPage code uses blocking browser dialogs instead of rendering UI state");
    }
    if (/\bre-?render required\b/i.test(code)) {
      failures.push("generated WebPage code contains a fake re-render placeholder");
    }
  }

  return toResult(failures);
}

export function checkWebPageHtml(html: string, options: CheckWebPageOptions = {}): CheckResult {
  const failures: string[] = [];
  const trimmed = html.trim();

  if (trimmed.length === 0) {
    failures.push("webpage html is empty");
  }
  if (!/^<!doctype html>|<html[\s>]/i.test(trimmed)) {
    failures.push("webpage html is not a full HTML document");
  }
  if (options.expectShadcn !== false && !/data-shadcn-runtime/.test(html)) {
    failures.push("webpage html is missing the shadcn runtime marker");
  }
  if (/\b(?:alert|confirm|prompt)\s*\(/.test(html)) {
    failures.push("webpage html uses blocking browser dialogs instead of rendering UI state");
  }
  if (/\bre-?render required\b/i.test(html)) {
    failures.push("webpage html contains a fake re-render placeholder");
  }
  for (const [pattern, label] of invalidHtmlOutputPatterns()) {
    if (pattern.test(html)) {
      failures.push(`webpage html contains ${label}`);
    }
  }

  return toResult(failures);
}

export async function checkWebPage(page: Page, html: string, options: CheckWebPageOptions = {}): Promise<CheckResult> {
  const failures = [...checkWebPageHtml(html, options).failures];
  const browserErrors: string[] = [];
  const onPageError = (error: Error): void => {
    browserErrors.push(error.message);
  };
  const onConsole = (message: { type(): string; text(): string }): void => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  try {
    await page.setContent(html, { waitUntil: "load" });
    const visibleText = await page.locator("body").innerText().catch(() => "");
    const minLength = options.minVisibleTextLength ?? 1;
    if (visibleText.trim().length < minLength) {
      failures.push("webpage has no meaningful visible text");
    }

    for (const [pattern, label] of invalidVisibleOutputPatterns()) {
      if (pattern.test(visibleText)) {
        failures.push(`webpage visible text contains ${label}`);
      }
    }

    const buttons = await page.locator("button").evaluateAll((items) => {
      return items.map((button) => ({
        text: button.textContent?.trim() ?? "",
        ariaLabel: button.getAttribute("aria-label") ?? "",
        title: button.getAttribute("title") ?? "",
        hasClickHandler: button.hasAttribute("onclick") || button.getAttribute("data-action") !== null,
      }));
    });
    for (const [index, button] of buttons.entries()) {
      const name = button.text || button.ariaLabel || button.title;
      if (name.trim().length === 0) {
        failures.push(`button ${index + 1} has no visible or accessible name`);
      }
      for (const [pattern, label] of invalidVisibleOutputPatterns()) {
        if (pattern.test(name)) {
          failures.push(`button ${index + 1} name contains ${label}`);
        }
      }
      if (looksLikeJavaScriptCall(name)) {
        failures.push(`button ${index + 1} name contains JavaScript handler text`);
      }
      if (!button.hasClickHandler && (looksInteractiveButtonName(name) || looksLikeJavaScriptCall(name))) {
        failures.push(`button ${index + 1} looks interactive but has no click handler`);
      }
    }

    if (browserErrors.length > 0) {
      failures.push(`webpage raised browser errors: ${browserErrors.join("; ")}`);
    }
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }

  return toResult(failures);
}

function invalidVisibleOutputPatterns(): Array<[RegExp, string]> {
  return [
    [/\[object Object\]/, "[object Object]"],
    [/\bundefined\b/, "undefined"],
    [/\bNaN\b/, "NaN"],
    [/\bnull\b/, "null"],
    [/\bfunction\s*\(|=>\s*\{/, "raw function source"],
  ];
}

function hasStringHandlerShadcnButton(code: string): boolean {
  return /\bshadcn\.Button\s*\(\s*(["'`])(?:\\.|(?!\1)[\s\S])*?\1\s*,\s*(["'`])\s*[A-Za-z_$][\w$]*(?:\s*\([^"'`]*\))?\s*\2\s*\)/.test(code);
}

function looksLikeJavaScriptCall(value: string): boolean {
  return /\b[A-Za-z_$][\w$]*\s*\([^)]*\)/.test(value);
}

function looksInteractiveButtonName(value: string): boolean {
  return /\b(?:add|apply|approve|cancel|click|create|delete|download|increment|next|open|remove|reset|run|save|send|start|submit|toggle|update)\b/i.test(value);
}

function invalidHtmlOutputPatterns(): Array<[RegExp, string]> {
  return [
    [/\[object Object\]/, "[object Object]"],
    [/\bundefined\b/, "undefined"],
    [/\bNaN\b/, "NaN"],
    [/\bnull\b/, "null"],
  ];
}

function toResult(failures: string[]): CheckResult {
  return {
    ok: failures.length === 0,
    failures,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
