# Cloudflare Workers + AI Plugin Architecture (Multi-Tab)

## Goal
Build one WordPress plugin with five operational tabs, where WordPress acts as a signed edge agent and Cloudflare Workers orchestrate automation, AI decisions, and heavy jobs.

## Plugin tabs (single plugin, separate workflows)
1. Uptime & Performance
2. Security
3. Analytics & Reporting
4. Domain, DNS & Email Administration
5. Form, Lead & Integration Management

## Shared control-plane pattern
- WordPress plugin: local signal collection, safe local actions, admin UI.
- API Worker: verifies plugin signatures (`X-Plugin-Timestamp`, `X-Plugin-Signature`), enforces policy, returns commands.
- Queue layer (Cloudflare Queues): durable background jobs, retries, DLQ.
- Workflow layer (Cloudflare Workflows): multi-step jobs with approvals, waits, rollback.
- State layer:
  - D1: site inventory, policies, job states, incidents, analytics summaries, DNS/email checks, lead-flow checks.
  - R2: scan artifacts, synthetic check evidence, logs, and optional large report exports.
  - Durable Objects: per-site coordination lock (`site:{id}`) to prevent conflicting jobs.
- AI layer:
  - Workers AI for classification/summarization (incident triage, security finding prioritization, analytics insight generation, lead/integration anomaly triage).
  - AI Gateway for model routing, caching, rate limits, and audit logs.
- On-demand compute layer (only when needed):
  - Sandbox SDK/Containers for long or tool-heavy tasks (deep malware scan, SMTP/header diagnostics, integration replay tests).
  - Browser Rendering for synthetic browser checks (real page render/perf path and end-to-end lead-flow validation), when simple HTTP checks are insufficient.

## Tab 1: Uptime & Performance
Primary outcome: detect outages/slowdowns early and shorten MTTR.

### Worker/API contracts
- Existing: `POST /plugin/wp/watchdog/heartbeat`
- Add:
  - `POST /plugin/wp/perf/beacon` (TTFB, PHP time, DB time, memory, error counts)
  - `GET /plugin/wp/incidents/open`
  - `POST /plugin/wp/incidents/{id}/ack`

### Automation
- Cron Triggers run synthetic checks by region and queue results.
- Workflow opens incident when threshold breached (availability, latency, 5xx spike).
- AI summarizes likely cause and recommended first response.

### On-demand compute trigger
- Trigger Browser Rendering/Sandbox only for persistent degradation (for example > 3 failed intervals) to run deeper page-flow diagnostics.

## Tab 2: Security
Primary outcome: continuously reduce exploit surface and detect compromise fast.
Best for:
- Firewall + malware scanning
- Login protection and brute-force blocking
- Live traffic monitoring

### Worker/API contracts
- Existing: `POST /plugin/wp/security/integrity/report`
- Add:
  - `POST /plugin/wp/security/posture/sync` (roles, MFA status proxy fields, hardening flags)
  - `POST /plugin/wp/security/malware/deep-scan/request`
  - `POST /plugin/wp/security/traffic/ingest` (bot score, challenge outcomes, request anomaly counters)
  - `GET /plugin/wp/security/findings`

### Automation
- Plugin enforces local hardening (already present) and submits posture snapshots.
- Worker checks SSL/TLS expiry, WAF/Rulesets posture, Access/SSO posture, drift from baseline.
- Use Rulesets API for WAF automation (avoid deprecated Firewall Rules API).
- AI ranks findings by exploitability + business impact and proposes safe remediation order.

### On-demand compute trigger
- Deep scan requested when integrity drift is suspicious or critical IOC signatures appear.

## Tab 3: Analytics & Reporting
Primary outcome: reliable GA4/Search Console/call-tracking instrumentation and concise monthly business insights.

### Worker/API contracts
- Add:
  - `POST /plugin/wp/analytics/config/sync` (property IDs, event map, conversion goals, call-tracking provider IDs)
  - `POST /plugin/wp/analytics/events/validate` (observed tags/events + schema checks)
  - `GET /plugin/wp/analytics/insights/monthly` (executive summary + KPI deltas + actions)
  - `POST /plugin/wp/analytics/report/ack` (owner acknowledgement and notes)

### Automation
- Worker pulls/aggregates GA4 + Search Console + call tracking metrics on schedule.
- Rule engine checks missing events, goal drift, attribution gaps, and sudden KPI anomalies.
- AI turns metric deltas into plain-language monthly insights with recommended actions.

### On-demand compute trigger
- Trigger browser-based event replay when analytics drift is detected (for example events missing after theme/plugin changes).

## Tab 4: Domain, DNS & Email Administration
Primary outcome: prevent expiration/outage risk and keep SPF/DKIM/DMARC + routing healthy.

### Worker/API contracts
- Add:
  - `POST /plugin/wp/domain/profile/sync` (registrar, renewal date, nameservers, owner contacts)
  - `POST /plugin/wp/dns/desired/sync` (expected DNS records and policy)
  - `GET /plugin/wp/dns/drift/findings`
  - `POST /plugin/wp/email/auth/check` (SPF, DKIM, DMARC, MX, routing checks)
  - `POST /plugin/wp/email/routing/test` (seed-message and delivery-path test request)

### Automation
- Worker continuously monitors domain expiry windows and DNS drift from desired state.
- Email checks run on schedule and after DNS changes to catch auth and routing regressions quickly.
- AI prioritizes remediation steps (record syntax/order/TTL changes) and drafts safe fix plans.

### On-demand compute trigger
- Trigger deep SMTP/header diagnostics when deliverability failures persist across basic checks.

## Tab 5: Form, Lead & Integration Management
Primary outcome: keep forms, booking flows, CRM handoffs, and lead automations working end-to-end.

### Worker/API contracts
- Existing:
  - `POST /plugin/wp/email/forward/config`
  - `POST /plugin/wp/lead/forward`
- Add:
  - `POST /plugin/wp/forms/profile/sync` (form providers, field schema, webhook targets)
  - `POST /plugin/wp/integrations/health/sync` (CRM/API auth status, error rates, quota state)
  - `POST /plugin/wp/leads/e2e/test/start` (synthetic lead-flow test request)
  - `POST /plugin/wp/leads/e2e/test/report` (evidence, latency, failure point)

### Automation
- Queue-backed retries protect webhook/CRM delivery from transient failures.
- Workflow verifies end-to-end lead path: form submit -> plugin event -> worker route -> CRM/notification receipt.
- AI summarizes failure cause, ranks business impact, and recommends operator actions.

### On-demand compute trigger
- Use Browser Rendering for synthetic form submission and booking flow verification in production-like paths.

## Minimal data model (D1)
- `sites` (id, domain, wp_version, plan, timezone)
- `policies` (site_id, tab, key, value_json, updated_at)
- `jobs` (id, site_id, tab, type, status, risk_score, created_at, updated_at)
- `incidents` (id, site_id, severity, status, summary, opened_at, closed_at)
- `artifacts` (id, job_id, kind, r2_key, checksum, created_at)
- `approvals` (id, job_id, approver, decision, reason, at)
- `analytics_snapshots` (site_id, period_start, period_end, metrics_json, anomalies_json)
- `dns_state` (site_id, source, records_json, observed_at)
- `email_checks` (site_id, spf, dkim, dmarc, mx, deliverability_score, checked_at)
- `lead_flow_checks` (site_id, form_id, integration_target, status, latency_ms, checked_at)

## Multi-tenant safety controls
- One Durable Object lock per site to serialize destructive operations.
- Idempotency keys on all mutating endpoints.
- Least-privilege tokens per capability (monitoring, security, analytics, dns-email, leads-integrations).
- Signed requests + replay window + strict nonce checking.
- `dry_run` mode on every destructive operation.

## Cost/latency guardrails
- Fast path: Worker + Queue + deterministic rules.
- AI path: only for triage/summarization/planning, not mandatory for execution.
- Heavy path: Sandbox/Browser Rendering only on threshold triggers or manual invocation.
- Add per-tab quotas and rate limiting in Worker bindings.

## Suggested rollout
1. Ship tab shells + shared job/event model.
2. Implement Monitoring + Security first (shared incident model).
3. Add Analytics & monthly insight generation.
4. Add Domain/DNS/Email drift + deliverability workflows.
5. Add Forms/Leads/Integrations synthetic e2e test automation.

## Why this structure works
- One plugin keeps deployment and auth simple.
- Separate tabs isolate policies, permissions, and job queues.
- Workers handle global, low-latency orchestration.
- Queues/Workflows provide reliable long-running execution.
- On-demand compute is used surgically, so costs stay predictable.

## Implementation references
- Workers AI: https://developers.cloudflare.com/workers-ai/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/
- Queues: https://developers.cloudflare.com/queues/
- Workflows: https://developers.cloudflare.com/workflows/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Browser Rendering: https://developers.cloudflare.com/browser-rendering/
- Rulesets API migration note: https://developers.cloudflare.com/fundamentals/api/reference/deprecations/#firewall-rules-api-and-filters-api
