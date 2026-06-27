# Spreadsheet Interview Tool

A small browser-based interviewing tool for exploring an Excel-style sheet evaluator.

It includes:

- A candidate scaffold editor that detects `???` holes and generates focused fill prompts.
- A TypeScript spreadsheet evaluator with `get`, `set`, formulas, cell references, recursive-cycle detection, and division-by-zero errors.
- A spreadsheet sandbox for trying values and formulas directly in the browser.

## Commands

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

The main evaluator lives in `src/spreadsheet.ts`. The hole detector lives in `src/holes.ts`.
