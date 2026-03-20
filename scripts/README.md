# AI WebAdmin Scripts

These scripts are host-side operational primitives for VPS/container orchestration.

## Implemented now
1. `replicate-server.sh`
   - Creates a dedicated production replica container from live site state.
   - Clones an identical sandbox container from a production snapshot.
   - Runs health checks for both ports and returns JSON output.
   - Supports `--dry-run` for safe plan validation without host mutation.
2. `launch-sandbox.sh`
   - Shared on-demand sandbox pool manager with lease TTL.
   - Commands: `acquire`, `release`, `status`, `cleanup`.
   - Supports multi-site reuse: slots are allocated only when needed and released/expired automatically.
3. `manage-nginx-lb.sh`
   - Commands: `enable`, `disable`, `status`.
   - Enables load balancer mode by replacing a site config with managed upstream proxy config.
   - Backs up existing config and rolls back on invalid nginx config.
4. `watchdog-heartbeat.sh`
   - Traffic-threshold switch helper with hysteresis.
   - Calls `manage-nginx-lb.sh` to enable/disable LB mode based on observed request rate.
5. `snapshot-site.sh`
   - Captures a tar snapshot, SHA-256 checksum, and manifest for a site path.
   - Supports `--dry-run` preview before writing artifacts.
6. `plan-upgrade.sh`
   - Builds a deterministic line-based upgrade plan with risk score and ordered steps.
   - Supports `--dry-run` preview and persisted plan files.
7. `execute-upgrade.sh`
   - Executes a generated upgrade plan with confirmation gating and step logs.
   - Supports `--dry-run` preview before mutation.
8. `verify-upgrade.sh`
   - Runs lightweight post-upgrade checks for paths, files, and optional HTTP status codes.
9. `rollback-upgrade.sh`
   - Restores a target path from a snapshot tarball with rollback backup creation.
   - Supports `--dry-run` preview and requires confirmation for real rollback.
10. `run-security-scan.sh`
   - Scans PHP files for suspicious constructs and writes a findings report.
   - Supports `--dry-run` preview and capped findings output.
11. `rotate-secrets.sh`
   - Generates a fresh secret and optionally persists it into an env file with backup.
   - Supports `--dry-run` preview and path allowlisting for mutations.
12. `test-host-ops-smoke.sh`
   - Non-destructive smoke harness for the host-side ops scripts.
   - Stubs `lxc`, `mysql`, and `nginx` so CI can validate behavior without a VPS.

## Deployment helper
- `deploy-ai-vps-control-panel-rpi5.sh`: deploys `apps/ai-vps-control-panel` on Raspberry Pi 5 with `systemd`, SQLite, optional Vault Transit secret backend env wiring, and a periodic key-refresh timer.
- `refresh-ai-vps-keys-from-vault.sh`: loads `AI_VPS_API_KEYS` from Vault KV v2 into a runtime env file (used by `ExecStartPre` in the Raspberry Pi service unit).
- `refresh-ai-vps-keys-and-reload.sh`: refreshes runtime keys and restarts the service only when the key set changed.
- `rotate-and-publish-vault-keys.sh`: rotates due DB-backed keys via panel API, writes the updated key spec to Vault KV, and records a publish audit event.
- `setup-stripe-billing.sh`: creates the Stripe products/prices for Starter, Growth, and Control Plane, registers the Stripe webhook endpoint for `/api/stripe/webhook`, and writes the derived env vars into the panel env file.
- `test-stripe-webhook.sh`: Stripe CLI helper to listen, trigger test events, and resend a real event id against the panel webhook endpoint.
