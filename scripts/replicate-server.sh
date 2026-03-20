#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'TXT'
Create a dedicated production replica and matching sandbox pair on one VPS.

Example:
  replicate-server.sh \
    --site example.com \
    --wp-root /var/www/example.com \
    --db-name example_wp \
    --db-user example_wp \
    --db-pass 'secret' \
    --table-prefix wp_ \
    --prod-port 18120 \
    --sandbox-port 18121

Notes:
- Requires LXD + mysql + nginx on the host.
- Uses /root/wp_sandbox_run.sh to build the production replica.
- Clones sandbox from production snapshot to ensure identical runtime.
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
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

require_lxc_container() {
  local name="$1"
  if ! lxc list --format csv -c n | awk -F',' -v n="${name}" '$1==n {found=1} END {exit(found?0:1)}'; then
    die "container not found: ${name}"
  fi
}

main() {
  require_cmd lxc
  require_cmd curl
  require_cmd mysql
  require_cmd awk

  local site=""
  local wp_root=""
  local db_name=""
  local db_user=""
  local db_pass=""
  local table_prefix="wp_"
  local db_mode="live"
  local prod_port="18120"
  local sandbox_port="18121"
  local prod_host=""
  local sandbox_host=""
  local runner_script="/root/wp_sandbox_run.sh"
  local snapshot_name="pair-base"
  local replace_existing="yes"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --wp-root) wp_root="$2"; shift 2 ;;
      --db-name) db_name="$2"; shift 2 ;;
      --db-user) db_user="$2"; shift 2 ;;
      --db-pass) db_pass="$2"; shift 2 ;;
      --table-prefix) table_prefix="$2"; shift 2 ;;
      --db-mode) db_mode="$2"; shift 2 ;;
      --prod-port) prod_port="$2"; shift 2 ;;
      --sandbox-port) sandbox_port="$2"; shift 2 ;;
      --prod-host) prod_host="$2"; shift 2 ;;
      --sandbox-host) sandbox_host="$2"; shift 2 ;;
      --runner-script) runner_script="$2"; shift 2 ;;
      --snapshot-name) snapshot_name="$2"; shift 2 ;;
      --replace-existing) replace_existing="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${wp_root}" && -n "${db_name}" ]] || die "requires --site --wp-root --db-name"
  [[ -x "${runner_script}" ]] || die "runner script not executable: ${runner_script}"
  [[ "${db_mode}" == "live" || "${db_mode}" == "cached" ]] || die "--db-mode must be live|cached"
  [[ "${replace_existing}" == "yes" || "${replace_existing}" == "no" ]] || die "--replace-existing must be yes|no"

  local site_key
  site_key="$(echo "${site}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9.-')"
  [[ -n "${site_key}" ]] || die "invalid site"

  if [[ -z "${prod_host}" ]]; then
    prod_host="prod-replica.${site_key}.local"
  fi
  if [[ -z "${sandbox_host}" ]]; then
    sandbox_host="sandbox-replica.${site_key}.local"
  fi

  local runner_output
  log "creating production replica on port ${prod_port}"
  runner_output="$("${runner_script}" \
    --site "${site}" \
    --staging-host "${prod_host}" \
    --wp-root "${wp_root}" \
    --db-name "${db_name}" \
    --db-user "${db_user}" \
    --db-pass "${db_pass}" \
    --table-prefix "${table_prefix}" \
    --port "${prod_port}" \
    --db-mode "${db_mode}" \
    --destroy-on-success no)"

  printf '%s\n' "${runner_output}"

  local prod_container
  prod_container="$(printf '%s\n' "${runner_output}" | awk '/^\[\+\] Container:/ {print $3}' | tail -n 1)"
  [[ -n "${prod_container}" ]] || die "failed to parse production container from runner output"
  require_lxc_container "${prod_container}"

  local sandbox_container="${prod_container}-sandbox"
  local sandbox_log_dir="/opt/wp-staging/sites/${site}/sandbox-runs/${prod_container}/logs"
  mkdir -p "${sandbox_log_dir}/nginx" "${sandbox_log_dir}/php" "${sandbox_log_dir}/app"
  touch "${sandbox_log_dir}/nginx/access.log" "${sandbox_log_dir}/nginx/error.log"
  chmod 666 "${sandbox_log_dir}/nginx/access.log" "${sandbox_log_dir}/nginx/error.log" || true

  if [[ "${replace_existing}" == "yes" ]]; then
    if lxc list --format csv -c n | awk -F',' -v n="${sandbox_container}" '$1==n {found=1} END {exit(found?0:1)}'; then
      log "removing existing sandbox container ${sandbox_container}"
      lxc delete -f "${sandbox_container}" >/dev/null 2>&1 || true
    fi
  fi

  if ! lxc info "${prod_container}" | grep -q " ${snapshot_name} "; then
    log "snapshotting ${prod_container}/${snapshot_name}"
    lxc snapshot "${prod_container}" "${snapshot_name}" >/dev/null
  fi

  log "cloning sandbox from ${prod_container}/${snapshot_name}"
  lxc copy "${prod_container}/${snapshot_name}" "${sandbox_container}" >/dev/null

  if lxc config device show "${sandbox_container}" | grep -q '^http:'; then
    lxc config device remove "${sandbox_container}" http >/dev/null 2>&1 || true
  fi
  if lxc config device show "${sandbox_container}" | grep -q '^logs:'; then
    lxc config device remove "${sandbox_container}" logs >/dev/null 2>&1 || true
  fi

  lxc config device add "${sandbox_container}" http proxy "listen=tcp:127.0.0.1:${sandbox_port}" "connect=tcp:127.0.0.1:80" >/dev/null
  lxc config device add "${sandbox_container}" logs disk "source=${sandbox_log_dir}" path=/host-logs >/dev/null
  lxc start "${sandbox_container}" >/dev/null
  lxc exec "${sandbox_container}" -- bash -lc 'systemctl restart mariadb php8.3-fpm nginx || true' >/dev/null
  lxc exec "${sandbox_container}" -- mysql wp_sandbox -e "UPDATE ${table_prefix}options SET option_value='https://${sandbox_host}' WHERE option_name IN ('siteurl','home');" >/dev/null

  local prod_code sandbox_code
  prod_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${prod_port}/" || true)"
  sandbox_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${sandbox_port}/" || true)"
  [[ "${prod_code}" == "200" || "${prod_code}" == "301" || "${prod_code}" == "302" ]] || die "prod health failed: ${prod_code}"
  [[ "${sandbox_code}" == "200" || "${sandbox_code}" == "301" || "${sandbox_code}" == "302" ]] || die "sandbox health failed: ${sandbox_code}"

  printf '{"ok":true,"site":"%s","prod":{"container":"%s","port":%s,"host":"%s","http_code":%s},"sandbox":{"container":"%s","port":%s,"host":"%s","http_code":%s},"snapshot":"%s"}\n' \
    "${site}" "${prod_container}" "${prod_port}" "${prod_host}" "${prod_code}" \
    "${sandbox_container}" "${sandbox_port}" "${sandbox_host}" "${sandbox_code}" "${snapshot_name}"
}

main "$@"
