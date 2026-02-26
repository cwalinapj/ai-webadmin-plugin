#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'TXT'
Usage:
  launch-sandbox.sh
    --site <domain>
    --staging-host <staging-domain>
    --wp-root <remote-wp-root>
    --db-name <db_name>
    --table-prefix <prefix_>
    --port <host-port>
    [--db-mode <live|cached>]
    [--destroy-on-success <yes|no>]
    [--vps-host <ip-or-hostname>]
    [--vps-user <ssh-user>]
    [--password-file <path>]

Defaults:
  --db-mode cached
  --destroy-on-success no
  --vps-host 45.131.65.193
  --vps-user root
  --password-file $HOME/.env

Environment override:
  SANDBOX_VPS_PASSWORD can be set directly to bypass password-file parsing.
TXT
}

SITE=""
STAGING_HOST=""
WP_ROOT=""
DB_NAME=""
TABLE_PREFIX=""
PORT=""
DB_MODE="cached"
DESTROY_ON_SUCCESS="no"
VPS_HOST="${SANDBOX_VPS_HOST:-45.131.65.193}"
VPS_USER="${SANDBOX_VPS_USER:-root}"
PASSWORD_FILE="${SANDBOX_VPS_PASSWORD_FILE:-$HOME/.env}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE="${2:-}"; shift 2;;
    --staging-host) STAGING_HOST="${2:-}"; shift 2;;
    --wp-root) WP_ROOT="${2:-}"; shift 2;;
    --db-name) DB_NAME="${2:-}"; shift 2;;
    --table-prefix) TABLE_PREFIX="${2:-}"; shift 2;;
    --port) PORT="${2:-}"; shift 2;;
    --db-mode) DB_MODE="${2:-}"; shift 2;;
    --destroy-on-success) DESTROY_ON_SUCCESS="${2:-}"; shift 2;;
    --vps-host) VPS_HOST="${2:-}"; shift 2;;
    --vps-user) VPS_USER="${2:-}"; shift 2;;
    --password-file) PASSWORD_FILE="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1"; usage; exit 2;;
  esac
done

if [[ -z "$SITE" || -z "$STAGING_HOST" || -z "$WP_ROOT" || -z "$DB_NAME" || -z "$TABLE_PREFIX" || -z "$PORT" ]]; then
  echo "Missing required args."
  usage
  exit 2
fi

if [[ "$DB_MODE" != "live" && "$DB_MODE" != "cached" ]]; then
  echo "--db-mode must be live or cached"
  exit 2
fi

if [[ "$DESTROY_ON_SUCCESS" != "yes" && "$DESTROY_ON_SUCCESS" != "no" ]]; then
  echo "--destroy-on-success must be yes or no"
  exit 2
fi

PASSWORD="${SANDBOX_VPS_PASSWORD:-}"
if [[ -z "$PASSWORD" ]]; then
  if [[ ! -f "$PASSWORD_FILE" ]]; then
    echo "Password file not found: $PASSWORD_FILE"
    exit 1
  fi
  PASSWORD="$(python3 - "$PASSWORD_FILE" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text(errors="ignore")
for pattern in (
    r'(?im)^\s*pass(?:word)?\s*:\s*(\S+)\s*$',
    r'(?im)^\s*SANDBOX_VPS_PASSWORD\s*=\s*(\S+)\s*$',
    r'(?im)^\s*VPS_PASSWORD\s*=\s*(\S+)\s*$',
):
    m = re.search(pattern, text)
    if m:
        print(m.group(1))
        raise SystemExit(0)
raise SystemExit(1)
PY
)" || {
    echo "Could not parse VPS password from $PASSWORD_FILE"
    exit 1
  }
fi

remote() {
  sshpass -p "$PASSWORD" ssh \
    -o ConnectTimeout=20 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "$VPS_USER@$VPS_HOST" "$@"
}

q() {
  printf '%q' "$1"
}

REMOTE_CMD="/root/wp_sandbox_run.sh \
--site $(q "$SITE") \
--staging-host $(q "$STAGING_HOST") \
--wp-root $(q "$WP_ROOT") \
--db-name $(q "$DB_NAME") \
--table-prefix $(q "$TABLE_PREFIX") \
--port $(q "$PORT") \
--db-mode $(q "$DB_MODE") \
--destroy-on-success $(q "$DESTROY_ON_SUCCESS")"

echo "[launch-sandbox] vps=${VPS_USER}@${VPS_HOST} site=${SITE} port=${PORT} db_mode=${DB_MODE}"
remote "bash -lc $(q "$REMOTE_CMD")"

RUN_DIR="$(remote "bash -lc $(q "ls -1dt /opt/wp-staging/sites/${SITE}/runs/* 2>/dev/null | head -n1")" | tr -d '\r')"
if [[ -n "$RUN_DIR" ]]; then
  echo "[launch-sandbox] latest_run_dir=${RUN_DIR}"
  remote "bash -lc $(q "test -f '${RUN_DIR}/report.json' && cat '${RUN_DIR}/report.json' || true")"
fi
