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

The production server requires `ANTHROPIC_API_KEY`. Generated programs run as
TypeScript through `tsx`; interactive terminal apps can use `neo-blessed`.
The server serves the
Vite build from `dist`, exposes interactive run session endpoints under
`/api/run/*`, and caches completed snippets in a process-local map backed by
durable storage. Local development uses files under `logs/` unless object
storage is configured.

## Object Storage

Production durability uses one S3-compatible bucket for shared sessions, code
cache entries, and feedback capture:

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
- `feedback/`

When `BUCKET_NAME` is unset, the server uses local files. That fallback is for
development only and is not durable across replacement machines or image
rebuilds.

## Shared Sessions

The Share button stores a loadable session blob and returns a URL with
`?session=<share-id>`.

## Code Cache

Compile and run share a global code cache keyed by completion hash.

Fly deployment is configured with `Dockerfile`, `fly.toml`, and
`.github/workflows/deploy.yml`. The `Deploy dev` workflow runs automatically
after CI passes on `main`. The `Deploy prod` workflow is manual-only and must be
run from `main`. Configure GitHub environments named `dev` and `prod` with:

- `FLY_API_TOKEN` environment or repository secret
- `FLY_APP_NAME` environment variable for that Fly app
- `ANTHROPIC_API_KEY` Fly secret
- object-storage secrets such as `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`,
  `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`

The main code sheet compiler lives in `src/domain/codeSheet.ts`. The runtime API lives
in `src/runtime/codeSheetRunner.ts` and `src/server/index.ts`.
