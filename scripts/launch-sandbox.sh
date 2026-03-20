#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

STATE_ROOT="${STATE_ROOT:-/opt/wp-staging/ondemand}"
LEASE_DIR="${LEASE_DIR:-${STATE_ROOT}/leases}"
LOG_ROOT="${LOG_ROOT:-${STATE_ROOT}/logs}"
DUMP_ROOT="${DUMP_ROOT:-${STATE_ROOT}/db_dumps}"
LOCK_DIR="${LOCK_DIR:-${STATE_ROOT}/.lock}"

usage() {
  cat <<'TXT'
On-demand shared sandbox manager (LXD).

Commands:
  acquire  Launch (or reuse) a sandbox slot for a site.
  release  Destroy sandbox for a slot/site/container and free lease.
  status   Show active leases and sandbox state.
  cleanup  Remove expired leases and any associated containers.

Acquire example:
  launch-sandbox.sh acquire \
    --site example.com \
    --wp-root /var/www/example.com \
    --db-name example_wp \
    --table-prefix wp_ \
    --db-user example_wp \
    --db-pass 'secret' \
    --db-mode live \
    --pool-size 3 \
    --base-port 18200 \
    --lease-ttl-min 90

Release example:
  launch-sandbox.sh release --site example.com
TXT
}

log() {
  printf '[%s] %s\n' "${SCRIPT_NAME}" "$*"
}

die() {
  printf '[%s] ERROR: %s\n' "${SCRIPT_NAME}" "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

acquire_lock() {
  mkdir -p "${STATE_ROOT}" "${LEASE_DIR}" "${LOG_ROOT}" "${DUMP_ROOT}"
  local retries=120
  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    retries=$((retries - 1))
    if [[ "${retries}" -le 0 ]]; then
      die "failed to acquire lock at ${LOCK_DIR}"
    fi
    sleep 1
  done
}

release_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

parse_lease_value() {
  local file="$1"
  local key="$2"
  awk -F'=' -v k="${key}" '$1==k {print $2}' "${file}" 2>/dev/null || true
}

normalize_site() {
  local site="$1"
  local normalized
  normalized="$(echo "${site}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9.-')"
  if [[ -z "${normalized}" ]]; then
    die "invalid --site value"
  fi
  printf '%s' "${normalized}"
}

site_key() {
  local site="$1"
  printf '%s' "${site//./-}"
}

lease_file_for_slot() {
  local slot="$1"
  printf '%s/slot-%s.env' "${LEASE_DIR}" "${slot}"
}

find_lease_for_site() {
  local site="$1"
  local file
  for file in "${LEASE_DIR}"/slot-*.env; do
    [[ -e "${file}" ]] || continue
    if [[ "$(parse_lease_value "${file}" "site")" == "${site}" ]]; then
      printf '%s' "${file}"
      return 0
    fi
  done
  return 1
}

lease_expired() {
  local file="$1"
  local expires_at
  expires_at="$(parse_lease_value "${file}" "expires_at")"
  [[ -n "${expires_at}" ]] || return 0
  [[ "$(date -u +%s)" -ge "${expires_at}" ]]
}

write_lease() {
  local file="$1"
  shift
  : > "${file}"
  while [[ $# -gt 0 ]]; do
    printf '%s=%s\n' "$1" "$2" >> "${file}"
    shift 2
  done
}

container_exists() {
  local name="$1"
  lxc info "${name}" >/dev/null 2>&1
}

container_ipv4() {
  local name="$1"
  lxc list "${name}" --format csv -c 4 | awk -F'[ ,]+' 'NF{print $1; exit}'
}

ensure_profile() {
  local profile="$1"
  if ! lxc profile show "${profile}" >/dev/null 2>&1; then
    log "creating profile ${profile}"
    lxc profile create "${profile}" >/dev/null
  fi
}

launch_container() {
  local name="$1"
  local profile="$2"
  if container_exists "${name}"; then
    log "reusing existing container ${name}"
    if [[ "$(lxc info "${name}" | awk '/^Status:/ {print $2}')" != "Running" ]]; then
      lxc start "${name}" >/dev/null
    fi
    return
  fi
  log "launching container ${name}"
  lxc launch images:ubuntu/22.04 "${name}" -p default -p "${profile}" >/dev/null
}

delete_container() {
  local name="$1"
  if container_exists "${name}"; then
    log "deleting container ${name}"
    lxc delete "${name}" --force >/dev/null
  fi
}

acquire_slot() {
  local pool_size="$1"
  local slot
  for slot in $(seq 1 "${pool_size}"); do
    local file
    file="$(lease_file_for_slot "${slot}")"
    if [[ ! -f "${file}" ]]; then
      printf '%s' "${slot}"
      return 0
    fi
    if lease_expired "${file}"; then
      printf '%s' "${slot}"
      return 0
    fi
  done
  return 1
}

cmd_acquire() {
  require_cmd lxc
  local site=""
  local wp_root=""
  local db_name=""
  local table_prefix=""
  local db_user=""
  local db_pass=""
  local db_mode="live"
  local pool_size=3
  local base_port=18200
  local lease_ttl_min=90
  local image_profile="wp-sandbox"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site "${2:-}")"; shift 2 ;;
      --wp-root) wp_root="${2:-}"; shift 2 ;;
      --db-name) db_name="${2:-}"; shift 2 ;;
      --table-prefix) table_prefix="${2:-}"; shift 2 ;;
      --db-user) db_user="${2:-}"; shift 2 ;;
      --db-pass) db_pass="${2:-}"; shift 2 ;;
      --db-mode) db_mode="${2:-}"; shift 2 ;;
      --pool-size) pool_size="${2:-}"; shift 2 ;;
      --base-port) base_port="${2:-}"; shift 2 ;;
      --lease-ttl-min) lease_ttl_min="${2:-}"; shift 2 ;;
      --profile) image_profile="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown arg for acquire: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${wp_root}" && -n "${db_name}" && -n "${table_prefix}" ]] || die "missing required acquire args"
  [[ "${db_mode}" == "live" || "${db_mode}" == "cached" ]] || die "--db-mode must be live or cached"

  acquire_lock
  trap release_lock EXIT

  local existing_lease
  existing_lease="$(find_lease_for_site "${site}" || true)"
  if [[ -n "${existing_lease}" ]] && ! lease_expired "${existing_lease}"; then
    local slot container_name port expires_at
    slot="$(parse_lease_value "${existing_lease}" "slot")"
    container_name="$(parse_lease_value "${existing_lease}" "container_name")"
    port="$(parse_lease_value "${existing_lease}" "port")"
    expires_at="$(parse_lease_value "${existing_lease}" "expires_at")"
    printf '{"ok":true,"reused":true,"site":"%s","slot":%s,"container_name":"%s","port":%s,"expires_at":%s}\n' \
      "${site}" "${slot}" "${container_name}" "${port}" "${expires_at}"
    return 0
  fi

  local slot
  slot="$(acquire_slot "${pool_size}")" || die "no sandbox slots available"
  local port=$((base_port + slot - 1))
  local key container_name lease_file expires_at created_at
  key="$(site_key "${site}")"
  container_name="wp-sandbox-${slot}-${key}"
  lease_file="$(lease_file_for_slot "${slot}")"
  expires_at=$(( $(date -u +%s) + (lease_ttl_min * 60) ))
  created_at="$(date -u +%s)"

  if [[ -f "${lease_file}" ]] && lease_expired "${lease_file}"; then
    delete_container "$(parse_lease_value "${lease_file}" "container_name")"
    rm -f "${lease_file}"
  fi

  ensure_profile "${image_profile}"
  launch_container "${container_name}" "${image_profile}"

  write_lease "${lease_file}" \
    slot "${slot}" \
    site "${site}" \
    container_name "${container_name}" \
    port "${port}" \
    wp_root "${wp_root}" \
    db_name "${db_name}" \
    table_prefix "${table_prefix}" \
    db_user "${db_user}" \
    db_pass "${db_pass}" \
    db_mode "${db_mode}" \
    created_at "${created_at}" \
    expires_at "${expires_at}"

  local ipv4
  ipv4="$(container_ipv4 "${container_name}")"
  printf '{"ok":true,"reused":false,"site":"%s","slot":%s,"container_name":"%s","port":%s,"ipv4":"%s","expires_at":%s}\n' \
    "${site}" "${slot}" "${container_name}" "${port}" "${ipv4}" "${expires_at}"
}

cmd_release() {
  require_cmd lxc
  local site=""
  local slot=""
  local container_name=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site "${2:-}")"; shift 2 ;;
      --slot) slot="${2:-}"; shift 2 ;;
      --container) container_name="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown arg for release: $1" ;;
    esac
  done

  acquire_lock
  trap release_lock EXIT

  local lease_file=""
  if [[ -n "${site}" ]]; then
    lease_file="$(find_lease_for_site "${site}" || true)"
  elif [[ -n "${slot}" ]]; then
    lease_file="$(lease_file_for_slot "${slot}")"
    [[ -f "${lease_file}" ]] || lease_file=""
  fi

  if [[ -n "${lease_file}" ]]; then
    container_name="${container_name:-$(parse_lease_value "${lease_file}" "container_name")}"
    rm -f "${lease_file}"
  fi

  [[ -n "${container_name}" ]] || die "release requires --site, --slot, or --container"
  delete_container "${container_name}"
  printf '{"ok":true,"released":"%s"}\n' "${container_name}"
}

cmd_status() {
  mkdir -p "${LEASE_DIR}"
  local file
  printf '['
  local first=1
  for file in "${LEASE_DIR}"/slot-*.env; do
    [[ -e "${file}" ]] || continue
    local slot site container_name port expires_at expired
    slot="$(parse_lease_value "${file}" "slot")"
    site="$(parse_lease_value "${file}" "site")"
    container_name="$(parse_lease_value "${file}" "container_name")"
    port="$(parse_lease_value "${file}" "port")"
    expires_at="$(parse_lease_value "${file}" "expires_at")"
    if lease_expired "${file}"; then expired=true; else expired=false; fi
    [[ ${first} -eq 1 ]] || printf ','
    first=0
    printf '{"slot":"%s","site":"%s","container_name":"%s","port":"%s","expires_at":"%s","expired":%s}' \
      "${slot}" "${site}" "${container_name}" "${port}" "${expires_at}" "${expired}"
  done
  printf ']\n'
}

cmd_cleanup() {
  require_cmd lxc
  acquire_lock
  trap release_lock EXIT
  mkdir -p "${LEASE_DIR}"
  local file cleaned=0
  for file in "${LEASE_DIR}"/slot-*.env; do
    [[ -e "${file}" ]] || continue
    if lease_expired "${file}"; then
      delete_container "$(parse_lease_value "${file}" "container_name")"
      rm -f "${file}"
      cleaned=$((cleaned + 1))
    fi
  done
  printf '{"ok":true,"cleaned":%s}\n' "${cleaned}"
}

main() {
  local command="${1:-}"
  shift || true
  case "${command}" in
    acquire) cmd_acquire "$@" ;;
    release) cmd_release "$@" ;;
    status) cmd_status "$@" ;;
    cleanup) cmd_cleanup "$@" ;;
    -h|--help|"") usage ;;
    *) die "unknown command: ${command}" ;;
  esac
}

main "$@"
