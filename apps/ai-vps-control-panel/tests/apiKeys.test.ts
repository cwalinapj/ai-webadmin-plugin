import { describe, expect, it } from 'vitest';
import { authenticate, isAllowed } from '../src/auth/apiKeys.js';
import type { ApiPrincipal } from '../src/types.js';

describe('api key auth', () => {
  it('authenticates bearer token from configured key map', async () => {
    process.env.AI_VPS_API_KEYS = 'token-a:operator:tenant-a,token-b:viewer:tenant-b';
    const request = {
      headers: {
        authorization: 'Bearer token-a',
      },
    } as unknown as Parameters<typeof authenticate>[0];

    const principal = await authenticate(request);
    expect(principal).not.toBeNull();
    expect(principal?.type).toBe('env');
    expect(principal?.role).toBe('operator');
    expect(principal?.tenant_id).toBe('tenant-a');
  });

  it('applies role hierarchy checks', () => {
    const principal: ApiPrincipal = {
      type: 'env',
      token_id: null,
      token_type: null,
      token: 'env:x',
      role: 'operator',
      tenant_id: 'tenant-a',
      scopes: ['*'],
    };

    expect(isAllowed(principal, 'viewer')).toBe(true);
    expect(isAllowed(principal, 'operator')).toBe(true);
    expect(isAllowed(principal, 'admin')).toBe(false);
  });
});
