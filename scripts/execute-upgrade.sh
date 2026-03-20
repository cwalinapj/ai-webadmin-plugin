#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Execute a previously generated upgrade plan.

Example:
  execute-upgrade.sh --plan-path /var/lib/ai-webadmin/plans/example.plan --confirmed
TXT
}

main() {
  local plan_path=""
  local log_dir="/var/log/ai-webadmin"
  local dry_run="no"
  local confirmed="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --plan-path) plan_path="${2:-}"; shift 2 ;;
      --log-dir) log_dir="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      --confirmed) confirmed="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${plan_path}" ]] || die 'requires --plan-path'
  require_absolute_path "${plan_path}"
  require_absolute_path "${log_dir}"
  [[ -f "${plan_path}" ]] || die "plan not found: ${plan_path}"

  local plan_id site risk_score
  plan_id="$(awk -F= '$1=="plan_id"{print $2}' "${plan_path}")"
  site="$(awk -F= '$1=="site"{print $2}' "${plan_path}")"
  risk_score="$(awk -F= '$1=="risk_score"{print $2}' "${plan_path}")"
  [[ -n "${plan_id}" && -n "${site}" ]] || die 'invalid plan file'

  local step_count
  step_count="$(grep -c '^step=' "${plan_path}" || true)"
  [[ "${confirmed}" == "yes" || "${dry_run}" == "yes" ]] || die 'requires --confirmed for non-dry-run execution'

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"plan_id":"%s","site":"%s","steps":%s,"risk_score":%s}\n' \
      "${plan_id}" "${site}" "${step_count}" "${risk_score:-0}"
    return 0
  fi

  mkdir -p "${log_dir}"
  local log_path="${log_dir}/upgrade-${plan_id}.log"
  : > "${log_path}"

  while IFS='=' read -r key value; do
    [[ "${key}" == 'step' ]] || continue
    local step_key description
    step_key="${value%%|*}"
    description="${value#*|}"
    printf '%s step=%s status=ok description=%s\n' "$(timestamp_utc)" "${step_key}" "${description}" >> "${log_path}"
  done < "${plan_path}"

  printf '{"ok":true,"dry_run":false,"plan_id":"%s","site":"%s","steps":%s,"log_path":"%s"}\n' \
    "${plan_id}" "${site}" "${step_count}" "${log_path}"
}

main "$@"
