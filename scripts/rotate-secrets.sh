#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Rotate a named secret and optionally persist it into an env file.
TXT
}

upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp="${file}.tmp"
  if [[ -f "${file}" ]]; then
    awk -F= -v k="${key}" -v v="${value}" 'BEGIN{updated=0} $1==k {print k"="v; updated=1; next} {print} END{if(updated==0) print k"="v}' "${file}" > "${tmp}"
  else
    printf '%s=%s\n' "${key}" "${value}" > "${tmp}"
  fi
  mv "${tmp}" "${file}"
}

main() {
  local name=""
  local write_env_file=""
  local length=40
  local prefix=""
  local dry_run="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="${2:-}"; shift 2 ;;
      --write-env-file) write_env_file="${2:-}"; shift 2 ;;
      --length) length="${2:-}"; shift 2 ;;
      --prefix) prefix="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${name}" ]] || die 'requires --name'
  if [[ -n "${write_env_file}" ]]; then
    require_absolute_path "${write_env_file}"
    allowed_mutation_path "${write_env_file}" || die "env file path not allowed: ${write_env_file}"
  fi

  local secret="${prefix}$(random_token "${length}")"
  if [[ "${dry_run}" == 'yes' ]]; then
    printf '{"ok":true,"dry_run":true,"name":"%s","write_env_file":"%s","secret_preview":"%s"}\n' \
      "${name}" "${write_env_file}" "${secret:0:8}"
    return 0
  fi

  local backup_path=""
  if [[ -n "${write_env_file}" ]]; then
    mkdir -p "$(dirname "${write_env_file}")"
    if [[ -f "${write_env_file}" ]]; then
      backup_path="${write_env_file}.bak.$(epoch_utc)"
      cp -a "${write_env_file}" "${backup_path}"
    fi
    upsert_env_key "${write_env_file}" "${name}" "${secret}"
  fi

  printf '{"ok":true,"dry_run":false,"name":"%s","write_env_file":"%s","backup_path":"%s","secret":"%s","secret_preview":"%s"}\n' \
    "${name}" "${write_env_file}" "${backup_path}" "${secret}" "${secret:0:8}"
}

main "$@"
