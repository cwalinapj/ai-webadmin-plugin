import type { Env } from '../types';

export async function putToR2(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ key: string }> {
  await env.ANCHOR_R2.put(key, body, {
    httpMetadata: {
      contentType,
    },
  });
  return { key };
}

export async function getFromR2(env: Env, key: string): Promise<ArrayBuffer> {
  const object = await env.ANCHOR_R2.get(key);
  if (!object) {
    throw new Error('r2_object_not_found');
  }
  return object.arrayBuffer();
}
