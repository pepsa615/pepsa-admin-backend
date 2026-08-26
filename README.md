# Pepsa Admin Backend

Independent Express.js and TypeScript control-plane API for Pepsa administrators.
It owns admin identity, platform-scoped authorization, audit, orchestration, and
platform integrations. It must never query a connected platform's database.

## Local development

Requirements: Node.js 22.12 or newer and pnpm 11.

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
pnpm dev:worker
```

The API listens on `http://localhost:3300` by default. Its versioned base path is
`/admin-api/v1`, with liveness at `/admin-api/v1/health/live`.

For production, `pnpm start` launches both the API and operation worker. Use
`pnpm start:api` or `pnpm start:worker` only when an external process manager
runs them separately.

The PostgreSQL schema and migration are under `prisma/`. The OpenAPI source of
truth is `src/contracts/openapi.yaml`. Never set bootstrap credentials after the
first administrator has enrolled MFA.

## First platform integration

`src/integrations/business-as-a-service` is the first adapter. All future calls
to the existing Business-as-a-Service backend must remain behind that adapter
and use its versioned HTTP API.

Set the same strong value in admin `ACTOR_SIGNING_SECRET` and BAS
`ADMIN_CONTROL_PLANE_SIGNING_SECRET`. The services and databases remain
independently deployed; only the versioned HTTP contract connects them.

## Verification

```bash
pnpm typecheck
pnpm contract:check
pnpm test
pnpm lint
pnpm build
pnpm format:check
```

CI starts a disposable PostgreSQL 17 service, deploys every migration, seeds the control plane, and runs the access-lifecycle integration suite. Set `TEST_DATABASE_URL` to include this real database test locally; unit-only runs skip it.

Security, backup, revocation, and credential rotation procedures live in
`docs/security/runbook.md`. BAS integration behavior is documented in
`docs/integrations/business-as-a-service.md`.
