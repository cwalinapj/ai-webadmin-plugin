#!/usr/bin/env bash
set -euo pipefail

script_name() {
  basename "$1"
}

log_info() {
  printf '[%s] %s\n' "$(script_name "$0")" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$(script_name "$0")" "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

require_absolute_path() {
  case "$1" in
    /*) ;;
    *) die "path must be absolute: $1" ;;
  esac
}

normalize_site_value() {
  local value="$1"
  value="$(echo "${value}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9.-')"
  [[ -n "${value}" ]] || die 'invalid site value'
  printf '%s' "${value}"
}

timestamp_utc() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

epoch_utc() {
  date -u +%s
}

random_token() {
  local length="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex $(( (length + 1) / 2 )) | cut -c1-"${length}"
    return 0
  fi
  python3 - <<PY
import secrets
alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
length = int(${length})
print("".join(secrets.choice(alphabet) for _ in range(length)), end="")
PY
}

bool_json() {
  if [[ "$1" == "yes" || "$1" == "true" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

safe_id() {
  local prefix="$1"
  printf '%s-%s' "${prefix}" "$(date -u +%Y%m%dT%H%M%SZ)-$(random_token 6)"
}

write_kv_file() {
  local file="$1"
  shift
  : > "${file}"
  while [[ $# -gt 1 ]]; do
    printf '%s=%s\n' "$1" "$2" >> "${file}"
    shift 2
  done
}

allowed_mutation_path() {
  case "$1" in
    /etc/*|/run/*|/var/lib/ai-webadmin/*|/tmp/*) return 0 ;;
    *) return 1 ;;
  esac
}
