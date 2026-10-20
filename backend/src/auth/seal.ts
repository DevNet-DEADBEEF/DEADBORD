/**
 * Sealed tokens: JSON encrypted and authenticated with AUTH_SECRET
 * (AES-256-GCM), so any backend instance can open what another sealed
 * without shared storage. Used for OAuth state and login challenges.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function seal<T extends { expires: number }>(value: T, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Returns undefined for tampered, foreign or expired tokens. */
export function unseal<T extends { expires: number }>(sealed: string, secret: Buffer): T | undefined {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()) as T;
    return value.expires > Date.now() ? value : undefined;
  } catch {
    return undefined;
  }
}
