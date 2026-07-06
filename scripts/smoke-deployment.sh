#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-}"
if [[ -z "$base_url" ]]; then
  echo "Usage: $0 <base-url>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for deployment smoke JSON checks" >&2
  exit 2
fi

base_url="${base_url%/}"
smoke_id="logos-deployment-smoke-${GITHUB_SHA:-local}-$(date +%s)-$$"
smoke_output="logos deployment smoke ok ${smoke_id}"
sheet="$(
  SMOKE_OUTPUT="$smoke_output" node <<'NODE'
const output = process.env.SMOKE_OUTPUT;
process.stdout.write(`function smoke_compile_run(): void {
  console.log(${JSON.stringify(output)});
}`);
NODE
)"

json_payload_for() {
  PAYLOAD_SHEET="$1" PAYLOAD_RUNNABLE="$2" node <<'NODE'
process.stdout.write(JSON.stringify({
  sheet: process.env.PAYLOAD_SHEET,
  runnable: process.env.PAYLOAD_RUNNABLE,
  compilationStrategy: "sequential",
}));
NODE
}

json_run_payload_for() {
  PAYLOAD_SHEET="$1" PAYLOAD_RUNNABLE="$2" PAYLOAD_IMPLEMENTATION="$3" PAYLOAD_IMPL_SHEET_ID="$4" PAYLOAD_SHEET_ID="$5" node <<'NODE'
process.stdout.write(JSON.stringify({
  sheet: process.env.PAYLOAD_SHEET,
  sheetId: process.env.PAYLOAD_SHEET_ID,
  runnable: process.env.PAYLOAD_RUNNABLE,
  implementation: process.env.PAYLOAD_IMPLEMENTATION,
  implSheetId: process.env.PAYLOAD_IMPL_SHEET_ID,
}));
NODE
}

post_json() {
  local path="$1"
  local payload="$2"
  local body_file
  local status

  body_file="$(mktemp)"
  status="$(
    curl -sS \
      -o "$body_file" \
      -w "%{http_code}" \
      -X POST "${base_url}${path}" \
      -H "Content-Type: application/json" \
      --data "$payload"
  )" || {
    local exit_code=$?
    echo "POST ${base_url}${path} failed with curl exit code ${exit_code}" >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    exit "$exit_code"
  }

  local body
  body="$(cat "$body_file")"
  rm -f "$body_file"

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "POST ${base_url}${path} returned HTTP ${status}: ${body}" >&2
    exit 1
  fi

  printf '%s' "$body"
}

check_compile_response() {
  COMPILE_RESPONSE="$1" EXPECTED_RUNNABLE="$2" node <<'NODE'
const lines = process.env.COMPILE_RESPONSE
  .split(/\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const events = lines.map((line) => JSON.parse(line));
const failure = events.find((event) => event.kind === "error");
if (failure) {
  throw new Error(`compile stream error: ${failure.error}`);
}
const diagnostics = events
  .filter((event) => event.kind === "typecheck")
  .flatMap((event) => event.diagnostics ?? []);
if (diagnostics.length > 0) {
  throw new Error(`compile typecheck diagnostics: ${JSON.stringify(diagnostics)}`);
}
const readiness = events.filter((event) => event.kind === "readiness").at(-1);
const smokeRunnable = readiness?.definitions?.find((definition) => definition.name === process.env.EXPECTED_RUNNABLE);
if (!smokeRunnable?.ready) {
  throw new Error(`smoke runnable was not ready: ${JSON.stringify(readiness)}`);
}
if (events.at(-1)?.kind !== "compiled") {
  throw new Error(`compile did not finish with compiled marker: ${JSON.stringify(events.at(-1))}`);
}
NODE
}

compiled_implementation() {
  COMPILE_RESPONSE="$1" node <<'NODE'
const lines = process.env.COMPILE_RESPONSE
  .split(/\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const events = lines.map((line) => JSON.parse(line));
const compiled = events.findLast((event) => event.kind === "compiled");
if (typeof compiled?.implementation !== "string" || compiled.implementation.length === 0) {
  throw new Error(`compile response did not include implementation: ${JSON.stringify(events.at(-1))}`);
}
process.stdout.write(compiled.implementation);
NODE
}

json_field() {
  RESPONSE="$1" FIELD="$2" node <<'NODE'
const response = JSON.parse(process.env.RESPONSE);
const value = process.env.FIELD.split(".").reduce((current, part) => current?.[part], response);
process.stdout.write(value === undefined || value === null ? "" : String(value));
NODE
}

check_default_project_response() {
  DEFAULT_PROJECT_RESPONSE="$1" node <<'NODE'
const response = JSON.parse(process.env.DEFAULT_PROJECT_RESPONSE);
if (response.ok !== true || !Array.isArray(response.sheets) || response.sheets.length === 0) {
  throw new Error(`default project response was not valid: ${JSON.stringify(response)}`);
}
NODE
}

chunk_text() {
  RESPONSE="$1" node <<'NODE'
const response = JSON.parse(process.env.RESPONSE);
process.stdout.write((response.chunks ?? []).map((chunk) => chunk.text ?? "").join(""));
NODE
}

check_interactive_run() {
  local payload="$1"
  local expected_output="$2"
  local start_response
  local session_id
  local output
  local state
  local code
  local poll_payload
  local poll_response
  local re_poll_payload
  local re_poll_response

  start_response="$(post_json "/api/run/start" "$payload")"
  session_id="$(json_field "$start_response" "sessionId")"
  if [[ -z "$session_id" ]]; then
    echo "Run start response did not include a session id: ${start_response}" >&2
    exit 1
  fi

  output="$(chunk_text "$start_response")"
  state="$(json_field "$start_response" "status.state")"
  code="$(json_field "$start_response" "status.code")"

  for _ in $(seq 1 40); do
    if [[ "$state" == "exited" ]]; then
      break
    fi

    sleep 0.25
    poll_payload="$(
      SESSION_ID="$session_id" node <<'NODE'
process.stdout.write(JSON.stringify({ sessionId: process.env.SESSION_ID }));
NODE
    )"
    poll_response="$(post_json "/api/run/poll" "$poll_payload")"
    output="${output}$(chunk_text "$poll_response")"
    state="$(json_field "$poll_response" "status.state")"
    code="$(json_field "$poll_response" "status.code")"
  done

  if [[ "$state" != "exited" ]]; then
    echo "Run did not exit before timeout. Last state: ${state}" >&2
    exit 1
  fi

  if [[ "$code" != "0" ]]; then
    echo "Run exited with code ${code}. Output: ${output}" >&2
    exit 1
  fi

  if [[ "$output" != *"$expected_output"* ]]; then
    echo "Run output did not include expected smoke marker." >&2
    echo "Expected: ${expected_output}" >&2
    echo "Actual: ${output}" >&2
    exit 1
  fi

  re_poll_payload="$(
    SESSION_ID="$session_id" node <<'NODE'
process.stdout.write(JSON.stringify({ sessionId: process.env.SESSION_ID }));
NODE
  )"
  re_poll_response="$(post_json "/api/run/poll" "$re_poll_payload")"
  if [[ "$(json_field "$re_poll_response" "status.state")" != "exited" ]]; then
    echo "Completed run session was not pollable: ${re_poll_response}" >&2
    exit 1
  fi
}

echo "Checking ${base_url}/healthz"
for _ in $(seq 1 30); do
  health_response="$(curl -fsS "${base_url}/healthz" 2>/dev/null || true)"
  if [[ "$health_response" == '{"ok":true}' ]]; then
    break
  fi
  sleep 1
done
health_response="$(curl -fsS "${base_url}/healthz")"
if [[ "$health_response" != '{"ok":true}' ]]; then
  echo "Unexpected health response from ${base_url}/healthz: ${health_response}" >&2
  exit 1
fi

echo "Checking default project API"
default_project_response="$(curl -fsS "${base_url}/api/project/default")"
check_default_project_response "$default_project_response"

payload="$(json_payload_for "$sheet" "smoke_compile_run")"

echo "Checking compile stream"
compile_response="$(post_json "/api/compile" "$payload")"
check_compile_response "$compile_response" "smoke_compile_run"
implementation="$(compiled_implementation "$compile_response")"
run_payload="$(json_run_payload_for "$sheet" "smoke_compile_run" "$implementation" "${smoke_id}-smoke_compile_run-impl" "${smoke_id}-sheet")"

echo "Checking interactive compile + run lifecycle"
check_interactive_run "$run_payload" "$smoke_output"

if [[ "${SMOKE_ANTHROPIC_E2E:-false}" == "true" ]]; then
  unique_suffix="$(date +%s)_$$"
  llm_function="smoke_add_${unique_suffix}"
  llm_runnable="smoke_llm_compile_run_${unique_suffix}"
  llm_sheet="$(
    LLM_FUNCTION="$llm_function" LLM_RUNNABLE="$llm_runnable" node <<'NODE'
const fn = process.env.LLM_FUNCTION;
const runnable = process.env.LLM_RUNNABLE;
process.stdout.write(`function ${fn}(x: number, y: number): number

function ${runnable}(): void {
  console.log(${fn}(1, 2));
}`);
NODE
  )"
  llm_payload="$(json_payload_for "$llm_sheet" "$llm_runnable")"

  echo "Checking live Anthropic compile + run lifecycle"
  llm_compile_response="$(post_json "/api/compile" "$llm_payload")"
  check_compile_response "$llm_compile_response" "$llm_runnable"
  llm_implementation="$(compiled_implementation "$llm_compile_response")"
  llm_run_payload="$(json_run_payload_for "$llm_sheet" "$llm_runnable" "$llm_implementation" "${smoke_id}-${llm_runnable}-impl" "${smoke_id}-${llm_runnable}-sheet")"
  check_interactive_run "$llm_run_payload" "3"
fi

echo "Deployment smoke passed for ${base_url}"
