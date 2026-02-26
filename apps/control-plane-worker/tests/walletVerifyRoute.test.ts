import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/auth/verifySignature';
import { handleRequest } from '../src/routes';

const env = {
  WP_PLUGIN_SHARED_SECRET: 'super-secret-value',
  CAP_TOKEN_UPTIME_WRITE: 'cap-uptime-token',
  REPLAY_WINDOW_SECONDS: '300',
} as const;

describe('wallet verify route', () => {
  it('verifies ethereum wallet signatures', async () => {
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4d59f7ddf96d3',
    );
    const message =
      'AI WebAdmin Login Challenge\nSite: example.com\nNetwork: ETHEREUM\nChain ID: 1\nNonce: nonce-1\nIssued At: 2026-02-26T00:00:00Z';
    const signature = await account.signMessage({ message });
    const payload = {
      session_id: 'session-1',
      wallet_network: 'ethereum',
      wallet_address: account.address,
      wallet_signature: signature,
      wallet_message: message,
    };

    const response = await handleRequest(await signedWalletRequest(payload), env as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.wallet_network).toBe('ethereum');
    expect(body.wallet_address).toBe(account.address);
  });

  it('verifies solana wallet signatures', async () => {
    const seed = new Uint8Array(32).fill(7);
    const keypair = nacl.sign.keyPair.fromSeed(seed);
    const walletAddress = bs58.encode(keypair.publicKey);
    const message =
      'AI WebAdmin Login Challenge\nSite: example.com\nNetwork: SOLANA\nNonce: nonce-2\nIssued At: 2026-02-26T00:00:00Z';
    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    const payload = {
      session_id: 'session-2',
      wallet_network: 'solana',
      wallet_address: walletAddress,
      wallet_signature: `base64:${toBase64(signatureBytes)}`,
      wallet_message: message,
    };

    const response = await handleRequest(await signedWalletRequest(payload), env as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.wallet_network).toBe('solana');
    expect(body.wallet_address).toBe(walletAddress);
  });

  it('rejects invalid wallet signatures', async () => {
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4d59f7ddf96d3',
    );
    const message = 'AI WebAdmin Login Challenge\nNonce: nonce-3';
    const payload = {
      session_id: 'session-3',
      wallet_network: 'ethereum',
      wallet_address: account.address,
      wallet_signature: '0x' + '00'.repeat(65),
      wallet_message: message,
    };

    const response = await handleRequest(await signedWalletRequest(payload), env as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.verified).toBe(false);
    expect(body.error).toBe('invalid_wallet_signature');
  });

  it('accepts site route alias for wallet verification', async () => {
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4d59f7ddf96d3',
    );
    const message = 'AI WebAdmin Login Challenge\nNonce: nonce-site-alias';
    const signature = await account.signMessage({ message });
    const payload = {
      session_id: 'session-site-alias',
      wallet_network: 'ethereum',
      wallet_address: account.address,
      wallet_signature: signature,
      wallet_message: message,
    };

    const response = await handleRequest(
      await signedWalletRequest(payload, '/plugin/site/auth/wallet/verify'),
      env as never,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(true);
  });
});

async function signedWalletRequest(
  payload: Record<string, unknown>,
  path = '/plugin/wp/auth/wallet/verify',
): Promise<Request> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.WP_PLUGIN_SHARED_SECRET, `${timestamp}.${body}`);

  return new Request(`https://api.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-plugin-timestamp': String(timestamp),
      'x-plugin-signature': signature,
    },
    body,
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
