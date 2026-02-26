# Script Contract Matrix

This is the implementation checklist for AI WebAdmin plugin automation scripts.

| Script | Primary Goal | Endpoint Contract | Inputs | Success Output |
|---|---|---|---|---|
| `launch-sandbox.sh` | Launch isolated pre-update sandbox | `POST /plugin/wp/sandbox/launch` | `session_id`, `site_url`, `snapshot_ref` | `sandbox_id`, `status=ready` |
| `replicate-server.sh` | Clone runtime state to temporary node | `POST /plugin/wp/replication/start` | `node_profile`, `snapshot_ref` | `replica_id`, `sync_status` |
| `snapshot-site.sh` | Capture pre-change snapshot | `POST /plugin/wp/backup/snapshot` | manifest, checksums, metadata | `snapshot_id`, `artifact_key` |
| `plan-upgrade.sh` | Build deterministic upgrade plan | `POST /plugin/wp/upgrade/plan` | versions, constraints | ordered plan + risk score |
| `execute-upgrade.sh` | Execute plan step-by-step | `POST /plugin/wp/upgrade/execute` | `plan_id`, approvals | `job_id`, step status |
| `verify-upgrade.sh` | Run smoke/health checks | `POST /plugin/wp/upgrade/verify` | `job_id`, test profile | pass/fail + evidence |
| `rollback-upgrade.sh` | Revert to known-good snapshot | `POST /plugin/wp/rollback/execute` | `snapshot_id`, `reason` | rollback job status |
| `watchdog-heartbeat.sh` | Report health telemetry | `POST /plugin/wp/watchdog/heartbeat` | cpu/mem/http/checklist | health state |
| `run-security-scan.sh` | Report malware/integrity findings | `POST /plugin/wp/security/integrity/report` | changed files + indicators | finding_id + severity |
| `rotate-secrets.sh` | Rotate scoped tokens safely | `POST /plugin/wp/secrets/rotate` | token scope, expiry policy | rotated token metadata |

## Implementation policy
- Scripts are orchestrators only.
- Heavy actions occur in control-plane workers.
- Every call must be signed and replay-protected.
- Any destructive action must support dry-run and rollback path.
