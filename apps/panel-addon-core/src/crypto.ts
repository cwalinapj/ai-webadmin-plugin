function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function buildCanonical(
  timestamp: number,
  nonce: string,
  method: string,
  path: string,
  bodySha256: string,
): string {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${bodySha256}`;
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data =
    typeof input === 'string'
      ? toArrayBuffer(new TextEncoder().encode(input))
      : input instanceof ArrayBuffer
        ? input
        : toArrayBuffer(input);

  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyData),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    toArrayBuffer(new TextEncoder().encode(message)),
  );
  return toHex(new Uint8Array(signature));
}
