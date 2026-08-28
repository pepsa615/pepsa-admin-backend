#!/usr/bin/env bash
# Poll an HTTP URL until it succeeds or times out.
set -euo pipefail

url="${1:?usage: wait-for-http.sh <url> [initial_sleep_sec] [max_attempts] [retry_delay_sec]}"
initial_sleep="${2:-${PEPSA_READINESS_INITIAL_SLEEP:-10}}"
max_attempts="${3:-${PEPSA_READINESS_MAX_ATTEMPTS:-20}}"
retry_delay="${4:-${PEPSA_READINESS_RETRY_DELAY:-3}}"

echo "Waiting ${initial_sleep}s before readiness check: $url"
sleep "$initial_sleep"

for attempt in $(seq 1 "$max_attempts"); do
  if curl --fail --silent --show-error "$url" >/dev/null; then
    echo "Ready: $url"
    exit 0
  fi
  if [[ "$attempt" -lt "$max_attempts" ]]; then
    echo "Not ready yet ($attempt/$max_attempts), retrying in ${retry_delay}s..."
    sleep "$retry_delay"
  fi
done

echo "Readiness check timed out: $url" >&2
exit 1
