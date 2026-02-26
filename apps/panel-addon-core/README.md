# Panel Addon Core

Shared TypeScript runtime for VPS control-panel addons (cPanel/Plesk/DirectAdmin/CyberPanel) that connect to the existing control-plane worker.

## Implemented in this phase
- Signed request builder compatible with worker verification headers.
- API client for `/plugin/site/*` contracts.
- Runtime heartbeat collector for non-WordPress sites.
- CLI command to publish heartbeat telemetry.
- Unit tests for signer, client, and collector modules.

## Quick start
```bash
cd apps/panel-addon-core
npm install
npm test
npm run build
```

## Heartbeat CLI usage
```bash
PANEL_BASE_URL="https://worker.example.com" \
PANEL_PLUGIN_ID="panel-agent-1" \
PANEL_SHARED_SECRET="..." \
PANEL_CAP_UPTIME="..." \
PANEL_SITE_ID="site-1" \
PANEL_DOMAIN="example.com" \
node dist/src/cli/heartbeat.js
```

## Current contract targets
- `POST /plugin/site/watchdog/heartbeat`
- `POST /plugin/site/host-optimizer/baseline`
- `POST /plugin/site/sandbox/request`
- `POST /plugin/site/sandbox/vote`
- `POST /plugin/site/sandbox/claim`
- `POST /plugin/site/sandbox/release`
- `POST /plugin/site/sandbox/conflicts/report`
- `POST /plugin/site/sandbox/conflicts/list`
- `POST /plugin/site/sandbox/conflicts/resolve`
