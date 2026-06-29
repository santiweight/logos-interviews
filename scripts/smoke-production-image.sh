#!/usr/bin/env bash
set -euo pipefail

image="${1:-logos-interviews-smoke}"
container_id="$(docker run --rm -d -p 127.0.0.1:0:8080 "$image")"

cleanup() {
  docker rm -f "$container_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

host_port="$(docker port "$container_id" 8080/tcp | sed 's/.*://')"
base_url="http://127.0.0.1:${host_port}"

for _ in $(seq 1 30); do
  if curl -fsS "${base_url}/healthz" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "${base_url}/healthz" >/dev/null
./scripts/smoke-deployment.sh "$base_url"

capture_response="$(
  curl -fsS \
    -X POST "${base_url}/api/session-events" \
    -H "Content-Type: application/json" \
    --data '{"sessionId":"smoke-session","events":[{"type":"session_start"}]}'
)"

case "$capture_response" in
  *'"ok":true'*'"captured":1'*) ;;
  *)
    echo "Unexpected session capture response: ${capture_response}" >&2
    exit 1
    ;;
esac

docker exec "$container_id" test -s /app/logs/session-events.jsonl
