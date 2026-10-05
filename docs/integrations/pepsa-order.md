# Pepsa Order integration

The control plane and pepsa-order are independently built and deployed. They share no runtime package or database access; all administration crosses `pepsa-order` `/internal/v1` through `PepsaOrderAdapter` (`admin/backend/src/integrations/pepsa-order/`).

Unlike BAS’s generic operations facade, the adapter keeps a static capability catalogue and maps each operation key to a concrete destination method and path. Admin HTTP stays on the shared `/admin-api/v1/operations/pepsa-order/:operation` surface; no platform-specific routes are required.

## Runtime adapter

| Concern | Behavior |
| --- | --- |
| Registration | `create-registry.ts` registers `PepsaOrderAdapter` with `config.orderService` + `ACTOR_SIGNING_SECRET` |
| Health | `GET /internal/v1/fleet/health` with a system actor token |
| Capabilities | Static catalogue (Phase 0 matrix); admin methods are `GET` \| `POST` |
| Path mapping | Path params (`partnerId`, `taskId`, …) taken from query/payload; stripped from upstream body |
| Upstream methods | May differ from admin method (e.g. `partners-update` is admin `POST` → destination `PATCH`) |
| Actor token | HS256, issuer `pepsa-admin`, audience `pepsa-order`, `platform=pepsa-order`, ~60s, single permission, `jti`, correlated `requestId` |
| Mutation headers | `X-Operator-Id`, `X-Change-Reason` (from payload `reason`), `X-Request-Id`, `Idempotency-Key` |
| Resilience | `PLATFORM_REQUEST_TIMEOUT_MS`; retry safe/idempotent reads only; circuit breaker isolates unavailable order |
| Audit | Control-plane `OperationService` records admin audit; destination records attributed audits via mutation headers + request ID |

Contract tests: `admin/backend/src/integrations/pepsa-order/index.test.ts`.

## Platform metadata

| Field | Value |
| --- | --- |
| Platform key | `pepsa-order` |
| Adapter type | `pepsa-order` |
| Environments | Deploy lane only — staging admin → staging order URL; production admin → production order URL. Actor JWT `environment` claim is always `production` (scope label), not an in-app sandbox switch |
| Audience (actor token) | `pepsa-order` |
| Issuer (actor token) | `pepsa-admin` |
| Owner | TBD (ops follow-up) |
| SLO | TBD (ops follow-up) |
| Incident contact | TBD (ops follow-up) |
| Network policy | Restrict `/internal/v1` to admin control-plane egress only; separate secrets per environment |

## Auth migration

### Destination (Phase 1)

- Prefer short-lived HS256 **actor tokens** (~60s), issuer `pepsa-admin`, audience `pepsa-order`.
- Destination re-checks issuer, audience, expiry, platform, permission (admin catalogue keys), and request ID; reject replay via `InternalAdminActorNonce`.
- Mutations require `X-Operator-Id`, `X-Change-Reason` (3–500 chars), `X-Request-Id`, `Idempotency-Key`.

### Interim (sandbox spike only)

- Shared-key adapter using `INTERNAL_ADMIN_TOKEN` is allowed **only when `APP_ENV` is `sandbox` or `local`** and `ADMIN_CONTROL_PLANE_SIGNING_SECRET` is unset.
- **Never** enable interim shared admin keys in production (`APP_ENV=production` rejects `INTERNAL_ADMIN_TOKEN`).
- Removal criteria (met when Phase 1 exit gate passes):
  1. Destination actor-token verification is enabled (`ADMIN_CONTROL_PLANE_SIGNING_SECRET` set).
  2. Rejection tests green for forged, expired, wrong-audience, cross-platform, replayed `jti`, and missing permission.
  3. Sandbox smoke uses actor tokens only (unset `INTERNAL_ADMIN_TOKEN`).
- After removal: delete `INTERNAL_ADMIN_TOKEN` / `INTERNAL_ADMIN_CAPABILITIES` from all configs and code paths in a follow-up cleanup.

## Destination capability scopes (today)

`catalog:read`, `partners:write`, `cost-profiles:write`, `credentials:write`, `fleet:read`, `fleet:sync`, `settings:read`, `settings:write`, `processing:read`, `processing:run`, `processing:manual`, `dispatch:read`, `dispatch:write`, `dispatch:refund`, `events:read`, `events:operate`, `integrations:read`, `integrations:write`

## Capability matrix

Columns match the platform onboarding template. Timeout defaults to `PLATFORM_REQUEST_TIMEOUT_MS` (admin). Retry applies only to safe/idempotent reads unless noted. Rate-limit is destination `INTERNAL_ADMIN_RATE_LIMIT` unless noted. Compensation is destination-owned unless the control plane documents a compensating action.


### Partners and cost profiles

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `partners-create` | POST | `/internal/v1/partners` | `partners:write` | `order.partners.write` | HIGH | required | dual for production activate | required | bounded | no | dest RL | deactivate partner |
| `partners-update` | PATCH | `/internal/v1/partners/{partnerId}` | `partners:write` | `order.partners.write` | HIGH | required | dual when deactivating | required | bounded | no | dest RL | re-activate / reverse patch |
| `partners-users-create` | POST | `/internal/v1/partners/{partnerId}/users` | `partners:write` | `order.partners.write` | MEDIUM | required | no | required | bounded | no | dest RL | remove mapping |
| `cost-profiles-create` | POST | `/internal/v1/cost-profiles` | `cost-profiles:write` | `order.partners.write` | MEDIUM | required | no | required | bounded | no | dest RL | supersede profile |
| `partners-cost-profile-authorize` | POST | `/internal/v1/partners/{partnerId}/cost-profiles/{costProfileId}` | `cost-profiles:write` | `order.partners.write` | HIGH | required | no | required | bounded | no | dest RL | revoke authorization |

### Credentials

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `credentials-issue` | POST | `/internal/v1/partners/{partnerId}/credentials` | `credentials:write` | `order.credentials.issue` | CRITICAL | required | MFA step-up + dual | required | bounded | no | dest RL | revoke credential |
| `credentials-revoke` | POST | `/internal/v1/credentials/{credentialId}/revoke` | `credentials:write` | `order.credentials.revoke` | CRITICAL | required | MFA step-up | required | bounded | no | dest RL | re-issue (new credential) |

Plaintext partner token returned once on issue; replay of same idempotency key returns `token=null`.

### Catalog

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `catalog-read` | GET | `/internal/v1/catalog` | `catalog:read` | `order.catalog.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |

### Fleet

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fleet-health` | GET | `/internal/v1/fleet/health` | `fleet:read` | `order.fleet.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `fleet-riders` | GET | `/internal/v1/fleet/riders` | `fleet:read` | `order.fleet.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `fleet-evaluate` | POST | `/internal/v1/fleet/evaluate` | `fleet:read` | `order.fleet.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `fleet-refresh` | POST | `/internal/v1/fleet/refresh` | `fleet:sync` | `order.fleet.sync` | MEDIUM | required | no | required | bounded | no | dest RL | last-good snapshot retained on failure |

`fleet-evaluate` is POST but treated as a read capability at the destination.

### Operations policies

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `policies-active` | GET | `/internal/v1/operations/policies/active` | `settings:read` | `order.operations.policies.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `policies-version` | GET | `/internal/v1/operations/policies/{version}` | `settings:read` | `order.operations.policies.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `policies-publish` | POST | `/internal/v1/operations/policies` | `settings:write` | `order.operations.policies.write` | CRITICAL | required | MFA + dual | required | bounded | no | dest RL | publish prior version |

### Processing

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `processing-pool` | GET | `/internal/v1/processing/pool` | `processing:read` | `order.processing.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `processing-run-get` | GET | `/internal/v1/processing/runs/{runId}` | `processing:read` | `order.processing.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `processing-batch-get` | GET | `/internal/v1/processing/batches/{batchId}` | `processing:read` | `order.processing.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `processing-run-automatic` | POST | `/internal/v1/processing/runs/automatic` | `processing:run` | `order.processing.run` | HIGH | required | no | required | bounded | no | dest RL | inspect run; no silent re-run without new key |
| `processing-run-optimize` | POST | `/internal/v1/processing/runs/optimize` | `processing:run` | `order.processing.run` | HIGH | required | no | required | longer (async 202) | no | dest RL | poll run; cancel not supported — document in runbook |
| `processing-run-manual` | POST | `/internal/v1/processing/runs/manual` | `processing:manual` | `order.processing.manual` | HIGH | required | dual | required | bounded | no | dest RL | hard safety constraints remain; audit proximity override |

### Dispatch

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dispatch-tasks` | GET | `/internal/v1/dispatch/tasks` | `dispatch:read` | `order.dispatch.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `dispatch-task-get` | GET | `/internal/v1/dispatch/tasks/{taskId}` | `dispatch:read` | `order.dispatch.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `dispatch-offer` | POST | `/internal/v1/dispatch/tasks/{taskId}/offers` | `dispatch:write` | `order.dispatch.write` | HIGH | required | no | required | bounded | no | dest RL | wait TTL / reassign |
| `dispatch-refund-retry` | POST | `/internal/v1/dispatch/refunds/{refundId}/retry` | `dispatch:refund` | `order.dispatch.refund` | CRITICAL | required | dual | required | bounded | no | dest RL | reconcile ledger; never double-credit |

### Events, recovery, metrics

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `events-list` | GET | `/internal/v1/operations/events` | `events:read` | `order.events.read` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a |
| `audits-list` | GET | `/internal/v1/operations/audits` | `events:read` | `order.events.read` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a |
| `metrics-read` | GET | `/internal/v1/operations/metrics` | `events:read` | `order.events.read` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a — never expose publicly |
| `provider-failures` | GET | `/internal/v1/operations/provider-failures` | `events:operate` | `order.events.operate` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a |
| `webhook-replay` | POST | `/internal/v1/operations/webhook-deliveries/{id}/replay` | `events:operate` | `order.events.operate` | HIGH | required | no | required | bounded | no | dest RL | destination delivery semantics |
| `notification-replay` | POST | `/internal/v1/operations/notification-deliveries/{id}/replay` | `events:operate` | `order.events.operate` | HIGH | required | no | required | bounded | no | dest RL | destination delivery semantics |
| `bas-callbacks-provision` | POST | `/internal/v1/operations/bas-callbacks` | `events:operate` | `order.events.operate` | HIGH | required | dual | required | bounded | no | dest RL | disable subscription |

### Integrations

| Operation key | Method | Path | Dest scope | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `integrations-list` | GET | `/internal/v1/integrations` | `integrations:read` | `order.integrations.read` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `integrations-upsert` | POST | `/internal/v1/integrations` | `integrations:write` | `order.integrations.write` | HIGH | required | dual | required | bounded | no | dest RL | disable integration |
| `integrations-disable` | POST | `/internal/v1/integrations/{id}/disable` | `integrations:write` | `order.integrations.write` | HIGH | required | dual | required | bounded | no | dest RL | re-enable via upsert |
| `integrations-rotate` | POST | `/internal/v1/integrations/{id}/rotate` | `integrations:write` | `order.integrations.write` | CRITICAL | required | MFA + dual | required | bounded | no | dest RL | rotate again / disable |

## Admin permission namespace (finalized for Phase 0)

| Permission | Risk | Delegatable | Notes |
| --- | --- | --- | --- |
| `order.catalog.read` | LOW | yes | |
| `order.partners.read` | LOW | yes | Reserved for future list/read surfaces; mutations use write |
| `order.partners.write` | HIGH | yes | Partners, users, cost profiles |
| `order.credentials.issue` | CRITICAL | no | MFA + dual in Phase 7 |
| `order.credentials.revoke` | CRITICAL | no | MFA step-up |
| `order.fleet.read` | LOW | yes | Includes evaluate |
| `order.fleet.sync` | MEDIUM | yes | Refresh pull |
| `order.processing.read` | LOW | yes | |
| `order.processing.run` | HIGH | yes | Automatic + optimize |
| `order.processing.manual` | HIGH | no | Dual approval |
| `order.dispatch.read` | LOW | yes | |
| `order.dispatch.write` | HIGH | yes | Offers / reassign |
| `order.dispatch.refund` | CRITICAL | no | Dual approval |
| `order.operations.policies.read` | LOW | yes | |
| `order.operations.policies.write` | CRITICAL | no | MFA + dual |
| `order.events.read` | MEDIUM | yes | Events, audits, metrics |
| `order.events.operate` | HIGH | yes | Replay, failures, BAS callbacks |
| `order.integrations.read` | LOW | yes | Never returns secrets |
| `order.integrations.write` | HIGH | no | Upsert/disable/rotate |

Seeded in Phase 1 (`admin/backend/prisma/seed.ts` + catalogue).

## Env / secret inventory

### Admin control plane (Phase 1)

| Concern | Env var | Notes |
| --- | --- | --- |
| Base URL | `ORDER_SERVICE_BASE_URL` | Per admin deploy (staging admin → staging order; production admin → production order) |
| Audience | `ORDER_SERVICE_AUDIENCE` | Default `pepsa-order` |
| Actor signing | `ACTOR_SIGNING_SECRET` | Shared HS256 secret (≥32 in prod); secret-manager ref |
| Timeout | `PLATFORM_REQUEST_TIMEOUT_MS` | Shared with other platforms |
| Retry | `PLATFORM_RETRY_ATTEMPTS` | Safe/idempotent reads only |
| Circuit | `PLATFORM_CIRCUIT_FAILURE_THRESHOLD`, `PLATFORM_CIRCUIT_OPEN_MS` | Isolate unavailable order service |
| Interim (sandbox only) | `ORDER_INTERNAL_ADMIN_TOKEN` (optional spike) | Must not be set in production configs |

### pepsa-order destination

| Concern | Env var | Notes |
| --- | --- | --- |
| Actor verify | `ADMIN_CONTROL_PLANE_SIGNING_SECRET` | Same value as admin `ACTOR_SIGNING_SECRET`; required in production |
| Audience | `ADMIN_CONTROL_PLANE_AUDIENCE` | Default `pepsa-order` |
| Interim auth | `INTERNAL_ADMIN_TOKEN` | Sandbox/`local` only when actor secret unset |
| Capabilities | `INTERNAL_ADMIN_CAPABILITIES` | Comma-separated scopes (interim path) |
| Rate limit | `INTERNAL_ADMIN_RATE_LIMIT` | Default 60 |
| Network | edge / firewall allowlist | Admin egress only to `/internal/v1` |

Never log actor tokens, partner credential plaintext, or customer payloads.

## Resilience and audit

- Timeouts bounded by `PLATFORM_REQUEST_TIMEOUT_MS`.
- Safe/idempotent reads retry with bounded backoff; circuit breaker isolates an unavailable order service.
- Mutations require reason + idempotency; create correlated audit events in admin and pepsa-order.
- Credential / integration rotate: MFA step-up and dual approval before production enablement (Phase 7).

## Doc gaps noted (source contracts)

- `pepsa-order/docs/api-contracts.md` omits `GET /fleet/health` and `POST /processing/runs/optimize` relative to OpenAPI 0.9.0.
- Env examples may omit `dispatch:*` capabilities that smoke and controllers require.
- Integrations mutations enforce attribution headers at runtime; Swagger helper coverage is incomplete.

## References

- Order contracts: `pepsa-order/docs/api-contracts.md`, `pepsa-order/docs/openapi.json`
- Deploy / secrets: `pepsa-order/docs/deployment.md`
- Onboarding template: `admin/backend/docs/integrations/platform-onboarding-template.md`
- BAS reference: `admin/backend/docs/integrations/business-as-a-service.md`
- Roadmap: `ADMIN_ORDER_PAYMENT_INTEGRATION.md`
