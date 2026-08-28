#!/usr/bin/env bash
# Load Node/pnpm/pm2 for non-interactive deploy shells (SSH from GitHub Actions).
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${PATH}"

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "${HOME}/.nvm/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo 'node is not installed or not on PATH' >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  :
elif command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@11.18.0 --activate
elif command -v npm >/dev/null 2>&1; then
  npm install -g pnpm@11.18.0
else
  echo 'pnpm is unavailable and could not be bootstrapped' >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    npm install -g pm2
  else
    echo 'pm2 is not installed' >&2
    exit 1
  fi
fi

echo "Using node $(node -v) pnpm $(pnpm -v) pm2 $(pm2 -v)"
