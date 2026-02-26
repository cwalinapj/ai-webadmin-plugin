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
  CAP_TOKEN_HOST_OPTIMIZER_WRITE: 'cap-host-token',
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

  it('requires host optimizer capability token for baseline route', async () => {
    const body = JSON.stringify({ site_url: 'https://example.com/' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '7f0c65df-df73-45b1-a838-f03d9568ae4e';
    const path = '/plugin/wp/host-optimizer/baseline';
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
      expect(result.error).toBe('missing_capability_token');
    }
  });

  it('requires host optimizer capability token for /plugin/site alias path', async () => {
    const body = JSON.stringify({ site_url: 'https://example.com/' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '4be355e6-bd12-45ee-a17c-79fcd67f33d8';
    const path = '/plugin/site/host-optimizer/baseline';
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
      expect(result.error).toBe('missing_capability_token');
    }
  });

  it('requires analytics capability token for goal assistant route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '7b7bb8a1-9c95-4866-b5ab-06ae2f34620a';
    const path = '/plugin/wp/analytics/goals/assistant';
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
      expect(result.error).toBe('missing_capability_token');
    }
  });

  it('verifies analytics capability token for /plugin/site analytics alias', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '88ad212e-8da1-495e-8085-63a3f9393fd8';
    const path = '/plugin/site/analytics/goals/assistant';
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

  it('requires uptime capability token for performance slo route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '58d0b14e-b088-4d89-b4de-00c7c57f6f4a';
    const path = '/plugin/wp/performance/slo/evaluate';
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
      expect(result.error).toBe('missing_capability_token');
    }
  });

  it('verifies uptime capability token for updates safe route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', domain: 'example.com' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 'e5ad8d0b-6631-4853-b1c6-bc0fd2525ecd';
    const path = '/plugin/site/updates/safe/run';
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
  });

  it('requires uptime capability token for incident mode route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', summary: 'incident' });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '7c2ae7d7-c40e-4a7f-90b5-a2fbf13bb553';
    const path = '/plugin/wp/incident/mode';
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
      expect(result.error).toBe('missing_capability_token');
    }
  });

  it('verifies uptime capability token for jobs report route', async () => {
    const body = JSON.stringify({ site_id: 'site-1', limit: 10 });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = '7d5b66db-bd52-4b2f-bdd2-ed5378258f6f';
    const path = '/plugin/site/jobs/reports';
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
  });
});
