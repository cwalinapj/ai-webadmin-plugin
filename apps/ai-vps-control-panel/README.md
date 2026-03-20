# AI VPS Control Panel (Scaffold)

Initial backend scaffold for a custom VPS control panel operated through a chat-agent workflow.

## What is implemented
- HTTP API server with health, site registration, chat planning, and action execution routes.
- Public SaaS-style landing experience at `/` with dedicated product URLs for each plugin.
- Public pricing route at `/pricing` with lead/demo capture wired into backend storage.
- Stripe Checkout session creation and webhook-driven billing state sync.
- Secure operator console at `/console`.
- Cookie-based console session login in addition to API token auth.
- Chat-agent planner that converts operator prompts into structured operations.
- Safe command executor with allowlisted services and confirmation gating.
- Dry-run-first execution mode for risky operations.
- Manual queue endpoint with policy guardrails and idempotency-key dedupe.
- Sensitive values in execution `stdout/stderr` are redacted before API response and persistence.
- Startup script contract checks are exposed in `/health` and can be enforced with `AI_VPS_STRICT_SCRIPT_CHECKS=true`.
- Executor runs commands with constrained env/cwd and supports non-root-only enforcement via `AI_VPS_REQUIRE_NON_ROOT_EXEC=true`.
- Persistent API-key/PAT management with hashed-at-rest secrets, audit trails, revoke/rotate endpoints, and auto-rotation support.
- Supports `switch_load_balancer_mode` action mapped to `/root/watchdog-heartbeat.sh` with strict args validation.
- Supports `run_site_snapshot` action mapped to `/root/snapshot-site.sh` or `AI_VPS_SNAPSHOT_SCRIPT_PATH`.
- Supports `plan_site_upgrade` action mapped to `/root/plan-upgrade.sh` or `AI_VPS_PLAN_UPGRADE_SCRIPT_PATH`.
- Supports `verify_site_upgrade` action mapped to `/root/verify-upgrade.sh` or `AI_VPS_VERIFY_UPGRADE_SCRIPT_PATH`.
- Supports `rollback_site_upgrade` action mapped to `/root/rollback-upgrade.sh` or `AI_VPS_ROLLBACK_UPGRADE_SCRIPT_PATH`.
- Supports `run_security_scan` action mapped to `/root/run-security-scan.sh` or `AI_VPS_RUN_SECURITY_SCAN_SCRIPT_PATH`.
- Supports `rotate_secret` action mapped to `/root/rotate-secrets.sh` or `AI_VPS_ROTATE_SECRETS_SCRIPT_PATH`.
- Fleet mode: multi-site risk dashboard, policy templates, and bulk policy apply across sites.
- Billing mode: per-site monthly sandbox subscription state with sync to worker enforcement.

## API routes
- `GET /health`
- `GET /api/pricing/plans`
- `GET /api/billing/public-status`
- `POST /api/leads`
- `GET /api/leads`
- `POST /api/billing/checkout-session`
- `GET /api/billing/history`
- `GET /api/billing/webhook-events`
- `POST /api/billing/customer-portal-session`
- `POST /api/stripe/webhook`
- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/session/me`
- `GET /api/auth/me`
- `GET /api/tokens`
- `POST /api/tokens`
- `POST /api/tokens/auto-rotate`
- `POST /api/tokens/publish-audit`
- `POST /api/tokens/:id/revoke`
- `POST /api/tokens/:id/rotate`
- `GET /api/sites`
- `POST /api/sites`
- `GET /api/billing/subscriptions`
- `POST /api/billing/subscriptions`
- `GET /api/fleet/risk`
- `GET /api/fleet/policies`
- `POST /api/fleet/policies`
- `POST /api/fleet/policies/:id/apply`
- `POST /api/chat/message`
- `POST /api/actions/queue`
- `POST /api/agent/execute`

## Authentication / RBAC
- Protected routes require API key auth via:
  - `Authorization: Bearer <token>` or
  - `X-API-Key: <token>`
- Configure keys with `AI_VPS_API_KEYS`:
  - Format: `token:role:tenant_id[:scope_a|scope_b]`
  - Multiple keys: comma-separated
  - Roles: `viewer`, `operator`, `admin`
  - Tenant `*` means global scope
- Example:
```bash
export AI_VPS_API_KEYS="admin-a:admin:tenant-a,operator-a:operator:tenant-a"
```

## Persistent key management
- Keys created with `/api/tokens` are stored in SQLite with token hash only (raw secret is returned once at creation/rotation).
- Supports both `api_key` and `pat` token types.
- Auto-rotation:
  - set `auto_rotate=true` and `rotate_after` (or `rotate_after_days`) when creating a token.
  - auth-triggered rotation returns the replacement via `x-rotated-api-key` response header.
  - batch rotation is available at `POST /api/tokens/auto-rotate`.
- Environment keys (`AI_VPS_API_KEYS`) are still supported as bootstrap keys.
- Secret backend options:
  - `AI_VPS_SECRET_BACKEND=local` (default): SHA-256 hash with `AI_VPS_TOKEN_PEPPER`.
  - `AI_VPS_SECRET_BACKEND=vault`: HashiCorp Vault Transit HMAC backend.
- Vault mode env vars:
  - `AI_VPS_VAULT_ADDR` (e.g. `http://127.0.0.1:8200`)
  - `AI_VPS_VAULT_TOKEN`
  - `AI_VPS_VAULT_TRANSIT_PATH` (default `transit`)
  - `AI_VPS_VAULT_HMAC_KEY` (default `ai-vps-token-hmac`)

## Worker telemetry sync
- When an action executes successfully, the panel syncs telemetry/jobs to the control-plane worker using `panel-addon-core`.
- Required env vars:
```bash
export PANEL_WORKER_BASE_URL="https://worker.example.com"
export PANEL_WORKER_SHARED_SECRET="..."
export PANEL_WORKER_CAP_UPTIME="..."
export PANEL_WORKER_CAP_SANDBOX="..."
export PANEL_WORKER_PLUGIN_PREFIX="ai-vps-panel"
export PANEL_WORKER_BILLING_INTERNAL_TOKEN="..."
```

Billing sync target in worker:
- `POST /internal/billing/subscription/upsert` (Bearer token = `PANEL_WORKER_BILLING_INTERNAL_TOKEN`)

## Local run
```bash
cd apps/ai-vps-control-panel
npm install
export AI_VPS_DB_PATH="./data/ai-vps-control-panel.sqlite"
export AI_VPS_API_KEYS="admin-a:admin:tenant-a,operator-a:operator:tenant-a"
export AI_VPS_SECRET_BACKEND="local"
export AI_VPS_TOKEN_PEPPER="change-this-in-prod"
export AI_VPS_TOKEN_ROTATE_DAYS="30"
export AI_VPS_STRICT_SCRIPT_CHECKS="true"
export AI_VPS_REQUIRE_NON_ROOT_EXEC="true"
npm test
npm run build
npm start
```
Open [http://localhost:8080](http://localhost:8080) for the web UI.
Public landing routes:
- `/`
- `/pricing`
- `/ai-addwords-meta`
- `/seo-traffic`
- `/ai-webadmin`
- `/cache-ops`
- `/hosting-ops`
- `/sitebuilder`
- `/tolldns`
- `/ai-vps-control-panel`
- `/console`

Console session env vars:
```bash
export AI_VPS_CONSOLE_EMAIL="owner@loccount.local"
export AI_VPS_CONSOLE_PASSWORD="replace-this"
export AI_VPS_CONSOLE_ROLE="admin"
export AI_VPS_CONSOLE_TENANT="*"
```

Stripe billing env vars:
```bash
export STRIPE_SECRET_KEY="sk_live_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."
export STRIPE_SUCCESS_URL="https://loccount.com/pricing?checkout=success"
export STRIPE_CANCEL_URL="https://loccount.com/pricing?checkout=cancel"
export STRIPE_PORTAL_RETURN_URL="https://loccount.com/console?billing=portal"
export STRIPE_PRICE_STARTER="price_..."
export STRIPE_PRICE_GROWTH="price_..."
export STRIPE_PRICE_CONTROL_PLANE="price_..."
```

Bootstrap helper:
```bash
sudo STRIPE_SECRET_KEY="sk_live_..." PANEL_BASE_URL="https://loccount.com" \
  /Users/root1/loc-count/_repos/ai-webadmin-plugin/scripts/setup-stripe-billing.sh
```

Webhook note:
- Point your Stripe webhook endpoint at `/api/stripe/webhook`.
- Send at minimum:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Subscription metadata should carry `tenant_id`, `site_id`, `plan_code`, and `plugin_id` so the panel can persist billing state and sync worker enforcement.
- Customer Portal is exposed through `POST /api/billing/customer-portal-session` and uses the latest known Stripe customer for the selected site.
- Stripe webhook replay protection is persisted in the local database by `stripe_event_id`, so duplicate deliveries are accepted once and ignored thereafter.
- Stripe webhook events now retain payload JSON plus failure status/error text for debugging and retry verification.

UI notes:
- `/pricing?site_id=<site-id>` shows a public billing-status badge for that site.
- `/console` shows a billing badge for the currently selected billing site.
- `/console` also exposes a Stripe webhook event table with processed/failed filtering. Hover a row to inspect the retained payload.

Webhook testing helper:
```bash
/Users/root1/loc-count/_repos/ai-webadmin-plugin/scripts/test-stripe-webhook.sh listen
/Users/root1/loc-count/_repos/ai-webadmin-plugin/scripts/test-stripe-webhook.sh trigger customer.subscription.updated
/Users/root1/loc-count/_repos/ai-webadmin-plugin/scripts/test-stripe-webhook.sh resend evt_123
```

## Monthly sandbox licensing (deactivate on non-payment)
- Use the **Billing & Sandbox Licensing** panel.
- Set `status` to `unpaid` or `canceled`, and/or uncheck `Sandbox enabled`.
- Click `Save + Sync` to persist locally and push to worker.
- Worker sandbox routes will return `402 sandbox_subscription_inactive` for blocked sites.

### Optional: Vault transit backend
```bash
export AI_VPS_SECRET_BACKEND="vault"
export AI_VPS_VAULT_ADDR="http://127.0.0.1:8200"
export AI_VPS_VAULT_TOKEN="..."
export AI_VPS_VAULT_TRANSIT_PATH="transit"
export AI_VPS_VAULT_HMAC_KEY="ai-vps-token-hmac"
```

## Example flow
1. Register site:
```bash
curl -sS -X POST http://localhost:8080/api/sites \
  -H 'authorization: Bearer admin-a' \
  -H 'content-type: application/json' \
  -d '{"id":"site-1","tenant_id":"tenant-a","domain":"example.com","panel_type":"ai_vps_panel","runtime_type":"php_generic"}'
```
2. Ask chat-agent:
```bash
curl -sS -X POST http://localhost:8080/api/chat/message \
  -H 'authorization: Bearer operator-a' \
  -H 'content-type: application/json' \
  -d '{"site_id":"site-1","message":"restart nginx"}'
```
3. Execute action in dry-run:
```bash
curl -sS -X POST http://localhost:8080/api/agent/execute \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer operator-a' \
  -d '{"site_id":"site-1","action":{"id":"...","type":"restart_service","description":"Restart nginx","risk":"high","requires_confirmation":true,"args":{"service":"nginx"}},"dry_run":true}'
```

4. Approve/execute from queue:
```bash
curl -sS -X GET 'http://localhost:8080/api/actions?status=pending' -H 'authorization: Bearer operator-a'
curl -sS -X POST 'http://localhost:8080/api/actions/<action_id>/approve' -H 'authorization: Bearer admin-a' -H 'content-type: application/json' -d '{}'
curl -sS -X POST 'http://localhost:8080/api/actions/<action_id>/execute' -H 'authorization: Bearer operator-a' -H 'content-type: application/json' -d '{"dry_run":true,"confirmed":true}'
```

5. Create and rotate a PAT:
```bash
curl -sS -X POST http://localhost:8080/api/tokens \
  -H 'authorization: Bearer admin-a' \
  -H 'content-type: application/json' \
  -d '{"tenant_id":"tenant-a","label":"ops-pat","token_type":"pat","role":"operator","auto_rotate":true,"rotate_after_days":14}'
curl -sS -X POST http://localhost:8080/api/tokens/<token_id>/rotate \
  -H 'authorization: Bearer admin-a' \
  -H 'content-type: application/json' \
  -d '{}'
```

## Notes
- This is the first control-plane backend skeleton, not a full cPanel replacement yet.
- Next phase should add full dashboard UX polish and production database migrations.
- For watchdog automation, ensure `/root/watchdog-heartbeat.sh` exists and is executable on the VPS host.
