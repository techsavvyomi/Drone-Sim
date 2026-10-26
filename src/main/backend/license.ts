import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import type { LicensePayload, SignedLicense } from '@shared/backend/contract';

// The license's signature check and the clock record's seal. Main process only.
//
// The backend signs each license with a private key that never leaves the
// Apps Script project (the LICENSE_PRIVATE_KEY Script Property). The app ships
// with the matching public key below, so it can check a license offline but
// never make one: a date edited on this computer breaks the signature.
//
// Replacing the key pair means a new public key here AND the new private key
// in the script; every license already handed out then fails the check until
// the app has fetched a fresh one online.

export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqPGv93zAX4asnnlUnYL2
NjSMcbIZx3MyC9IIKWgNu6lxlKHZg2ZZpE/+A9S7hsynmql85l9odJAkz+uNlJvd
xEgnqEsRcge4iR8M9PzxCOV0xa0luxhp/PCxB9fUWjMH65R5ZkMf9ZYd2RF/vOKC
BNYZASlyaZasPT9a/xPx2vxhpvk0LVPehpjUQz2ldL+eQvJKUGqXdB+2Zz1JFOee
GXkLp8/GJcfUjfAV1QZ6atMXu4U0G5W1A0Omf3oWXxo24UIvjoYtVpscUSewwqqC
4ZKn6eznKd6v3JqUtqIKx12w0vgEtj1SMrV/81YxseMeZT2Bd2nA3C73BE3+8/9v
fwIDAQAB
-----END PUBLIC KEY-----
`;

const TYPES = ['TRIAL', 'ANNUAL', 'LIFETIME'];

/** The license's contents when the signature is good and the shape is right; otherwise null. */
export function verifyLicense(
  signed: SignedLicense | null | undefined,
  publicKey: string,
): LicensePayload | null {
  if (!signed || typeof signed.payload !== 'string' || !signed.signature) return null;
  try {
    const ok = createVerify('RSA-SHA256')
      .update(signed.payload, 'utf8')
      .verify(publicKey, signed.signature, 'base64');
    if (!ok) return null;
    const p = JSON.parse(signed.payload) as LicensePayload;
    const valid =
      p?.v === 1 &&
      typeof p.userId === 'string' &&
      typeof p.deviceId === 'string' &&
      TYPES.includes(p.type) &&
      typeof p.issuedAt === 'string' &&
      (p.expiresAt === null || typeof p.expiresAt === 'string');
    return valid ? p : null;
  } catch {
    return null;
  }
}

/**
 * The last time seen, sealed with a secret kept OS-encrypted beside it, so it
 * cannot be edited to an earlier time in the database. Deleting it only falls
 * back to the server's time in the license.
 */
export function sealTime(secret: string, t: number): string {
  return JSON.stringify({ t, mac: createHmac('sha256', secret).update(String(t)).digest('base64') });
}

export function openSealedTime(secret: string, record: string | null): number | null {
  if (!record) return null;
  try {
    const { t, mac } = JSON.parse(record) as { t: number; mac: string };
    if (typeof t !== 'number' || typeof mac !== 'string') return null;
    const expected = createHmac('sha256', secret).update(String(t)).digest();
    const actual = Buffer.from(mac, 'base64');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? t : null;
  } catch {
    return null;
  }
}
