# Storage Anchor Worker

Policy-based object broker that stores content across Cloudflare R2 and Backblaze B2, with optional IPFS backup for high-priority objects.

## Features
- `POST /anchor/store`: ingest object content (base64) and route storage by policy.
- `GET /anchor/object?id=...` or `?key=...`: inspect manifest and replication status.
- `GET /anchor/health`: service and provider configuration status.
- D1 manifest + task tables for durable placement tracking.
- Queue-driven replication and backup tasks.
- Optional IPFS backup path (free-quota aware).

## Policy summary
- `hot`: primary `R2`.
- `balanced`: primary `R2`, replica `B2` (if configured).
- `cold`: primary `B2` (if configured), else `R2`.
- `high` priority: dual copy (`R2` + `B2`) where possible.
- `high` or `force_ipfs_backup`: attempts IPFS backup if token is configured and quota remains.

## Request example
```bash
curl -X POST "https://<worker-domain>/anchor/store" \
  -H "Authorization: Bearer <ANCHOR_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "object_key": "tenant-a/snapshots/site-123.json",
    "content_base64": "eyJ0ZXN0Ijp0cnVlfQ==",
    "content_type": "application/json",
    "priority": "high",
    "retention_class": "balanced",
    "force_ipfs_backup": false,
    "metadata": { "tenant": "tenant-a", "kind": "snapshot" }
  }'
```

## Required secrets and vars
Set with `wrangler secret put`:
- `ANCHOR_API_TOKEN`
- `B2_KEY_ID`
- `B2_APPLICATION_KEY`
- `B2_BUCKET_ID`
- `B2_BUCKET_NAME`
- `IPFS_API_TOKEN` (optional for IPFS backups)

Optional vars in `wrangler.toml`:
- `MAX_INLINE_OBJECT_BYTES` (default `5242880`)
- `IPFS_FREE_QUOTA_BYTES` (default `10737418240`, ~10 GiB)
- `IPFS_PIN_ENDPOINT` (default `https://api.web3.storage/upload`)
- `IPFS_GATEWAY_BASE` (default `https://w3s.link/ipfs/`)
- `B2_ACCOUNT_AUTH_URL` (override rarely needed)

## Local commands
```bash
npm install
npm test
npm run d1:migrate
npm run dev
```
