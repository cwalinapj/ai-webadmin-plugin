#!/usr/bin/env bash
set -euo pipefail

# Refresh AI_VPS_API_KEYS into a runtime env file.
# - If AI_VPS_VAULT_KV_ENABLE=1, fetches keys from Vault KV v2.
# - Otherwise uses AI_VPS_API_KEYS from the base env file.

BASE_ENV_FILE="${1:-${BASE_ENV_FILE:-/etc/ai-vps-control-panel.env}}"
RUNTIME_ENV_FILE="${2:-${RUNTIME_ENV_FILE:-/run/ai-vps-control-panel/runtime.env}}"

if [[ ! -f "${BASE_ENV_FILE}" ]]; then
  echo "base env file not found: ${BASE_ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${BASE_ENV_FILE}"
set +a

runtime_dir="$(dirname -- "${RUNTIME_ENV_FILE}")"
mkdir -p "${runtime_dir}"

tmp_file="$(mktemp "${runtime_dir}/runtime.env.XXXXXX")"
cleanup() {
  rm -f "${tmp_file}"
}
trap cleanup EXIT

# Copy all static env vars except AI_VPS_API_KEYS, which is rewritten below.
grep -v '^AI_VPS_API_KEYS=' "${BASE_ENV_FILE}" > "${tmp_file}" || true

is_enabled="${AI_VPS_VAULT_KV_ENABLE:-0}"
if [[ "${is_enabled}" == "1" || "${is_enabled,,}" == "true" || "${is_enabled,,}" == "yes" ]]; then
  if [[ -z "${AI_VPS_VAULT_ADDR:-}" || -z "${AI_VPS_VAULT_TOKEN:-}" ]]; then
    echo "AI_VPS_VAULT_KV_ENABLE is set, but AI_VPS_VAULT_ADDR or AI_VPS_VAULT_TOKEN is missing" >&2
    exit 1
  fi

  kv_mount="${AI_VPS_VAULT_KV_MOUNT:-kv}"
  kv_path="${AI_VPS_VAULT_KV_PATH:-ai-vps-control-panel/runtime}"
  kv_field="${AI_VPS_VAULT_KV_FIELD:-api_keys_spec}"

  vault_url="${AI_VPS_VAULT_ADDR%/}/v1/${kv_mount#/}/data/${kv_path#/}"
  vault_json="$(curl -fsS -H "X-Vault-Token: ${AI_VPS_VAULT_TOKEN}" "${vault_url}")"

  api_keys_spec="$({
    printf '%s' "${vault_json}" | node -e '
      const fs = require("fs");
      const field = process.argv[1];
      const raw = fs.readFileSync(0, "utf8");
      const body = JSON.parse(raw);
      const value = body?.data?.data?.[field];
      if (typeof value !== "string" || value.trim() === "") {
        process.exit(2);
      }
      process.stdout.write(value.trim());
    ' "${kv_field}"
  })" || {
    echo "failed to parse Vault KV field '${kv_field}' from ${vault_url}" >&2
    exit 1
  }

  printf 'AI_VPS_API_KEYS=%s\n' "${api_keys_spec}" >> "${tmp_file}"
else
  if [[ -z "${AI_VPS_API_KEYS:-}" ]]; then
    echo "AI_VPS_API_KEYS is missing in ${BASE_ENV_FILE}" >&2
    exit 1
  fi
  printf 'AI_VPS_API_KEYS=%s\n' "${AI_VPS_API_KEYS}" >> "${tmp_file}"
fi

chmod 0600 "${tmp_file}"
mv -f "${tmp_file}" "${RUNTIME_ENV_FILE}"
