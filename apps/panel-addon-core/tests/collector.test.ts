import { describe, expect, it } from 'vitest';
import { collectHeartbeatPayload } from '../src/collectors/heartbeat.js';

describe('heartbeat collector', () => {
  it('builds runtime heartbeat payload for non-wordpress site', () => {
    const payload = collectHeartbeatPayload({
      siteId: 'site-abc',
      domain: 'example.com',
      runtimeLabel: 'node_generic',
    });

    expect(payload.site_id).toBe('site-abc');
    expect(payload.domain).toBe('example.com');
    expect(payload.wp_version).toBe('node_generic');
    expect(Array.isArray(payload.load_avg)).toBe(true);
  });
});
