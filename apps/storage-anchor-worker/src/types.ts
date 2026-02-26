export type AnchorPriority = 'standard' | 'high';
export type RetentionClass = 'hot' | 'balanced' | 'cold';
export type AnchorProvider = 'r2' | 'b2' | 'ipfs';

export interface AnchorTaskMessage {
  taskId: string;
}

export interface Env {
  ANCHOR_DB: D1Database;
  ANCHOR_QUEUE: Queue<AnchorTaskMessage>;
  ANCHOR_R2: R2Bucket;
  ANCHOR_API_TOKEN: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_BUCKET_ID?: string;
  B2_BUCKET_NAME?: string;
  B2_ACCOUNT_AUTH_URL?: string;
  IPFS_API_TOKEN?: string;
  IPFS_PIN_ENDPOINT?: string;
  IPFS_GATEWAY_BASE?: string;
  IPFS_FREE_QUOTA_BYTES?: string;
  MAX_INLINE_OBJECT_BYTES?: string;
}

export interface AnchorStoreRequest {
  object_key: string;
  content_base64: string;
  content_type?: string;
  priority?: AnchorPriority;
  retention_class?: RetentionClass;
  force_ipfs_backup?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PlacementPlan {
  primary: 'r2' | 'b2';
  replicas: Array<'r2' | 'b2'>;
  ipfsBackup: boolean;
  reason: string;
}
