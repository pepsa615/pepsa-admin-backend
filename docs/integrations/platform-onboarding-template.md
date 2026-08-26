# Platform onboarding checklist

1. Allocate a stable key, owner, environments, adapter type, secret references, network policy, SLO, and incident contact.
2. Publish versioned health, capabilities, operation, and operation-status endpoints with normalized errors and request IDs.
3. Define capability permissions, risks, delegation, reasons, approval, idempotency, timeout, retry, rate-limit, and compensation rules.
4. Validate signed issuer/audience/expiry/platform/environment/permissions/scopes at the destination; reject replay and unknown capabilities.
5. Implement the adapter without platform branching in shared authorization code.
6. Pass contract, cross-platform isolation, failure, security, load, and correlated-audit tests.
7. Complete credential rotation, rollback, backup, incident, and support runbooks before enabling production.
