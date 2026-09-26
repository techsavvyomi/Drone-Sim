/**
 * Optimizes the Re-Volt 3 "Supermarket" Sketchfab export into supermarket.opt.glb.
 *
 * Two things in the export must not reach the game:
 *   - `sky_m165mat` — a 2,900-unit sky sphere. The outdoor sky is procedural, and
 *     a sphere that size also blows out every bounding box measured off the file.
 *   - `EZ_Col` / `NM_Col` / `HD_Col` — the racing game's per-difficulty collision
 *     hulls, drawn with alpha 0. Invisible, but they would still be draw calls,
 *     and they hang below the floor (y −26) and above the roof (y 88).
 *
 * Everything else is joined by material (879 meshes → a handful of draw calls),
 * welded, Draco-compressed, and its textures capped at 1024² WebP — the target
 * is a 512 MB-VRAM integrated GPU.
 *
 * Usage: node scripts/prepare-supermarket-model.mjs <input.glb> <output.opt.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  draco,
  flatten,
  join,
  prune,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/prepare-supermarket-model.mjs <input.glb> <output.opt.glb>');
  process.exit(1);
}

const DROP = /^sky_|_Col_\d+__\d+$/;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

const doc = await io.read(input);
let dropped = 0;
for (const node of doc.getRoot().listNodes()) {
  if (DROP.test(node.getName())) {
    node.dispose();
    dropped++;
  }
}

await doc.transform(
  prune(),
  dedup(),
  flatten(),
  join(),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  prune(),
  draco(),
);

await io.write(output, doc);
const meshes = doc.getRoot().listMeshes().length;
console.log(`dropped ${dropped} nodes; ${meshes} meshes written to ${output}`);
