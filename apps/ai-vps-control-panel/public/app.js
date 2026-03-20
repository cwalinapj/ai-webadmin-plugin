const tokenInput = document.querySelector("#tokenInput");
const sessionEmailInput = document.querySelector("#sessionEmailInput");
const sessionPasswordInput = document.querySelector("#sessionPasswordInput");
const loginBtn = document.querySelector("#loginBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const authState = document.querySelector("#authState");
const saveTokenBtn = document.querySelector("#saveTokenBtn");
const refreshAllBtn = document.querySelector("#refreshAllBtn");

const siteForm = document.querySelector("#siteForm");
const siteList = document.querySelector("#siteList");

const chatForm = document.querySelector("#chatForm");
const chatSiteSelect = document.querySelector("#chatSiteSelect");
const chatMessageInput = document.querySelector("#chatMessageInput");
const chatOutput = document.querySelector("#chatOutput");

const queueStatusFilter = document.querySelector("#queueStatusFilter");
const loadQueueBtn = document.querySelector("#loadQueueBtn");
const queueTableBody = document.querySelector("#queueTableBody");

const loadAuditBtn = document.querySelector("#loadAuditBtn");
const auditList = document.querySelector("#auditList");
const hostOpsForm = document.querySelector("#hostOpsForm");
const hostOpsSiteSelect = document.querySelector("#hostOpsSiteSelect");
const hostOpsActionType = document.querySelector("#hostOpsActionType");
const hostOpsSitePath = document.querySelector("#hostOpsSitePath");
const hostOpsOutputDir = document.querySelector("#hostOpsOutputDir");
const hostOpsFromVersion = document.querySelector("#hostOpsFromVersion");
const hostOpsToVersion = document.querySelector("#hostOpsToVersion");
const hostOpsVerifyUrl = document.querySelector("#hostOpsVerifyUrl");
const hostOpsExpectFiles = document.querySelector("#hostOpsExpectFiles");
const hostOpsSnapshotPath = document.querySelector("#hostOpsSnapshotPath");
const hostOpsTargetPath = document.querySelector("#hostOpsTargetPath");
const hostOpsSecretName = document.querySelector("#hostOpsSecretName");
const hostOpsSecretPrefix = document.querySelector("#hostOpsSecretPrefix");
const hostOpsSecretLength = document.querySelector("#hostOpsSecretLength");
const hostOpsDryRunBtn = document.querySelector("#hostOpsDryRunBtn");
const hostOpsLiveBtn = document.querySelector("#hostOpsLiveBtn");
const hostOpsOutput = document.querySelector("#hostOpsOutput");

const fleetRiskWindow = document.querySelector("#fleetRiskWindow");
const loadFleetRiskBtn = document.querySelector("#loadFleetRiskBtn");
const fleetRiskSummary = document.querySelector("#fleetRiskSummary");
const fleetRiskTableBody = document.querySelector("#fleetRiskTableBody");

const policyForm = document.querySelector("#policyForm");
const policyCategoryFilter = document.querySelector("#policyCategoryFilter");
const loadPoliciesBtn = document.querySelector("#loadPoliciesBtn");
const policyApplySiteSelect = document.querySelector("#policyApplySiteSelect");
const policyListBody = document.querySelector("#policyListBody");
const billingForm = document.querySelector("#billingForm");
const billingSiteSelect = document.querySelector("#billingSiteSelect");
const billingStatusFilter = document.querySelector("#billingStatusFilter");
const loadBillingBtn = document.querySelector("#loadBillingBtn");
const openPortalBtn = document.querySelector("#openPortalBtn");
const billingListBody = document.querySelector("#billingListBody");
const loadBillingHistoryBtn = document.querySelector("#loadBillingHistoryBtn");
const billingHistoryBody = document.querySelector("#billingHistoryBody");
const leadSourceFilter = document.querySelector("#leadSourceFilter");
const loadLeadsBtn = document.querySelector("#loadLeadsBtn");
const leadListBody = document.querySelector("#leadListBody");
const webhookEventStatusFilter = document.querySelector("#webhookEventStatusFilter");
const loadWebhookEventsBtn = document.querySelector("#loadWebhookEventsBtn");
const exportWebhookEventsBtn = document.querySelector("#exportWebhookEventsBtn");
const webhookEventListBody = document.querySelector("#webhookEventListBody");
const payloadDialog = document.querySelector("#payloadDialog");
const closePayloadDialogBtn = document.querySelector("#closePayloadDialogBtn");
const payloadDialogBody = document.querySelector("#payloadDialogBody");

const TOKEN_KEY = "ai_vps_api_token";
let latestWebhookEvents = [];

function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function text(el, value) {
  if (!el) {
    return;
  }
  el.textContent = value;
}

function setBadge(el, tone, message) {
  if (!el) {
    return;
  }
  el.className = "billing-badge";
  el.classList.add(`billing-badge-${tone || "neutral"}`);
  el.textContent = message;
}

function clear(el) {
  if (!el) {
    return;
  }
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function makeOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function syncSiteSelectors(sites) {
  clear(chatSiteSelect);
  clear(policyApplySiteSelect);
  clear(billingSiteSelect);
  clear(hostOpsSiteSelect);

  if (policyApplySiteSelect) {
    policyApplySiteSelect.appendChild(makeOption("__ALL__", "All Sites"));
  }

  for (const site of sites) {
    if (chatSiteSelect) {
      chatSiteSelect.appendChild(makeOption(site.id, `${site.id} - ${site.domain}`));
    }
    if (policyApplySiteSelect) {
      policyApplySiteSelect.appendChild(makeOption(site.id, `${site.id} - ${site.domain}`));
    }
    if (billingSiteSelect) {
      billingSiteSelect.appendChild(makeOption(site.id, `${site.id} - ${site.domain}`));
    }
    if (hostOpsSiteSelect) {
      hostOpsSiteSelect.appendChild(makeOption(site.id, `${site.id} - ${site.domain}`));
    }
  }
}

async function loadSites() {
  const result = await api("/api/sites");
  const sites = result.sites || [];

  clear(siteList);
  for (const site of sites) {
    const li = document.createElement("li");
    li.textContent = `${site.id} (${site.domain}) [tenant=${site.tenant_id}]`;
    siteList.appendChild(li);
  }

  syncSiteSelectors(sites);
}

async function loadQueue() {
  const status = queueStatusFilter.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await api(`/api/actions${query}`);
  const actions = result.actions || [];
  clear(queueTableBody);

  for (const action of actions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${action.id}</td>
      <td>${action.site_id}</td>
      <td>${action.type}</td>
      <td>${action.risk}</td>
      <td>${action.status}</td>
      <td></td>
    `;
    const actionCell = tr.lastElementChild;

    if (action.status === "pending") {
      const approve = document.createElement("button");
      approve.textContent = "Approve";
      approve.className = "secondary";
      approve.addEventListener("click", async () => {
        try {
          await api(`/api/actions/${encodeURIComponent(action.id)}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          await loadQueue();
          await loadAudit();
          await loadFleetRisk();
        } catch (error) {
          alert(error.message);
        }
      });
      actionCell.appendChild(approve);
    }

    if (action.status === "pending" || action.status === "approved") {
      const exec = document.createElement("button");
      exec.textContent = "Execute (Dry)";
      exec.addEventListener("click", async () => {
        try {
          await executeQueuedAction(action.id, true);
          await loadQueue();
          await loadAudit();
          await loadFleetRisk();
        } catch (error) {
          alert(error.message);
        }
      });
      actionCell.appendChild(exec);

      const execLive = document.createElement("button");
      execLive.textContent = "Execute Live";
      execLive.className = "danger";
      execLive.addEventListener("click", async () => {
        try {
          const confirmed = window.prompt(`Type LIVE to execute action ${action.id} on ${action.site_id}`) || "";
          if (confirmed.trim().toUpperCase() !== "LIVE") {
            return;
          }
          await executeQueuedAction(action.id, false);
          await loadQueue();
          await loadAudit();
          await loadFleetRisk();
        } catch (error) {
          alert(error.message);
        }
      });
      actionCell.appendChild(execLive);
    }

    queueTableBody.appendChild(tr);
  }
}

async function executeQueuedAction(actionId, dryRun) {
  return api(`/api/actions/${encodeURIComponent(actionId)}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun, confirmed: true }),
  });
}

async function loadAudit() {
  const result = await api("/api/audit?limit=30");
  const logs = result.logs || [];
  clear(auditList);
  for (const log of logs) {
    const li = document.createElement("li");
    li.textContent = `[${log.created_at}] ${log.event_type} by ${log.actor} (site=${log.site_id || "-"})`;
    auditList.appendChild(li);
  }
}

async function loadFleetRisk() {
  const windowHours = Number.parseInt(fleetRiskWindow?.value || "24", 10);
  const query = `?window_hours=${Number.isFinite(windowHours) ? Math.max(1, Math.min(336, windowHours)) : 24}`;
  const result = await api(`/api/fleet/risk${query}`);

  const summary = result.summary || {};
  text(
    fleetRiskSummary,
    `sites=${summary.total_sites || 0}, high=${summary.high_risk_sites || 0}, medium=${summary.medium_risk_sites || 0}, low=${summary.low_risk_sites || 0}, mean=${summary.mean_risk_score || 0}`,
  );

  clear(fleetRiskTableBody);
  for (const item of result.sites || []) {
    const tr = document.createElement("tr");
    const policies = Array.isArray(item.policy_templates) ? item.policy_templates.join(", ") : "";
    tr.innerHTML = `
      <td>${item.site_id}</td>
      <td>${item.domain}</td>
      <td>${item.risk_level}</td>
      <td>${item.risk_score}</td>
      <td>${item.pending_high_risk_actions}</td>
      <td>${item.failed_actions_window}</td>
      <td>${policies || "-"}</td>
    `;
    fleetRiskTableBody.appendChild(tr);
  }
}

async function loadPolicies() {
  const category = policyCategoryFilter?.value?.trim() || "";
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const result = await api(`/api/fleet/policies${query}`);
  const templates = result.templates || [];

  clear(policyListBody);
  for (const template of templates) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${template.name}</td>
      <td>${template.category}</td>
      <td>${template.applied_sites || 0}</td>
      <td>${template.updated_at}</td>
      <td></td>
    `;
    const actionCell = tr.lastElementChild;

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", async () => {
      const selectedSite = policyApplySiteSelect?.value || "__ALL__";
      const payload =
        selectedSite === "__ALL__"
          ? { apply_all: true, status: "active" }
          : { site_ids: [selectedSite], status: "active" };
      try {
        await api(`/api/fleet/policies/${encodeURIComponent(template.id)}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        await loadPolicies();
        await loadFleetRisk();
        await loadAudit();
      } catch (error) {
        alert(error.message);
      }
    });
    actionCell.appendChild(applyBtn);

    const previewBtn = document.createElement("button");
    previewBtn.textContent = "View Config";
    previewBtn.className = "secondary";
    previewBtn.addEventListener("click", () => {
      alert(JSON.stringify(template.config || {}, null, 2));
    });
    actionCell.appendChild(previewBtn);

    policyListBody.appendChild(tr);
  }
}

function toIsoOrNull(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

async function loadBillingSubscriptions() {
  const status = billingStatusFilter?.value?.trim() || "";
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await api(`/api/billing/subscriptions${query}`);
  clear(billingListBody);

  for (const item of result.subscriptions || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.site_id}</td>
      <td>${item.domain || "-"}</td>
      <td>${item.status}</td>
      <td>${item.sandbox_enabled ? "enabled" : "disabled"}</td>
      <td>${item.sandbox_access_allowed ? "allowed" : "blocked"}</td>
      <td>${item.plan_code}</td>
      <td>${item.updated_at}</td>
    `;
    billingListBody.appendChild(tr);
  }
  await updateConsoleBillingBadge();
}

async function updateConsoleBillingBadge() {
  const siteId = billingSiteSelect?.value?.trim() || "";
  if (!siteId) {
    setBadge(document.querySelector("#consoleBillingBadge"), "neutral", "No billing site selected");
    return;
  }
  try {
    const result = await api(`/api/billing/subscriptions?limit=500`);
    const subscription = (result.subscriptions || []).find((item) => item.site_id === siteId);
    if (!subscription) {
      setBadge(document.querySelector("#consoleBillingBadge"), "neutral", `${siteId}: no billing record`);
      return;
    }
    setBadge(
      document.querySelector("#consoleBillingBadge"),
      subscription.badge_tone || "neutral",
      `${subscription.domain || subscription.site_id}: ${subscription.status} / ${subscription.plan_code}`,
    );
  } catch (error) {
    setBadge(document.querySelector("#consoleBillingBadge"), "neutral", error.message);
  }
}

async function loadBillingHistory() {
  const siteId = billingSiteSelect?.value?.trim() || "";
  const query = siteId ? `?site_id=${encodeURIComponent(siteId)}` : "";
  const result = await api(`/api/billing/history${query}`);
  clear(billingHistoryBody);

  for (const item of result.orders || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.site_id || "-"}</td>
      <td>${item.domain || "-"}</td>
      <td>${item.status}</td>
      <td>${item.plan_code}</td>
      <td>${item.stripe_customer_id || "-"}</td>
      <td>${item.stripe_subscription_id || "-"}</td>
      <td>${item.created_at}</td>
    `;
    billingHistoryBody.appendChild(tr);
  }
}

async function openCustomerPortal() {
  const siteId = billingSiteSelect?.value?.trim() || "";
  if (!siteId) {
    alert("Select a site first.");
    return;
  }
  try {
    const result = await api("/api/billing/customer-portal-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_id: siteId }),
    });
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
      return;
    }
    alert("Portal session created, but no URL was returned.");
  } catch (error) {
    alert(error.message);
  }
}

async function loadLeads() {
  const source = leadSourceFilter?.value?.trim() || "";
  const query = source ? `?source=${encodeURIComponent(source)}` : "";
  const result = await api(`/api/leads${query}`);
  clear(leadListBody);
  for (const lead of result.leads || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${lead.name}</td>
      <td>${lead.email}</td>
      <td>${lead.source}</td>
      <td>${lead.product_slug || "-"}</td>
      <td>${lead.plan_code || "-"}</td>
      <td>${lead.created_at}</td>
    `;
    leadListBody.appendChild(tr);
  }
}

async function loadWebhookEvents() {
  const status = webhookEventStatusFilter?.value?.trim() || "";
  const siteId = billingSiteSelect?.value?.trim() || "";
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (siteId) {
    params.set("site_id", siteId);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const result = await api(`/api/billing/webhook-events${query}`);
  latestWebhookEvents = result.events || [];
  clear(webhookEventListBody);
  for (const event of latestWebhookEvents) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${event.stripe_event_id}</td>
      <td>${event.event_type}</td>
      <td>${event.status}</td>
      <td>${event.site_id || "-"}</td>
      <td>${event.error_message || "-"}</td>
      <td>${event.processed_at}</td>
    `;
    tr.addEventListener("click", () => openPayloadDialog(event));
    webhookEventListBody.appendChild(tr);
  }
}

function openPayloadDialog(event) {
  if (!payloadDialog || !payloadDialogBody) {
    alert(JSON.stringify(event.payload || {}, null, 2));
    return;
  }
  payloadDialogBody.textContent = JSON.stringify(
    {
      stripe_event_id: event.stripe_event_id,
      event_type: event.event_type,
      status: event.status,
      site_id: event.site_id,
      error_message: event.error_message,
      payload: event.payload || {},
    },
    null,
    2,
  );
  payloadDialog.showModal();
}

function closePayloadDialog() {
  if (payloadDialog?.open) {
    payloadDialog.close();
  }
}

function csvValue(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function exportWebhookEventsCsv() {
  if (!latestWebhookEvents.length) {
    alert("No webhook events loaded.");
    return;
  }
  const rows = [
    [
      "stripe_event_id",
      "event_type",
      "status",
      "site_id",
      "error_message",
      "processed_at",
      "payload_json",
    ].join(","),
  ];
  for (const event of latestWebhookEvents) {
    rows.push(
      [
        csvValue(event.stripe_event_id),
        csvValue(event.event_type),
        csvValue(event.status),
        csvValue(event.site_id || ""),
        csvValue(event.error_message || ""),
        csvValue(event.processed_at),
        csvValue(JSON.stringify(event.payload || {})),
      ].join(","),
    );
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "stripe-webhook-events.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadSession() {
  try {
    const result = await api("/api/session/me");
    text(authState, `Authenticated via ${result.session.type} as ${result.session.role} (tenant=${result.session.tenant_id})`);
  } catch {
    text(authState, getToken() ? "Using API token auth" : "Not authenticated");
  }
}

async function loginSession() {
  const email = sessionEmailInput?.value?.trim() || "";
  const password = sessionPasswordInput?.value || "";
  if (!email || !password) {
    alert("Console email and password are required.");
    return;
  }
  try {
    await api("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (sessionPasswordInput) {
      sessionPasswordInput.value = "";
    }
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

async function logoutSession() {
  try {
    await api("/api/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await loadSession();
  } catch (error) {
    alert(error.message);
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  const siteId = chatSiteSelect.value;
  const message = chatMessageInput.value.trim();
  if (!siteId || !message) {
    return;
  }
  try {
    const result = await api("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site_id: siteId,
        message,
      }),
    });
    text(
      chatOutput,
      `${result.assistant_message}\nQueued actions: ${(result.actions || [])
        .map((item) => `${item.id}:${item.type}:${item.status}`)
        .join(", ")}`,
    );
    chatMessageInput.value = "";
    await loadQueue();
    await loadAudit();
    await loadFleetRisk();
  } catch (error) {
    alert(error.message);
  }
}

async function submitSiteForm(event) {
  event.preventDefault();
  const form = new FormData(siteForm);
  const payload = {
    id: String(form.get("id") || "").trim(),
    domain: String(form.get("domain") || "").trim(),
    tenant_id: String(form.get("tenant_id") || "").trim(),
    panel_type: String(form.get("panel_type") || "").trim() || "ai_vps_panel",
    runtime_type: String(form.get("runtime_type") || "").trim() || "php_generic",
  };
  try {
    await api("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    siteForm.reset();
    await loadSites();
    await loadFleetRisk();
    await loadAudit();
  } catch (error) {
    alert(error.message);
  }
}

async function submitPolicyForm(event) {
  event.preventDefault();
  const form = new FormData(policyForm);
  const configRaw = String(form.get("config_json") || "{}").trim();
  let config = {};
  try {
    const parsed = JSON.parse(configRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed;
    } else {
      throw new Error("Policy config must be a JSON object.");
    }
  } catch (error) {
    alert(`Invalid policy config JSON: ${error.message}`);
    return;
  }

  const payload = {
    name: String(form.get("name") || "").trim(),
    description: String(form.get("description") || "").trim(),
    category: String(form.get("category") || "").trim() || "general",
    config,
  };
  if (!payload.name) {
    alert("Policy template name is required.");
    return;
  }

  try {
    await api("/api/fleet/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    policyForm.reset();
    await loadPolicies();
    await loadAudit();
  } catch (error) {
    alert(error.message);
  }
}

async function submitBillingForm(event) {
  event.preventDefault();
  const form = new FormData(billingForm);
  const payload = {
    site_id: String(form.get("site_id") || "").trim(),
    plugin_id: String(form.get("plugin_id") || "").trim(),
    plan_code: String(form.get("plan_code") || "").trim() || "sandbox_monthly",
    status: String(form.get("status") || "").trim(),
    sandbox_enabled: form.get("sandbox_enabled") !== null,
    current_period_end: toIsoOrNull(String(form.get("current_period_end") || "")),
    grace_period_end: toIsoOrNull(String(form.get("grace_period_end") || "")),
  };
  if (!payload.site_id || !payload.status) {
    alert("Site and billing status are required.");
    return;
  }

  try {
    const result = await api("/api/billing/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (result?.worker_sync?.ok === false) {
      alert("Saved locally, but worker sync failed. Check panel env vars and worker token.");
    }
    await loadBillingSubscriptions();
    await loadAudit();
  } catch (error) {
    alert(error.message);
  }
}

function currentHostOpsActionPayload() {
  const siteId = hostOpsSiteSelect?.value?.trim() || "";
  const actionType = hostOpsActionType?.value?.trim() || "";
  const sitePath = hostOpsSitePath?.value?.trim() || "";
  const outputValue = hostOpsOutputDir?.value?.trim() || "";
  const fromVersion = hostOpsFromVersion?.value?.trim() || "";
  const toVersion = hostOpsToVersion?.value?.trim() || "";
  const verifyUrl = hostOpsVerifyUrl?.value?.trim() || "";
  const expectFilesCsv = hostOpsExpectFiles?.value?.trim() || "";
  const snapshotPath = hostOpsSnapshotPath?.value?.trim() || "";
  const targetPath = hostOpsTargetPath?.value?.trim() || "";
  const secretName = hostOpsSecretName?.value?.trim() || "";
  const secretPrefix = hostOpsSecretPrefix?.value?.trim() || "";
  const secretLength = Number.parseInt(hostOpsSecretLength?.value || "40", 10);

  if (!siteId || !actionType) {
    throw new Error("Site and host op action are required.");
  }

  if (actionType === "run_site_snapshot") {
    return {
      site_id: siteId,
      action: {
        id: crypto.randomUUID(),
        type: "run_site_snapshot",
        description: `Snapshot ${siteId}`,
        risk: "medium",
        requires_confirmation: true,
        args: {
          site: siteId,
          site_path: sitePath || `/var/www/${siteId}`,
          output_dir: outputValue || "/var/backups/ai-webadmin",
        },
      },
    };
  }

  if (actionType === "verify_site_upgrade") {
    return {
      site_id: siteId,
      action: {
        id: crypto.randomUUID(),
        type: "verify_site_upgrade",
        description: `Verify ${siteId}`,
        risk: "medium",
        requires_confirmation: false,
        args: {
          site: siteId,
          site_path: sitePath || `/var/www/${siteId}`,
          url: verifyUrl || "",
          expect_files_csv: expectFilesCsv || `${sitePath || `/var/www/${siteId}`}/index.php`,
        },
      },
    };
  }

  if (actionType === "plan_site_upgrade") {
    return {
      site_id: siteId,
      action: {
        id: crypto.randomUUID(),
        type: "plan_site_upgrade",
        description: `Plan upgrade for ${siteId}`,
        risk: "medium",
        requires_confirmation: false,
        args: {
          site: siteId,
          site_path: sitePath || `/var/www/${siteId}`,
          from_version: fromVersion || "",
          to_version: toVersion || "",
          output_path: outputValue || `/var/lib/ai-webadmin/plans/${siteId}.plan`,
        },
      },
    };
  }

  if (actionType === "rollback_site_upgrade") {
    return {
      site_id: siteId,
      action: {
        id: crypto.randomUUID(),
        type: "rollback_site_upgrade",
        description: `Rollback ${siteId} from snapshot`,
        risk: "high",
        requires_confirmation: true,
        args: {
          snapshot_path: snapshotPath,
          target_path: targetPath || sitePath || `/var/www/${siteId}`,
          backup_dir: outputValue || "/var/backups/ai-webadmin/rollback",
        },
      },
    };
  }

  if (actionType === "rotate_secret") {
    return {
      site_id: siteId,
      action: {
        id: crypto.randomUUID(),
        type: "rotate_secret",
        description: `Rotate secret for ${siteId}`,
        risk: "high",
        requires_confirmation: true,
        args: {
          name: secretName || "API_TOKEN",
          write_env_file: outputValue || "/run/ai-vps-control-panel/runtime.env",
          prefix: secretPrefix || "tok_",
          length: Number.isFinite(secretLength) ? secretLength : 40,
        },
      },
    };
  }

  throw new Error("Unsupported host op action.");
}

async function queueHostOpsAction(event) {
  if (event) {
    event.preventDefault();
  }
  try {
    const payload = currentHostOpsActionPayload();
    const result = await api("/api/actions/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        idempotency_key: `hostops-${crypto.randomUUID()}`,
      }),
    });
    text(hostOpsOutput, JSON.stringify(result, null, 2));
    await loadQueue();
    await loadAudit();
    await loadFleetRisk();
  } catch (error) {
    text(hostOpsOutput, `Error: ${error.message}`);
  }
}

async function runHostOpsAction(event, dryRun) {
  if (event) {
    event.preventDefault();
  }
  try {
    const payload = currentHostOpsActionPayload();
    const result = await api("/api/agent/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        dry_run: dryRun,
        confirmed: true,
      }),
    });
    text(hostOpsOutput, JSON.stringify(result, null, 2));
    await loadAudit();
    await loadQueue();
  } catch (error) {
    text(hostOpsOutput, `Error: ${error.message}`);
  }
}

async function refreshAll() {
  try {
    await loadSession();
    await loadSites();
    await loadQueue();
    await loadFleetRisk();
    await loadPolicies();
    await loadBillingSubscriptions();
    await loadBillingHistory();
    await loadLeads();
    await loadWebhookEvents();
    await loadAudit();
  } catch (error) {
    text(chatOutput, `Error: ${error.message}`);
  }
}

saveTokenBtn.addEventListener("click", () => {
  setToken(tokenInput.value.trim());
  refreshAll();
});
refreshAllBtn.addEventListener("click", refreshAll);
loginBtn.addEventListener("click", loginSession);
logoutBtn.addEventListener("click", logoutSession);
siteForm.addEventListener("submit", submitSiteForm);
chatForm.addEventListener("submit", sendChatMessage);
hostOpsForm?.addEventListener("submit", queueHostOpsAction);
hostOpsDryRunBtn?.addEventListener("click", (event) => runHostOpsAction(event, true));
hostOpsLiveBtn?.addEventListener("click", (event) => runHostOpsAction(event, false));
policyForm.addEventListener("submit", submitPolicyForm);
billingForm.addEventListener("submit", submitBillingForm);
loadQueueBtn.addEventListener("click", loadQueue);
loadAuditBtn.addEventListener("click", loadAudit);
loadFleetRiskBtn.addEventListener("click", loadFleetRisk);
loadPoliciesBtn.addEventListener("click", loadPolicies);
loadBillingBtn.addEventListener("click", loadBillingSubscriptions);
billingSiteSelect?.addEventListener("change", updateConsoleBillingBadge);
openPortalBtn.addEventListener("click", openCustomerPortal);
loadBillingHistoryBtn.addEventListener("click", loadBillingHistory);
loadLeadsBtn.addEventListener("click", loadLeads);
loadWebhookEventsBtn.addEventListener("click", loadWebhookEvents);
exportWebhookEventsBtn.addEventListener("click", exportWebhookEventsCsv);
closePayloadDialogBtn?.addEventListener("click", closePayloadDialog);

tokenInput.value = getToken();
refreshAll();
