# Permission catalogue

Permissions use `<platform>.<resource>.<verb>`; control-plane permissions use `admin.<resource>.<verb>`. LOW is routine read, MEDIUM is sensitive read, HIGH changes customer or operational state, and CRITICAL changes privilege, money, secrets, or bulk state. Only permissions marked delegatable may be granted by non-super administrators.

BAS v1 provides dashboard, business, order, pricing, finance, transaction, invoice, API-key metadata, webhook, and audit reads; business review and webhook replay are the approved mutations. Wallet adjustment remains catalogued but has no endpoint until dual-approval and compensation acceptance tests are approved.

## Resource scope contract

BAS assignments may be narrowed with `{ "businessIds": ["<business UUID>"] }`. The control plane calculates scopes only from assignments that grant the requested permission. An unrestricted granting assignment takes precedence; otherwise the signed actor context carries the union of its business scopes. BAS applies that scope to dashboards, lists, finance, pricing, integrations, audit, single mutations, previews, and bulk mutations. A present but unsupported or empty scope is deny-all.

Environment scope is independent. An assignment bound to `sandbox` never contributes permissions to a production request (and vice versa).

## Pepsa Order (`pepsa-order`)

Finalized in Phase 0. Seeded in Phase 1. Capability mapping: [`docs/integrations/pepsa-order.md`](../integrations/pepsa-order.md).

| Permission | Risk | Delegatable |
| --- | --- | --- |
| `order.catalog.read` | LOW | yes |
| `order.partners.read` | LOW | yes |
| `order.partners.write` | HIGH | yes |
| `order.credentials.issue` | CRITICAL | no |
| `order.credentials.revoke` | CRITICAL | no |
| `order.fleet.read` | LOW | yes |
| `order.fleet.sync` | MEDIUM | yes |
| `order.processing.read` | LOW | yes |
| `order.processing.run` | HIGH | yes |
| `order.processing.manual` | HIGH | no |
| `order.dispatch.read` | LOW | yes |
| `order.dispatch.write` | HIGH | yes |
| `order.dispatch.refund` | CRITICAL | no |
| `order.operations.policies.read` | LOW | yes |
| `order.operations.policies.write` | CRITICAL | no |
| `order.events.read` | MEDIUM | yes |
| `order.events.operate` | HIGH | yes |
| `order.integrations.read` | LOW | yes |
| `order.integrations.write` | HIGH | no |

CRITICAL and non-delegatable keys require MFA step-up and/or dual approval before production enablement (Phase 7).

## Pepsa Payment (`pepsa-payment`)

Finalized in Phase 0. Seeded in Phase 1. Capability mapping: [`docs/integrations/pepsa-payment.md`](../integrations/pepsa-payment.md).

| Permission | Risk | Delegatable |
| --- | --- | --- |
| `payment.platforms.read` | LOW | yes |
| `payment.platforms.write` | HIGH | no |
| `payment.platforms.keys.rotate` | CRITICAL | no |
| `payment.platforms.status` | CRITICAL | no |
| `payment.settings.transfer` | HIGH | yes |
| `payment.settings.vas` | HIGH | yes |
| `payment.settings.settlement` | HIGH | yes |
| `payment.sva.provisioning.read` | MEDIUM | yes |
| `payment.sva.provisioning.reconcile` | CRITICAL | no |
| `payment.checkout.provisioning.read` | MEDIUM | yes |
| `payment.checkout.provisioning.reconcile` | CRITICAL | no |
| `payment.kyc.encryption.rotate` | CRITICAL | no |

Settings keys cover both GET and PATCH; gate writes via role composition until finer `.read` / `.write` splits are needed.
