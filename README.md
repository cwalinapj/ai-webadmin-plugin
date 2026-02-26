# ai-webadmin-plugin

Dedicated repository for AI WebAdmin WordPress plugin family.

## Contents
- `plugin/ai-webadmin` — main AI WebAdmin plugin.
- `plugin/tolldns` — TollDNS dependency plugin used by free-tier checks.
- `update-feed` — plugin update metadata artifacts.
- `docs` — installation, contracts, and security docs.
- `scripts` — plugin-side operational script scaffolds.

## Contracts
This repo consumes frozen APIs from `Sitebuilder1.0/api-contracts.md`.

## Security
- Signed plugin requests (`X-Plugin-Timestamp`, `X-Plugin-Signature`).
- 5-minute replay window expected in backend verification.
- Avoid storing plaintext secrets in WordPress options when avoidable.

## Plugin-only roadmap docs
- `docs/web-admin-core-duties.md`
- `docs/plugin-execution-roadmap.md`
- `docs/script-contract-matrix.md`
