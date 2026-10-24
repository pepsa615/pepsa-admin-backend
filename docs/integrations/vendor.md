# Vendor Admin integration

Status: In progress; production disabled until the Vendor roadmap Phase 7 gate passes.

## Boundary

- Platform key: `vendor`.
- Destination audience: `pepsa-vendor-admin`.
- Admin owns identity, MFA, RBAC, approval and initiating audit evidence.
- Vendor owns vendor/customer operations and re-authorizes every destination request.
- Payment data is authoritative only when identified as coming from Pepsa Payment; Vendor finance data is projected.

## Adapter rules

The adapter uses explicit operation metadata: HTTP method/path, permission, risk, timeout, retry safety and approval requirement. Reads and explicitly idempotent mutations may be retried. An ambiguous Payment or Pepsa Order mutation is resolved by status inquiry, never blind replay. Destination errors are mapped to a safe category and request ID; raw provider bodies do not cross into Admin.

Every aggregate includes source, `asOf`, `Africa/Lagos`, currency, freshness and data-quality/partial-result state. Scoped reads are filtered at Vendor, not only in Admin.

## Environment and secrets

Each staging/production deployment has an independent Vendor base URL and Admin→Vendor signing secret. These are different from Vendor→Payment, Payment→Vendor, Vendor→Order and Order→Vendor credentials. Key IDs support overlap during rotation and independent relationship revocation. There is no runtime environment switch.

## Production gate

Production enablement requires a scoped read, review decision, critical fee approval, provisioning reconciliation and delivery replay through the UI with correlated Admin/Vendor audit IDs, plus the roadmap security and financial certification evidence.
