/**
 * Optimizes a drone CAD export for realtime use while keeping the propellers as
 * separate, animatable nodes.
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
 * Which nodes are propellers differs per model, so there are two ways to say it:
 *
 *   --props=<pattern>          regex matched against node names (default:
 *                              "propeller", which is how the PlutoX names them)
 *   --props=A,B,C,D            explicit node names, when the export gives the
 *                              props no distinguishing name of their own
 *
 * The explicit form is what the Pluto Guru needs: its four props are leaf
 * `Body1.0xx` meshes, and the only nodes named "…Propeller…" are two group
 * wrappers holding *two* props each — tagging those yields 2 spinning pairs
 * instead of 4 independent props.
 *
 * Only the outermost tagged node becomes a pivot at runtime; its descendants
 * merely keep their names so `join` leaves the subtree intact.
 *
 * Usage: node scripts/prepare-drone-model.mjs <input.glb> <output.glb> [--props=...]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, weld, simplify, prune, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const argv = process.argv.slice(2);
const [input, output] = argv.filter((a) => !a.startsWith('--'));
const propsArg = argv.find((a) => a.startsWith('--props='))?.slice('--props='.length);
if (!input || !output) {
  console.error(
    'usage: prepare-drone-model.mjs <input.glb> <output.glb> [--props=<regex>|<name,name,...>]',
  );
  process.exit(1);
}

/** Prefix the runtime looks for. */
const PROP_PREFIX = 'PROP_';

// A comma means "these exact node names"; anything else is a regex.
const explicit = propsArg?.includes(',') ? propsArg.split(',').map((s) => s.trim()) : null;
const pattern = explicit ? null : new RegExp(propsArg || 'propeller', 'i');
const isPropRoot = (name) => (explicit ? explicit.includes(name) : pattern.test(name));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// Find the prop roots first, then protect their whole subtree. Nesting matters:
// a node inside an already-matched prop is part of that prop, not a new one.
const nodes = root.listNodes();
const parents = new Map();
for (const n of nodes) for (const c of n.listChildren()) parents.set(c, n);
const hasPropAncestor = (n) => {
  for (let p = parents.get(n); p; p = parents.get(p)) {
    if (isPropRoot(p.getName() || '')) return true;
  }
  return false;
};

const propRoots = nodes.filter((n) => isPropRoot(n.getName() || '') && !hasPropAncestor(n));
if (explicit) {
  const missing = explicit.filter((name) => !nodes.some((n) => n.getName() === name));
  if (missing.length) {
    console.error(`error: node(s) not found in ${input}: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Everything under a prop root keeps its name so `join` can't merge the subtree
// into the airframe; the root itself gets the tag the runtime pivots on.
const keep = new Set();
propRoots.forEach((node, i) => {
  node.traverse((o) => keep.add(o));
  keep.add(node);
  node.setName(`${PROP_PREFIX}${i}`);
});

let part = 0;
for (const node of nodes) {
  if (!keep.has(node)) node.setName('');
  else if (!node.getName()) node.setName(`${PROP_PREFIX}part${part++}`);
}
// A mesh reachable from a prop node must stay named too — an unnamed mesh is
// fair game for the join pass even when its node is protected.
const keptMeshes = new Set([...keep].map((n) => n.getMesh()).filter(Boolean));
for (const mesh of root.listMeshes()) {
  if (keptMeshes.has(mesh)) {
    if (!mesh.getName()) mesh.setName(`${PROP_PREFIX}mesh`);
  } else {
    mesh.setName('');
  }
}

console.log(`tagged ${propRoots.length} propeller nodes (${keep.size} nodes kept)`);
if (propRoots.length !== 4) {
  console.warn(
    `warning: expected 4 propellers, tagged ${propRoots.length} — the runtime needs one pivot per motor`,
  );
}

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
