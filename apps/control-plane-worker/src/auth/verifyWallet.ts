import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { getAddress, isAddress, recoverMessageAddress } from 'viem';

export type WalletNetwork = 'ethereum' | 'solana';

export interface WalletVerifyPayload {
  wallet_address: string;
  wallet_signature: string;
  wallet_message: string;
  wallet_network?: string;
}

export interface WalletVerifySuccess {
  ok: true;
  walletAddress: string;
  walletNetwork: WalletNetwork;
}

export interface WalletVerifyError {
  ok: false;
  status: number;
  error: string;
}

export function normalizeWalletNetwork(raw: unknown): WalletNetwork {
  const network = String(raw ?? '')
    .trim()
    .toLowerCase();
  return network === 'solana' ? 'solana' : 'ethereum';
}

export async function verifyWalletChallenge(
  payload: WalletVerifyPayload,
): Promise<WalletVerifySuccess | WalletVerifyError> {
  const walletAddress = payload.wallet_address?.trim() ?? '';
  const signature = payload.wallet_signature?.trim() ?? '';
  const message = payload.wallet_message ?? '';
  const walletNetwork = normalizeWalletNetwork(payload.wallet_network);

  if (!walletAddress) {
    return { ok: false, status: 400, error: 'missing_wallet_address' };
  }

  if (!signature) {
    return { ok: false, status: 400, error: 'missing_wallet_signature' };
  }

  if (message === '') {
    return { ok: false, status: 400, error: 'missing_wallet_message' };
  }

  if (walletNetwork === 'solana') {
    return verifySolana(walletAddress, signature, message);
  }

  return verifyEthereum(walletAddress, signature, message);
}

async function verifyEthereum(
  walletAddress: string,
  signature: string,
  message: string,
): Promise<WalletVerifySuccess | WalletVerifyError> {
  if (!isAddress(walletAddress)) {
    return { ok: false, status: 400, error: 'invalid_wallet_address' };
  }

  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, status: 400, error: 'invalid_wallet_signature_format' };
  }

  let recoveredAddress: string;
  try {
    recoveredAddress = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, status: 401, error: 'invalid_wallet_signature' };
  }

  const expected = getAddress(walletAddress);
  const recovered = getAddress(recoveredAddress);
  if (expected !== recovered) {
    return { ok: false, status: 401, error: 'wallet_signature_mismatch' };
  }

  return {
    ok: true,
    walletAddress: expected,
    walletNetwork: 'ethereum',
  };
}

function verifySolana(
  walletAddress: string,
  signature: string,
  message: string,
): WalletVerifySuccess | WalletVerifyError {
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = bs58.decode(walletAddress);
  } catch {
    return { ok: false, status: 400, error: 'invalid_wallet_address' };
  }

  if (publicKeyBytes.length !== 32) {
    return { ok: false, status: 400, error: 'invalid_wallet_address' };
  }

  const signatureBytes = decodeWalletSignature(signature);
  if (!signatureBytes || signatureBytes.length !== 64) {
    return { ok: false, status: 400, error: 'invalid_wallet_signature_format' };
  }

  const verified = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signatureBytes,
    publicKeyBytes,
  );

  if (!verified) {
    return { ok: false, status: 401, error: 'wallet_signature_mismatch' };
  }

  return {
    ok: true,
    walletAddress: bs58.encode(publicKeyBytes),
    walletNetwork: 'solana',
  };
}

function decodeWalletSignature(raw: string): Uint8Array | null {
  const signature = raw.trim();
  if (signature === '') {
    return null;
  }

  if (signature.toLowerCase().startsWith('base64:')) {
    return decodeBase64(signature.slice('base64:'.length));
  }

  if (signature.startsWith('0x')) {
    return decodeHex(signature.slice(2));
  }

  if (/[+/=]/.test(signature)) {
    return decodeBase64(signature);
  }

  try {
    return bs58.decode(signature);
  } catch {
    return decodeBase64(signature);
  }
}

function decodeHex(input: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(input) || input.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(input.length / 2);
  for (let index = 0; index < input.length; index += 2) {
    bytes[index / 2] = Number.parseInt(input.slice(index, index + 2), 16);
  }
  return bytes;
}

function decodeBase64(input: string): Uint8Array | null {
  const normalized = input.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    return null;
  }

  try {
    const decoded = atob(normalized);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
