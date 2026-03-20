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
  local f
  for f in "${LEASE_DIR}"/slot-*.env; do
    [[ -f "${f}" ]] || continue
    if [[ "$(parse_lease_value "${f}" "site")" == "${site}" ]]; then
      printf '%s\n' "${f}"
      return 0
    fi
  done
  return 1
}

is_container_running() {
  local name="$1"
  lxc list --format csv -c ns | awk -F',' -v n="${name}" '$1==n && $2=="RUNNING" {found=1} END {exit(found?0:1)}'
}

delete_container_if_exists() {
  local name="$1"
  if lxc list --format csv -c n | awk -F',' -v n="${name}" '$1==n {found=1} END {exit(found?0:1)}'; then
    lxc delete -f "${name}" >/dev/null 2>&1 || true
  fi
}

healthcheck_port() {
  local port="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/" || true)"
  [[ "${code}" == "200" || "${code}" == "301" || "${code}" == "302" ]]
}

cleanup_expired() {
  local now
  now="$(date +%s)"
  local f expires container slot
  for f in "${LEASE_DIR}"/slot-*.env; do
    [[ -f "${f}" ]] || continue
    expires="$(parse_lease_value "${f}" "expires_at")"
    container="$(parse_lease_value "${f}" "container")"
    slot="$(parse_lease_value "${f}" "slot")"
    if [[ -z "${expires}" || "${expires}" -le "${now}" ]]; then
      if [[ -n "${container}" ]]; then
        log "cleaning expired slot=${slot} container=${container}"
        delete_container_if_exists "${container}"
      fi
      rm -f "${f}"
    fi
  done
}

write_lease() {
  local file="$1"
  shift
  {
    for kv in "$@"; do
      printf '%s\n' "${kv}"
    done
  } >"${file}"
}

acquire_cmd() {
  local site=""
  local wp_root=""
  local db_name=""
  local db_user=""
  local db_pass=""
  local table_prefix="wp_"
  local db_mode="live"
  local pool_size="3"
  local base_port="18200"
  local lease_ttl_min="120"
  local base_template="wp-sandbox"
  local base_snapshot="clean-base"
  local staging_host=""
  local dry_run="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --wp-root) wp_root="$2"; shift 2 ;;
      --db-name) db_name="$2"; shift 2 ;;
      --db-user) db_user="$2"; shift 2 ;;
      --db-pass) db_pass="$2"; shift 2 ;;
      --table-prefix) table_prefix="$2"; shift 2 ;;
      --db-mode) db_mode="$2"; shift 2 ;;
      --pool-size) pool_size="$2"; shift 2 ;;
      --base-port) base_port="$2"; shift 2 ;;
      --lease-ttl-min) lease_ttl_min="$2"; shift 2 ;;
      --base-template) base_template="$2"; shift 2 ;;
      --base-snapshot) base_snapshot="$2"; shift 2 ;;
      --staging-host) staging_host="$2"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${wp_root}" && -n "${db_name}" ]] || die "acquire requires --site --wp-root --db-name"
  [[ -d "${wp_root}" ]] || die "wp root does not exist: ${wp_root}"
  [[ "${db_mode}" == "live" || "${db_mode}" == "cached" ]] || die "--db-mode must be live or cached"

  site="$(normalize_site "${site}")"
  local key
  key="$(site_key "${site}")"
  if [[ -z "${staging_host}" ]]; then
    staging_host="sandbox-${key}.local"
  fi

  acquire_lock
  trap release_lock EXIT
  cleanup_expired

  local existing_lease
  existing_lease="$(find_lease_for_site "${site}" || true)"
  if [[ -n "${existing_lease}" ]]; then
    local existing_container existing_port
    existing_container="$(parse_lease_value "${existing_lease}" "container")"
    existing_port="$(parse_lease_value "${existing_lease}" "port")"
    if [[ -n "${existing_container}" ]] && is_container_running "${existing_container}"; then
      log "reusing existing sandbox for site=${site}"
      printf '{"ok":true,"reused":true,"site":"%s","container":"%s","port":%s}\n' \
        "${site}" "${existing_container}" "${existing_port}"
      return 0
    fi
    rm -f "${existing_lease}"
  fi

  local slot=""
  local i lease_file
  for ((i = 1; i <= pool_size; i++)); do
    lease_file="$(lease_file_for_slot "${i}")"
    if [[ ! -f "${lease_file}" ]]; then
      slot="${i}"
      break
    fi
  done
  [[ -n "${slot}" ]] || die "no free sandbox slots in pool (pool-size=${pool_size})"

  local run_id container port log_dir dump_file
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  container="wp-ondemand-sbx-${slot}"
  port="$((base_port + slot - 1))"
  log_dir="${LOG_ROOT}/${site}/${run_id}"
  dump_file="${DUMP_ROOT}/${site}-${run_id}.sql.gz"

  mkdir -p "${log_dir}/nginx" "${log_dir}/php" "${log_dir}/app" "${DUMP_ROOT}"
  touch "${log_dir}/nginx/access.log" "${log_dir}/nginx/error.log"
  chmod 666 "${log_dir}/nginx/access.log" "${log_dir}/nginx/error.log" || true

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","slot":%s,"container":"%s","port":%s}\n' \
      "${site}" "${slot}" "${container}" "${port}"
    return 0
  fi

  delete_container_if_exists "${container}"
  log "copying base template ${base_template}/${base_snapshot} -> ${container}"
  if ! lxc copy "${base_template}/${base_snapshot}" "${container}" >/dev/null 2>&1; then
    lxc copy "${base_template}" "${container}" -s "${base_snapshot}" >/dev/null
  fi
  lxc start "${container}" >/dev/null
  lxc config device add "${container}" http proxy "listen=tcp:127.0.0.1:${port}" "connect=tcp:127.0.0.1:80" >/dev/null
  lxc config device add "${container}" logs disk "source=${log_dir}" path=/host-logs >/dev/null

  log "copying site files into ${container}"
  local tar_path="/tmp/${container}_wp.tar"
  tar -C "${wp_root}" -cf "${tar_path}" .
  lxc file push "${tar_path}" "${container}/root/wp.tar" >/dev/null
  rm -f "${tar_path}"
  lxc exec "${container}" -- bash -lc '
    rm -rf /var/www/html &&
    mkdir -p /var/www/html &&
    tar -C /var/www/html -xf /root/wp.tar &&
    rm -f /root/wp.tar
  ' >/dev/null

  mkdir -p "$(dirname "${dump_file}")"
  if [[ "${db_mode}" == "live" ]]; then
    if ! mysqldump --single-transaction --quick "${db_name}" 2>/dev/null | gzip >"${dump_file}"; then
      [[ -n "${db_user}" && -n "${db_pass}" ]] || die "live dump requires --db-user and --db-pass when socket auth fails"
      mysqldump --single-transaction --quick -u"${db_user}" -p"${db_pass}" "${db_name}" | gzip >"${dump_file}"
    fi
  else
    local latest_dump
    latest_dump="$(ls -1t "${DUMP_ROOT}/${site}"-*.sql.gz 2>/dev/null | head -n 1 || true)"
    if [[ -z "${latest_dump}" ]]; then
      latest_dump="$(ls -1t "/opt/wp-staging/sites/${site}/db_dumps"/*.sql.gz 2>/dev/null | head -n 1 || true)"
    fi
    [[ -n "${latest_dump}" ]] || die "no cached dump found for site=${site}"
    cp -f "${latest_dump}" "${dump_file}"
  fi

  log "importing DB into ${container}"
  lxc file push "${dump_file}" "${container}/root/db.sql.gz" >/dev/null
  lxc exec "${container}" -- bash -lc '
    gunzip -c /root/db.sql.gz > /root/db.sql &&
    rm -f /root/db.sql.gz &&
    mysql -e "DROP DATABASE IF EXISTS wp_sandbox; CREATE DATABASE wp_sandbox DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" &&
    mysql wp_sandbox < /root/db.sql &&
    rm -f /root/db.sql
  ' >/dev/null

  local sandbox_db_user="wp_sandbox"
  local sandbox_db_pass="SandboxPass123!"
  lxc exec "${container}" -- mysql -e "CREATE USER IF NOT EXISTS '${sandbox_db_user}'@'localhost' IDENTIFIED BY '${sandbox_db_pass}'; GRANT ALL PRIVILEGES ON wp_sandbox.* TO '${sandbox_db_user}'@'localhost'; FLUSH PRIVILEGES;" >/dev/null

  lxc exec "${container}" -- bash -lc "
    WP_CONFIG=/var/www/html/wp-config.php
    sed -i \"s/define( 'DB_NAME',[[:space:]]*'[^']*' );/define( 'DB_NAME', 'wp_sandbox' );/\" \"\$WP_CONFIG\"
    sed -i \"s/define( 'DB_USER',[[:space:]]*'[^']*' );/define( 'DB_USER', '${sandbox_db_user}' );/\" \"\$WP_CONFIG\"
    sed -i \"s/define( 'DB_PASSWORD',[[:space:]]*'[^']*' );/define( 'DB_PASSWORD', '${sandbox_db_pass}' );/\" \"\$WP_CONFIG\"
    sed -i \"s/define( 'DB_HOST',[[:space:]]*'[^']*' );/define( 'DB_HOST', 'localhost' );/\" \"\$WP_CONFIG\"
  " >/dev/null

  lxc exec "${container}" -- mysql wp_sandbox -e "UPDATE ${table_prefix}options SET option_value='https://${staging_host}' WHERE option_name IN ('siteurl','home');" >/dev/null
  lxc exec "${container}" -- bash -lc "cat >/etc/nginx/sites-available/default <<'NGINX'
server {
  listen 80;
  server_name _;
  root /var/www/html;
  index index.php index.html;

  access_log /host-logs/nginx/access.log;
  error_log  /host-logs/nginx/error.log;

  location / {
    try_files \$uri \$uri/ /index.php?\$args;
  }

  location ~ \\.php\$ {
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
  }
}
NGINX
nginx -t && systemctl reload nginx
systemctl restart php8.3-fpm mariadb
chown -R www-data:www-data /var/www/html/wp-content /var/www/html/wp-config.php || true
" >/dev/null

  healthcheck_port "${port}" || die "sandbox health check failed on port ${port}"

  local now expires_at
  now="$(date +%s)"
  expires_at="$((now + (lease_ttl_min * 60)))"
  lease_file="$(lease_file_for_slot "${slot}")"
  write_lease "${lease_file}" \
    "slot=${slot}" \
    "site=${site}" \
    "container=${container}" \
    "port=${port}" \
    "run_id=${run_id}" \
    "staging_host=${staging_host}" \
    "wp_root=${wp_root}" \
    "db_name=${db_name}" \
    "table_prefix=${table_prefix}" \
    "expires_at=${expires_at}" \
    "log_dir=${log_dir}" \
    "dump_file=${dump_file}"

  printf '{"ok":true,"reused":false,"site":"%s","slot":%s,"container":"%s","port":%s,"staging_host":"%s","expires_at":%s}\n' \
    "${site}" "${slot}" "${container}" "${port}" "${staging_host}" "${expires_at}"
}

release_cmd() {
  local site=""
  local slot=""
  local container=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --slot) slot="$2"; shift 2 ;;
      --sandbox-id|--container) container="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  acquire_lock
  trap release_lock EXIT

  local target_lease=""
  local f
  if [[ -n "${slot}" ]]; then
    target_lease="$(lease_file_for_slot "${slot}")"
  elif [[ -n "${site}" ]]; then
    site="$(normalize_site "${site}")"
    target_lease="$(find_lease_for_site "${site}" || true)"
  elif [[ -n "${container}" ]]; then
    for f in "${LEASE_DIR}"/slot-*.env; do
      [[ -f "${f}" ]] || continue
      if [[ "$(parse_lease_value "${f}" "container")" == "${container}" ]]; then
        target_lease="${f}"
        break
      fi
    done
  else
    die "release requires --site or --slot or --sandbox-id"
  fi

  if [[ -z "${target_lease}" || ! -f "${target_lease}" ]]; then
    printf '{"ok":true,"released":false,"message":"no matching lease"}\n'
    return 0
  fi

  local lease_container lease_slot lease_site
  lease_container="$(parse_lease_value "${target_lease}" "container")"
  lease_slot="$(parse_lease_value "${target_lease}" "slot")"
  lease_site="$(parse_lease_value "${target_lease}" "site")"
  if [[ -n "${lease_container}" ]]; then
    delete_container_if_exists "${lease_container}"
  fi
  rm -f "${target_lease}"
  printf '{"ok":true,"released":true,"site":"%s","slot":%s,"container":"%s"}\n' \
    "${lease_site}" "${lease_slot}" "${lease_container}"
}

status_cmd() {
  mkdir -p "${LEASE_DIR}"
  local now
  now="$(date +%s)"
  local first="yes"
  printf '{"ok":true,"leases":['
  local f slot site container port expires_at running
  for f in "${LEASE_DIR}"/slot-*.env; do
    [[ -f "${f}" ]] || continue
    slot="$(parse_lease_value "${f}" "slot")"
    site="$(parse_lease_value "${f}" "site")"
    container="$(parse_lease_value "${f}" "container")"
    port="$(parse_lease_value "${f}" "port")"
    expires_at="$(parse_lease_value "${f}" "expires_at")"
    running="false"
    if [[ -n "${container}" ]] && is_container_running "${container}"; then
      running="true"
    fi
    [[ "${first}" == "yes" ]] || printf ','
    first="no"
    printf '{"slot":%s,"site":"%s","container":"%s","port":%s,"running":%s,"expires_at":%s,"expired":%s}' \
      "${slot:-0}" "${site}" "${container}" "${port:-0}" "${running}" "${expires_at:-0}" \
      "$([[ -n "${expires_at}" && "${expires_at}" -le "${now}" ]] && printf 'true' || printf 'false')"
  done
  printf ']}\n'
}

cleanup_cmd() {
  acquire_lock
  trap release_lock EXIT
  cleanup_expired
  printf '{"ok":true,"cleaned":true}\n'
}

main() {
  require_cmd lxc
  require_cmd tar
  require_cmd mysql
  require_cmd mysqldump
  require_cmd curl

  local cmd="${1:-}"
  if [[ -z "${cmd}" ]]; then
    usage
    exit 2
  fi
  shift || true

  case "${cmd}" in
    acquire) acquire_cmd "$@" ;;
    release) release_cmd "$@" ;;
    status) status_cmd "$@" ;;
    cleanup) cleanup_cmd "$@" ;;
    -h|--help|help) usage ;;
    *) die "unknown command: ${cmd}" ;;
  esac
}

main "$@"
