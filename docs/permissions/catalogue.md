# Permission catalogue

Permissions use `<platform>.<resource>.<verb>`; control-plane permissions use `admin.<resource>.<verb>`. LOW is routine read, MEDIUM is sensitive read, HIGH changes customer or operational state, and CRITICAL changes privilege, money, secrets, or bulk state. Only permissions marked delegatable may be granted by non-super administrators.

BAS v1 provides dashboard, business, order, pricing, finance, transaction, invoice, API-key metadata, webhook, and audit reads; business review and webhook replay are the approved mutations. Wallet adjustment remains catalogued but has no endpoint until dual-approval and compensation acceptance tests are approved.

## Resource scope contract

BAS assignments may be narrowed with `{ "businessIds": ["<business UUID>"] }`. The control plane calculates scopes only from assignments that grant the requested permission. An unrestricted granting assignment takes precedence; otherwise the signed actor context carries the union of its business scopes. BAS applies that scope to dashboards, lists, finance, pricing, integrations, audit, single mutations, previews, and bulk mutations. A present but unsupported or empty scope is deny-all.

Environment scope is independent. An assignment bound to staging never contributes permissions to a production request.
