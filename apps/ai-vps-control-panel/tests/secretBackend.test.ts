import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSecretBackend, resetSecretBackendForTests } from '../src/auth/secretBackend.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  resetSecretBackendForTests();
  vi.restoreAllMocks();
});

describe('secret backend', () => {
  it('uses local hashing by default', async () => {
    delete process.env.AI_VPS_SECRET_BACKEND;
    process.env.AI_VPS_TOKEN_PEPPER = 'pepper-1';

    const backend = getSecretBackend();
    const hash = await backend.hashToken('sample-token');

    expect(backend.type).toBe('local');
    expect(hash).toBe('bf10f6ae5b82601d70beddb3f0c8fbf88c5299b38bd118df394fbcfa5ea22e65');
  });

  it('uses vault transit hmac when configured', async () => {
    process.env.AI_VPS_SECRET_BACKEND = 'vault';
    process.env.AI_VPS_VAULT_ADDR = 'http://vault.internal:8200/';
    process.env.AI_VPS_VAULT_TOKEN = 'vault-token';
    process.env.AI_VPS_VAULT_TRANSIT_PATH = 'transit';
    process.env.AI_VPS_VAULT_HMAC_KEY = 'panel-token-hmac';

    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () =>
      new Response(JSON.stringify({ data: { hmac: 'vault:v1:deadbeef' } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const backend = getSecretBackend();
    const hash = await backend.hashToken('sample-token');

    expect(backend.type).toBe('vault');
    expect(hash).toBe('vault:v1:deadbeef');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://vault.internal:8200/v1/transit/hmac/panel-token-hmac/sha2-256',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vault-token': 'vault-token',
      },
    });
  });

  it('fails when vault mode is missing required config', () => {
    process.env.AI_VPS_SECRET_BACKEND = 'vault';
    delete process.env.AI_VPS_VAULT_ADDR;
    delete process.env.AI_VPS_VAULT_TOKEN;

    expect(() => getSecretBackend()).toThrowError('vault_config_missing');
  });
});
