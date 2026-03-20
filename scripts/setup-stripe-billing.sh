#!/usr/bin/env bash
set -euo pipefail

if [[ "${TRACE:-0}" == "1" ]]; then
  set -x
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd node

ENV_FILE="${STRIPE_ENV_FILE:-/etc/ai-vps-control-panel.env}"
PANEL_BASE_URL="${PANEL_BASE_URL:-http://127.0.0.1:8080}"
WEBHOOK_URL="${STRIPE_WEBHOOK_URL:-${PANEL_BASE_URL%/}/api/stripe/webhook}"
SUCCESS_URL="${STRIPE_SUCCESS_URL:-${PANEL_BASE_URL%/}/pricing?checkout=success}"
CANCEL_URL="${STRIPE_CANCEL_URL:-${PANEL_BASE_URL%/}/pricing?checkout=cancel}"
PORTAL_RETURN_URL="${STRIPE_PORTAL_RETURN_URL:-${PANEL_BASE_URL%/}/console?billing=portal}"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-${STRIPE_API_SECRET_KEY:-}}"
fi

if [[ -z "$STRIPE_SECRET_KEY" ]]; then
  echo "STRIPE_SECRET_KEY is required." >&2
  exit 1
fi

stripe_form() {
  local endpoint="$1"
  shift
  curl -fsS "https://api.stripe.com/v1/${endpoint}" \
    -u "${STRIPE_SECRET_KEY}:" \
    "$@"
}

json_field() {
  local field_path="$1"
  node -e '
    const fieldPath = process.argv[1];
    const input = process.argv[2];
    const data = JSON.parse(input);
    let value = data;
    for (const part of fieldPath.split(".")) {
      if (!part) continue;
      value = value?.[part];
    }
    if (value === undefined || value === null) {
      process.exit(2);
    }
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
    } else {
      process.stdout.write(String(value));
    }
  ' "$field_path" "$2"
}

env_get() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 1
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

append_or_replace_env() {
  local key="$1"
  local value="$2"
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  node -e '
    const fs = require("node:fs");
    const [filePath, key, value] = process.argv.slice(1);
    const escaped = String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, "\\\"");
    const line = `${key}="${escaped}"`;
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {}
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      if (content !== "" && !content.endsWith("\n")) {
        content += "\n";
      }
      content += `${line}\n`;
    }
    fs.writeFileSync(filePath, content);
  ' "$ENV_FILE" "$key" "$value"
}

create_product_if_missing() {
  local env_key="$1"
  local name="$2"
  local description="$3"
  local existing
  existing="$(env_get "$env_key" || true)"
  if [[ -n "$existing" ]]; then
    printf '%s' "$existing"
    return
  fi
  local response
  response="$(stripe_form products \
    -d "name=${name}" \
    --data-urlencode "description=${description}")"
  local product_id
  product_id="$(json_field "id" "$response")"
  append_or_replace_env "$env_key" "$product_id"
  printf '%s' "$product_id"
}

create_price_if_missing() {
  local env_key="$1"
  local product_id="$2"
  local amount_cents="$3"
  local lookup_key="$4"
  local existing
  existing="$(env_get "$env_key" || true)"
  if [[ -n "$existing" ]]; then
    printf '%s' "$existing"
    return
  fi
  local response
  response="$(stripe_form prices \
    -d "product=${product_id}" \
    -d "currency=usd" \
    -d "unit_amount=${amount_cents}" \
    -d "recurring[interval]=month" \
    -d "lookup_key=${lookup_key}")"
  local price_id
  price_id="$(json_field "id" "$response")"
  append_or_replace_env "$env_key" "$price_id"
  printf '%s' "$price_id"
}

create_webhook_if_missing() {
  local endpoint_id secret
  endpoint_id="$(env_get "STRIPE_WEBHOOK_ENDPOINT_ID" || true)"
  secret="$(env_get "STRIPE_WEBHOOK_SECRET" || true)"
  if [[ -n "$endpoint_id" && -n "$secret" ]]; then
    printf '%s\n%s' "$endpoint_id" "$secret"
    return
  fi
  local response
  response="$(stripe_form webhook_endpoints \
    --data-urlencode "url=${WEBHOOK_URL}" \
    -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=customer.subscription.created" \
    -d "enabled_events[]=customer.subscription.updated" \
    -d "enabled_events[]=customer.subscription.deleted")"
  endpoint_id="$(json_field "id" "$response")"
  secret="$(json_field "secret" "$response")"
  append_or_replace_env "STRIPE_WEBHOOK_ENDPOINT_ID" "$endpoint_id"
  append_or_replace_env "STRIPE_WEBHOOK_SECRET" "$secret"
  printf '%s\n%s' "$endpoint_id" "$secret"
}

append_or_replace_env "STRIPE_SUCCESS_URL" "$SUCCESS_URL"
append_or_replace_env "STRIPE_CANCEL_URL" "$CANCEL_URL"
append_or_replace_env "STRIPE_PORTAL_RETURN_URL" "$PORTAL_RETURN_URL"

starter_product_id="$(create_product_if_missing "STRIPE_PRODUCT_STARTER" "LocCount Starter" "Single-site SaaS entry plan for AI VPS Control Panel.")"
growth_product_id="$(create_product_if_missing "STRIPE_PRODUCT_GROWTH" "LocCount Growth" "Multi-site growth plan for agencies and operators.")"
control_plane_product_id="$(create_product_if_missing "STRIPE_PRODUCT_CONTROL_PLANE" "LocCount Control Plane" "Full control-plane operations plan with Vault-backed workflows.")"

starter_price_id="$(create_price_if_missing "STRIPE_PRICE_STARTER" "$starter_product_id" "29900" "loccount_starter_monthly")"
growth_price_id="$(create_price_if_missing "STRIPE_PRICE_GROWTH" "$growth_product_id" "99900" "loccount_growth_monthly")"
control_plane_price_id="$(create_price_if_missing "STRIPE_PRICE_CONTROL_PLANE" "$control_plane_product_id" "249900" "loccount_control_plane_monthly")"

mapfile -t webhook_data < <(create_webhook_if_missing)
webhook_endpoint_id="${webhook_data[0]}"
webhook_secret="${webhook_data[1]}"

cat <<EOF
Stripe billing setup complete.

Env file: $ENV_FILE
Webhook URL: $WEBHOOK_URL

Created or reused:
- STRIPE_PRODUCT_STARTER=$starter_product_id
- STRIPE_PRODUCT_GROWTH=$growth_product_id
- STRIPE_PRODUCT_CONTROL_PLANE=$control_plane_product_id
- STRIPE_PRICE_STARTER=$starter_price_id
- STRIPE_PRICE_GROWTH=$growth_price_id
- STRIPE_PRICE_CONTROL_PLANE=$control_plane_price_id
- STRIPE_WEBHOOK_ENDPOINT_ID=$webhook_endpoint_id
- STRIPE_WEBHOOK_SECRET=$webhook_secret

Restart the panel after updating the env file:
  sudo systemctl restart ai-vps-control-panel
EOF
