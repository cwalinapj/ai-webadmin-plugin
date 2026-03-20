import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

let server: ReturnType<typeof createServer>;
let baseUrl = '';

beforeAll(async () => {
  process.env.AI_VPS_API_KEYS = [
    'admin-a:admin:tenant-a',
    'operator-a:operator:tenant-a',
    'operator-b:operator:tenant-b',
  ].join(',');
  process.env.AI_VPS_DB_PATH = ':memory:';
  process.env.AI_VPS_CONSOLE_EMAIL = 'owner@loccount.local';
  process.env.AI_VPS_CONSOLE_PASSWORD = 'console-pass-123';
  server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed_to_bind_test_server');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe('ai vps control panel api', () => {
  it('responds to health check', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('serves frontend shell', async () => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body.includes('LocCount')).toBe(true);
  });

  it('serves console and product landing routes', async () => {
    const consoleResponse = await fetch(`${baseUrl}/console`);
    const consoleBody = await consoleResponse.text();
    expect(consoleResponse.status).toBe(200);
    expect(consoleBody.includes('AI VPS Control Panel')).toBe(true);

    const productResponse = await fetch(`${baseUrl}/ai-webadmin`);
    const productBody = await productResponse.text();
    expect(productResponse.status).toBe(200);
    expect(productBody.includes('LocCount Product')).toBe(true);

    const pricingResponse = await fetch(`${baseUrl}/pricing`);
    const pricingBody = await pricingResponse.text();
    expect(pricingResponse.status).toBe(200);
    expect(pricingBody.includes('Pricing | LocCount')).toBe(true);
  });

  it('exposes minimal public billing status for pricing badges', async () => {
    const createSiteRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'public-billing-site-1',
        tenant_id: 'tenant-a',
        domain: 'public-billing.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(createSiteRes.status).toBe(201);

    const saveBillingRes = await fetch(`${baseUrl}/api/billing/subscriptions`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'public-billing-site-1',
        status: 'past_due',
        sandbox_enabled: true,
        plan_code: 'growth',
      }),
    });
    expect(saveBillingRes.status).toBe(201);

    const publicStatusRes = await fetch(`${baseUrl}/api/billing/public-status?site_id=public-billing-site-1`);
    const publicStatusBody = (await publicStatusRes.json()) as {
      ok: boolean;
      billing: { site_id: string; status: string; badge_tone: string; plan_code: string };
    };
    expect(publicStatusRes.status).toBe(200);
    expect(publicStatusBody.ok).toBe(true);
    expect(publicStatusBody.billing.site_id).toBe('public-billing-site-1');
    expect(publicStatusBody.billing.status).toBe('past_due');
    expect(publicStatusBody.billing.badge_tone).toBe('warn');
    expect(publicStatusBody.billing.plan_code).toBe('growth');
  });

  it('exposes public pricing plans', async () => {
    const response = await fetch(`${baseUrl}/api/pricing/plans`);
    const body = (await response.json()) as {
      ok: boolean;
      plans: Array<{ code: string; monthly_price_usd: number }>;
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.plans.some((item) => item.code === 'starter' && item.monthly_price_usd === 299)).toBe(true);
    expect(body.plans.some((item) => item.code === 'control-plane' && item.monthly_price_usd === 2499)).toBe(true);
  });

  it('supports public lead capture and console session login', async () => {
    const leadRes = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Taylor Buyer',
        email: 'taylor@example.com',
        company: 'Buyer Co',
        source: 'pricing_page',
        product_slug: 'ai-vps-control-panel',
        plan_code: 'growth',
        message: 'Need a walkthrough',
      }),
    });
    expect(leadRes.status).toBe(201);

    const loginRes = await fetch(`${baseUrl}/api/session/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'owner@loccount.local',
        password: 'console-pass-123',
      }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get('set-cookie');
    expect(typeof cookie).toBe('string');
    expect((cookie ?? '').includes('ai_vps_console_session=')).toBe(true);

    const leadsRes = await fetch(`${baseUrl}/api/leads`, {
      headers: {
        cookie: cookie ?? '',
      },
    });
    const leadsBody = (await leadsRes.json()) as {
      ok: boolean;
      leads: Array<{ email: string; plan_code: string | null }>;
    };
    expect(leadsRes.status).toBe(200);
    expect(leadsBody.ok).toBe(true);
    expect(leadsBody.leads.some((item) => item.email === 'taylor@example.com' && item.plan_code === 'growth')).toBe(
      true,
    );
  });

  it('requires auth for protected routes', async () => {
    const response = await fetch(`${baseUrl}/api/sites`);
    expect(response.status).toBe(401);
  });

  it('manages persisted PAT/API keys with rotate and revoke flows', async () => {
    const createTokenRes = await fetch(`${baseUrl}/api/tokens`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: 'tenant-a',
        label: 'ops pat',
        token_type: 'pat',
        role: 'operator',
        scopes: ['*'],
        auto_rotate: true,
        rotate_after: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    const createTokenBody = (await createTokenRes.json()) as {
      ok: boolean;
      token: string;
      record: { id: string; token_type: string };
    };
    expect(createTokenRes.status).toBe(201);
    expect(createTokenBody.ok).toBe(true);
    expect(createTokenBody.record.token_type).toBe('pat');
    expect(createTokenBody.token.length > 20).toBe(true);

    const autoRotateTriggerRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(createTokenBody.token),
    });
    const rotatedToken = autoRotateTriggerRes.headers.get('x-rotated-api-key');
    expect(autoRotateTriggerRes.status).toBe(200);
    expect(typeof rotatedToken).toBe('string');
    expect((rotatedToken ?? '').length > 20).toBe(true);

    const oldTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(createTokenBody.token),
    });
    expect(oldTokenRes.status).toBe(401);

    const rotatedAuthRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(rotatedToken ?? ''),
    });
    expect(rotatedAuthRes.status).toBe(200);

    const listTokensRes = await fetch(`${baseUrl}/api/tokens?include_revoked=1`, {
      headers: authHeaders('admin-a'),
    });
    const listTokensBody = (await listTokensRes.json()) as {
      ok: boolean;
      tokens: Array<{ id: string; status: string }>;
    };
    expect(listTokensRes.status).toBe(200);
    const activeToken = listTokensBody.tokens.find((item) => item.status === 'active');
    expect(activeToken).toBeDefined();

    const rotateRes = await fetch(`${baseUrl}/api/tokens/${encodeURIComponent(activeToken?.id ?? '')}/rotate`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const rotateBody = (await rotateRes.json()) as {
      ok: boolean;
      token: string;
      record: { id: string; status: string };
    };
    expect(rotateRes.status).toBe(201);
    expect(rotateBody.ok).toBe(true);
    expect(rotateBody.record.status).toBe('active');

    const publishAuditRes = await fetch(`${baseUrl}/api/tokens/publish-audit`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: 'tenant-a',
        ok: true,
        rotated_count: 1,
        active_token_count: 2,
        stale_token_count: 0,
        vault_mount: 'kv',
        vault_path: 'ai-vps-control-panel/runtime',
        vault_field: 'api_keys_spec',
        note: 'publisher_job_test',
      }),
    });
    expect(publishAuditRes.status).toBe(201);

    const revokeRes = await fetch(`${baseUrl}/api/tokens/${encodeURIComponent(rotateBody.record.id)}/revoke`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'test_cleanup' }),
    });
    expect(revokeRes.status).toBe(200);

    const revokedTokenAuthRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authHeaders(rotateBody.token),
    });
    expect(revokedTokenAuthRes.status).toBe(401);

    const auditRes = await fetch(`${baseUrl}/api/audit?limit=200`, {
      headers: authHeaders('admin-a'),
    });
    const auditBody = (await auditRes.json()) as {
      ok: boolean;
      logs: Array<{ event_type: string }>;
    };
    expect(auditRes.status).toBe(200);
    expect(auditBody.ok).toBe(true);
    expect(auditBody.logs.some((item) => item.event_type === 'auth.token.publish')).toBe(true);
  });

  it('creates Stripe checkout sessions and applies webhook-driven billing state', async () => {
    const createSiteRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'stripe-site-1',
        tenant_id: 'tenant-a',
        domain: 'stripe.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(createSiteRes.status).toBe(201);

    const originalFetch = globalThis.fetch;
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth_123';
    process.env.STRIPE_SUCCESS_URL = 'https://loccount.test/pricing?checkout=success';
    process.env.STRIPE_CANCEL_URL = 'https://loccount.test/pricing?checkout=cancel';

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          authorization: 'Bearer sk_test_123',
          'content-type': 'application/x-www-form-urlencoded',
        });
        const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
        expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_growth_123');
        expect(body).toContain('client_reference_id=');
        expect(body).toContain('metadata%5Bsite_id%5D=stripe-site-1');
        return new Response(
          JSON.stringify({
            id: 'cs_test_123',
            url: 'https://checkout.stripe.test/session/cs_test_123',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }
      if (url === 'https://api.stripe.com/v1/billing_portal/sessions') {
        expect(init?.method).toBe('POST');
        const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
        expect(body).toContain('customer=cus_test_123');
        return new Response(
          JSON.stringify({
            id: 'bps_test_123',
            url: 'https://billing.stripe.test/session/bps_test_123',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const checkoutRes = await fetch(`${baseUrl}/api/billing/checkout-session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Morgan Buyer',
          email: 'morgan@example.com',
          company: 'Stripe Co',
          product_slug: 'ai-vps-control-panel',
          plan_code: 'growth',
          tenant_id: 'tenant-a',
          site_id: 'stripe-site-1',
          message: 'Start paid rollout',
        }),
      });
      const checkoutBody = (await checkoutRes.json()) as {
        ok: boolean;
        order: { id: string; stripe_checkout_session_id: string | null; status: string };
        checkout_url: string;
      };
      expect(checkoutRes.status).toBe(201);
      expect(checkoutBody.ok).toBe(true);
      expect(checkoutBody.order.status).toBe('checkout_created');
      expect(checkoutBody.order.stripe_checkout_session_id).toBe('cs_test_123');
      expect(checkoutBody.checkout_url).toBe('https://checkout.stripe.test/session/cs_test_123');

      const completedPayload = JSON.stringify({
        id: 'evt_checkout_completed_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer: 'cus_test_123',
            subscription: 'sub_test_123',
            metadata: {
              order_id: checkoutBody.order.id,
            },
          },
        },
      });
      const completedRes = await fetch(`${baseUrl}/api/stripe/webhook`, {
        method: 'POST',
        headers: stripeWebhookHeaders(completedPayload, 'whsec_test_123'),
        body: completedPayload,
      });
      expect(completedRes.status).toBe(200);

      const duplicateCompletedRes = await fetch(`${baseUrl}/api/stripe/webhook`, {
        method: 'POST',
        headers: stripeWebhookHeaders(completedPayload, 'whsec_test_123'),
        body: completedPayload,
      });
      const duplicateCompletedBody = (await duplicateCompletedRes.json()) as {
        ok: boolean;
        duplicate: boolean;
        stripe_event_id: string;
      };
      expect(duplicateCompletedRes.status).toBe(200);
      expect(duplicateCompletedBody.ok).toBe(true);
      expect(duplicateCompletedBody.duplicate).toBe(true);
      expect(duplicateCompletedBody.stripe_event_id).toBe('evt_checkout_completed_123');

      const periodEnd = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
      const updatedPayload = JSON.stringify({
        id: 'evt_subscription_updated_123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_123',
            customer: 'cus_test_123',
            status: 'active',
            current_period_end: periodEnd,
            metadata: {
              order_id: checkoutBody.order.id,
              tenant_id: 'tenant-a',
              site_id: 'stripe-site-1',
              plan_code: 'growth',
              product_slug: 'ai-vps-control-panel',
              plugin_id: 'panel-addon',
            },
          },
        },
      });
      const updatedRes = await fetch(`${baseUrl}/api/stripe/webhook`, {
        method: 'POST',
        headers: stripeWebhookHeaders(updatedPayload, 'whsec_test_123'),
        body: updatedPayload,
      });
      expect(updatedRes.status).toBe(200);

      const billingRes = await fetch(`${baseUrl}/api/billing/subscriptions`, {
        headers: authHeaders('operator-a'),
      });
      const billingBody = (await billingRes.json()) as {
        ok: boolean;
        subscriptions: Array<{
          site_id: string;
          plan_code: string;
          status: string;
          sandbox_enabled: boolean;
          sandbox_access_allowed: boolean;
        }>;
      };
      expect(billingRes.status).toBe(200);
      expect(billingBody.ok).toBe(true);
      expect(
        billingBody.subscriptions.some(
          (item) =>
            item.site_id === 'stripe-site-1' &&
            item.plan_code === 'growth' &&
            item.status === 'active' &&
            item.sandbox_enabled === true &&
            item.sandbox_access_allowed === true,
        ),
      ).toBe(true);

      const historyRes = await fetch(`${baseUrl}/api/billing/history?site_id=stripe-site-1`, {
        headers: authHeaders('operator-a'),
      });
      const historyBody = (await historyRes.json()) as {
        ok: boolean;
        orders: Array<{ site_id: string | null; status: string; stripe_customer_id: string | null }>;
      };
      expect(historyRes.status).toBe(200);
      expect(historyBody.ok).toBe(true);
      expect(
        historyBody.orders.some(
          (item) => item.site_id === 'stripe-site-1' && item.status === 'active' && item.stripe_customer_id === 'cus_test_123',
        ),
      ).toBe(true);

      const portalRes = await fetch(`${baseUrl}/api/billing/customer-portal-session`, {
        method: 'POST',
        headers: {
          ...authHeaders('operator-a'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          site_id: 'stripe-site-1',
        }),
      });
      const portalBody = (await portalRes.json()) as {
        ok: boolean;
        url: string;
        customer_id: string;
      };
      expect(portalRes.status).toBe(201);
      expect(portalBody.ok).toBe(true);
      expect(portalBody.customer_id).toBe('cus_test_123');
      expect(portalBody.url).toBe('https://billing.stripe.test/session/bps_test_123');

      const webhookEventsRes = await fetch(`${baseUrl}/api/billing/webhook-events?site_id=stripe-site-1`, {
        headers: authHeaders('operator-a'),
      });
      const webhookEventsBody = (await webhookEventsRes.json()) as {
        ok: boolean;
        events: Array<{ stripe_event_id: string; status: string; payload: Record<string, unknown> }>;
      };
      expect(webhookEventsRes.status).toBe(200);
      expect(webhookEventsBody.ok).toBe(true);
      expect(
        webhookEventsBody.events.some(
          (item) =>
            item.stripe_event_id === 'evt_subscription_updated_123' &&
            item.status === 'processed' &&
            typeof item.payload === 'object',
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_PRICE_GROWTH;
      delete process.env.STRIPE_SUCCESS_URL;
      delete process.env.STRIPE_CANCEL_URL;
    }
  });

  it('records failed Stripe webhook processing and allows retry with same event id', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
    process.env.STRIPE_PRICE_GROWTH = 'price_growth_123';

    const failedPayload = JSON.stringify({
      id: 'evt_failed_retry_123',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_failed_retry_123',
          customer: 'cus_failed_retry_123',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 3600,
          metadata: {
            tenant_id: 'tenant-a',
            site_id: 'missing-site-1',
            plan_code: 'growth',
            plugin_id: 'panel-addon',
          },
        },
      },
    });
    const failedRes = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: stripeWebhookHeaders(failedPayload, 'whsec_test_123'),
      body: failedPayload,
    });
    const failedBody = (await failedRes.json()) as { ok: boolean; error: string; stripe_event_id: string };
    expect(failedRes.status).toBe(500);
    expect(failedBody.ok).toBe(false);
    expect(failedBody.stripe_event_id).toBe('evt_failed_retry_123');

    const failedEventsRes = await fetch(`${baseUrl}/api/billing/webhook-events?status=failed`, {
      headers: authHeaders('operator-a'),
    });
    const failedEventsBody = (await failedEventsRes.json()) as {
      ok: boolean;
      events: Array<{ stripe_event_id: string; status: string; error_message: string | null }>;
    };
    expect(failedEventsRes.status).toBe(200);
    expect(failedEventsBody.ok).toBe(true);
    expect(
      failedEventsBody.events.some(
        (item) =>
          item.stripe_event_id === 'evt_failed_retry_123' &&
          item.status === 'failed' &&
          typeof item.error_message === 'string',
      ),
    ).toBe(true);

    const createSiteRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'missing-site-1',
        tenant_id: 'tenant-a',
        domain: 'retry.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(createSiteRes.status).toBe(201);

    const retryRes = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: stripeWebhookHeaders(failedPayload, 'whsec_test_123'),
      body: failedPayload,
    });
    const retryBody = (await retryRes.json()) as { ok: boolean; received: boolean };
    expect(retryRes.status).toBe(200);
    expect(retryBody.ok).toBe(true);

    const retriedEventsRes = await fetch(`${baseUrl}/api/billing/webhook-events?site_id=missing-site-1`, {
      headers: authHeaders('operator-a'),
    });
    const retriedEventsBody = (await retriedEventsRes.json()) as {
      ok: boolean;
      events: Array<{ stripe_event_id: string; status: string; error_message: string | null }>;
    };
    expect(retriedEventsRes.status).toBe(200);
    expect(retriedEventsBody.ok).toBe(true);
    expect(
      retriedEventsBody.events.some(
        (item) =>
          item.stripe_event_id === 'evt_failed_retry_123' &&
          item.status === 'processed' &&
          item.error_message === null,
      ),
    ).toBe(true);

    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_GROWTH;
  });

  it('enforces tenant-scoped auth, planning, approvals, and execution queue', async () => {
    const createSiteRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'site-test-1',
        tenant_id: 'tenant-a',
        domain: 'example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(createSiteRes.status).toBe(201);

    const chatRes = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        ...authHeaders('operator-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'site-test-1',
        message: 'restart nginx',
      }),
    });
    const chatBody = (await chatRes.json()) as {
      ok: boolean;
      conversation_id: string;
      actions: Array<{ id: string; type: string; status: string }>;
    };

    expect(chatRes.status).toBe(200);
    expect(chatBody.ok).toBe(true);
    expect(chatBody.actions[0]?.type).toBe('restart_service');
    expect(chatBody.actions[0]?.status).toBe('pending');

    const listActionsRes = await fetch(`${baseUrl}/api/actions?status=pending`, {
      headers: authHeaders('operator-a'),
    });
    const listActionsBody = (await listActionsRes.json()) as {
      ok: boolean;
      actions: Array<{ id: string }>;
    };
    expect(listActionsRes.status).toBe(200);
    expect(listActionsBody.ok).toBe(true);
    expect(listActionsBody.actions.some((item) => item.id === chatBody.actions[0]?.id)).toBe(true);

    const approveRes = await fetch(
      `${baseUrl}/api/actions/${encodeURIComponent(chatBody.actions[0]?.id ?? '')}/approve`,
      {
        method: 'POST',
        headers: {
          ...authHeaders('admin-a'),
          'content-type': 'application/json',
        },
        body: '{}',
      },
    );
    expect(approveRes.status).toBe(200);

    const executeQueuedRes = await fetch(
      `${baseUrl}/api/actions/${encodeURIComponent(chatBody.actions[0]?.id ?? '')}/execute`,
      {
        method: 'POST',
        headers: {
          ...authHeaders('operator-a'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          dry_run: true,
          confirmed: true,
        }),
      },
    );
    const executeQueuedBody = (await executeQueuedRes.json()) as {
      ok: boolean;
      dry_run: boolean;
      worker_sync?: { ok: boolean; details?: { skipped?: boolean } };
    };
    expect(executeQueuedRes.status).toBe(200);
    expect(executeQueuedBody.ok).toBe(true);
    expect(executeQueuedBody.dry_run).toBe(true);
    expect(executeQueuedBody.worker_sync?.ok).toBe(true);
    expect(executeQueuedBody.worker_sync?.details?.skipped).toBe(true);

    const crossTenantRes = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        ...authHeaders('operator-b'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'site-test-1',
        message: 'status nginx',
      }),
    });
    expect(crossTenantRes.status).toBe(403);

    const executeRes = await fetch(`${baseUrl}/api/agent/execute`, {
      method: 'POST',
      headers: {
        ...authHeaders('operator-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'site-test-1',
        action: chatBody.actions[0],
        dry_run: true,
        confirmed: true,
      }),
    });
    const executeBody = (await executeRes.json()) as {
      ok: boolean;
      dry_run: boolean;
      worker_sync?: { ok: boolean; details?: { skipped?: boolean } };
    };

    expect(executeRes.status).toBe(200);
    expect(executeBody.ok).toBe(true);
    expect(executeBody.dry_run).toBe(true);
    expect(executeBody.worker_sync?.ok).toBe(true);
    expect(executeBody.worker_sync?.details?.skipped).toBe(true);

    const messagesRes = await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(chatBody.conversation_id)}/messages`,
      {
        headers: authHeaders('operator-a'),
      },
    );
    const messagesBody = (await messagesRes.json()) as {
      ok: boolean;
      messages: Array<{ role: string }>;
    };
    expect(messagesRes.status).toBe(200);
    expect(messagesBody.ok).toBe(true);
    expect(messagesBody.messages.some((item) => item.role === 'user')).toBe(true);
    expect(messagesBody.messages.some((item) => item.role === 'assistant')).toBe(true);
  });

  it('supports fleet mode risk dashboard and policy template apply across sites', async () => {
    const siteARes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'fleet-site-1',
        tenant_id: 'tenant-a',
        domain: 'fleet-one.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(siteARes.status).toBe(201);

    const siteBRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'fleet-site-2',
        tenant_id: 'tenant-a',
        domain: 'fleet-two.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(siteBRes.status).toBe(201);

    const riskyChatRes = await fetch(`${baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        ...authHeaders('operator-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'fleet-site-1',
        message: 'restart nginx',
      }),
    });
    expect(riskyChatRes.status).toBe(200);

    const policyCreateRes = await fetch(`${baseUrl}/api/fleet/policies`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: 'tenant-a',
        name: 'Agency Baseline',
        category: 'security',
        description: 'Default baseline policy',
        config: {
          waf_mode: 'strict',
          mfa_required: true,
          backup_frequency: 'daily',
        },
      }),
    });
    const policyCreateBody = (await policyCreateRes.json()) as {
      ok: boolean;
      template: { id: string; name: string };
    };
    expect(policyCreateRes.status).toBe(201);
    expect(policyCreateBody.ok).toBe(true);
    expect(policyCreateBody.template.name).toBe('Agency Baseline');

    const applyPolicyRes = await fetch(
      `${baseUrl}/api/fleet/policies/${encodeURIComponent(policyCreateBody.template.id)}/apply`,
      {
        method: 'POST',
        headers: {
          ...authHeaders('admin-a'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          apply_all: true,
          status: 'active',
        }),
      },
    );
    const applyPolicyBody = (await applyPolicyRes.json()) as {
      ok: boolean;
      applied_count: number;
    };
    expect(applyPolicyRes.status).toBe(200);
    expect(applyPolicyBody.ok).toBe(true);
    expect(applyPolicyBody.applied_count).toBeGreaterThanOrEqual(2);

    const listPoliciesRes = await fetch(`${baseUrl}/api/fleet/policies`, {
      headers: authHeaders('operator-a'),
    });
    const listPoliciesBody = (await listPoliciesRes.json()) as {
      ok: boolean;
      templates: Array<{ id: string; applied_sites: number }>;
    };
    expect(listPoliciesRes.status).toBe(200);
    const createdTemplate = listPoliciesBody.templates.find(
      (item) => item.id === policyCreateBody.template.id,
    );
    expect(createdTemplate).toBeDefined();
    expect((createdTemplate?.applied_sites ?? 0) >= 2).toBe(true);

    const fleetRiskRes = await fetch(`${baseUrl}/api/fleet/risk?window_hours=24`, {
      headers: authHeaders('operator-a'),
    });
    const fleetRiskBody = (await fleetRiskRes.json()) as {
      ok: boolean;
      summary: { total_sites: number; high_risk_sites: number };
      sites: Array<{ site_id: string; risk_score: number; policy_templates: string[] }>;
    };
    expect(fleetRiskRes.status).toBe(200);
    expect(fleetRiskBody.ok).toBe(true);
    expect(fleetRiskBody.summary.total_sites).toBeGreaterThanOrEqual(2);
    const siteOne = fleetRiskBody.sites.find((item) => item.site_id === 'fleet-site-1');
    const siteTwo = fleetRiskBody.sites.find((item) => item.site_id === 'fleet-site-2');
    expect((siteOne?.risk_score ?? 0) >= (siteTwo?.risk_score ?? 0)).toBe(true);
    expect(siteOne?.policy_templates.includes('Agency Baseline')).toBe(true);
  });

  it('manages monthly sandbox licensing state and exposes blocked access when unpaid', async () => {
    const createSiteRes = await fetch(`${baseUrl}/api/sites`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'billing-site-1',
        tenant_id: 'tenant-a',
        domain: 'billing-one.example.com',
        panel_type: 'ai_vps_panel',
        runtime_type: 'php_generic',
      }),
    });
    expect(createSiteRes.status).toBe(201);

    const saveBillingRes = await fetch(`${baseUrl}/api/billing/subscriptions`, {
      method: 'POST',
      headers: {
        ...authHeaders('admin-a'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        site_id: 'billing-site-1',
        status: 'unpaid',
        sandbox_enabled: false,
        plan_code: 'sandbox_monthly',
      }),
    });
    const saveBillingBody = (await saveBillingRes.json()) as {
      ok: boolean;
      subscription: { site_id: string; status: string; sandbox_access_allowed: boolean };
      worker_sync: { ok: boolean; skipped?: boolean };
    };
    expect(saveBillingRes.status).toBe(201);
    expect(saveBillingBody.ok).toBe(true);
    expect(saveBillingBody.subscription.site_id).toBe('billing-site-1');
    expect(saveBillingBody.subscription.status).toBe('unpaid');
    expect(saveBillingBody.subscription.sandbox_access_allowed).toBe(false);
    expect(saveBillingBody.worker_sync.ok).toBe(true);
    expect(saveBillingBody.worker_sync.skipped).toBe(true);

    const listBillingRes = await fetch(`${baseUrl}/api/billing/subscriptions?status=unpaid`, {
      headers: authHeaders('operator-a'),
    });
    const listBillingBody = (await listBillingRes.json()) as {
      ok: boolean;
      subscriptions: Array<{ site_id: string; status: string; sandbox_enabled: boolean; sandbox_access_allowed: boolean }>;
    };
    expect(listBillingRes.status).toBe(200);
    expect(listBillingBody.ok).toBe(true);
    const billingRecord = listBillingBody.subscriptions.find((item) => item.site_id === 'billing-site-1');
    expect(billingRecord).toBeDefined();
    expect(billingRecord?.status).toBe('unpaid');
    expect(billingRecord?.sandbox_enabled).toBe(false);
    expect(billingRecord?.sandbox_access_allowed).toBe(false);
  });
});

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function stripeWebhookHeaders(payload: string, secret: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return {
    'content-type': 'application/json',
    'stripe-signature': `t=${timestamp},v1=${signature}`,
  };
}
