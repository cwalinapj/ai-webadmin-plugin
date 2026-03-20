#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib/host-ops-common.sh
source "${SCRIPT_DIR}/lib/host-ops-common.sh"

usage() {
  cat <<'TXT'
Restore a target path from a tar snapshot.
TXT
}

main() {
  require_cmd tar

  local snapshot_path=""
  local target_path=""
  local backup_dir="/var/backups/ai-webadmin/rollback"
  local dry_run="no"
  local confirmed="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --snapshot-path) snapshot_path="${2:-}"; shift 2 ;;
      --target-path) target_path="${2:-}"; shift 2 ;;
      --backup-dir) backup_dir="${2:-}"; shift 2 ;;
      --dry-run) dry_run="yes"; shift ;;
      --confirmed) confirmed="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [[ -n "${snapshot_path}" && -n "${target_path}" ]] || die 'requires --snapshot-path and --target-path'
  require_absolute_path "${snapshot_path}"
  require_absolute_path "${target_path}"
  require_absolute_path "${backup_dir}"
  [[ -f "${snapshot_path}" ]] || die "snapshot not found: ${snapshot_path}"
  [[ -d "${target_path}" ]] || die "target path not found: ${target_path}"

  if [[ "${dry_run}" == "yes" ]]; then
    printf '{"ok":true,"dry_run":true,"snapshot_path":"%s","target_path":"%s"}\n' "${snapshot_path}" "${target_path}"
    return 0
  fi

  [[ "${confirmed}" == 'yes' ]] || die 'requires --confirmed for rollback'
  mkdir -p "${backup_dir}"
  local backup_path="${backup_dir}/$(basename "${target_path}")-$(safe_id backup).tgz"
  tar -czf "${backup_path}" -C "$(dirname "${target_path}")" "$(basename "${target_path}")"
  rm -rf "${target_path}"
  mkdir -p "$(dirname "${target_path}")"
  tar -xzf "${snapshot_path}" -C "$(dirname "${target_path}")"

  printf '{"ok":true,"dry_run":false,"target_path":"%s","snapshot_path":"%s","backup_path":"%s"}\n' \
    "${target_path}" "${snapshot_path}" "${backup_path}"
}

main "$@"
