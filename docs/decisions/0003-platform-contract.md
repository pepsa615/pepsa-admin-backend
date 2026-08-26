# ADR 0003: Versioned HTTP adapters and signed actor context

Status: accepted.

Connected products remain independent and are accessed only through `/internal/admin/v1`. The control plane uses a registry of adapters and a 60-second signed actor JWT with issuer, audience, subject, platform, environment, narrow permissions, scopes, and request ID. Mutations require reason and idempotency key. Credentials are secret-manager references, never browser values. Safe calls use bounded retries, timeouts, and a circuit breaker.

Permissions are currently seeded from the approved BAS capability catalogue. A later automated synchronizer may only add reviewed catalogue versions; it must never silently grant assignments.
