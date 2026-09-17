import { describe, expect, it, vi } from 'vitest';
import { decryptProtected, hasProtectedMagic, isProtectedPath, joinKey } from '../src/shared/protectedAssets';
import { encryptProtected, newAssetKey, protectAssets } from '../vite-plugins/protect-assets';
import { installProtectedModelLoader } from '../src/renderer/assets/protectedModels';
import { blockedSwitchIn } from '../src/main/security';

// A packaged build's models are encrypted inside app.asar and decrypted in
// memory. These pin that what the build writes is what the app can read, that
// nothing else is touched, and that a debugger cannot be attached to a
// packaged build from the command line.

const glb = () => {
  const bytes = new Uint8Array(4096);
  bytes.set([0x67, 0x6c, 0x54, 0x46]); // "glTF"
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
  return bytes;
};

describe('model encryption', () => {
  it('round-trips through the build step and the app, with the key in two halves', async () => {
    const assetKey = newAssetKey();
    const plain = glb();
    const sealed = encryptProtected(plain, assetKey.key);

    expect(hasProtectedMagic(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from('glTF'))).toBe(false);
    // Neither half on its own is the key.
    expect(assetKey.halves[0]).not.toBe(assetKey.key.toString('hex'));
    expect(Buffer.from(joinKey(...assetKey.halves)).equals(assetKey.key)).toBe(true);

    const opened = await decryptProtected(
      sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength),
      joinKey(...assetKey.halves),
    );
    expect(new Uint8Array(opened)).toEqual(plain);
  });

  it('refuses a file encrypted by another build, or tampered with', async () => {
    const a = newAssetKey();
    const b = newAssetKey();
    const sealed = encryptProtected(glb(), a.key);
    const buf = () => sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength);
    await expect(decryptProtected(buf(), b.key)).rejects.toThrow();
    const tampered = new Uint8Array(buf());
    tampered[100] ^= 1;
    await expect(decryptProtected(tampered.buffer, a.key)).rejects.toThrow();
  });

  it('passes an unencrypted model straight through', async () => {
    const plain = glb();
    const out = await decryptProtected(plain.buffer, newAssetKey().key);
    expect(new Uint8Array(out)).toEqual(plain);
  });

  it('encrypts .glb assets in the bundle and nothing else', () => {
    const assetKey = newAssetKey();
    const plugin = protectAssets(assetKey) as any;
    const bundle: Record<string, any> = {
      model: { type: 'asset', fileName: 'assets/PlutoX.opt-abc.glb', source: glb() },
      texture: { type: 'asset', fileName: 'assets/pad-abc.png', source: new Uint8Array([1, 2, 3]) },
      code: { type: 'chunk', fileName: 'assets/index-abc.js', code: 'console.log(1)' },
    };
    plugin.generateBundle.call({ info: vi.fn() }, {}, bundle);
    expect(hasProtectedMagic(bundle.model.source)).toBe(true);
    expect(bundle.texture.source).toEqual(new Uint8Array([1, 2, 3]));
    expect(plugin.apply).toBe('build');
  });

  it('recognises model URLs, with or without a query', () => {
    expect(isProtectedPath('file:///app/assets/forest.opt-B03dS8wW.glb')).toBe(true);
    expect(isProtectedPath('./assets/tiger.GLB?v=2')).toBe(true);
    expect(isProtectedPath('./assets/index.js')).toBe(false);
  });
});

describe('the app reading its models', () => {
  const respond = (body: Uint8Array | string, status = 200) =>
    new Response(typeof body === 'string' ? body : Buffer.from(body), { status });

  it('decrypts .glb fetches and leaves every other request alone', async () => {
    const assetKey = newAssetKey();
    const plain = glb();
    const sealed = encryptProtected(plain, assetKey.key);
    const target = {
      fetch: vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('.glb') ? respond(sealed) : respond('{"ok":true}'),
      ) as unknown as typeof fetch,
    };
    expect(installProtectedModelLoader(target, assetKey.halves)).toBe(true);

    const model = await target.fetch('./assets/PlutoX.opt-abc.glb');
    expect(new Uint8Array(await model.arrayBuffer())).toEqual(plain);
    expect(model.headers.get('Content-Type')).toBe('model/gltf-binary');

    const other = await target.fetch('./settings.json');
    expect(await other.json()).toEqual({ ok: true });
  });

  it('passes a failed model request through for the loader to report', async () => {
    const assetKey = newAssetKey();
    const target = { fetch: vi.fn(async () => respond('missing', 404)) as unknown as typeof fetch };
    installProtectedModelLoader(target, assetKey.halves);
    expect((await target.fetch('./assets/gone.glb')).status).toBe(404);
  });

  it('installs nothing in development, where there is no key', () => {
    const original = vi.fn() as unknown as typeof fetch;
    const target = { fetch: original };
    expect(installProtectedModelLoader(target, ['', ''])).toBe(false);
    expect(target.fetch).toBe(original);
  });
});

describe('packaged build lockdown', () => {
  it('spots debugger switches however they are written', () => {
    expect(blockedSwitchIn(['/app/Drone', '--remote-debugging-port=9222'])).toBe('remote-debugging-port');
    expect(blockedSwitchIn(['/app/Drone', '--inspect'])).toBe('inspect');
    expect(blockedSwitchIn(['/app/Drone', '--INSPECT-BRK=9229'])).toBe('inspect-brk');
    expect(blockedSwitchIn(['/app/Drone', '--js-flags=--expose-gc'])).toBe('js-flags');
    expect(blockedSwitchIn(['/app/Drone', '--squirrel-firstrun', 'inspect'])).toBeNull();
  });
});
