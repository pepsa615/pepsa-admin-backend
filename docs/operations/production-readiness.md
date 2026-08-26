# Production readiness runbook

## Deploy

Build immutable API and worker images from the same commit. Run `pnpm verify`, validate the migration on an anonymized production-size restore, deploy migrations once, then worker, API, and frontend. Verify live/ready health, BAS capability discovery, operation worker throughput, audit export lag, and a read-only synthetic request. Roll back application images only; database rollback requires an approved forward-fix plan.

## SLOs and alerts

- Login and authorization: 99.95%, p95 below 500 ms excluding MFA entry.
- Control-plane reads: 99.9%, p95 below 750 ms.
- BAS reads: 99.5%, p95 below 2 s.
- Audit database persistence: 99.99%; external delivery lag below five minutes.
- Page on failed audit delivery, repeated privilege denials, recovery spikes, unavailable BAS circuit, worker backlog, or readiness failure.

## Incident

Declare an incident ID, freeze nonessential privileged work, identify affected platform/environment, revoke suspect sessions or activate independently approved emergency access, preserve logs and audit-chain head, and communicate through the security incident channel. Never bypass destination authorization. After recovery, revoke emergency grants, verify both audit trails, rotate exposed credentials, and complete a blameless review.

## Backup and disaster recovery

Use encrypted point-in-time PostgreSQL backups with daily snapshots, a 15-minute RPO and four-hour RTO. Quarterly restore to an isolated account, run migrations, verify the audit chain and assignment counts, exercise recovery delivery, and record evidence. Secret-manager backups and signing-key escrow follow the security account policy.
