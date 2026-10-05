#!/usr/bin/env bash
set -euo pipefail

deploy_root="${PEPSA_DEPLOY_ROOT:-${HOME}/var/www/admin-backend}"
cd "$deploy_root"

test -d .git || {
  echo "ERROR: $deploy_root is not a git clone. Clone the admin backend repo there first." >&2
  exit 1
}
test -f shared/.env || {
  echo "ERROR: missing $deploy_root/shared/.env" >&2
  exit 1
}

mkdir -p shared logs
ln -sfn shared/.env .env

set -a
# shellcheck source=/dev/null
source "$deploy_root/shared/.env"
set +a

# shellcheck source=/dev/null
source "$deploy_root/deploy/scripts/bootstrap-node.sh"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
export PEPSA_PM2_ENV="${PEPSA_PM2_ENV:-production}"
if [[ -z "${PORT:-}" ]]; then
  if [[ "$PEPSA_PM2_ENV" == "staging" ]]; then
    export PORT=3301
  else
    export PORT=3300
  fi
fi

pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm build
pnpm prisma:migrate

pm2 startOrReload ecosystem.config.cjs --update-env

bash deploy/scripts/wait-for-http.sh "http://127.0.0.1:${PORT}/admin-api/v1/health/live"

pm2 save
echo "Admin backend deployed at $(git rev-parse --short HEAD) (PEPSA_PM2_ENV=${PEPSA_PM2_ENV}, PORT=${PORT})"
