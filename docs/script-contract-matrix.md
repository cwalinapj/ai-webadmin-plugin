# Script Contract Matrix

This is the implementation checklist for AI WebAdmin plugin automation scripts.

| Script | Primary Goal | Endpoint Contract | Inputs | Success Output |
|---|---|---|---|---|
| `launch-sandbox.sh` | Launch/reuse local LXD sandbox slot | Host-side primitive (current) | `site`, `wp_root`, `db_name`, `table_prefix`, slot/pool params | JSON with `container_name`, `port`, `expires_at` |
| `replicate-server.sh` | Create production replica + cloned sandbox pair | Host-side primitive (current) | `site`, `wp_root`, db args, `prod_port`, `sandbox_port` | JSON with prod/sandbox containers and health codes |
| `snapshot-site.sh` | Capture pre-change snapshot | Host-side primitive (current) | `site`, `site_path`, `output_dir`, optional excludes | JSON with `snapshot_id`, `artifact_key`, `archive_path` |
| `plan-upgrade.sh` | Build deterministic upgrade plan | Host-side primitive (current) | `site`, `site_path`, versions, optional plugins/themes | JSON with `plan_path`, `risk_score` |
| `execute-upgrade.sh` | Execute plan step-by-step | Host-side primitive (current) | `plan_path`, `confirmed`, optional `log_dir` | JSON with `plan_id`, `steps`, `log_path` |
| `verify-upgrade.sh` | Run smoke/health checks | Host-side primitive (current) | `site`, optional `site_path`, `url`, repeated `expect-file` | pass/fail JSON with evidence |
| `rollback-upgrade.sh` | Revert to known-good snapshot | Host-side primitive (current) | `snapshot_path`, `target_path`, `confirmed` | JSON with restored target and backup path |
| `watchdog-heartbeat.sh` | Apply LB hysteresis locally from observed traffic | Host-side primitive (current) | `site`, `rps`, `site_config`, repeated `backend` | JSON with action + managed LB result |
| `run-security-scan.sh` | Report malware/integrity findings | Host-side primitive (current) | `site`, `path`, optional report path | JSON with findings count and report path |
| `rotate-secrets.sh` | Rotate scoped tokens safely | Host-side primitive (current) | `name`, optional env file, length/prefix | JSON with updated secret metadata |

## Implementation policy
- Scripts are orchestrators only.
- Heavy actions occur in control-plane workers.
- Every call must be signed and replay-protected.
- Any destructive action must support dry-run and rollback path.

## Current split
- The scripts in this matrix are implemented as host-side operational primitives.
- The control plane can call selected primitives directly while broader worker/API orchestration evolves around them.
