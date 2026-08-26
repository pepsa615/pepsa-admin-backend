# ADR 0002: Explicit platform and environment isolation

Status: accepted.

Access is evaluated as administrator, platform, environment, permission, and optional resource scope. Membership is explicit and never implies access to future platforms. Global assignments and destination-specific assignments remain distinct. The requested environment is resolved server-side; only matching assignment scopes contribute permissions. BAS receives the narrowed environment and resource constraints in a signed actor token and remains authoritative for its domain operation.

Staging and production use separate platform environment records, endpoint secret references, databases, service credentials, and deployment approvals.
