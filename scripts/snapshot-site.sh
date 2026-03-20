#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Capture a tar snapshot plus manifest for a site path.

Example:
  snapshot-site.sh \
    --site example.com \
    --site-path /var/www/example.com \
    --output-dir /var/backups/ai-webadmin
TXT
}

main() {
  require_cmd tar
  require_cmd sha256sum

  local site=""
  local site_path=""
  local output_dir="/var/backups/ai-webadmin"
  local dry_run="no"
  local excludes=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --site) site="$(normalize_site_value "${2:-}")"; shift 2 ;;
      --site-path) site_path="${2:-}"; shift 2 ;;
      --output-dir) output_dir="${2:-}"; shift 2 ;;
      --exclude) excludes+=("${2:-}"); shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${site}" && -n "${site_path}" ]] || die 'requires --site and --site-path'
  require_absolute_path "${site_path}"
  require_absolute_path "${output_dir}"
  [[ -d "${site_path}" ]] || die "site path not found: ${site_path}"

  local snapshot_id artifact_key ts archive_path checksum_path manifest_path
  snapshot_id="$(safe_id "snapshot")"
  artifact_key="${site}/$(basename "${site_path}")-${snapshot_id}.tgz"
  ts="$(timestamp_utc)"
  archive_path="${output_dir}/${site}-site-${snapshot_id}.tgz"
  checksum_path="${archive_path}.sha256"
  manifest_path="${archive_path}.manifest"

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"site":"%s","snapshot_id":"%s","artifact_key":"%s","archive_path":"%s"}\n' \
      "${site}" "${snapshot_id}" "${artifact_key}" "${archive_path}"
    return 0
  fi

  mkdir -p "${output_dir}"
  local tar_args=( -czf "${archive_path}" )
  local item
  for item in "${excludes[@]}"; do
    tar_args+=( --exclude "$item" )
  done
  tar_args+=( -C "$(dirname "${site_path}")" "$(basename "${site_path}")" )
  tar "${tar_args[@]}"
  sha256sum "${archive_path}" > "${checksum_path}"
  write_kv_file "${manifest_path}" \
    snapshot_id "${snapshot_id}" \
    site "${site}" \
    site_path "${site_path}" \
    archive_path "${archive_path}" \
    artifact_key "${artifact_key}" \
    created_at "${ts}"

  printf '{"ok":true,"dry_run":false,"site":"%s","snapshot_id":"%s","artifact_key":"%s","archive_path":"%s","checksum_path":"%s","manifest_path":"%s"}\n' \
    "${site}" "${snapshot_id}" "${artifact_key}" "${archive_path}" "${checksum_path}" "${manifest_path}"
}

main "$@"
