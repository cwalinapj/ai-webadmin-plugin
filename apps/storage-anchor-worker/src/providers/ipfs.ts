import type { Env } from '../types';

interface IpfsResult {
  cid: string;
  gatewayUrl: string;
}

function extractCid(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      extractCid(record.cid) ??
      extractCid(record.IpfsHash) ??
      extractCid(record.Hash) ??
      extractCid(record.value) ??
      null
    );
  }
  return null;
}

export function isIpfsConfigured(env: Env): boolean {
  return Boolean(env.IPFS_API_TOKEN);
}

export async function pinToIpfs(
  env: Env,
  body: ArrayBuffer,
  contentType: string,
): Promise<IpfsResult> {
  if (!env.IPFS_API_TOKEN) {
    throw new Error('ipfs_not_configured');
  }

  const endpoint = env.IPFS_PIN_ENDPOINT ?? 'https://api.web3.storage/upload';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.IPFS_API_TOKEN}`,
      'content-type': contentType || 'application/octet-stream',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`ipfs_pin_failed_${response.status}`);
  }

  const raw = await response.text();
  let cid: string | null = null;
  try {
    const json = JSON.parse(raw) as unknown;
    cid = extractCid(json);
  } catch {
    cid = extractCid(raw);
  }

  if (!cid) {
    throw new Error('ipfs_cid_missing');
  }

  const gatewayBase = env.IPFS_GATEWAY_BASE ?? 'https://w3s.link/ipfs/';
  const normalizedBase = gatewayBase.endsWith('/') ? gatewayBase : `${gatewayBase}/`;
  return {
    cid,
    gatewayUrl: `${normalizedBase}${cid}`,
  };
}
