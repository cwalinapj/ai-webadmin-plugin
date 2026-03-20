#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Run lightweight verification checks after an upgrade.
TXT
}

main() {
  require_cmd awk
  require_cmd grep

  local site=""
  local site_path=""
  local url=""
  local expected_codes="200,301,302"
  local dry_run="no"
  local expected_files=()
  local missing=0
  local failed_http=0
  local http_code=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site_value "${2:-}")"; shift 2 ;;
      --site-path) site_path="${2:-}"; shift 2 ;;
      --url) url="${2:-}"; shift 2 ;;
      --expect-file) expected_files+=("${2:-}"); shift 2 ;;
      --expected-codes) expected_codes="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" ]] || die 'requires --site'
  if [[ -n "${site_path}" ]]; then
    require_absolute_path "${site_path}"
  fi

  if [[ "${dry_run}" == "yes" ]]; then
    local checks="${#expected_files[@]}"
    [[ -n "${site_path}" ]] && checks=$((checks + 1))
    [[ -n "${url}" ]] && checks=$((checks + 1))
    printf '{"ok":true,"dry_run":true,"site":"%s","checks":%s}\n' "${site}" "${checks}"
    return 0
  fi

  if [[ -n "${site_path}" && ! -d "${site_path}" ]]; then
    missing=$((missing + 1))
  fi
  local file
  for file in "${expected_files[@]}"; do
    if [[ ! -e "${file}" ]]; then
      missing=$((missing + 1))
    fi
  done

  if [[ -n "${url}" ]]; then
    require_cmd curl
    http_code="$(curl -s -o /dev/null -w '%{http_code}' "${url}" || true)"
    local match='no'
    local code
    IFS=',' read -r -a codes <<< "${expected_codes}"
    for code in "${codes[@]}"; do
      if [[ "${http_code}" == "${code}" ]]; then
        match='yes'
        break
      fi
    done
    if [[ "${match}" != 'yes' ]]; then
      failed_http=1
    fi
  fi

  if [[ ${missing} -gt 0 || ${failed_http} -gt 0 ]]; then
    printf '{"ok":false,"dry_run":false,"site":"%s","missing":%s,"http_code":"%s","http_failed":%s}\n' \
      "${site}" "${missing}" "${http_code}" "$(bool_json "${failed_http}")"
    exit 1
  fi

  printf '{"ok":true,"dry_run":false,"site":"%s","missing":0,"http_code":"%s"}\n' "${site}" "${http_code}"
}

main "$@"
