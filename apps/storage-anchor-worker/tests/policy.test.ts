import { describe, expect, it } from 'vitest';
import { buildPlacementPlan } from '../src/policy';

describe('buildPlacementPlan', () => {
  it('uses b2 as primary for cold retention when available', () => {
    const plan = buildPlacementPlan({
      priority: 'standard',
      retentionClass: 'cold',
      sizeBytes: 2048,
      b2Configured: true,
      ipfsConfigured: false,
      forceIpfsBackup: false,
      ipfsQuotaRemainingBytes: 0,
    });

    expect(plan.primary).toBe('b2');
    expect(plan.replicas).toEqual([]);
    expect(plan.ipfsBackup).toBe(false);
  });

  it('uses dual-provider for high-priority objects', () => {
    const plan = buildPlacementPlan({
      priority: 'high',
      retentionClass: 'balanced',
      sizeBytes: 4096,
      b2Configured: true,
      ipfsConfigured: true,
      forceIpfsBackup: false,
      ipfsQuotaRemainingBytes: 8192,
    });

    expect(plan.primary).toBe('r2');
    expect(plan.replicas).toContain('b2');
    expect(plan.ipfsBackup).toBe(true);
  });

  it('disables ipfs backup if free quota is exceeded', () => {
    const plan = buildPlacementPlan({
      priority: 'high',
      retentionClass: 'hot',
      sizeBytes: 10_000,
      b2Configured: true,
      ipfsConfigured: true,
      forceIpfsBackup: true,
      ipfsQuotaRemainingBytes: 2048,
    });

    expect(plan.ipfsBackup).toBe(false);
  });
});
