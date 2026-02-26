import { describe, expect, it } from 'vitest';
import {
  buildCanonical,
  hmacSha256Hex,
  sha256Hex,
  verifySignedRequest,
} from '../src/auth/verifySignature';

const env = {
  WP_PLUGIN_SHARED_SECRET: 'super-secret-value',
  CAP_TOKEN_UPTIME_WRITE: 'cap-uptime-token',
  CAP_TOKEN_ANALYTICS_WRITE: 'cap-analytics-token',
  REPLAY_WINDOW_SECONDS: '300',
};

describe('verifySignedRequest', () => {
  it('verifies valid signed heartbeat request', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
    const path = '/plugin/wp/watchdog/heartbeat';
    const method = 'POST';
    const bodyHash = await sha256Hex(body);
    const canonical = buildCanonical(timestamp, nonce, method, path, bodyHash);
    const signature = await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, canonical);

    const request = new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-plugin-id': 'plugin-1',
        'x-plugin-timestamp': String(timestamp),
        'x-plugin-nonce': nonce,
        'x-plugin-signature': signature,
        'x-capability-token': env.CAP_TOKEN_UPTIME_WRITE,
      },
      body,
    });

    const result = await verifySignedRequest({
      request,
      rawBody: await request.clone().arrayBuffer(),
      path,
      env,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginId).toBe('plugin-1');
      expect(result.nonce).toBe(nonce);
    }
  });

  it('rejects stale timestamp', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000) - 1000;
    const nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
    const path = '/plugin/wp/watchdog/heartbeat';
    const method = 'POST';
    const bodyHash = await sha256Hex(body);
    const canonical = buildCanonical(timestamp, nonce, method, path, bodyHash);
    const signature = await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, canonical);

    const request = new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-plugin-id': 'plugin-1',
        'x-plugin-timestamp': String(timestamp),
        'x-plugin-nonce': nonce,
        'x-plugin-signature': signature,
        'x-capability-token': env.CAP_TOKEN_UPTIME_WRITE,
      },
      body,
    });

    const result = await verifySignedRequest({
      request,
      rawBody: await request.clone().arrayBuffer(),
      path,
      env,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('timestamp_out_of_window');
    }
  });

  it('rejects invalid signature', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
    const path = '/plugin/wp/watchdog/heartbeat';

    const request = new Request(`https://api.example.com${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-plugin-id': 'plugin-1',
        'x-plugin-timestamp': String(timestamp),
        'x-plugin-nonce': nonce,
        'x-plugin-signature': '0'.repeat(64),
        'x-capability-token': env.CAP_TOKEN_UPTIME_WRITE,
      },
      body,
    });

    const result = await verifySignedRequest({
      request,
      rawBody: await request.clone().arrayBuffer(),
      path,
      env,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('signature_mismatch');
    }
  });

  it('verifies analytics capability token on analytics route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
    const path = '/plugin/wp/analytics/google/status';
    const method = 'POST';
    const bodyHash = await sha256Hex(body);
    const canonical = buildCanonical(timestamp, nonce, method, path, bodyHash);
    const signature = await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, canonical);

    const request = new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-plugin-id': 'plugin-1',
        'x-plugin-timestamp': String(timestamp),
        'x-plugin-nonce': nonce,
        'x-plugin-signature': signature,
        'x-capability-token': env.CAP_TOKEN_ANALYTICS_WRITE,
      },
      body,
    });

    const result = await verifySignedRequest({
      request,
      rawBody: await request.clone().arrayBuffer(),
      path,
      env,
    });

    expect(result.ok).toBe(true);
  });
});
