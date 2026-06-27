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
pnpm start
```

`pnpm dev` runs the Vite development server. `pnpm build && pnpm start`
builds and serves the deployable app with a production Node server.

The production server requires `ANTHROPIC_API_KEY` and `python3`. It serves the
Vite build from `dist`, exposes `/api/run`, and caches completed snippets in
memory for the lifetime of the process.

## Session Capture

The browser posts first-party session events to `/api/session-events` while the
app is open. Events include clicks, form changes, editor snapshots, browser
errors, page visibility changes, API request/response metadata, run results, and
agent turns. Important events include an app snapshot with the current editor
contents, output, implementation view, selected sample, active tab, run status,
agent messages, viewport, focus state, and URL.

The server appends JSONL records to `SESSION_CAPTURE_DIR/session-events.jsonl`.
If `SESSION_CAPTURE_DIR` is unset, it writes to `logs/session-events.jsonl`.
Each line includes `sessionId`, request metadata, receive time, and the captured
event. The log directory is ignored by git.

This captures browser-visible and application state only. Browsers do not expose
arbitrary OS or machine state to web apps; for full reproduction, replay against
the captured app snapshots and API responses for a given `sessionId`.

Fly deployment is configured with `Dockerfile`, `fly.toml`, and
`.github/workflows/deploy.yml`. Configure the repository with:

- `FLY_API_TOKEN` repository secret
- `FLY_APP_NAME` repository variable
- `ANTHROPIC_API_KEY` Fly secret

The main code sheet compiler lives in `src/codeSheet.ts`. The runtime API lives
in `src/codeSheetRunner.ts` and `src/server.ts`.
