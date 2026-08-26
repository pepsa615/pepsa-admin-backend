# ADR 0004: Governance, audit, and revocation policy

Status: accepted.

Critical role definitions, assignments, and operations require recent MFA and an independently approved, payload-bound, single-use approval. Emergency access requires another administrator, an incident ID, explicit permissions, and at most one hour. Access reviews revoke assignments and sessions immediately.

Audit records are database-immutable, hash chained, exported by an idempotent outbox, and retained for seven years unless Legal sets a stricter residency policy. Production alerts when export lag exceeds five minutes. Critical access changes revoke sessions in the same workflow; the revocation SLO is 60 seconds end to end.
