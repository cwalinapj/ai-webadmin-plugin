import { describe, expect, it, vi } from 'vitest';
import { cleanupReplayArtifacts } from '../src/auth/replay';

function makeMockDb() {
  const runMock = vi.fn(async () => undefined);
  const bindMock = vi.fn(() => ({ run: runMock }));
  const prepareMock = vi.fn(() => ({ bind: bindMock }));
  const db = { prepare: prepareMock } as unknown as D1Database;
  return { db, prepareMock, bindMock, runMock };
}

describe('cleanupReplayArtifacts', () => {
  it('deletes nonces and idempotency_keys older than the retention period', async () => {
    const { db, prepareMock, bindMock } = makeMockDb();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);

    const retentionSeconds = 3600;
    await cleanupReplayArtifacts(db, { retentionSeconds });

    const expectedCutoff = new Date(nowMs - retentionSeconds * 1000).toISOString();

    expect(prepareMock).toHaveBeenCalledWith('DELETE FROM nonces WHERE seen_at < ?1');
    expect(prepareMock).toHaveBeenCalledWith('DELETE FROM idempotency_keys WHERE seen_at < ?1');
    expect(bindMock).toHaveBeenCalledWith(expectedCutoff);
    expect(bindMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('uses DEFAULT_RETENTION_SECONDS (86400) when retentionSeconds is not provided', async () => {
    const { db, bindMock } = makeMockDb();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);

    await cleanupReplayArtifacts(db);

    const expectedCutoff = new Date(nowMs - 86_400 * 1000).toISOString();
    expect(bindMock).toHaveBeenCalledWith(expectedCutoff);

    vi.useRealTimers();
  });

  it('clamps retentionSeconds to a minimum of 60', async () => {
    const { db, bindMock } = makeMockDb();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);

    await cleanupReplayArtifacts(db, { retentionSeconds: 5 });

    const expectedCutoff = new Date(nowMs - 60 * 1000).toISOString();
    expect(bindMock).toHaveBeenCalledWith(expectedCutoff);

    vi.useRealTimers();
  });

  it('uses DEFAULT_RETENTION_SECONDS when retentionSeconds is non-finite', async () => {
    const { db, bindMock } = makeMockDb();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);

    await cleanupReplayArtifacts(db, { retentionSeconds: NaN });

    const expectedCutoff = new Date(nowMs - 86_400 * 1000).toISOString();
    expect(bindMock).toHaveBeenCalledWith(expectedCutoff);

    vi.useRealTimers();
  });
});
