export class SiteLock {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/acquire') {
      const lockId = request.headers.get('X-Lock-Id') ?? '';
      const ttlSeconds = Number.parseInt(request.headers.get('X-Lock-TTL') ?? '30', 10);
      const now = Date.now();
      const current = await this.state.storage.get<{ lockId: string; expiresAt: number }>('lock');

      if (current && current.expiresAt > now && current.lockId !== lockId) {
        return json({ ok: false, error: 'lock_held' }, 409);
      }

      await this.state.storage.put('lock', {
        lockId,
        expiresAt: now + ttlSeconds * 1000,
      });

      return json({ ok: true }, 200);
    }

    if (request.method === 'POST' && url.pathname === '/release') {
      const lockId = request.headers.get('X-Lock-Id') ?? '';
      const current = await this.state.storage.get<{ lockId: string; expiresAt: number }>('lock');
      if (current && current.lockId === lockId) {
        await this.state.storage.delete('lock');
      }

      return json({ ok: true }, 200);
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}
