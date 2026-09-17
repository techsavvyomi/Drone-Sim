import { decryptProtected, isProtectedPath, joinKey } from '@shared/protectedAssets';

// Reading the encrypted 3D models of a packaged build.
//
// Every model in the app is loaded by three.js's GLTFLoader, which fetches the
// file with `fetch`. Wrapping `fetch` for .glb URLs, once, before anything
// loads, decrypts them all without touching a single loading call site: a new
// model is protected by being a .glb, not by someone remembering to use a
// special loader.
//
// In development the key halves are empty and this installs nothing.

declare const __ASSET_KEY_A__: string;
declare const __ASSET_KEY_B__: string;

export function installProtectedModelLoader(
  target: { fetch: typeof fetch } = window,
  halves: [string, string] = [__ASSET_KEY_A__, __ASSET_KEY_B__],
): boolean {
  if (!halves[0] || !halves[1]) return false;
  const key = joinKey(halves[0], halves[1]);
  const original = target.fetch.bind(target);

  target.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isProtectedPath(url)) return original(input, init);

    const res = await original(input, init);
    // A file:// response reports status 0; anything else that is not OK is
    // passed through for the loader to report as it always would.
    if (!res.ok && res.status !== 0) return res;
    const plain = await decryptProtected(await res.arrayBuffer(), key);
    return new Response(plain, {
      status: 200,
      headers: { 'Content-Type': 'model/gltf-binary', 'Content-Length': String(plain.byteLength) },
    });
  };
  return true;
}
