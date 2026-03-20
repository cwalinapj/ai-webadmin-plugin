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

require_cmd stripe

ENV_FILE="${STRIPE_ENV_FILE:-/etc/ai-vps-control-panel.env}"
PANEL_BASE_URL="${PANEL_BASE_URL:-http://127.0.0.1:8080}"
FORWARD_URL="${STRIPE_FORWARD_URL:-${PANEL_BASE_URL%/}/api/stripe/webhook}"
WEBHOOK_ENDPOINT_ID="${STRIPE_WEBHOOK_ENDPOINT_ID:-}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  WEBHOOK_ENDPOINT_ID="${WEBHOOK_ENDPOINT_ID:-${STRIPE_WEBHOOK_ENDPOINT_ID:-}}"
fi

MODE="${1:-trigger}"
EVENT_NAME="${2:-customer.subscription.updated}"

case "$MODE" in
  listen)
    echo "Forwarding Stripe CLI events to ${FORWARD_URL}"
    exec stripe listen --forward-to "$FORWARD_URL"
    ;;
  trigger)
    echo "Triggering Stripe test event: ${EVENT_NAME}"
    exec stripe trigger "$EVENT_NAME"
    ;;
  resend)
    EVENT_ID="${2:-}"
    if [[ -z "$EVENT_ID" ]]; then
      echo "usage: $0 resend <event_id>" >&2
      exit 1
    fi
    if [[ -z "$WEBHOOK_ENDPOINT_ID" ]]; then
      echo "STRIPE_WEBHOOK_ENDPOINT_ID is required for resend mode." >&2
      exit 1
    fi
    echo "Resending Stripe event ${EVENT_ID} to webhook endpoint ${WEBHOOK_ENDPOINT_ID}"
    exec stripe events resend "$EVENT_ID" --webhook-endpoint "$WEBHOOK_ENDPOINT_ID"
    ;;
  *)
    echo "usage: $0 [listen|trigger|resend] [event_name|event_id]" >&2
    exit 1
    ;;
esac
