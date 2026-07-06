#!/usr/bin/env bash
set -euo pipefail

image="${1:-logos-interviews-smoke}"
container_id="$(docker run --rm -d -p 127.0.0.1:0:8080 -e LOGOS_ANTHROPIC_API_KEY="${LOGOS_ANTHROPIC_API_KEY:?}" "$image")"

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
pnpm smoke:deployment -- --base-url "$base_url"
