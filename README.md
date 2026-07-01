# Logos TypeScript Baseline

A browser-based Logos workbench hard-forked to target TypeScript instead of
Python.

It includes:

- A Logos editor with four migrated baseline samples:
  `Intro to Logos`, `Beyond Basics`, `Formula spreadsheet`, and `Annotated maze`.
- A TypeScript compilation target that emits executable TypeScript modules.
- A Node-backed run path for compiled programs.
- A focused baseline test suite that runs those four samples through the
  TypeScript target.

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

`pnpm test` is intentionally scoped to the destructive TypeScript migration
contract: the four baseline sample files must compile and run through the
TypeScript target.

The production server requires `ANTHROPIC_API_KEY` only when live LLM completion
is used. Program execution uses Node, not Python. The server serves the Vite
build from `dist`, exposes interactive run session endpoints under `/api/run/*`,
and caches completed snippets in a process-local map backed by durable storage.
Local development uses files under `logs/` unless object storage is configured.

## Object Storage

Production durability uses one S3-compatible bucket for shared sessions, code
cache entries, session capture, and feedback capture:

```sh
BUCKET_NAME=...
AWS_REGION=...
AWS_ENDPOINT_URL_S3=... # optional for Tigris, R2, MinIO, etc.
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Objects are written under fixed prefixes:

- `shared-sessions/`
- `code-cache/`
- `session-capture/session-events/`
- `session-capture/feedback/`

When `BUCKET_NAME` is unset, the server uses local files. That fallback is for
development only and is not durable across replacement machines or image
rebuilds.

## Session Capture

The browser posts first-party session events to `/api/session-events` while the
app is open. Events include clicks, form changes, editor snapshots, browser
errors, page visibility changes, API request/response metadata, run results, and
agent turns. Important events include an app snapshot with the current editor
contents, output, implementation view, selected sample, active tab, run status,
agent messages, viewport, focus state, and URL. Capture records are written as
newline-delimited JSON, one object per request, to avoid unsafe append writes to
object storage.

This captures browser-visible and application state only. Browsers do not expose
arbitrary OS or machine state to web apps; for full reproduction, replay against
the captured app snapshots and API responses for a given `sessionId`.

## Shared Sessions

The Share button stores a loadable session blob and returns a URL with
`?session=<share-id>`.

## Code Cache

Compile and run share a global code cache keyed by completion hash.

Fly deployment is configured with `Dockerfile`, `fly.toml`, and
`.github/workflows/deploy.yml`. Configure the repository with:

- `FLY_API_TOKEN` repository secret
- `FLY_APP_NAME` repository variable
- `ANTHROPIC_API_KEY` Fly secret
- object-storage secrets such as `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`,
  `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`

The TypeScript target compiler lives in `src/typescriptTarget.ts`. The runtime
API lives in `src/codeSheetRunner.ts` and `src/server.ts`.
