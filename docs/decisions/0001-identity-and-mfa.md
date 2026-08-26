# ADR 0001: Internal identity with mandatory TOTP

Status: accepted for the first release.

The control plane owns administrator accounts, scrypt password hashes, opaque server sessions, mandatory TOTP, and single-use recovery codes. Production password recovery is delivered only through the configured trusted recovery service and still requires MFA. This avoids coupling the first release to an identity vendor. A future OIDC/WebAuthn migration must preserve stable administrator IDs, audit continuity, session revocation, and step-up semantics. Phishing-resistant WebAuthn is the preferred next authenticator.
