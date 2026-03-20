#!/usr/bin/env bash
set -euo pipefail

# Refresh runtime API key env and restart service if keys changed.

SERVICE_NAME="${1:-ai-vps-control-panel}"
BASE_ENV_FILE="${2:-/etc/ai-vps-control-panel.env}"
RUNTIME_ENV_FILE="${3:-/run/${SERVICE_NAME}/runtime.env}"
REFRESH_HELPER="${4:-/usr/local/bin/${SERVICE_NAME}-refresh-keys}"

if [[ ! -x "${REFRESH_HELPER}" ]]; then
  echo "refresh helper is not executable: ${REFRESH_HELPER}" >&2
  exit 1
fi

old_hash=""
if [[ -f "${RUNTIME_ENV_FILE}" ]]; then
  old_hash="$(sha256sum "${RUNTIME_ENV_FILE}" | awk '{print $1}')"
fi

"${REFRESH_HELPER}" "${BASE_ENV_FILE}" "${RUNTIME_ENV_FILE}"
new_hash="$(sha256sum "${RUNTIME_ENV_FILE}" | awk '{print $1}')"

if [[ "${old_hash}" != "${new_hash}" ]]; then
  systemctl restart "${SERVICE_NAME}.service"
  echo "${SERVICE_NAME}: runtime key set changed; service restarted"
else
  echo "${SERVICE_NAME}: runtime key set unchanged"
fi
