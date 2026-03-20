const PRODUCTS = [
  {
    slug: "ai-addwords-meta",
    name: "AI AddWords Meta",
    category: "Paid Traffic",
    pitch: "AI that creates, tests, and scales paid campaigns toward a target CPA.",
    headline: "An ad engine built for owners who want spend discipline, not guesswork.",
    outcome: "Generates creative, copy, targeting loops, and conversion-focused campaign iterations.",
    audience: "Businesses buying traffic across Meta and search who need tighter unit economics.",
    advantage: "Pushes toward a fixed acquisition target instead of leaving optimization buried in an ad account.",
    capabilities: [
      "Creative generation and split-test loops.",
      "CPA-aware campaign optimization.",
      "Lead flow handoff into chatbot and landing systems.",
    ],
  },
  {
    slug: "seo-traffic",
    name: "SEO Traffic",
    category: "Organic Growth",
    pitch: "AI SEO operations that turn ranking gaps into compounding search traffic.",
    headline: "Organic growth without relying on manual SEO task lists.",
    outcome: "Surfaces content opportunities, prioritizes work, and supports repeatable traffic lifts.",
    audience: "Sites that need pipeline growth from content, location pages, or evergreen search demand.",
    advantage: "Connects discovery, execution, and operational follow-through in one workflow.",
    capabilities: [
      "Ranking-gap discovery and prioritization.",
      "Content and page rollout support.",
      "SEO work mapped into broader site operations.",
    ],
  },
  {
    slug: "ai-webadmin",
    name: "AI WebAdmin",
    category: "Web Operations",
    pitch: "A 24/7 AI web admin for updates, fixes, audits, and operational hygiene.",
    headline: "The operator layer for the sites that actually generate revenue.",
    outcome: "Automates routine admin work while preserving approval flows for higher-risk actions.",
    audience: "Agencies, hosts, and operators managing multiple sites across mixed stacks.",
    advantage: "Pairs chat-driven operations with audit logs, queueing, and tenant-aware controls.",
    capabilities: [
      "Chat-driven maintenance and operational tasks.",
      "Audit history, approvals, and execution controls.",
      "Shared policies across many managed sites.",
    ],
  },
  {
    slug: "cache-ops",
    name: "Cache Ops",
    category: "Performance",
    pitch: "AI cache optimization that improves speed without blindly breaking page behavior.",
    headline: "Performance gains backed by policy instead of random toggles.",
    outcome: "Reduces server load and improves delivery speed through guided cache operations.",
    audience: "Sites suffering from slow response times, poor hit rates, or inconsistent caching layers.",
    advantage: "Works as part of the same control plane instead of a disconnected tuning plugin.",
    capabilities: [
      "Cache policy tuning and operational visibility.",
      "Safer changes through queue and approval flows.",
      "Supports broader hosting optimization strategy.",
    ],
  },
  {
    slug: "hosting-ops",
    name: "Hosting Ops",
    category: "Infrastructure",
    pitch: "AI hosting automation for uptime, backups, scaling, and service health.",
    headline: "Hosting operations that behave like a product, not a pile of shell scripts.",
    outcome: "Centralizes infrastructure actions, service checks, and recovery steps across tenants.",
    audience: "Operators running VPS fleets or mixed hosting environments who need leverage.",
    advantage: "Combines operational execution with billing state, policy templates, and security controls.",
    capabilities: [
      "Service status, restart, and dry-run execution flows.",
      "Fleet-level visibility and risk scoring.",
      "Deployment paths for VPS and Raspberry Pi nodes.",
    ],
  },
  {
    slug: "sitebuilder",
    name: "Sitebuilder 1.0",
    category: "Conversion Pages",
    pitch: "AI sitebuilding for fast revisions, launch pages, and conversion-focused updates.",
    headline: "Ship pages faster without creating another disconnected design tool.",
    outcome: "Supports rapid page iteration as part of the same growth and operations stack.",
    audience: "Teams that need launch pages, revision speed, and better conversion paths.",
    advantage: "Connects page work directly to ad, SEO, and hosting workflows.",
    capabilities: [
      "Rapid launch-page and revision support.",
      "Conversion-aware positioning inside the product suite.",
      "Tighter connection between acquisition and page execution.",
    ],
  },
  {
    slug: "tolldns",
    name: "TollDNS",
    category: "DNS and Edge",
    pitch: "AI DNS and edge operations for routing, failover, and record control.",
    headline: "DNS moves from a support chore to an automated reliability layer.",
    outcome: "Improves control over records, failover posture, and edge-level operational consistency.",
    audience: "Teams that need reliable domain routing across products, environments, and client sites.",
    advantage: "Keeps DNS operations inside the same audited control plane as hosting and security.",
    capabilities: [
      "DNS record and routing management.",
      "Edge and failover support inside the suite.",
      "Shared operational visibility with the rest of the stack.",
    ],
  },
  {
    slug: "ai-vps-control-panel",
    name: "AI VPS Control Panel",
    category: "Control Plane",
    pitch: "Chat-driven VPS operations with approvals, billing awareness, and Vault-backed key security.",
    headline: "The command center that turns the plugin stack into a real SaaS operating surface.",
    outcome: "Provides the control layer for tenant operations, billing, policies, and secure execution.",
    audience: "Operators who need one place to run the full suite across WordPress and non-WordPress sites.",
    advantage: "Brings together operations, security, deployment, and product routing in one system.",
    capabilities: [
      "Chat-first ops with execution queue and audit logs.",
      "Billing-aware sandbox and policy controls.",
      "Vault-backed token rotation and publish workflows.",
    ],
  },
];

const bySlug = new Map(PRODUCTS.map((product) => [product.slug, product]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
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
  if (el) {
    el.textContent = value;
  }
}

function setBadge(el, tone, message) {
  if (!el) {
    return;
  }
  el.className = "billing-badge";
  el.classList.add(`billing-badge-${tone || "neutral"}`);
  el.textContent = message;
}

async function submitLeadForm(form, stateEl, source) {
  const formData = new FormData(form);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    company: String(formData.get("company") || "").trim(),
    product_slug: String(formData.get("product_slug") || "").trim(),
    plan_code: String(formData.get("plan_code") || "").trim(),
    message: String(formData.get("message") || "").trim(),
    source,
  };
  try {
    await api("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    text(stateEl, "Request received. The lead is now in the console inbox.");
  } catch (error) {
    text(stateEl, error.message);
  }
}

async function startCheckout(form, stateEl) {
  const formData = new FormData(form);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    company: String(formData.get("company") || "").trim(),
    product_slug: String(formData.get("product_slug") || "").trim() || "ai-vps-control-panel",
    plan_code: String(formData.get("plan_code") || "").trim(),
    message: String(formData.get("message") || "").trim(),
    source: "pricing_checkout",
  };
  try {
    const result = await api("/api/billing/checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (result.checkout_url) {
      window.location.assign(result.checkout_url);
      return;
    }
    text(stateEl, "Checkout session created, but no redirect URL was returned.");
  } catch (error) {
    text(stateEl, error.message);
  }
}

function renderHome() {
  const grid = document.querySelector("#productGrid");
  const urlList = document.querySelector("#urlList");
  if (!grid || !urlList) {
    return;
  }

  for (const product of PRODUCTS) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <p class="card-category">${product.category}</p>
      <h3>${product.name}</h3>
      <p>${product.pitch}</p>
      <a class="card-link" href="/${product.slug}">Visit /${product.slug}</a>
    `;
    grid.appendChild(card);

    const item = document.createElement("li");
    item.innerHTML = `<a href="/${product.slug}">/${product.slug}</a>`;
    urlList.appendChild(item);
  }
}

function renderProduct() {
  const slug = window.location.pathname.replace(/^\/+/, "");
  const product = bySlug.get(slug);
  if (!product) {
    window.location.replace("/");
    return;
  }

  document.title = `${product.name} | LocCount`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) {
    desc.setAttribute("content", product.pitch);
  }

  const fields = {
    productCategory: product.category,
    productTitle: product.name,
    productPitch: product.pitch,
    productHeadline: product.headline,
    productOutcome: product.outcome,
    productAudience: product.audience,
    productAdvantage: product.advantage,
    productUrlHeading: `${product.name} now has its own clean public URL.`,
    productUrlPath: `/${product.slug}`,
  };

  for (const [id, value] of Object.entries(fields)) {
    const node = document.querySelector(`#${id}`);
    if (node) {
      node.textContent = value;
    }
  }

  const slugInput = document.querySelector("#productSlugInput");
  if (slugInput) {
    slugInput.value = product.slug;
  }

  const list = document.querySelector("#capabilityList");
  if (list) {
    for (const item of product.capabilities) {
      const card = document.createElement("article");
      card.className = "capability-card";
      card.textContent = item;
      list.appendChild(card);
    }
  }
}

async function renderPricing() {
  const grid = document.querySelector("#pricingGrid");
  const planSelect = document.querySelector("#pricingPlanSelect");
  const badge = document.querySelector("#publicBillingBadge");
  if (!grid || !planSelect) {
    return;
  }
  const result = await api("/api/pricing/plans");
  for (const plan of result.plans || []) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <p class="card-category">${plan.audience}</p>
      <h3>${plan.name}</h3>
      <p class="price-line">$${plan.monthly_price_usd}/mo</p>
      <p>${plan.summary}</p>
      <p class="card-link">${plan.cta}</p>
    `;
    grid.appendChild(card);

    const option = document.createElement("option");
    option.value = plan.code;
    option.textContent = `${plan.name} - $${plan.monthly_price_usd}/mo`;
    planSelect.appendChild(option);
  }

  const siteId = new URLSearchParams(window.location.search).get("site_id") || "";
  if (!siteId) {
    setBadge(badge, "neutral", "Add ?site_id=<site-id> to show current billing status.");
    return;
  }
  try {
    const statusResult = await api(`/api/billing/public-status?site_id=${encodeURIComponent(siteId)}`);
    const billing = statusResult.billing || {};
    setBadge(
      badge,
      billing.badge_tone || "neutral",
      `${billing.domain || billing.site_id}: ${billing.status || "unknown"} / ${billing.plan_code || "-"}`,
    );
  } catch (error) {
    setBadge(badge, "neutral", error.message);
  }
}

function bindLeadForms() {
  const homeForm = document.querySelector("#leadCaptureForm");
  const homeState = document.querySelector("#leadCaptureState");
  if (homeForm && homeState) {
    homeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitLeadForm(homeForm, homeState, "homepage_demo");
    });
  }

  const productForm = document.querySelector("#productLeadForm");
  const productState = document.querySelector("#productLeadState");
  if (productForm && productState) {
    productForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitLeadForm(productForm, productState, "product_page");
    });
  }

  const pricingForm = document.querySelector("#pricingLeadForm");
  const pricingState = document.querySelector("#pricingLeadState");
  if (pricingForm && pricingState) {
    pricingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await startCheckout(pricingForm, pricingState);
    });
    const leadOnlyBtn = document.querySelector("#pricingLeadOnlyBtn");
    if (leadOnlyBtn) {
      leadOnlyBtn.addEventListener("click", async () => {
        await submitLeadForm(pricingForm, pricingState, "pricing_page");
      });
    }
  }
}

const page = document.body.dataset.page;
if (page === "home") {
  renderHome();
}
if (page === "product") {
  renderProduct();
}
if (page === "pricing") {
  renderPricing().catch((error) => {
    const grid = document.querySelector("#pricingGrid");
    if (grid) {
      grid.textContent = error.message;
    }
  });
}
bindLeadForms();
