#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'TXT'
Manage an NGINX load-balancer config for a site.

Commands:
  enable   Create/activate LB config and reload nginx.
  disable  Restore previous site config backup and reload nginx.
  status   Show current managed LB status.

Enable example:
  manage-nginx-lb.sh enable \
    --site example.com \
    --backend 127.0.0.1:18120 \
    --backend 127.0.0.1:18122 \
    --site-config /etc/nginx/sites-available/example.com.conf

Disable example:
  manage-nginx-lb.sh disable \
    --site example.com \
    --site-config /etc/nginx/sites-available/example.com.conf
TXT
}

log() {
  printf '[%s] %s\n' "${SCRIPT_NAME}" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "${SCRIPT_NAME}" "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

safe_site_key() {
  local site="$1"
  site="$(echo "${site}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9.-')"
  [[ -n "${site}" ]] || die "invalid site name"
  printf '%s' "${site}"
}

backup_current_config() {
  local src="$1"
  local backup_dir="$2"
  mkdir -p "${backup_dir}"
  local ts backup
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${backup_dir}/$(basename "${src}").${ts}.bak"
  cp -a "${src}" "${backup}"
  printf '%s\n' "${backup}"
}

latest_backup_for() {
  local site_config="$1"
  local backup_dir="$2"
  ls -1t "${backup_dir}/$(basename "${site_config}")".*.bak 2>/dev/null | head -n 1 || true
}

write_lb_config() {
  local site="$1"
  local site_config="$2"
  local upstream_name="$3"
  local listen_port="$4"
  local http2="$5"
  shift 5
  local backends=("$@")

  local http2_flag=""
  if [[ "${http2}" == "yes" ]]; then
    http2_flag=" http2"
  fi

  {
    printf '# managed-by: ai-webadmin manage-nginx-lb.sh\n'
    printf '# generated-at: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'upstream %s {\n' "${upstream_name}"
    printf '  least_conn;\n'
    local backend
    for backend in "${backends[@]}"; do
      printf '  server %s max_fails=3 fail_timeout=15s;\n' "${backend}"
    done
    printf '  keepalive 64;\n'
    printf '}\n\n'
    printf 'server {\n'
    printf '  listen %s%s;\n' "${listen_port}" "${http2_flag}"
    printf '  server_name %s;\n\n' "${site}"
    printf '  location / {\n'
    printf '    proxy_http_version 1.1;\n'
    printf '    proxy_set_header Host $host;\n'
    printf '    proxy_set_header X-Real-IP $remote_addr;\n'
    printf '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
    printf '    proxy_set_header X-Forwarded-Proto $scheme;\n'
    printf '    proxy_set_header Connection "";\n'
    printf '    proxy_connect_timeout 5s;\n'
    printf '    proxy_send_timeout 30s;\n'
    printf '    proxy_read_timeout 30s;\n'
    printf '    proxy_pass http://%s;\n' "${upstream_name}"
    printf '  }\n'
    printf '}\n'
  } >"${site_config}"
}

reload_nginx_with_rollback() {
  local backup="$1"
  local site_config="$2"
  if ! nginx -t >/dev/null 2>&1; then
    if [[ -n "${backup}" && -f "${backup}" ]]; then
      cp -a "${backup}" "${site_config}"
    fi
    nginx -t >/dev/null 2>&1 || true
    die "nginx config test failed"
  fi
  nginx -s reload >/dev/null
}

enable_cmd() {
  local site=""
  local site_config=""
  local listen_port="80"
  local http2="no"
  local backup_dir="/etc/nginx/ai-webadmin-backups"
  local dry_run="no"
  local backends=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --backend) backends+=("$2"); shift 2 ;;
      --site-config) site_config="$2"; shift 2 ;;
      --listen-port) listen_port="$2"; shift 2 ;;
      --http2) http2="yes"; shift ;;
      --backup-dir) backup_dir="$2"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" ]] || die "enable requires --site"
  site="$(safe_site_key "${site}")"
  [[ "${#backends[@]}" -gt 0 ]] || die "enable requires one or more --backend"
  if [[ -z "${site_config}" ]]; then
    site_config="/etc/nginx/sites-available/${site}.conf"
  fi
  [[ -f "${site_config}" ]] || die "site config not found: ${site_config}"

  local upstream_name="awp_${site//./_}_upstream"
  local enabled_link="/etc/nginx/sites-enabled/$(basename "${site_config}")"

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","site_config":"%s","backends":%s}\n' \
      "${site}" "${site_config}" "$(printf '%s\n' "${backends[@]}" | awk 'BEGIN{printf "["} {printf (NR==1?"":" ,") "\""$0"\""} END{printf "]"}')"
    return 0
  fi

  local backup=""
  backup="$(backup_current_config "${site_config}" "${backup_dir}")"
  log "backup created: ${backup}"

  write_lb_config "${site}" "${site_config}" "${upstream_name}" "${listen_port}" "${http2}" "${backends[@]}"
  ln -sfn "${site_config}" "${enabled_link}"
  reload_nginx_with_rollback "${backup}" "${site_config}"

  printf '{"ok":true,"enabled":true,"site":"%s","site_config":"%s","upstream":"%s","backends_count":%s}\n' \
    "${site}" "${site_config}" "${upstream_name}" "${#backends[@]}"
}

disable_cmd() {
  local site=""
  local site_config=""
  local backup_dir="/etc/nginx/ai-webadmin-backups"
  local dry_run="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --site-config) site_config="$2"; shift 2 ;;
      --backup-dir) backup_dir="$2"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" ]] || die "disable requires --site"
  site="$(safe_site_key "${site}")"
  if [[ -z "${site_config}" ]]; then
    site_config="/etc/nginx/sites-available/${site}.conf"
  fi

  local backup
  backup="$(latest_backup_for "${site_config}" "${backup_dir}")"
  [[ -n "${backup}" && -f "${backup}" ]] || die "no backup found for ${site_config}"

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","restore_from":"%s"}\n' "${site}" "${backup}"
    return 0
  fi

  cp -a "${backup}" "${site_config}"
  reload_nginx_with_rollback "" "${site_config}"
  printf '{"ok":true,"enabled":false,"site":"%s","restored_from":"%s"}\n' "${site}" "${backup}"
}

status_cmd() {
  local site=""
  local site_config=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$2"; shift 2 ;;
      --site-config) site_config="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" ]] || die "status requires --site"
  site="$(safe_site_key "${site}")"
  if [[ -z "${site_config}" ]]; then
    site_config="/etc/nginx/sites-available/${site}.conf"
  fi

  local managed="false"
  local backends_count=0
  if [[ -f "${site_config}" ]]; then
    if grep -q 'managed-by: ai-webadmin manage-nginx-lb.sh' "${site_config}"; then
      managed="true"
      backends_count="$(grep -cE '^[[:space:]]+server [0-9a-zA-Z\.\-:]+ ' "${site_config}" || true)"
    fi
  fi

  printf '{"ok":true,"site":"%s","site_config":"%s","managed":%s,"backends_count":%s}\n' \
    "${site}" "${site_config}" "${managed}" "${backends_count}"
}

main() {
  require_cmd nginx
  require_cmd awk
  require_cmd cp
  require_cmd grep

  local cmd="${1:-}"
  [[ -n "${cmd}" ]] || { usage; exit 2; }
  shift || true

  case "${cmd}" in
    enable) enable_cmd "$@" ;;
    disable) disable_cmd "$@" ;;
    status) status_cmd "$@" ;;
    -h|--help|help) usage ;;
    *) die "unknown command: ${cmd}" ;;
  esac
}

main "$@"
