#!/usr/bin/env bash
set -euo pipefail

# Rotate due API keys in AI VPS panel, then publish updated API key spec to Vault KV v2.
# Also writes publish audit event into panel audit log.

BASE_ENV_FILE="${1:-${BASE_ENV_FILE:-/etc/ai-vps-control-panel.env}}"

if [[ ! -f "${BASE_ENV_FILE}" ]]; then
  echo "base env file not found: ${BASE_ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${BASE_ENV_FILE}"
set +a

: "${AI_VPS_VAULT_ADDR:?AI_VPS_VAULT_ADDR is required}"
: "${AI_VPS_VAULT_TOKEN:?AI_VPS_VAULT_TOKEN is required}"

PANEL_BASE_URL="${AI_VPS_PANEL_BASE_URL:-http://127.0.0.1:${PORT:-8080}}"
KV_MOUNT="${AI_VPS_VAULT_KV_MOUNT:-kv}"
KV_PATH="${AI_VPS_VAULT_KV_PATH:-ai-vps-control-panel/runtime}"
KV_FIELD="${AI_VPS_VAULT_KV_FIELD:-api_keys_spec}"
ROTATE_LIMIT="${AI_VPS_ROTATE_PUBLISH_LIMIT:-50}"

vault_data_url="${AI_VPS_VAULT_ADDR%/}/v1/${KV_MOUNT#/}/data/${KV_PATH#/}"
admin_token=""
rotated_count=0
active_token_count=0
stale_token_count=0
audit_sent=0

send_publish_audit() {
  local ok_flag="$1"
  local note="$2"
  local error_message="${3:-}"

  if [[ -z "${admin_token}" || "${audit_sent}" -eq 1 ]]; then
    return 0
  fi

  local payload
  payload="$(node -e '
    const ok = process.argv[1] === "1";
    const rotated = Number(process.argv[2] || "0");
    const active = Number(process.argv[3] || "0");
    const stale = Number(process.argv[4] || "0");
    const mount = process.argv[5];
    const path = process.argv[6];
    const field = process.argv[7];
    const note = process.argv[8];
    const errorMessage = process.argv[9];
    const body = {
      ok,
      rotated_count: Number.isFinite(rotated) ? rotated : 0,
      active_token_count: Number.isFinite(active) ? active : 0,
      stale_token_count: Number.isFinite(stale) ? stale : 0,
      vault_mount: mount,
      vault_path: path,
      vault_field: field,
      note,
    };
    if (errorMessage) {
      body.error = errorMessage;
    }
    process.stdout.write(JSON.stringify(body));
  ' "${ok_flag}" "${rotated_count}" "${active_token_count}" "${stale_token_count}" "${KV_MOUNT}" "${KV_PATH}" "${KV_FIELD}" "${note}" "${error_message}")"

  curl -fsS -X POST "${PANEL_BASE_URL}/api/tokens/publish-audit" \
    -H "authorization: Bearer ${admin_token}" \
    -H 'content-type: application/json' \
    -d "${payload}" >/dev/null || true

  audit_sent=1
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  send_publish_audit 0 "rotate_and_publish_job_failed" "exit_${exit_code}_line_${line_no}"
}

trap 'on_error $? $LINENO' ERR

echo "[rotate-publish] loading key spec from Vault: ${KV_MOUNT}/${KV_PATH} (${KV_FIELD})"
vault_read_json="$(curl -fsS -H "X-Vault-Token: ${AI_VPS_VAULT_TOKEN}" "${vault_data_url}")"

spec_string="$({
  printf '%s' "${vault_read_json}" | node -e '
    const fs = require("fs");
    const field = process.argv[1];
    const raw = fs.readFileSync(0, "utf8");
    const payload = JSON.parse(raw);
    const value = payload?.data?.data?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      process.exit(2);
    }
    process.stdout.write(value.trim());
  ' "${KV_FIELD}"
})" || {
  echo "unable to read field '${KV_FIELD}' from Vault data path ${KV_MOUNT}/${KV_PATH}" >&2
  exit 1
}

admin_token="$({
  printf '%s' "${spec_string}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const entries = raw.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
    for (const entry of entries) {
      const [token = "", role = ""] = entry.split(":").map((v) => v.trim());
      if (token && role.toLowerCase() === "admin") {
        process.stdout.write(token);
        process.exit(0);
      }
    }
    process.exit(2);
  '
})" || {
  echo "no admin token found in Vault key spec" >&2
  exit 1
}

echo "[rotate-publish] introspecting existing tokens via /api/auth/me"
inventory_json="$({
  printf '%s' "${spec_string}" | node -e '
    const fs = require("fs");

    async function run() {
      const baseUrl = process.argv[1];
      const spec = fs.readFileSync(0, "utf8").trim();
      const entries = spec.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
      const out = [];
      for (const entry of entries) {
        const parts = entry.split(":").map((v) => v.trim());
        const token = parts[0] || "";
        const role = (parts[1] || "").toLowerCase();
        const tenant = parts[2] && parts[2] !== "" ? parts[2] : "*";
        const scopes = parts[3] ? parts[3].split("|").map((v) => v.trim()).filter(Boolean) : ["*"];
        if (!token || !role) {
          continue;
        }

        let tokenId = null;
        let principalType = "unknown";
        let live = false;
        try {
          const res = await fetch(`${baseUrl}/api/auth/me`, {
            headers: {
              authorization: `Bearer ${token}`,
            },
          });
          if (res.ok) {
            const body = await res.json();
            principalType = body?.principal?.type || "unknown";
            tokenId = body?.principal?.token_id || null;
            live = true;
          }
        } catch {
          live = false;
        }

        out.push({
          token,
          role,
          tenant,
          scopes,
          token_id: tokenId,
          principal_type: principalType,
          live,
        });
      }

      process.stdout.write(JSON.stringify(out));
    }

    run().catch((error) => {
      process.stderr.write(String(error?.message || error));
      process.exit(1);
    });
  ' "${PANEL_BASE_URL}"
})"

rotate_response="$(curl -fsS -X POST "${PANEL_BASE_URL}/api/tokens/auto-rotate" \
  -H "authorization: Bearer ${admin_token}" \
  -H 'content-type: application/json' \
  -d "{\"limit\":${ROTATE_LIMIT}}")"

echo "[rotate-publish] rebuilding spec with rotated tokens"
updated_spec="$({
  node -e '
    const inventory = JSON.parse(process.argv[1]);
    const rotatedPayload = JSON.parse(process.argv[2]);

    const byId = new Map();
    const envEntries = [];
    const staleEntries = [];

    for (const entry of inventory) {
      if (!entry.live) {
        staleEntries.push(entry);
      }
      if (entry.principal_type === "db" && entry.token_id) {
        byId.set(entry.token_id, {
          token: entry.token,
          role: entry.role,
          tenant: entry.tenant,
          scopes: Array.isArray(entry.scopes) && entry.scopes.length > 0 ? entry.scopes : ["*"],
        });
      } else {
        envEntries.push(entry);
      }
    }

    const rotated = Array.isArray(rotatedPayload?.rotated) ? rotatedPayload.rotated : [];
    for (const item of rotated) {
      const fromId = item?.from_token_id;
      const token = item?.token;
      const rec = item?.record;
      if (typeof fromId === "string" && fromId !== "") {
        byId.delete(fromId);
      }
      if (typeof token === "string" && token !== "" && rec && typeof rec.id === "string") {
        byId.set(rec.id, {
          token,
          role: String(rec.role || "operator").toLowerCase(),
          tenant: String(rec.tenant_id || "*"),
          scopes: Array.isArray(rec.scopes) && rec.scopes.length > 0 ? rec.scopes.map((v) => String(v)) : ["*"],
        });
      }
    }

    const serialize = (entry) => {
      const scopes = Array.isArray(entry.scopes) ? entry.scopes.filter(Boolean) : [];
      const scopePart = scopes.length > 0 && !(scopes.length === 1 && scopes[0] === "*") ? `:${scopes.join("|")}` : "";
      return `${entry.token}:${entry.role}:${entry.tenant}${scopePart}`;
    };

    const dbEntries = Array.from(byId.values());
    const out = [];
    for (const e of envEntries) {
      if (!e.token || !e.role) {
        continue;
      }
      out.push(serialize({
        token: e.token,
        role: e.role,
        tenant: e.tenant || "*",
        scopes: Array.isArray(e.scopes) && e.scopes.length > 0 ? e.scopes : ["*"],
      }));
    }
    for (const e of dbEntries) {
      out.push(serialize(e));
    }

    process.stdout.write(JSON.stringify({
      api_keys_spec: out.join(","),
      rotated_count: Number(rotatedPayload?.rotated_count || rotated.length || 0),
      active_token_count: out.length,
      stale_token_count: staleEntries.length,
    }));
  ' "${inventory_json}" "${rotate_response}"
})"

new_spec="$({
  printf '%s' "${updated_spec}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    const value = parsed?.api_keys_spec;
    if (typeof value !== "string" || value.trim() === "") {
      process.exit(2);
    }
    process.stdout.write(value.trim());
  '
})" || {
  echo "failed to build updated api_keys_spec" >&2
  exit 1
}

vault_write_payload="$({
  printf '%s' "${vault_read_json}" | node -e '
    const fs = require("fs");
    const field = process.argv[1];
    const newSpec = process.argv[2];
    const raw = fs.readFileSync(0, "utf8");
    const oldData = JSON.parse(raw)?.data?.data || {};
    oldData[field] = newSpec;
    oldData[`${field}_updated_at`] = new Date().toISOString();
    process.stdout.write(JSON.stringify({ data: oldData }));
  ' "${KV_FIELD}" "${new_spec}"
})"

echo "[rotate-publish] writing updated key spec to Vault"
curl -fsS -X POST "${vault_data_url}" \
  -H "X-Vault-Token: ${AI_VPS_VAULT_TOKEN}" \
  -H 'content-type: application/json' \
  -d "${vault_write_payload}" >/dev/null

payload_summary="$({
  printf '%s' "${updated_spec}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    process.stdout.write(JSON.stringify({
      ok: true,
      rotated_count: Number(parsed.rotated_count || 0),
      active_token_count: Number(parsed.active_token_count || 0),
      stale_token_count: Number(parsed.stale_token_count || 0),
    }));
  '
})"

rotated_count="$({
  printf '%s' "${payload_summary}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    process.stdout.write(String(Number(parsed.rotated_count || 0)));
  '
})"
active_token_count="$({
  printf '%s' "${payload_summary}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    process.stdout.write(String(Number(parsed.active_token_count || 0)));
  '
})"
stale_token_count="$({
  printf '%s' "${payload_summary}" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    process.stdout.write(String(Number(parsed.stale_token_count || 0)));
  '
})"

send_publish_audit 1 "rotate_and_publish_job" ""
trap - ERR

echo "[rotate-publish] completed successfully"
