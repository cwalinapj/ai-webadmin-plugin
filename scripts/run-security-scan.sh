#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Run a lightweight security scan over a site path.
TXT
}

main() {
  require_cmd find
  require_cmd grep

  local site=""
  local scan_path=""
  local output_path=""
  local max_findings=50
  local dry_run="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site_value "${2:-}")"; shift 2 ;;
      --path) scan_path="${2:-}"; shift 2 ;;
      --output-path) output_path="${2:-}"; shift 2 ;;
      --max-findings) max_findings="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${scan_path}" ]] || die 'requires --site and --path'
  require_absolute_path "${scan_path}"
  [[ -d "${scan_path}" ]] || die "scan path not found: ${scan_path}"
  if [[ -n "${output_path}" ]]; then
    require_absolute_path "${output_path}"
  fi

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","path":"%s","max_findings":%s}\n' "${site}" "${scan_path}" "${max_findings}"
    return 0
  fi

  local report_file=""
  if [[ -n "${output_path}" ]]; then
    mkdir -p "$(dirname "${output_path}")"
    report_file="${output_path}"
  else
    report_file="/tmp/${site}-security-scan-$(epoch_utc).report"
  fi

  : > "${report_file}"
  local findings=0
  while IFS= read -r file; do
    if grep -Eq 'eval\s*\(|base64_decode\s*\(|shell_exec\s*\(|passthru\s*\(' "${file}"; then
      printf 'severity=high path=%s reason=suspicious_php_construct\n' "${file}" >> "${report_file}"
      findings=$((findings + 1))
    fi
    if [[ ${findings} -ge ${max_findings} ]]; then
      break
    fi
  done < <(find "${scan_path}" -type f \( -name '*.php' -o -name '*.phtml' \) | sort)

  printf '{"ok":true,"dry_run":false,"site":"%s","path":"%s","findings":%s,"report_path":"%s"}\n' \
    "${site}" "${scan_path}" "${findings}" "${report_file}"
}

main "$@"
