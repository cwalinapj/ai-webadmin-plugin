# AI WebAdmin Scripts (Scaffold)

These scripts define the plugin-side operational verbs that emulate a human web admin workflow.

## Priority scripts
1. `launch-sandbox.sh`
2. `replicate-server.sh`
3. `snapshot-site.sh`
4. `plan-upgrade.sh`
5. `execute-upgrade.sh`
6. `verify-upgrade.sh`
7. `rollback-upgrade.sh`
8. `watchdog-heartbeat.sh`
9. `run-security-scan.sh`
10. `rotate-secrets.sh`

All scripts are currently stubs that log contract expectations and exit safely.

## Current status
- `launch-sandbox.sh` now supports a real LXD sandbox launch flow over SSH:
  - reads VPS password from `SANDBOX_VPS_PASSWORD` or `~/.env` (`Password:` style)
  - calls remote `/root/wp_sandbox_run.sh` with site/db parameters
  - prints latest `report.json` from `/opt/wp-staging/sites/<site>/runs/<run_id>/`
- Remaining scripts are scaffold stubs.
