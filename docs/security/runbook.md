# Security and access runbook

## Bootstrap

Set `BOOTSTRAP_ADMIN_EMAIL` and a one-use `BOOTSTRAP_ADMIN_PASSWORD`, run migrations and seed once, then remove both values from the runtime environment. The bootstrap administrator must enroll TOTP on first sign-in. No production default exists.

## Administrator invitation

Access managers never choose or learn an invited administrator's password. Invitation creates a random unusable credential and a hashed, 24-hour, single-use enrollment token. Production sends the raw token only through the configured verified recovery-delivery service. The recipient uses it to set their own password, then enrolls MFA on first login. Development may return the token in the authenticated response for local testing only.

## Credential rotation

Rotate `ACTOR_SIGNING_SECRET` in the admin API and `ADMIN_CONTROL_PLANE_SIGNING_SECRET` in BAS in one controlled deployment window. Revoke active admin sessions after rotating `SESSION_SECRET`. MFA encryption-key rotation requires a dual-read migration before the old key is removed.

## Emergency revocation

Suspend the administrator or platform membership. The service revokes active sessions as part of the same workflow. If the UI is unavailable, update the record through an audited database break-glass procedure and restart the API. Record incident ID, operator, approver, reason, and time.

## MFA recovery

Eight single-use recovery codes are issued once, immediately after TOTP enrollment. Only keyed hashes are stored. Administrators keep plaintext codes in the approved password manager. Each recovery attempt is audited and successful use consumes the code atomically. If all codes are lost, Security must verify identity and use the documented, dual-approved break-glass reset procedure; never disable MFA globally.

Password reset tokens expire after 15 minutes, are stored only as keyed hashes, delivered through `RECOVERY_DELIVERY_URL`, require the current TOTP for enrolled users, are consumed once, and revoke every session. The public request response never confirms whether an account exists.

## Audit verification

Use `/admin-api/v1/audit/verify` or independently export `AuditEvent` rows ordered by `sequence` and recompute each SHA-256 hash from canonical event material and the previous hash. A mismatch is a security incident. `AuditDelivery` sends every event idempotently to `SECURITY_MONITORING_URL`; alert on failed records or five-minute lag.

## Backup and restore

Take encrypted daily PostgreSQL backups with point-in-time recovery. Quarterly, restore into an isolated environment, validate row counts and audit-chain continuity, and record recovery time and recovery point achieved.
