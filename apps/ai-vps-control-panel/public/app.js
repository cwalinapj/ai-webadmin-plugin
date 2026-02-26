const tokenInput = document.querySelector("#tokenInput");
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

const TOKEN_KEY = "ai_vps_api_token";

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
  el.textContent = value;
}

function clear(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

async function loadSites() {
  const result = await api("/api/sites");
  const sites = result.sites || [];
  clear(siteList);
  clear(chatSiteSelect);

  for (const site of sites) {
    const li = document.createElement("li");
    li.textContent = `${site.id} (${site.domain}) [tenant=${site.tenant_id}]`;
    siteList.appendChild(li);

    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = `${site.id} - ${site.domain}`;
    chatSiteSelect.appendChild(option);
  }
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
          await api(`/api/actions/${encodeURIComponent(action.id)}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dry_run: true, confirmed: true }),
          });
          await loadQueue();
          await loadAudit();
        } catch (error) {
          alert(error.message);
        }
      });
      actionCell.appendChild(exec);
    }

    queueTableBody.appendChild(tr);
  }
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
    await loadAudit();
  } catch (error) {
    alert(error.message);
  }
}

async function refreshAll() {
  try {
    await loadSites();
    await loadQueue();
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
siteForm.addEventListener("submit", submitSiteForm);
chatForm.addEventListener("submit", sendChatMessage);
loadQueueBtn.addEventListener("click", loadQueue);
loadAuditBtn.addEventListener("click", loadAudit);

tokenInput.value = getToken();
refreshAll();
