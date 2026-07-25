/**
 * Optimizes the PlutoX CAD export for realtime use while keeping the
 * propellers as separate, animatable nodes.
 *
 * The stock `gltf-transform optimize` merges 3,656 meshes down to ~49 by
 * joining everything that shares a material — which is exactly what we want for
 * the airframe, and exactly what we DON'T want for the props, because a merged
 * prop can't be rotated independently.
 *
 * `join` has a `keepNamed` option that refuses to merge named nodes. Since the
 * CAD export names nearly everything ("Body1.019"), we first blank every name
 * except the propellers — so the body merges freely and the four props survive.
 *
 * Usage: node scripts/prepare-drone-model.mjs <input.glb> <output.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, weld, simplify, prune, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: prepare-drone-model.mjs <input.glb> <output.glb>');
  process.exit(1);
}

/** Nodes whose name matches this are preserved and become spinnable. */
const PROP_PATTERN = /propeller/i;
/** Prefix the runtime looks for. */
const PROP_PREFIX = 'PROP_';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

let props = 0;
for (const node of root.listNodes()) {
  const name = node.getName() || '';
  if (PROP_PATTERN.test(name)) {
    node.setName(`${PROP_PREFIX}${props++}`);
  } else {
    node.setName('');
  }
}
for (const mesh of root.listMeshes()) {
  const name = mesh.getName() || '';
  mesh.setName(PROP_PATTERN.test(name) ? name : '');
}

console.log(`tagged ${props} propeller nodes`);

await doc.transform(
  dedup(),
  // keepNamed keeps the tagged props out of the merge.
  join({ keepNamed: true }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, error: 0.004 }),
  prune(),
  quantize(),
);

await io.write(output, doc);

const after = doc.getRoot();
console.log(
  `meshes: ${after.listMeshes().length}  nodes: ${after.listNodes().length}  ` +
    `props kept: ${after
      .listNodes()
      .filter((n) => (n.getName() || '').startsWith(PROP_PREFIX)).length}`,
);
