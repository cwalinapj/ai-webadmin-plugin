export async function withSiteLock<T>(
  namespace: DurableObjectNamespace,
  siteId: string,
  run: () => Promise<T>,
): Promise<T> {
  const durableId = namespace.idFromName(`site:${siteId}`);
  const stub = namespace.get(durableId);
  const lockId = crypto.randomUUID();

  const acquireResponse = await stub.fetch('https://site-lock/acquire', {
    method: 'POST',
    headers: {
      'X-Lock-Id': lockId,
      'X-Lock-TTL': '30',
    },
  });

  if (!acquireResponse.ok) {
    throw new Error('site_lock_acquire_failed');
  }

  try {
    return await run();
  } finally {
    try {
      await stub.fetch('https://site-lock/release', {
        method: 'POST',
        headers: {
          'X-Lock-Id': lockId,
        },
      });
    } catch (error) {
      // Lock expiration is bounded by TTL; release best-effort failure should not mask run result.
    }
  }
}
