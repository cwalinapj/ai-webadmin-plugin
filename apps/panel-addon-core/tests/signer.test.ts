import { describe, expect, it } from 'vitest';
import { buildCanonical, hmacSha256Hex, sha256Hex } from '../src/crypto.js';
import { signJsonRequest } from '../src/signer.js';

describe('panel addon signer', () => {
  it('creates canonical signature headers for signed requests', async () => {
    const signed = await signJsonRequest({
      pluginId: 'plugin-1',
      sharedSecret: 'shared-secret',
      method: 'POST',
      path: '/plugin/site/watchdog/heartbeat',
      payload: {
        site_id: 'site-1',
        domain: 'example.com',
      },
      capabilityToken: 'cap-up',
      idempotencyKey: 'idem-test',
    });

    expect(signed.headers['X-Plugin-Id']).toBe('plugin-1');
    expect(signed.headers['X-Capability-Token']).toBe('cap-up');
    expect(signed.headers['Idempotency-Key']).toBe('idem-test');
    expect(signed.headers['X-Plugin-Nonce']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(signed.headers['X-Plugin-Signature']).toMatch(/^[0-9a-f]{64}$/);

    const bodyHash = await sha256Hex(signed.body);
    const canonical = buildCanonical(
      Number.parseInt(signed.headers['X-Plugin-Timestamp'] ?? '0', 10),
      signed.headers['X-Plugin-Nonce'] ?? '',
      'POST',
      '/plugin/site/watchdog/heartbeat',
      bodyHash,
    );
    const expected = await hmacSha256Hex('shared-secret', canonical);
    expect(signed.headers['X-Plugin-Signature']).toBe(expected);
  });
});
