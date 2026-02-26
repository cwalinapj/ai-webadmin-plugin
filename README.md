# WP Admin Plugin Suite

Repository for multiple WordPress plugins and a Cloudflare control plane.

This repo is now organized as a multi-product suite (not web3-only):
- `apps/webadmin-edge-agent`: production WordPress edge agent plugin.
- `apps/control-plane-worker`: Cloudflare Worker control plane.
- `apps/storage-anchor-worker`: policy-based R2 + B2 + IPFS storage anchor service.
- `apps/panel-addon-core`: scaffold for non-WordPress control-panel addons.
- `apps/ai-vps-control-panel`: AI-chat-operated VPS control-panel backend scaffold.
- `plugins/ai-webadmin`: legacy all-in-one AI WebAdmin plugin.
- [`plugins/tolldns`](plugins/tolldns/README.md): TollDNS helper plugin — part of the [DECENTRALIZED-DNS](https://github.com/cwalinapj/DECENTRALIZED-DNS-) platform.
- [`plugins/toll-comments`](plugins/toll-comments/README.md): DDNS Toll Comments — refundable credit-based comment spam protection (merged from [DECENTRALIZED-DNS](https://github.com/cwalinapj/DECENTRALIZED-DNS-)).
- [`plugins/wp-optin`](plugins/wp-optin/README.md): DDNS Opt-in — connect a WordPress site to the DECENTRALIZED-DNS control plane (merged from [DECENTRALIZED-DNS](https://github.com/cwalinapj/DECENTRALIZED-DNS-)).
- `plugins/ai-wp-host-optimizer`: host baseline and VPS recommendation telemetry plugin.
- `plugins/ai-addwords-meta-plugin`: paid traffic AI orchestration + CPA/Web3 settlement plugin.

## AI_WP_Plugin_Family

- [AI_WP_Plugin_Family](apps/webadmin-edge-agent/readme.txt) - WebAdmin Edge Agent
- [AI_WP_Plugin_Family](plugins/ai-webadmin/README.md) - AI WebAdmin
- [AI_WP_Plugin_Family](plugins/tolldns/README.md) - TollDNS
- [AI_WP_Plugin_Family](plugins/ai-wp-host-optimizer/README.md) - AI WP Host Optimizer Plugin
- [AI_WP_Plugin_Family](plugins/ai-addwords-meta-plugin/README.md) - AI AddWords + Meta Paid Traffic Plugin

## Repository layout

```text
repo/
  apps/
    webadmin-edge-agent/
    control-plane-worker/
    storage-anchor-worker/
    panel-addon-core/
    ai-vps-control-panel/
  plugins/
    ai-webadmin/
    tolldns/
    toll-comments/
    wp-optin/
    ai-wp-host-optimizer/
    ai-addwords-meta-plugin/
  docs/
  scripts/
  update-feed/
```

## VPS addon phase

- Roadmap: `docs/vps-control-panel-addon-roadmap.md`
- AI VPS control panel architecture: `docs/ai-vps-control-panel-architecture.md`
- Worker now supports both route namespaces:
  - `/plugin/wp/*` for existing WordPress agents
  - `/plugin/site/*` for control-panel addons and non-WordPress runtimes

## Local development

### WP-Env
- Requires Node 20+ and Docker.
- Plugin mounted from `./apps/webadmin-edge-agent`.

```bash
npm install -g @wordpress/env
wp-env start
```

### Docker Compose
- WordPress plugin mounted from `./apps/webadmin-edge-agent`.

```bash
docker compose up -d
```

### Worker

```bash
cd apps/control-plane-worker
npm install
npm run dev
```

### Autonomous Watchdog LB (Worker -> VPS panel)

Enable automatic LB switching when heartbeat telemetry crosses thresholds:

```bash
cd apps/control-plane-worker
wrangler secret put WATCHDOG_AUTOMATION_PANEL_API_TOKEN
```

Set vars in `apps/control-plane-worker/wrangler.toml`:
- `WATCHDOG_AUTOMATION_ENABLED=1`
- `WATCHDOG_AUTOMATION_PANEL_BASE_URL=https://<vps-panel-host>`
- `WATCHDOG_AUTOMATION_BACKENDS=127.0.0.1:18120,127.0.0.1:18122`
- `WATCHDOG_AUTOMATION_ENABLE_RPS_THRESHOLD=180`
- `WATCHDOG_AUTOMATION_DISABLE_RPS_THRESHOLD=120`
- `WATCHDOG_AUTOMATION_RPS_PER_LOAD_AVG=60` (fallback if `traffic_rps` not provided)
- `WATCHDOG_AUTOMATION_COOLDOWN_SECONDS=300`
- `WATCHDOG_AUTOMATION_DRY_RUN=1` (set `0` for live execution)
- `WATCHDOG_AUTOMATION_SITE_TEMPLATE={domain}`
- `WATCHDOG_AUTOMATION_SITE_CONFIG_TEMPLATE=/etc/nginx/sites-available/{domain}.conf`

### Panel Addon Core

```bash
cd apps/panel-addon-core
npm install
npm test
npm run build
```

### AI VPS Control Panel

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

### Analytics OAuth + Deploy setup

Set worker secrets:

```bash
cd apps/control-plane-worker
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_REDIRECT_URI
wrangler secret put CAP_TOKEN_ANALYTICS_WRITE
wrangler secret put ANALYTICS_GOAL_ASSISTANT_GATEWAY_ID # optional
```

Worker callback:
- `GET /oauth/google/callback`
- AI planner uses Workers AI binding `AI` with fallback to deterministic planning.
- Optional vars in `wrangler.toml`:
  - `ANALYTICS_GOAL_ASSISTANT_USE_AI` (`1` or `0`)
  - `ANALYTICS_GOAL_ASSISTANT_MODEL` (default `@cf/meta/llama-3.1-8b-instruct`)
  - `ANALYTICS_GOAL_ASSISTANT_GATEWAY_ID` (optional AI Gateway id)

WP Admin flow:
1. Open `WebAdmin Edge Agent -> Analytics & Reporting`.
2. Click `Generate Analytics API Key` and copy the one-time value.
3. Set the same value in worker secret `CAP_TOKEN_ANALYTICS_WRITE`.
4. Use `AI Goal Assistant` to generate recommended conversion goals/events.
5. Click `Apply Plan to Analytics Settings` to auto-fill primary/secondary conversions + funnel steps.
6. Save GA4/GTM IDs, click `Connect Google Account`, then `Deploy GTM + GA4 Conversions`.

## Wallet login verification

`plugins/ai-webadmin` now supports wallet-signature login for:
- Ethereum (`personal_sign`)
- Solana (`signMessage`)

Worker endpoint:
- `POST /plugin/wp/auth/wallet/verify`

The worker verifies signed requests and validates wallet signatures for both networks.

## Sandbox Scheduler (Agent Voting)

Control-plane worker now supports sandbox queue orchestration with agent voting:
- `POST /plugin/wp/sandbox/request`
- `POST /plugin/wp/sandbox/vote`
- `POST /plugin/wp/sandbox/claim`
- `POST /plugin/wp/sandbox/release`
- `POST /plugin/wp/sandbox/conflicts/report`
- `POST /plugin/wp/sandbox/conflicts/list`
- `POST /plugin/wp/sandbox/conflicts/resolve`

Selection order is weighted by:
- request priority
- summed agent votes
- queue age (anti-starvation boost)

Claims are serialized with a Durable Object lock so multiple agents do not claim the same sandbox slot.
Agents can also share a conflict pool for blocked work, read active conflicts, and resolve/dismiss them after remediation.
All sandbox routes use signed plugin auth and require capability token `CAP_TOKEN_SANDBOX_WRITE`.

## Analytics Google deploy (OAuth + one-click conversions)

New worker routes:
- `POST /plugin/wp/analytics/google/connect/start`
- `POST /plugin/wp/analytics/google/status`
- `POST /plugin/wp/analytics/google/deploy`
- `GET /oauth/google/callback`

Plugin tab:
- `Analytics & Reporting` now supports:
  - Connect Google account (OAuth)
  - Save GA4/GTM IDs + analytics capability token
  - One-click deploy for GTM tags/triggers and GA4 conversions
  - Optional GTM snippet + conversion event bridge injection

## Tests

### Worker tests (includes Ethereum + Solana wallet verify tests)

```bash
cd apps/control-plane-worker
npm test
```

### Edge agent PHP tests

```bash
cd apps/webadmin-edge-agent
composer install
composer test
```

### Toll Comments PHP tests

```bash
cd plugins/toll-comments
phpunit
```

## Build installable edge-agent zip

```bash
./scripts/build-webadmin-edge-agent-zip.sh
```

Artifact:
- `apps/webadmin-edge-agent/dist/webadmin-edge-agent.zip`

## CI

GitHub Actions workflow:
- Runs worker tests (including Ethereum/Solana wallet-login verification path).
- Runs WordPress edge-agent PHPUnit suite.
- Runs PHP lint for `plugins/ai-webadmin`, `plugins/tolldns`, `plugins/toll-comments`, `plugins/wp-optin`, and `plugins/ai-addwords-meta-plugin`.

## GitHub repo rename

If you want the GitHub repository slug renamed from a web3-specific name, do it in:
- GitHub -> Repository -> `Settings` -> `General` -> `Repository name`

Suggested neutral name:
- `wp-admin-plugin-suite`
