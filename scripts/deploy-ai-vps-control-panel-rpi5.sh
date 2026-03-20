#!/usr/bin/env bash
set -euo pipefail

# Deploy AI VPS Control Panel on Raspberry Pi 5 (Debian Bookworm/Ubuntu)
# - Installs prerequisites + Node.js 22
# - Deploys code from local checkout or git repo
# - Builds apps/ai-vps-control-panel
# - Configures systemd service

APP_USER="${APP_USER:-ai-panel}"
APP_GROUP="${APP_GROUP:-${APP_USER}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ai-webadmin-plugin}"
ENV_FILE="${ENV_FILE:-/etc/ai-vps-control-panel.env}"
SERVICE_NAME="${SERVICE_NAME:-ai-vps-control-panel}"
PORT="${PORT:-8080}"
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-/run/${SERVICE_NAME}/runtime.env}"
BOOTSTRAP_HELPER_PATH="${BOOTSTRAP_HELPER_PATH:-/usr/local/bin/${SERVICE_NAME}-refresh-keys}"
REFRESH_AND_RELOAD_HELPER_PATH="${REFRESH_AND_RELOAD_HELPER_PATH:-/usr/local/bin/${SERVICE_NAME}-refresh-and-reload}"
ENABLE_KEY_REFRESH_TIMER="${ENABLE_KEY_REFRESH_TIMER:-1}"
KEY_REFRESH_INTERVAL_MINUTES="${KEY_REFRESH_INTERVAL_MINUTES:-5}"
ROTATE_PUBLISH_HELPER_PATH="${ROTATE_PUBLISH_HELPER_PATH:-/usr/local/bin/${SERVICE_NAME}-rotate-publish}"
ENABLE_ROTATE_PUBLISH_TIMER="${ENABLE_ROTATE_PUBLISH_TIMER:-0}"
ROTATE_PUBLISH_INTERVAL_MINUTES="${ROTATE_PUBLISH_INTERVAL_MINUTES:-15}"

# Source options:
# 1) local source (default): sync current repo to INSTALL_DIR
# 2) git source: set REPO_URL, optional REPO_BRANCH
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SOURCE_DIR="${LOCAL_SOURCE_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

log() {
  printf '[deploy-rpi5] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run as root: sudo $0"
    exit 1
  fi
}

run_as_app() {
  local cmd="$1"
  runuser -u "${APP_USER}" -- bash -lc "${cmd}"
}

install_packages() {
  log "Installing OS packages"
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    rsync \
    sqlite3 \
    build-essential \
    gnupg
}

install_node_22() {
  local need_install=1
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ -n "${major}" && "${major}" -ge 22 ]]; then
      need_install=0
    fi
  fi

  if [[ "${need_install}" -eq 1 ]]; then
    log "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    log "Node.js $(node -v) already installed"
  fi
}

ensure_user() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    log "Creating group ${APP_GROUP}"
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Creating user ${APP_USER}"
    useradd --system --gid "${APP_GROUP}" --home-dir "/home/${APP_USER}" --create-home --shell /usr/sbin/nologin "${APP_USER}"
  fi
}

deploy_code() {
  mkdir -p "${INSTALL_DIR}"

  if [[ -n "${REPO_URL}" ]]; then
    log "Deploying from git: ${REPO_URL} (${REPO_BRANCH})"
    if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
      rm -rf "${INSTALL_DIR}"
      run_as_app "git clone --branch '${REPO_BRANCH}' --depth 1 '${REPO_URL}' '${INSTALL_DIR}'"
    else
      run_as_app "cd '${INSTALL_DIR}' && git fetch --depth 1 origin '${REPO_BRANCH}' && git checkout '${REPO_BRANCH}' && git reset --hard 'origin/${REPO_BRANCH}'"
    fi
  else
    log "Deploying from local source: ${LOCAL_SOURCE_DIR}"
    if [[ ! -d "${LOCAL_SOURCE_DIR}/apps/ai-vps-control-panel" ]]; then
      echo "Local source does not look correct: ${LOCAL_SOURCE_DIR}"
      exit 1
    fi
    rsync -a --delete \
      --exclude '.git' \
      --exclude 'node_modules' \
      "${LOCAL_SOURCE_DIR}/" "${INSTALL_DIR}/"
  fi

  chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"
}

build_app() {
  log "Installing dependencies + building"
  run_as_app "cd '${INSTALL_DIR}/apps/panel-addon-core' && npm ci"
  run_as_app "cd '${INSTALL_DIR}/apps/ai-vps-control-panel' && npm ci"
  run_as_app "cd '${INSTALL_DIR}/apps/ai-vps-control-panel' && npm run build"
}

write_env_file_if_missing() {
  if [[ -f "${ENV_FILE}" ]]; then
    log "Env file exists: ${ENV_FILE} (leaving as-is)"
    return
  fi

  log "Creating env file: ${ENV_FILE}"
  cat >"${ENV_FILE}" <<ENVVARS
PORT=${PORT}
AI_VPS_DB_PATH=/var/lib/ai-vps-control-panel/ai-vps-control-panel.sqlite
AI_VPS_API_KEYS=change-me-admin-key:admin:*
AI_VPS_SECRET_BACKEND=local
AI_VPS_TOKEN_PEPPER=change-this-in-production
AI_VPS_TOKEN_ROTATE_DAYS=30

# Vault mode (optional)
# AI_VPS_SECRET_BACKEND=vault
# AI_VPS_VAULT_ADDR=http://127.0.0.1:8200
# AI_VPS_VAULT_TOKEN=replace-with-vault-token
# AI_VPS_VAULT_TRANSIT_PATH=transit
# AI_VPS_VAULT_HMAC_KEY=ai-vps-token-hmac
#
# Vault KV startup key fetch (optional)
# If enabled, AI_VPS_API_KEYS is loaded from Vault KV every service start/restart.
# Expected Vault KV v2 field value format:
#   admin-token:admin:*,operator-token:operator:tenant-a
# AI_VPS_VAULT_KV_ENABLE=1
# AI_VPS_VAULT_KV_MOUNT=kv
# AI_VPS_VAULT_KV_PATH=ai-vps-control-panel/runtime
# AI_VPS_VAULT_KV_FIELD=api_keys_spec
# AI_VPS_PANEL_BASE_URL=http://127.0.0.1:${PORT}
# AI_VPS_ROTATE_PUBLISH_LIMIT=50

# Optional worker sync
# PANEL_WORKER_BASE_URL=https://worker.example.com
# PANEL_WORKER_SHARED_SECRET=replace-me
# PANEL_WORKER_CAP_UPTIME=replace-me
# PANEL_WORKER_CAP_SANDBOX=replace-me
# PANEL_WORKER_PLUGIN_PREFIX=ai-vps-panel
ENVVARS

  chown root:"${APP_GROUP}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
}

prepare_data_dirs() {
  mkdir -p /var/lib/ai-vps-control-panel
  chown -R "${APP_USER}:${APP_GROUP}" /var/lib/ai-vps-control-panel
  chmod 0750 /var/lib/ai-vps-control-panel
}

install_bootstrap_helper() {
  local source_helper="${INSTALL_DIR}/scripts/refresh-ai-vps-keys-from-vault.sh"
  if [[ ! -f "${source_helper}" ]]; then
    echo "Vault KV bootstrap helper not found: ${source_helper}" >&2
    exit 1
  fi

  log "Installing key bootstrap helper: ${BOOTSTRAP_HELPER_PATH}"
  install -m 0755 "${source_helper}" "${BOOTSTRAP_HELPER_PATH}"
}

install_refresh_and_reload_helper() {
  local source_helper="${INSTALL_DIR}/scripts/refresh-ai-vps-keys-and-reload.sh"
  if [[ ! -f "${source_helper}" ]]; then
    echo "refresh+reload helper not found: ${source_helper}" >&2
    exit 1
  fi

  log "Installing key refresh+reload helper: ${REFRESH_AND_RELOAD_HELPER_PATH}"
  install -m 0755 "${source_helper}" "${REFRESH_AND_RELOAD_HELPER_PATH}"
}

install_rotate_publish_helper() {
  local source_helper="${INSTALL_DIR}/scripts/rotate-and-publish-vault-keys.sh"
  if [[ ! -f "${source_helper}" ]]; then
    echo "rotate+publish helper not found: ${source_helper}" >&2
    exit 1
  fi

  log "Installing rotate+publish helper: ${ROTATE_PUBLISH_HELPER_PATH}"
  install -m 0755 "${source_helper}" "${ROTATE_PUBLISH_HELPER_PATH}"
}

write_systemd_unit() {
  local unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
  log "Writing systemd unit: ${unit_path}"
  cat >"${unit_path}" <<UNIT
[Unit]
Description=AI VPS Control Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
EnvironmentFile=${ENV_FILE}
EnvironmentFile=-${RUNTIME_ENV_FILE}
WorkingDirectory=${INSTALL_DIR}/apps/ai-vps-control-panel
RuntimeDirectory=${SERVICE_NAME}
RuntimeDirectoryMode=0750
ExecStartPre=${BOOTSTRAP_HELPER_PATH} ${ENV_FILE} ${RUNTIME_ENV_FILE}
ExecStart=/usr/bin/node ${INSTALL_DIR}/apps/ai-vps-control-panel/dist/src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/ai-vps-control-panel /run/${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
UNIT

  chmod 0644 "${unit_path}"
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.service"
}

write_key_refresh_units() {
  local refresh_service_path="/etc/systemd/system/${SERVICE_NAME}-key-refresh.service"
  local refresh_timer_path="/etc/systemd/system/${SERVICE_NAME}-key-refresh.timer"

  log "Writing key refresh service: ${refresh_service_path}"
  cat >"${refresh_service_path}" <<UNIT
[Unit]
Description=Refresh AI VPS API keys from Vault KV and restart on change
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=${REFRESH_AND_RELOAD_HELPER_PATH} ${SERVICE_NAME} ${ENV_FILE} ${RUNTIME_ENV_FILE} ${BOOTSTRAP_HELPER_PATH}
UNIT

  log "Writing key refresh timer: ${refresh_timer_path}"
  cat >"${refresh_timer_path}" <<UNIT
[Unit]
Description=Periodic AI VPS API key refresh timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=${KEY_REFRESH_INTERVAL_MINUTES}min
Unit=${SERVICE_NAME}-key-refresh.service
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  chmod 0644 "${refresh_service_path}" "${refresh_timer_path}"
  systemctl daemon-reload

  local enabled="${ENABLE_KEY_REFRESH_TIMER,,}"
  if [[ "${enabled}" == "1" || "${enabled}" == "true" || "${enabled}" == "yes" ]]; then
    systemctl enable --now "${SERVICE_NAME}-key-refresh.timer"
  else
    systemctl disable --now "${SERVICE_NAME}-key-refresh.timer" >/dev/null 2>&1 || true
  fi
}

write_rotate_publish_units() {
  local rotate_service_path="/etc/systemd/system/${SERVICE_NAME}-rotate-publish.service"
  local rotate_timer_path="/etc/systemd/system/${SERVICE_NAME}-rotate-publish.timer"

  log "Writing rotate+publish service: ${rotate_service_path}"
  cat >"${rotate_service_path}" <<UNIT
[Unit]
Description=Rotate due panel API keys and publish to Vault KV
After=network-online.target ${SERVICE_NAME}.service
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=${ROTATE_PUBLISH_HELPER_PATH} ${ENV_FILE}
UNIT

  log "Writing rotate+publish timer: ${rotate_timer_path}"
  cat >"${rotate_timer_path}" <<UNIT
[Unit]
Description=Periodic rotate+publish API key timer

[Timer]
OnBootSec=4min
OnUnitActiveSec=${ROTATE_PUBLISH_INTERVAL_MINUTES}min
Unit=${SERVICE_NAME}-rotate-publish.service
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  chmod 0644 "${rotate_service_path}" "${rotate_timer_path}"
  systemctl daemon-reload

  local enabled="${ENABLE_ROTATE_PUBLISH_TIMER,,}"
  if [[ "${enabled}" == "1" || "${enabled}" == "true" || "${enabled}" == "yes" ]]; then
    systemctl enable --now "${SERVICE_NAME}-rotate-publish.timer"
  else
    systemctl disable --now "${SERVICE_NAME}-rotate-publish.timer" >/dev/null 2>&1 || true
  fi
}

post_checks() {
  log "Service status"
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

  local enabled="${ENABLE_KEY_REFRESH_TIMER,,}"
  if [[ "${enabled}" == "1" || "${enabled}" == "true" || "${enabled}" == "yes" ]]; then
    log "Key refresh timer status"
    systemctl --no-pager --full status "${SERVICE_NAME}-key-refresh.timer" || true
  fi

  local rotate_enabled="${ENABLE_ROTATE_PUBLISH_TIMER,,}"
  if [[ "${rotate_enabled}" == "1" || "${rotate_enabled}" == "true" || "${rotate_enabled}" == "yes" ]]; then
    log "Rotate+publish timer status"
    systemctl --no-pager --full status "${SERVICE_NAME}-rotate-publish.timer" || true
  fi

  log "Health check"
  set +e
  curl -fsS "http://127.0.0.1:${PORT}/health"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    log "Health check failed; inspect logs: journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
    exit 1
  fi

  echo
  log "Deployment complete"
  log "Edit ${ENV_FILE} with real secrets, then restart: systemctl restart ${SERVICE_NAME}"
  if [[ "${enabled}" == "1" || "${enabled}" == "true" || "${enabled}" == "yes" ]]; then
    log "Manual key sync run: systemctl start ${SERVICE_NAME}-key-refresh.service"
  fi
  if [[ "${rotate_enabled}" == "1" || "${rotate_enabled}" == "true" || "${rotate_enabled}" == "yes" ]]; then
    log "Manual rotate+publish run: systemctl start ${SERVICE_NAME}-rotate-publish.service"
  fi
}

main() {
  require_root
  install_packages
  install_node_22
  ensure_user
  deploy_code
  build_app
  prepare_data_dirs
  write_env_file_if_missing
  install_bootstrap_helper
  install_refresh_and_reload_helper
  install_rotate_publish_helper
  write_systemd_unit
  write_key_refresh_units
  write_rotate_publish_units
  post_checks
}

main "$@"
