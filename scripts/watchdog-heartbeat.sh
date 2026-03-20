#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'TXT'
Traffic-aware LB switch helper.

It uses hysteresis:
- enable LB when rps >= enable threshold
- disable LB when rps <= disable threshold

Example:
  watchdog-heartbeat.sh \
    --site example.com \
    --site-config /etc/nginx/sites-available/example.com \
    --backend 127.0.0.1:18120 \
    --backend 127.0.0.1:18122 \
    --rps 230
TXT
}

log() {
  printf '[%s] %s\n' "${SCRIPT_NAME}" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "${SCRIPT_NAME}" "$*" >&2
  exit 1
}

state_value() {
  local file="$1"
  local key="$2"
  awk -F'=' -v k="${key}" '$1==k {print $2}' "${file}" 2>/dev/null || true
}

write_state() {
  local file="$1"
  shift
  mkdir -p "$(dirname "${file}")"
  {
    for kv in "$@"; do
      printf '%s\n' "${kv}"
    done
  } >"${file}"
}

main() {
  local site=""
  local site_config=""
  local rps=""
  local cpu_load=""
  local enable_rps_threshold="180"
  local disable_rps_threshold="120"
  local state_dir="/var/lib/ai-webadmin"
  local dry_run="no"
  local backends=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --site-config) site_config="$2"; shift 2 ;;
      --backend) backends+=("$2"); shift 2 ;;
      --rps) rps="$2"; shift 2 ;;
      --cpu-load) cpu_load="$2"; shift 2 ;;
      --enable-rps-threshold) enable_rps_threshold="$2"; shift 2 ;;
      --disable-rps-threshold) disable_rps_threshold="$2"; shift 2 ;;
      --state-dir) state_dir="$2"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${rps}" ]] || die "requires --site and --rps"
  if [[ -z "${site_config}" ]]; then
    site_config="/etc/nginx/sites-available/${site}"
  fi
  [[ "${#backends[@]}" -gt 0 ]] || die "requires one or more --backend"

  local manage_script
  manage_script="$(cd "$(dirname "$0")" && pwd)/manage-nginx-lb.sh"
  [[ -x "${manage_script}" ]] || die "missing executable manage-nginx-lb.sh next to watchdog-heartbeat.sh"

  local state_file="${state_dir}/lb-state-${site//./-}.env"
  local current_state
  current_state="$(state_value "${state_file}" "enabled")"
  [[ -n "${current_state}" ]] || current_state="false"

  local action="noop"
  if (( rps >= enable_rps_threshold )) && [[ "${current_state}" != "true" ]]; then
    action="enable"
  elif (( rps <= disable_rps_threshold )) && [[ "${current_state}" == "true" ]]; then
    action="disable"
  fi

  local cmd_output='{"ok":true,"noop":true}'
  if [[ "${action}" == "enable" ]]; then
    local args=(
      enable
      --site "${site}"
      --site-config "${site_config}"
    )
    local backend
    for backend in "${backends[@]}"; do
      args+=(--backend "${backend}")
    done
    if [[ "${dry_run}" == "yes" ]]; then
      args+=(--dry-run)
    fi
    cmd_output="$("${manage_script}" "${args[@]}")"
    if [[ "${dry_run}" != "yes" ]]; then
      write_state "${state_file}" \
        "enabled=true" \
        "last_action=enable" \
        "last_rps=${rps}" \
        "last_cpu_load=${cpu_load}" \
        "updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    fi
  elif [[ "${action}" == "disable" ]]; then
    local args=(
      disable
      --site "${site}"
      --site-config "${site_config}"
    )
    if [[ "${dry_run}" == "yes" ]]; then
      args+=(--dry-run)
    fi
    cmd_output="$("${manage_script}" "${args[@]}")"
    if [[ "${dry_run}" != "yes" ]]; then
      write_state "${state_file}" \
        "enabled=false" \
        "last_action=disable" \
        "last_rps=${rps}" \
        "last_cpu_load=${cpu_load}" \
        "updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    fi
  else
    log "no change: rps=${rps}, state=${current_state}"
  fi

  printf '{"ok":true,"site":"%s","rps":%s,"action":"%s","state_before":"%s","state_file":"%s","lb_result":%s}\n' \
    "${site}" "${rps}" "${action}" "${current_state}" "${state_file}" "${cmd_output}"
}

main "$@"
