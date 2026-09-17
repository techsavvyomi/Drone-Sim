// The file format of an encrypted 3D model, shared by the build step that
// writes it (vite-plugins/protect-assets.ts) and the app that reads it
// (src/renderer/assets/protectedModels.ts).
//
//   bytes 0-7    magic "DSIMENC1"
//   bytes 8-19   AES-GCM initialisation vector (12 bytes, random per file)
//   bytes 20-    AES-256-GCM ciphertext followed by its 16-byte auth tag
//
// The key is generated fresh for every production build and compiled into the
// app in two halves (see `joinKey`). This is protection against copying, not a
// secret from a determined reverse-engineer: the app has to be able to decrypt
// its own models. What it stops is someone unpacking app.asar and opening the
// models in Blender.

export const PROTECTED_MAGIC = 'DSIMENC1';
export const PROTECTED_IV_BYTES = 12;
export const PROTECTED_HEADER_BYTES = PROTECTED_MAGIC.length + PROTECTED_IV_BYTES;

/** Extensions encrypted at build time. */
export const PROTECTED_EXTENSIONS = ['.glb'];

export function isProtectedPath(url: string): boolean {
  const path = url.split(/[?#]/)[0].toLowerCase();
  return PROTECTED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function hasProtectedMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PROTECTED_HEADER_BYTES) return false;
  for (let i = 0; i < PROTECTED_MAGIC.length; i++) {
    if (bytes[i] !== PROTECTED_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** The key is shipped as two random-looking halves XORed together. */
export function joinKey(aHex: string, bHex: string): Uint8Array {
  const out = new Uint8Array(aHex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(aHex.substr(i * 2, 2), 16) ^ parseInt(bHex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Decrypt a protected file with WebCrypto (browser and Node both have it). */
export async function decryptProtected(data: ArrayBuffer, rawKey: Uint8Array): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  if (!hasProtectedMagic(bytes)) return data;
  const iv = bytes.slice(PROTECTED_MAGIC.length, PROTECTED_HEADER_BYTES);
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(PROTECTED_HEADER_BYTES));
}
