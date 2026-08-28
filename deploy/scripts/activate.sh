#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id is required}"
deploy_root="${PEPSA_DEPLOY_ROOT:-/home/pepsa/var/www/admin-backend}"
case "$release_id" in (*[!A-Za-z0-9._-]*|'') echo 'Invalid release id' >&2; exit 2;; esac
case "$deploy_root" in
  "${HOME}/var/www/admin-backend"|/home/pepsa/var/www/admin-backend|/var/www/admin-server) ;;
  (*) echo 'Unexpected deployment root' >&2; exit 2;;
esac

release_path="$deploy_root/releases/$release_id"
test -d "$release_path"
test -f "$release_path/package.json"
test -f "$deploy_root/shared/.env"
previous="$(readlink "$deploy_root/current" 2>/dev/null || true)"

cd "$release_path"
ln -sfn "$deploy_root/shared/.env" .env
set -a
# shellcheck source=/dev/null
source "$deploy_root/shared/.env"
set +a
# shellcheck source=/dev/null
source "$release_path/deploy/scripts/bootstrap-node.sh"
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm build
pnpm prisma:migrate
ln -sfn "$release_path" "$deploy_root/current"
cd "$deploy_root/current"
pm2 startOrReload ecosystem.config.cjs --update-env

if ! bash deploy/scripts/wait-for-http.sh http://127.0.0.1:3300/admin-api/v1/health/live; then
  if test -n "$previous" && test -d "$previous"; then
    ln -sfn "$previous" "$deploy_root/current"
    cd "$deploy_root/current"
    pm2 startOrReload ecosystem.config.cjs --update-env
  fi
  echo 'Admin API readiness verification failed; release was rolled back.' >&2
  exit 1
fi
pm2 save
echo "Activated admin backend $release_id at $deploy_root"
