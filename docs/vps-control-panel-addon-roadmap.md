# VPS Control-Panel Addon Roadmap

## Objective
Evolve the current WordPress plugin suite into control-panel addons that operate across mixed stacks:
- WordPress
- Laravel/PHP custom apps
- Node/Next.js sites
- Static sites behind Nginx/Apache/Caddy

## Core principle
Keep one shared control plane and one signed agent contract, then ship thin adapters per panel/runtime.

## Product mapping (current -> panel addon module)
- AI AddWords + Meta plugin -> `paid_traffic` addon module
- SEO traffic tooling -> `seo_traffic` addon module
- AI WebAdmin plugin -> `web_admin` addon module
- Cache optimization plugin -> `cache_ops` addon module
- Host optimizer plugin -> `hosting_ops` addon module
- Sitebuilder 1.0 -> `sitebuilder_ops` addon module
- TollDNS -> `dns_edge_ops` addon module

## Shared addon architecture
1. Panel addon (cPanel/Plesk/DirectAdmin/CyberPanel):
- UI for onboarding, keys, policies, and module toggles
- Local collector for metrics/config/state
- Secure signer for worker requests

2. Site runtime adapters (per hosted app):
- `wordpress` adapter
- `php_generic` adapter
- `node_generic` adapter
- `static_site` adapter

3. Unified worker contracts:
- Use `/plugin/site/*` contracts for non-WordPress addons.
- WordPress keeps `/plugin/wp/*` and can gradually migrate to `/plugin/site/*`.

## Minimum addon capability contract
- Identity: `site_id`, `agent_id`, `panel_type`, `runtime_type`
- Auth: `X-Plugin-Id`, `X-Plugin-Timestamp`, `X-Plugin-Nonce`, `X-Plugin-Signature`
- Safety: capability token + idempotency key + replay window checks
- Execution policy: per-module `enabled`, `dry_run`, `rate_limit`, `budget_limit`

## Phase rollout
### Phase 1: Shared control-plane compatibility (done in this repo)
- Worker accepts both `/plugin/wp/*` and `/plugin/site/*` for heartbeat/sandbox/host-optimizer/wallet verify routes.
- Existing plugin behavior remains unchanged.
- Starter implementations now exist:
  - `apps/panel-addon-core` (signed client + heartbeat CLI)
  - `apps/ai-vps-control-panel` (chat-agent backend + guarded command executor)
  - API key auth + tenant RBAC + worker telemetry sync wiring in control-panel backend
  - SQLite persistence and first web UI shell (inventory/chat/queue/audit)

### Phase 2: Panel addon bootstrap
- Build `panel-addon-core` package with:
  - request signing client
  - endpoint client
  - policy store
  - job runner
- Build first adapter for one panel (recommended: cPanel).

### Phase 3: Runtime adapters
- Implement adapters for `wordpress`, `php_generic`, `node_generic`, `static_site`.
- Normalize telemetry so decision engines (security/performance/traffic) stay runtime-agnostic.

### Phase 4: Product module portability
- Move module logic out of WP-specific plugin code into shared services:
  - paid traffic orchestration
  - SEO checks and task execution
  - cache and hosting operations
  - DNS + email health/automation

### Phase 5: Distribution and tenancy
- Ship addons via panel marketplaces/direct install packages.
- Introduce tenant-level policy templates and feature flags.

## Data model additions (control plane)
- `agents` (`agent_id`, `site_id`, `panel_type`, `runtime_type`, `version`, `last_seen_at`)
- `addon_modules` (`site_id`, `module`, `enabled`, `dry_run`, `policy_json`)
- `site_runtime_inventory` (`site_id`, `framework`, `server_stack`, `cache_layer`, `deploy_mode`)

## Security baseline for panel addons
- Never store raw API secrets unencrypted.
- Rotate panel integration credentials and capability tokens.
- Enforce signed mutations and nonce/idempotency on every mutating route.
- Add explicit break-glass/manual approval mode for destructive actions.

## Recommended first implementation target
- cPanel addon + `wordpress` and `php_generic` runtime adapters.
- Reuse current worker routes and signing model.
- Keep paid traffic module in dry-run until provider contracts are validated end-to-end.
