import { describe, expect, it, vi } from 'vitest';
import { cleanupReplayArtifacts } from '../src/auth/replay';

function makeMockDb(runFn = vi.fn().mockResolvedValue(undefined)) {
  const bind = vi.fn().mockReturnValue({ run: runFn });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, run: runFn };
}

describe('cleanupReplayArtifacts', () => {
  it('deletes records older than the retention period', async () => {
    const { prepare, bind, run } = makeMockDb();
    const db = { prepare } as unknown as D1Database;

    const before = Date.now();
    await cleanupReplayArtifacts(db, { retentionSeconds: 3600 });
    const after = Date.now();

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledWith('DELETE FROM nonces WHERE seen_at < ?1');
    expect(prepare).toHaveBeenCalledWith('DELETE FROM idempotency_keys WHERE seen_at < ?1');

    const cutoff = new Date(bind.mock.calls[0][0] as string).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 3600 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 3600 * 1000 + 100);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('uses default retention (24h) when no options provided', async () => {
    const { prepare, bind } = makeMockDb();
    const db = { prepare } as unknown as D1Database;

    const before = Date.now();
    await cleanupReplayArtifacts(db);
    const after = Date.now();

    const cutoff = new Date(bind.mock.calls[0][0] as string).getTime();
    const defaultRetentionMs = 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - defaultRetentionMs);
    expect(cutoff).toBeLessThanOrEqual(after - defaultRetentionMs + 100);
  });

  it('preserves records within retention period (cutoff is in the past)', async () => {
    const { prepare, bind } = makeMockDb();
    const db = { prepare } as unknown as D1Database;

    await cleanupReplayArtifacts(db, { retentionSeconds: 60 });

    const cutoff = new Date(bind.mock.calls[0][0] as string).getTime();
    // cutoff should be ~60 seconds ago, so records newer than that are preserved
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(59_000);
    expect(Date.now() - cutoff).toBeLessThan(65_000);
  });

  it('clamps very small retention values to minimum of 60 seconds', async () => {
    const { bind } = makeMockDb();
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await cleanupReplayArtifacts(db, { retentionSeconds: 5 });

    const cutoff = new Date(bind.mock.calls[0][0] as string).getTime();
    // Should be clamped to 60s, not 5s
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(59_000);
  });

  it('uses default retention when retentionSeconds is not a finite number', async () => {
    const { bind } = makeMockDb();
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await cleanupReplayArtifacts(db, { retentionSeconds: NaN });

    const cutoff = new Date(bind.mock.calls[0][0] as string).getTime();
    const defaultRetentionMs = 24 * 60 * 60 * 1000;
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(defaultRetentionMs - 1000);
    expect(Date.now() - cutoff).toBeLessThan(defaultRetentionMs + 5000);
  });
});
