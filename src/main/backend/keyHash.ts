import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// The activation key's offline check. scrypt, built into Node, is slow on
// purpose: the hash in the local database cannot be turned back into the key,
// and guessing keys against it costs real time per guess.

const PARAMS = { N: 16384, r: 8, p: 1 };
const LENGTH = 32;

function derive(key: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(key.trim().toUpperCase(), salt, LENGTH, PARAMS, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

export async function hashKey(key: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  const hash = await derive(key, salt);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

export async function verifyKey(key: string, salt: string, hash: string): Promise<boolean> {
  try {
    const expected = Buffer.from(hash, 'base64');
    const actual = await derive(key, Buffer.from(salt, 'base64'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
