# Pepsa Payment integration

Phase 0 inventory and Phase 4 runtime adapter for integrating **pepsa-payment** into the Pepsa Administration Platform.

The control plane and pepsa-payment are independently built and deployed. They share no runtime package or database access; all administration crosses versioned `/v1` admin surfaces with a pinned contract.

## Runtime adapter

| Concern | Behavior |
| --- | --- |
| Registration | `create-registry.ts` registers `PepsaPaymentAdapter` with `config.paymentService` + `ACTOR_SIGNING_SECRET` |
| Health | `GET /v1/admin/sva-provisioning` with a system actor token (no path param) |
| Capabilities | Static catalogue (Phase 0 matrix, 14 ops); admin methods are `GET` \| `POST` |
| Path mapping | Path params (`platformId`, `userId`, `checkoutId`) taken from query/payload; stripped from upstream body |
| Upstream methods | May differ from admin method (e.g. `platforms-status` and `*-settings-patch` are admin `POST` → destination `PATCH`) |
| Actor token | HS256, issuer `pepsa-admin`, audience `pepsa-payment`, `platform=pepsa-payment`, ~60s, permission(s), `jti`, correlated `requestId` |
| Mutation headers | `X-Operator-Id`, `X-Change-Reason` (from payload `reason`), `X-Request-Id`, `Idempotency-Key` |
| SVA / checkout note | Destination `note` preserved when supplied; otherwise control-plane `reason` is mapped into `note` |
| Resilience | `PLATFORM_REQUEST_TIMEOUT_MS`; retry safe reads only; circuit breaker isolates unavailable payment |
| Audit | Control-plane `OperationService` records admin audit; destination receives attribution headers + request ID |
| Not wired | `payment.platforms.read` — reserved until destination adds a platforms list/get route |

Contract tests: `admin/backend/src/integrations/pepsa-payment/index.test.ts`.

## Platform metadata

| Field | Value |
| --- | --- |
| Platform key | `pepsa-payment` |
| Adapter type | `pepsa-payment` |
| Environments | Deploy lane only — staging admin → staging payment URL; production admin → production payment URL. Actor JWT `environment` is always `production` (scope label) |
| Audience (actor token) | `pepsa-payment` |
| Issuer (actor token) | `pepsa-admin` |
| Owner | TBD (ops follow-up) |
| SLO | TBD (ops follow-up) |
| Incident contact | TBD (ops follow-up) |
| Network policy | Restrict `/v1/platforms` and `/v1/admin/*` to admin control-plane egress only; separate secrets per environment |

## Auth migration

### Today (destination)

- Header `X-Admin-Key` (raw secret) compared via SHA-256 digest to `ADMIN_API_KEY_SHA256` (timing-safe).
- No per-operator identity or RBAC at the payment boundary; audit actor is effectively `admin:key`.
- Shared rate limit `PLATFORM_RATE_LIMIT_PER_MINUTE` (default **5**/min) on `/v1/platforms` and `/v1/admin`, keyed by hash of the admin key.
- Most admin mutations do **not** require `Idempotency-Key` or change reason today (exception: SVA reconcile requires `note` 5–500; DVA reconcile `note` optional 3–500).

### Target (parity with BAS)

- Short-lived HS256 **actor tokens** (~60s), issuer `pepsa-admin`, audience `pepsa-payment`.
- Destination re-checks issuer, audience, expiry, platform, environment, permission, and request ID; reject replay and unknown capabilities.
- One platform, one environment, one permission per token; correlated request ID.
- Mutations must carry operator ID, change reason, request ID, and idempotency key; correlated audit in both systems.

### Destination gaps to close in Phase 1

1. Per-operator identity (replace shared-key actor).
2. Require change reason on platform lifecycle, settings PATCH, KYC rotate, and DVA reconcile.
3. Enforce idempotency on all admin mutations (or document control-plane-only discipline until destination supports it).
4. Map admin permissions to destination capability checks (today: single shared key).

### Interim (sandbox / non-production spike only)

- Shared `X-Admin-Key` / `ADMIN_API_KEY_SHA256` is allowed **only when `DEPLOYMENT_ENVIRONMENT !== 'production'`** and `ADMIN_CONTROL_PLANE_SIGNING_SECRET` is unset.
- **Never** enable interim shared admin keys in production (production validation rejects `ADMIN_API_KEY_SHA256`).
- Removal criteria (met when Phase 1 exit gate passes):
  1. Destination actor-token verification is enabled (`ADMIN_CONTROL_PLANE_SIGNING_SECRET` set).
  2. Rejection tests green for forged, expired, wrong-audience, cross-platform, replayed `jti`, and missing permission.
  3. Non-production smoke uses actor tokens only (unset `ADMIN_API_KEY_SHA256`).
- After removal: delete interim admin-key paths in a follow-up cleanup.

## Capability matrix

API prefix defaults to `/v1`. Timeout defaults to `PLATFORM_REQUEST_TIMEOUT_MS`. Retry applies only to safe reads. Rate-limit is destination `PLATFORM_RATE_LIMIT_PER_MINUTE` unless noted.

### Platform lifecycle

| Operation key | Method | Path | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `platforms-onboard` | POST | `/v1/platforms` | `payment.platforms.write` | HIGH | required* | dual | required* | bounded | no | dest RL | suspend / revoke |
| `platforms-rotate-key` | POST | `/v1/platforms/{platformId}/rotate-key` | `payment.platforms.keys.rotate` | CRITICAL | required* | MFA + dual | required* | bounded | no | dest RL | rotate again; revoke compromised |
| `platforms-status` | PATCH | `/v1/platforms/{platformId}/status` | `payment.platforms.status` | CRITICAL | required* | MFA + dual | required* | bounded | no | dest RL | reactivate only if not revoked |

\*Control-plane required; destination must accept/enforce in Phase 1. Onboard returns one-time `pp_live_*` key; rotate returns new key once. Revoked platforms cannot be reactivated.

### Transfer / VAS / settlement settings

| Operation key | Method | Path | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `transfer-settings-get` | GET | `/v1/platforms/{platformId}/transfer-settings` | `payment.settings.transfer` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `transfer-settings-patch` | PATCH | `/v1/platforms/{platformId}/transfer-settings` | `payment.settings.transfer` | HIGH | required* | dual | required* | bounded | no | dest RL | append-only events; patch prior values |
| `vas-settings-get` | GET | `/v1/platforms/{platformId}/vas-settings` | `payment.settings.vas` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `vas-settings-patch` | PATCH | `/v1/platforms/{platformId}/vas-settings` | `payment.settings.vas` | HIGH | required* | dual | required* | bounded | no | dest RL | append-only events |
| `settlement-settings-get` | GET | `/v1/platforms/{platformId}/settlement-settings` | `payment.settings.settlement` | LOW | no | no | n/a | bounded | yes | dest RL | n/a |
| `settlement-settings-patch` | PATCH | `/v1/platforms/{platformId}/settlement-settings` | `payment.settings.settlement` | HIGH | required* | dual | required* | bounded | no | dest RL | append-only events; escrow 1–168h; DVA expiry 1–24h |

Read permissions for settings GETs use the same permission key as writes for Phase 0 simplicity; Phase 1 seed may split `.read` if RBAC needs finer control. Until then, grant carefully.

**Refinement for catalogue:** settings use dedicated keys; reads and writes share the key above. Prefer assigning via roles that are read-only auditor (deny PATCH at adapter) vs ops admin.

### SVA provisioning

| Operation key | Method | Path | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sva-provisioning-list` | GET | `/v1/admin/sva-provisioning` | `payment.sva.provisioning.read` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a |
| `sva-provisioning-reconcile` | POST | `/v1/admin/sva-provisioning/{userId}/reconcile` | `payment.sva.provisioning.reconcile` | CRITICAL | required (`note` 5–500 today) | dual for activate/retry | required* | bounded | no | dest RL | mark_failed; never speculative credit |

Actions: `activate`, `retry`, `mark_failed`. Activate needs account evidence; retry only when status is `failed`. Ambiguous provider outcomes stay pending — never blind redispatch.

### DVA / checkout provisioning

| Operation key | Method | Path | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `checkout-provisioning-list` | GET | `/v1/admin/checkout-provisioning` | `payment.checkout.provisioning.read` | MEDIUM | no | no | n/a | bounded | yes | dest RL | n/a |
| `checkout-provisioning-reconcile` | POST | `/v1/admin/checkout-provisioning/{checkoutId}/reconcile` | `payment.checkout.provisioning.reconcile` | CRITICAL | required* (`note` optional today) | dual for activate/retry | required* | bounded | no | dest RL | mark_failed; never blind redispatch |

Actions: `retry`, `activate`, `mark_failed`. Activate needs `account_number`, `bank_name`, `expires_at`.

### KYC encryption rotation

| Operation key | Method | Path | Admin permission | Risk | Reason | Approval | Idempotency | Timeout | Retry | Rate-limit | Compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kyc-rotate-encryption` | POST | `/v1/admin/kyc/rotate-encryption` | `payment.kyc.encryption.rotate` | CRITICAL | required* | MFA + dual | required* | bounded | no | dest RL | re-run under new active key; preserve evidence |

Re-encrypts NIN/BVN under active `KYC_ENCRYPTION_KEY_ID`; returns `{ active_key_id, profiles_rotated }`. No body today.

## Admin permission namespace (finalized for Phase 0)

| Permission | Risk | Delegatable | Notes |
| --- | --- | --- | --- |
| `payment.platforms.read` | LOW | yes | Reserved for future list/status reads |
| `payment.platforms.write` | HIGH | no | Onboard |
| `payment.platforms.keys.rotate` | CRITICAL | no | MFA + dual |
| `payment.platforms.status` | CRITICAL | no | MFA + dual |
| `payment.settings.transfer` | HIGH | yes | GET + PATCH; role-gate writes |
| `payment.settings.vas` | HIGH | yes | GET + PATCH |
| `payment.settings.settlement` | HIGH | yes | GET + PATCH |
| `payment.sva.provisioning.read` | MEDIUM | yes | |
| `payment.sva.provisioning.reconcile` | CRITICAL | no | Dual for activate/retry |
| `payment.checkout.provisioning.read` | MEDIUM | yes | |
| `payment.checkout.provisioning.reconcile` | CRITICAL | no | Dual for activate/retry |
| `payment.kyc.encryption.rotate` | CRITICAL | no | MFA + dual |

Seeded in Phase 1 (`admin/backend/prisma/seed.ts` + catalogue).

## Env / secret inventory

### Admin control plane (Phase 1)

| Concern | Env var | Notes |
| --- | --- | --- |
| Base URL | `PAYMENT_SERVICE_BASE_URL` | Per environment selection |
| Audience | `PAYMENT_SERVICE_AUDIENCE` | Default `pepsa-payment` |
| Actor signing | `ACTOR_SIGNING_SECRET` | Shared HS256 secret; secret-manager ref |
| Timeout / retry / circuit | `PLATFORM_REQUEST_TIMEOUT_MS`, `PLATFORM_RETRY_ATTEMPTS`, `PLATFORM_CIRCUIT_*` | Shared resilience knobs |
| Interim (sandbox only) | `PAYMENT_ADMIN_API_KEY` (optional spike) | Raw key for `X-Admin-Key`; never in production |

### pepsa-payment destination

| Concern | Env var | Notes |
| --- | --- | --- |
| Actor verify | `ADMIN_CONTROL_PLANE_SIGNING_SECRET` | Same value as admin `ACTOR_SIGNING_SECRET`; required in production |
| Audience | `ADMIN_CONTROL_PLANE_AUDIENCE` | Default `pepsa-payment` |
| Interim auth | `ADMIN_API_KEY_SHA256` | SHA-256 hex of raw admin key; non-production only when actor secret unset |
| Rate limit | `PLATFORM_RATE_LIMIT_PER_MINUTE` | Default 5 |
| KYC encryption | `KYC_ENCRYPTION_KEY_ID`, `KYC_ENCRYPTION_KEYS_JSON` (or legacy base64) | Required for rotate-encryption |
| KYC lookup | `KYC_LOOKUP_HMAC_KEY` | Independent of encryption key |
| Metrics (adjacent) | `METRICS_BEARER_TOKEN` | `/metrics` only — not admin adapter |
| Shared env path (prod) | `/srv/pepsa-payment/shared/.env` | Never in release artifacts |

Never log actor tokens, platform API keys (`pp_live_*`), KYC plaintext, or customer financial payloads.

## Resilience and audit

- Timeouts bounded by `PLATFORM_REQUEST_TIMEOUT_MS`.
- Safe reads retry with bounded backoff; circuit breaker isolates an unavailable payment service.
- High-risk mutations (key rotate, suspend/revoke, reconcile activate/retry, KYC rotate) require MFA step-up and/or dual approval before production enablement (Phase 7).
- Correlated audit events in admin and pepsa-payment once actor tokens land (adapter sends attribution headers + request ID; destination guard verifies actor tokens when `ADMIN_CONTROL_PLANE_SIGNING_SECRET` is set).

## Adjacent (out of adapter scope)

| Surface | Auth | Notes |
| --- | --- | --- |
| `GET /metrics` | Bearer `METRICS_BEARER_TOKEN` | Ops scrape; not admin UI |
| `GET /health/live`, `/health/ready` | Public | Release/readiness |
| Partner wallet/transfer/VAS/checkout | `X-API-Key` | Not admin |

## References

- Architecture: `pepsa-payment/docs/architecture.md`
- Operations / secrets: `pepsa-payment/docs/operations.md`
- Roadmap product: `pepsa-payment/ROADMAP.md`
- Controllers: `platform.controller.ts`, `admin-provisioning.controller.ts`, `admin-checkout.controller.ts`, `admin-kyc.controller.ts`
- Onboarding template: `admin/backend/docs/integrations/platform-onboarding-template.md`
- BAS reference: `admin/backend/docs/integrations/business-as-a-service.md`
- Integration roadmap: `ADMIN_ORDER_PAYMENT_INTEGRATION.md`
