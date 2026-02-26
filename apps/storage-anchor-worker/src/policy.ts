import type { AnchorPriority, PlacementPlan, RetentionClass } from './types';

export interface PlacementInput {
  priority: AnchorPriority;
  retentionClass: RetentionClass;
  sizeBytes: number;
  b2Configured: boolean;
  ipfsConfigured: boolean;
  forceIpfsBackup: boolean;
  ipfsQuotaRemainingBytes: number;
}

export function buildPlacementPlan(input: PlacementInput): PlacementPlan {
  const {
    priority,
    retentionClass,
    sizeBytes,
    b2Configured,
    ipfsConfigured,
    forceIpfsBackup,
    ipfsQuotaRemainingBytes,
  } = input;

  let primary: 'r2' | 'b2' = 'r2';
  const replicas: Array<'r2' | 'b2'> = [];
  const reasons: string[] = [];

  if (retentionClass === 'cold' && b2Configured) {
    primary = 'b2';
    reasons.push('cold_retention_prefers_b2_primary');
  } else {
    primary = 'r2';
    reasons.push('active_delivery_prefers_r2_primary');
  }

  if (retentionClass === 'balanced' && b2Configured && primary !== 'b2') {
    replicas.push('b2');
    reasons.push('balanced_retention_adds_b2_replica');
  }

  if (priority === 'high') {
    if (primary === 'r2' && b2Configured && !replicas.includes('b2')) {
      replicas.push('b2');
      reasons.push('high_priority_requires_secondary_copy_b2');
    }
    if (primary === 'b2' && !replicas.includes('r2')) {
      replicas.push('r2');
      reasons.push('high_priority_requires_secondary_copy_r2');
    }
  }

  const ipfsRequested = forceIpfsBackup || priority === 'high';
  const ipfsBackup =
    ipfsRequested && ipfsConfigured && ipfsQuotaRemainingBytes >= Math.max(1, sizeBytes);

  if (ipfsRequested && !ipfsConfigured) {
    reasons.push('ipfs_not_configured');
  } else if (ipfsRequested && ipfsConfigured && !ipfsBackup) {
    reasons.push('ipfs_quota_exceeded');
  } else if (ipfsBackup) {
    reasons.push('ipfs_backup_enabled');
  }

  return {
    primary,
    replicas,
    ipfsBackup,
    reason: reasons.join(','),
  };
}
