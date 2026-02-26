import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelAddonClient } from '../src/client.js';

describe('panel addon client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts signed heartbeat payload to site route', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, commands: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new PanelAddonClient({
      baseUrl: 'https://worker.example.com',
      pluginId: 'plugin-1',
      sharedSecret: 'secret-1',
      capabilityTokens: {
        uptime: 'cap-up',
      },
    });

    const result = await client.sendHeartbeat({
      site_id: 'site-1',
      domain: 'example.com',
      plan: 'vps',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const url = firstCall?.[0] as URL;
    const init = firstCall?.[1] as RequestInit;
    expect(url.toString()).toBe('https://worker.example.com/plugin/site/watchdog/heartbeat');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Capability-Token']).toBe('cap-up');
    expect((init.headers as Record<string, string>)['X-Plugin-Id']).toBe('plugin-1');
  });
});
