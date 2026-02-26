# AI VPS Control Panel (Scaffold)

Initial backend scaffold for a custom VPS control panel operated through a chat-agent workflow.

## What is implemented
- HTTP API server with health, site registration, chat planning, and action execution routes.
- Chat-agent planner that converts operator prompts into structured operations.
- Safe command executor with allowlisted services and confirmation gating.
- Dry-run-first execution mode for risky operations.
- Persistent API-key/PAT management with hashed-at-rest secrets, audit trails, revoke/rotate endpoints, and auto-rotation support.
- Supports `switch_load_balancer_mode` action mapped to `/root/watchdog-heartbeat.sh` with strict args validation.

## API routes
- `GET /health`
- `GET /api/auth/me`
- `GET /api/tokens`
- `POST /api/tokens`
- `POST /api/tokens/auto-rotate`
- `POST /api/tokens/publish-audit`
- `POST /api/tokens/:id/revoke`
- `POST /api/tokens/:id/rotate`
- `GET /api/sites`
- `POST /api/sites`
- `POST /api/chat/message`
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
```

## Local run
```bash
cd apps/ai-vps-control-panel
npm install
export AI_VPS_DB_PATH="./data/ai-vps-control-panel.sqlite"
export AI_VPS_API_KEYS="admin-a:admin:tenant-a,operator-a:operator:tenant-a"
export AI_VPS_SECRET_BACKEND="local"
export AI_VPS_TOKEN_PEPPER="change-this-in-prod"
export AI_VPS_TOKEN_ROTATE_DAYS="30"
npm test
npm run build
npm start
```
Open [http://localhost:8080](http://localhost:8080) for the web UI.

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
