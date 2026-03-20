#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/ai-webadmin-smoke.XXXXXX)"
FAKE_BIN="${TMP_DIR}/fake-bin"
FAKE_LXC_STATE="${TMP_DIR}/fake-lxc"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${FAKE_BIN}" "${FAKE_LXC_STATE}"

cat > "${FAKE_BIN}/lxc" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_root="${FAKE_LXC_STATE:?missing FAKE_LXC_STATE}"
containers_dir="${state_root}/containers"
profiles_dir="${state_root}/profiles"
mkdir -p "${containers_dir}" "${profiles_dir}"

container_file() {
  printf '%s/%s.env\n' "${containers_dir}" "$1"
}

case "${1:-}" in
  profile)
    case "${2:-}" in
      show)
        [[ -f "${profiles_dir}/${3:-}.profile" ]] || exit 1
        ;;
      create)
        : > "${profiles_dir}/${3:-}.profile"
        ;;
      *)
        exit 1
        ;;
    esac
    ;;
  launch)
    name="${3:-}"
    file="$(container_file "${name}")"
    cat > "${file}" <<TXT
name=${name}
status=Running
ipv4=10.55.0.10
TXT
    ;;
  info)
    name="${2:-}"
    file="$(container_file "${name}")"
    [[ -f "${file}" ]] || exit 1
    status="$(awk -F= '$1=="status"{print $2}' "${file}")"
    printf 'Name: %s\nStatus: %s\n' "${name}" "${status}"
    ;;
  start)
    name="${2:-}"
    file="$(container_file "${name}")"
    [[ -f "${file}" ]] || exit 1
    awk 'BEGIN{updated=0} /^status=/{print "status=Running"; updated=1; next} {print} END{if(updated==0) print "status=Running"}' "${file}" > "${file}.tmp"
    mv "${file}.tmp" "${file}"
    ;;
  delete)
    if [[ "${2:-}" == "--force" ]]; then
      name="${3:-}"
    else
      name="${2:-}"
    fi
    rm -f "$(container_file "${name}")"
    ;;
  list)
    if [[ "${2:-}" == "--format" && "${3:-}" == "csv" && "${4:-}" == "-c" && "${5:-}" == "n" ]]; then
      for file in "${containers_dir}"/*.env; do
        [[ -e "${file}" ]] || continue
        basename "${file}" .env
      done
    elif [[ "${3:-}" == "--format" && "${4:-}" == "csv" && "${5:-}" == "-c" && "${6:-}" == "4" ]]; then
      name="${2:-}"
      file="$(container_file "${name}")"
      [[ -f "${file}" ]] || exit 1
      awk -F= '$1=="ipv4"{print $2}' "${file}"
    else
      exit 1
    fi
    ;;
  *)
    exit 1
    ;;
esac
EOF

cat > "${FAKE_BIN}/mysql" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "${FAKE_BIN}/nginx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "${FAKE_BIN}/lxc" "${FAKE_BIN}/mysql" "${FAKE_BIN}/nginx"

export PATH="${FAKE_BIN}:${PATH}"
export FAKE_LXC_STATE

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    printf 'assertion failed: expected output to contain %s\n' "${needle}" >&2
    exit 1
  fi
}

launch_state="${TMP_DIR}/launch-state"
mkdir -p "${launch_state}"

launch_out="$(
  STATE_ROOT="${launch_state}" \
  LEASE_DIR="${launch_state}/leases" \
  LOG_ROOT="${launch_state}/logs" \
  DUMP_ROOT="${launch_state}/db_dumps" \
  LOCK_DIR="${launch_state}/.lock" \
  "${ROOT_DIR}/scripts/launch-sandbox.sh" acquire \
    --site example.com \
    --wp-root /var/www/example.com \
    --db-name example_wp \
    --table-prefix wp_ \
    --pool-size 2 \
    --base-port 19000 \
    --lease-ttl-min 30 \
    --profile smoke-profile
)"
assert_contains "${launch_out}" '"ok":true'
assert_contains "${launch_out}" '"reused":false'
assert_contains "${launch_out}" '"container_name":"wp-sandbox-1-example-com"'

launch_reuse_out="$(
  STATE_ROOT="${launch_state}" \
  LEASE_DIR="${launch_state}/leases" \
  LOG_ROOT="${launch_state}/logs" \
  DUMP_ROOT="${launch_state}/db_dumps" \
  LOCK_DIR="${launch_state}/.lock" \
  "${ROOT_DIR}/scripts/launch-sandbox.sh" acquire \
    --site example.com \
    --wp-root /var/www/example.com \
    --db-name example_wp \
    --table-prefix wp_ \
    --pool-size 2 \
    --base-port 19000 \
    --lease-ttl-min 30 \
    --profile smoke-profile
)"
assert_contains "${launch_reuse_out}" '"reused":true'

launch_status_out="$(
  STATE_ROOT="${launch_state}" \
  LEASE_DIR="${launch_state}/leases" \
  LOG_ROOT="${launch_state}/logs" \
  DUMP_ROOT="${launch_state}/db_dumps" \
  LOCK_DIR="${launch_state}/.lock" \
  "${ROOT_DIR}/scripts/launch-sandbox.sh" status
)"
assert_contains "${launch_status_out}" '"site":"example.com"'

launch_release_out="$(
  STATE_ROOT="${launch_state}" \
  LEASE_DIR="${launch_state}/leases" \
  LOG_ROOT="${launch_state}/logs" \
  DUMP_ROOT="${launch_state}/db_dumps" \
  LOCK_DIR="${launch_state}/.lock" \
  "${ROOT_DIR}/scripts/launch-sandbox.sh" release --site example.com
)"
assert_contains "${launch_release_out}" '"released":"wp-sandbox-1-example-com"'

replicate_out="$(
  "${ROOT_DIR}/scripts/replicate-server.sh" \
    --site example.com \
    --wp-root /var/www/example.com \
    --db-name example_wp \
    --db-mode live \
    --prod-port 18120 \
    --sandbox-port 18121 \
    --dry-run
)"
assert_contains "${replicate_out}" '"dry_run":true'
assert_contains "${replicate_out}" '"sandbox":{"host":"sandbox-replica.example.com.local","port":18121}'

nginx_site_config="${TMP_DIR}/example.conf"
printf 'server { listen 80; server_name example.com; }\n' > "${nginx_site_config}"

watchdog_out="$(
  "${ROOT_DIR}/scripts/watchdog-heartbeat.sh" \
    --site example.com \
    --site-config "${nginx_site_config}" \
    --backend 127.0.0.1:18120 \
    --backend 127.0.0.1:18121 \
    --rps 250 \
    --state-dir "${TMP_DIR}/watchdog-state" \
    --dry-run
)"
assert_contains "${watchdog_out}" '"action":"enable"'
assert_contains "${watchdog_out}" '"dry_run":true'

site_root="${TMP_DIR}/site/example.com"
mkdir -p "${site_root}/wp-content/plugins"
printf '<?php echo \"ok\"; ?>\n' > "${site_root}/index.php"
printf '<?php eval(base64_decode(\"ZWNobyAxOw==\")); ?>\n' > "${site_root}/wp-content/plugins/bad.php"

snapshot_out="$(
  "${ROOT_DIR}/scripts/snapshot-site.sh" \
    --site example.com \
    --site-path "${site_root}" \
    --output-dir "${TMP_DIR}/backups"
)"
assert_contains "${snapshot_out}" '"ok":true'
snapshot_path="$(printf '%s\n' "${snapshot_out}" | sed -n 's/.*"archive_path":"\([^"]*\)".*/\1/p')"
[[ -f "${snapshot_path}" ]] || { echo "snapshot archive missing" >&2; exit 1; }

plan_dry_run_out="$(
  "${ROOT_DIR}/scripts/plan-upgrade.sh" \
    --site example.com \
    --site-path "${site_root}" \
    --from-version 6.5.5 \
    --to-version 6.6.1 \
    --dry-run
)"
assert_contains "${plan_dry_run_out}" '"dry_run":true'

plan_out="$(
  "${ROOT_DIR}/scripts/plan-upgrade.sh" \
    --site example.com \
    --site-path "${site_root}" \
    --from-version 6.5.5 \
    --to-version 6.6.1 \
    --output-path "${TMP_DIR}/plans/example.plan"
)"
assert_contains "${plan_out}" '"ok":true'

execute_dry_run_out="$(
  "${ROOT_DIR}/scripts/execute-upgrade.sh" \
    --plan-path "${TMP_DIR}/plans/example.plan" \
    --dry-run
)"
assert_contains "${execute_dry_run_out}" '"dry_run":true'

execute_out="$(
  "${ROOT_DIR}/scripts/execute-upgrade.sh" \
    --plan-path "${TMP_DIR}/plans/example.plan" \
    --log-dir "${TMP_DIR}/logs" \
    --confirmed
)"
assert_contains "${execute_out}" '"ok":true'

verify_out="$(
  "${ROOT_DIR}/scripts/verify-upgrade.sh" \
    --site example.com \
    --site-path "${site_root}" \
    --expect-file "${site_root}/index.php"
)"
assert_contains "${verify_out}" '"ok":true'

scan_dry_run_out="$(
  "${ROOT_DIR}/scripts/run-security-scan.sh" \
    --site example.com \
    --path "${site_root}" \
    --dry-run
)"
assert_contains "${scan_dry_run_out}" '"dry_run":true'

scan_out="$(
  "${ROOT_DIR}/scripts/run-security-scan.sh" \
    --site example.com \
    --path "${site_root}" \
    --output-path "${TMP_DIR}/scan.report"
)"
assert_contains "${scan_out}" '"findings":1'

rotate_out="$(
  "${ROOT_DIR}/scripts/rotate-secrets.sh" \
    --name API_TOKEN \
    --write-env-file "${TMP_DIR}/runtime.env" \
    --prefix tok_
)"
assert_contains "${rotate_out}" '"ok":true'
assert_contains "$(cat "${TMP_DIR}/runtime.env")" 'API_TOKEN=tok_'

printf 'changed\n' > "${site_root}/index.php"
rollback_dry_run_out="$(
  "${ROOT_DIR}/scripts/rollback-upgrade.sh" \
    --snapshot-path "${snapshot_path}" \
    --target-path "${site_root}" \
    --dry-run
)"
assert_contains "${rollback_dry_run_out}" '"dry_run":true'

rollback_out="$(
  "${ROOT_DIR}/scripts/rollback-upgrade.sh" \
    --snapshot-path "${snapshot_path}" \
    --target-path "${site_root}" \
    --backup-dir "${TMP_DIR}/rollback-backups" \
    --confirmed
)"
assert_contains "${rollback_out}" '"ok":true'
assert_contains "$(cat "${site_root}/index.php")" 'echo "ok"'

printf 'host ops smoke tests passed\n'
