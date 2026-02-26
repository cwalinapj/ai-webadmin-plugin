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
    expect(body.includes('AI VPS Control Panel')).toBe(true);
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
});

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}
