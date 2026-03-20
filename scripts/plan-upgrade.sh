#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Build a deterministic line-based upgrade plan.

Example:
  plan-upgrade.sh \
    --site example.com \
    --site-path /var/www/example.com \
    --from-version 6.5.5 \
    --to-version 6.6.1 \
    --output-path /var/lib/ai-webadmin/plans/example.plan
TXT
}

append_step() {
  local file="$1"
  local step_key="$2"
  local description="$3"
  printf 'step=%s|%s\n' "${step_key}" "${description}" >> "${file}"
}

main() {
  local site=""
  local site_path=""
  local from_version="unknown"
  local to_version="unknown"
  local output_path=""
  local dry_run="no"
  local plugin_count=0
  local theme_count=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site_value "${2:-}")"; shift 2 ;;
      --site-path) site_path="${2:-}"; shift 2 ;;
      --from-version) from_version="${2:-}"; shift 2 ;;
      --to-version) to_version="${2:-}"; shift 2 ;;
      --plugin) plugin_count=$((plugin_count + 1)); shift 2 ;;
      --theme) theme_count=$((theme_count + 1)); shift 2 ;;
      --output-path) output_path="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${site_path}" ]] || die 'requires --site and --site-path'
  require_absolute_path "${site_path}"
  if [[ -n "${output_path}" ]]; then
    require_absolute_path "${output_path}"
  else
    output_path="/var/lib/ai-webadmin/plans/${site}-$(safe_id plan).plan"
  fi

  local risk_score=20
  risk_score=$((risk_score + (plugin_count * 7) + (theme_count * 4)))
  if [[ "${from_version}" != "${to_version}" ]]; then
    risk_score=$((risk_score + 15))
  fi
  if [[ ${risk_score} -gt 95 ]]; then
    risk_score=95
  fi

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","plan_path":"%s","risk_score":%s,"steps":["snapshot","maintenance_on","upgrade","verify","maintenance_off"]}\n' \
      "${site}" "${output_path}" "${risk_score}"
    return 0
  fi

  mkdir -p "$(dirname "${output_path}")"
  write_kv_file "${output_path}" \
    plan_id "$(safe_id plan)" \
    site "${site}" \
    site_path "${site_path}" \
    from_version "${from_version}" \
    to_version "${to_version}" \
    risk_score "${risk_score}" \
    created_at "$(timestamp_utc)"
  append_step "${output_path}" snapshot 'Capture site snapshot before mutation'
  append_step "${output_path}" maintenance_on 'Enable maintenance mode'
  append_step "${output_path}" upgrade 'Apply core, plugin, and theme updates'
  append_step "${output_path}" verify 'Run post-upgrade smoke checks'
  append_step "${output_path}" maintenance_off 'Disable maintenance mode'

  printf '{"ok":true,"dry_run":false,"site":"%s","plan_path":"%s","risk_score":%s}\n' \
    "${site}" "${output_path}" "${risk_score}"
}

main "$@"
