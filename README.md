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
pnpm test:e2e
pnpm build
pnpm start
```

`pnpm dev` runs the Vite development server. `pnpm build && pnpm start`
builds and serves the deployable app with a production Node server.
`pnpm test:e2e` runs deterministic end-to-end tests. The live Anthropic
reliability eval is opt-in with `RUN_ANTHROPIC_E2E=true pnpm test:e2e`.
The `Anthropic E2E` GitHub Actions workflow runs that live eval on relevant
`main` changes and on a weekday work-hours cadence, skipping scheduled runs
when the current `main` SHA has already passed.

The production server requires `ANTHROPIC_API_KEY` and `python3`. It serves the
Vite build from `dist`, exposes interactive run session endpoints under
`/api/run/*`, and caches completed snippets in memory for the lifetime of the
process.

## Session Capture

The browser posts first-party session events to `/api/session-events` while the
app is open. Events include clicks, form changes, editor snapshots, browser
errors, page visibility changes, API request/response metadata, run results, and
agent turns. Important events include an app snapshot with the current editor
contents, output, implementation view, selected sample, active tab, run status,
agent messages, viewport, focus state, and URL.

For durable production capture, configure S3-compatible object storage. The
server writes one newline-delimited JSON object per request under
`<prefix>/session-events/YYYY/MM/DD/*.jsonl`; feedback records are written under
`<prefix>/feedback/YYYY/MM/DD/*.jsonl`. This layout avoids unsafe append writes
to object storage.

```sh
SESSION_CAPTURE_S3_BUCKET=...
SESSION_CAPTURE_S3_REGION=...
SESSION_CAPTURE_S3_ENDPOINT=... # optional for Tigris, R2, MinIO, etc.
SESSION_CAPTURE_S3_PREFIX=session-capture
SESSION_CAPTURE_S3_FORCE_PATH_STYLE=false
FEEDBACK_CAPTURE_S3_BUCKET=... # optional; falls back to session bucket
FEEDBACK_CAPTURE_S3_PREFIX=... # optional; defaults below session prefix
```

Fly/Tigris-style `BUCKET_NAME` and `AWS_ENDPOINT_URL_S3` are also accepted when
the capture-specific bucket or endpoint variables are unset. Credentials use
the standard AWS SDK environment variables, such as `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`.

If S3-compatible storage is not configured, the server appends JSONL records to
`SESSION_CAPTURE_DIR/session-events.jsonl`, or `logs/session-events.jsonl` when
`SESSION_CAPTURE_DIR` is unset. This local fallback is useful for development
but is not durable across replacement machines or image rebuilds.

This captures browser-visible and application state only. Browsers do not expose
arbitrary OS or machine state to web apps; for full reproduction, replay against
the captured app snapshots and API responses for a given `sessionId`.

## Shared Sessions

The Share button stores a loadable session blob and returns a URL with
`?session=<share-id>`. Local development stores those blobs in
`SHARED_SESSION_DIR`, or `logs/shared-sessions` if unset.

For durable share links in production, configure S3-compatible object storage:

```sh
SHARED_SESSION_S3_BUCKET=...
SHARED_SESSION_S3_REGION=...
SHARED_SESSION_S3_ENDPOINT=... # optional for R2, Tigris, MinIO, etc.
SHARED_SESSION_S3_PREFIX=shared-sessions
SHARED_SESSION_S3_FORCE_PATH_STYLE=false
```

Credentials use the standard AWS SDK environment variables, such as
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Fly/Tigris-style `BUCKET_NAME` and `AWS_ENDPOINT_URL_S3` are accepted for shared
sessions too when the shared-session-specific bucket or endpoint variables are
unset.

Fly deployment is configured with `Dockerfile`, `fly.toml`, and
`.github/workflows/deploy.yml`. Configure the repository with:

- `FLY_API_TOKEN` repository secret
- `FLY_APP_NAME` repository variable
- `ANTHROPIC_API_KEY` Fly secret
- S3/Tigris capture storage secrets such as `BUCKET_NAME`,
  `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`

The main code sheet compiler lives in `src/codeSheet.ts`. The runtime API lives
in `src/codeSheetRunner.ts` and `src/server.ts`.
