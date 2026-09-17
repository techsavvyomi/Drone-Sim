import { createCipheriv, randomBytes } from 'node:crypto';
import type { Plugin } from 'vite';
import {
  PROTECTED_IV_BYTES,
  PROTECTED_MAGIC,
  isProtectedPath,
} from '../src/shared/protectedAssets';

// Encrypts the 3D models in a production renderer build.
//
// Runs only for `vite build` (which is what `npm run package` and `npm run make`
// do), never for `npm start`, so development keeps reading plain files. The key
// is new for every build; `protectedAssetDefines` compiles it into the app.

export interface AssetKey {
  /** The AES-256 key. */
  key: Buffer;
  /** Two halves that XOR to the key, compiled into the renderer. */
  halves: [string, string];
}

export function newAssetKey(): AssetKey {
  const key = randomBytes(32);
  const mask = randomBytes(32);
  const other = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) other[i] = key[i] ^ mask[i];
  return { key, halves: [mask.toString('hex'), other.toString('hex')] };
}

export function encryptProtected(plain: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(PROTECTED_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from(PROTECTED_MAGIC, 'ascii'), iv, body]);
}

/** Values for Vite's `define`: empty halves mean "nothing is encrypted". */
export function protectedAssetDefines(assetKey: AssetKey | null): Record<string, string> {
  return {
    __ASSET_KEY_A__: JSON.stringify(assetKey ? assetKey.halves[0] : ''),
    __ASSET_KEY_B__: JSON.stringify(assetKey ? assetKey.halves[1] : ''),
  };
}

export function protectAssets(assetKey: AssetKey): Plugin {
  return {
    name: 'dronesim:protect-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let count = 0;
      let bytes = 0;
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !isProtectedPath(file.fileName)) continue;
        const plain = typeof file.source === 'string' ? Buffer.from(file.source) : file.source;
        file.source = encryptProtected(plain, assetKey.key);
        count += 1;
        bytes += plain.byteLength;
      }
      this.info(`encrypted ${count} model(s), ${(bytes / 1048576).toFixed(1)} MB`);
    },
  };
}
