import { Suspense, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import sitePropsUrl from '../../../assets/models/site_props.opt.glb?url';
import { useSiteMaterials, tiled, PROP_IDS, type SiteMaterials } from './siteMaterials';

// Construction Site — a topped-out concrete frame with no cladding on it yet.
//
// The point of the map is the FRAME: seven storeys of open slab-and-column,
// which is the one thing none of the other environments offer — a building you
// fly THROUGH rather than around. Every bay is 6 m clear and every storey is
// 3.6 m, so there is a flyable lattice from the ground to 25 m with the lift
// core as the only solid obstacle in the middle of it.
//
// Everything here is authored from primitives and instanced. The only loaded
// asset is site_props.opt.glb, which holds the scanned debris; its geometry is
// re-origined so each piece sits on y = 0 centred in XZ, and its materials are
// rebuilt in siteMaterials.ts from the pack's own baked maps.

const DRACO_DECODER_PATH = 'draco/gltf/';

const BAY = 6;
const STOREY = 3.6;
/** Slab levels 0..LEVELS; level 0 is the ground raft, LEVELS is the roof. */
const LEVELS = 7;
const SLAB_T = 0.25;
const COL_W = 0.5;

/** Column grid lines. The frame spans 36 m x 24 m. */
const XS = [-18, -12, -6, 0, 6, 12, 18];
const ZS = [-12, -6, 0, 6, 12];
const HALF_X = 18;
const HALF_Z = 12;

/**
 * The lift/stair core, one full bay.
 *
 * Deliberately off-centre: it lands on four real column positions, which a
 * centred 6 m shaft could not do on a 6 m grid without a column standing in
 * the middle of its own void.
 */
const CORE = { x0: -6, x1: 0, z0: -6, z1: 0 };
const CORE_T = 0.25;

/**
 * Retiles a BoxGeometry's UVs so its texture reads at `metres` per tile.
 *
 * BoxGeometry gives every face the same 0..1 UV square, so a 36 m slab and a
 * 0.5 m column would otherwise show the same texture stretched to completely
 * different scales. `su`/`sv` are the dimensions of the face that actually gets
 * looked at — the top for a slab, the sides for a column or a wall.
 */
function retileBox(geo: THREE.BoxGeometry, su: number, sv: number, metres: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (su / metres), uv.getY(i) * (sv / metres));
  }
  uv.needsUpdate = true;
  return geo;
}

/** Level y of a slab's TOP surface — what you land on. */
const levelY = (k: number) => k * STOREY;

/** Deterministic PRNG so the site is laid out identically every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slab plates for one level, as [cx, cz, sizeX, sizeZ] boxes. */
function slabPlates(k: number): [number, number, number, number][] {
  // Ground raft is solid: the core starts on it rather than through it.
  if (k === 0) return [[0, 0, HALF_X * 2, HALF_Z * 2]];

  // The roof was never finished. Only the northern half of it got poured, so
  // the frame is open to the sky over the other half and the columns up there
  // stand with nothing on top of them.
  if (k === LEVELS) return [[0, 6, HALF_X * 2, 12]];

  // Everything between: a full plate with the core bay left as a void.
  return [
    [0, (CORE.z0 - HALF_Z) / 2, HALF_X * 2, CORE.z0 + HALF_Z],
    [0, (HALF_Z + CORE.z1) / 2, HALF_X * 2, HALF_Z - CORE.z1],
    [(CORE.x0 - HALF_X) / 2, (CORE.z0 + CORE.z1) / 2, CORE.x0 + HALF_X, CORE.z1 - CORE.z0],
    [(HALF_X + CORE.x1) / 2, (CORE.z0 + CORE.z1) / 2, HALF_X - CORE.x1, CORE.z1 - CORE.z0],
  ];
}

/** Perimeter bays that got their blockwork infill, thinning as you go up. */
function infillWalls(): { x: number; y: number; z: number; w: number; h: number; rot: number }[] {
  const rnd = mulberry32(0x51e7);
  const out: { x: number; y: number; z: number; w: number; h: number; rot: number }[] = [];
  const h = STOREY - SLAB_T;

  for (let k = 0; k < LEVELS; k++) {
    // The trade works bottom-up, so the low floors are nearly closed in and the
    // top ones are still bare frame.
    const fill = [0.72, 0.5, 0.28, 0.12, 0.06, 0, 0][k];
    if (fill <= 0) continue;
    const y = levelY(k) + h / 2;

    for (let i = 0; i < XS.length - 1; i++) {
      const cx = (XS[i] + XS[i + 1]) / 2;
      for (const z of [-HALF_Z, HALF_Z]) {
        if (rnd() < fill) out.push({ x: cx, y, z, w: BAY, h, rot: 0 });
      }
    }
    for (let i = 0; i < ZS.length - 1; i++) {
      const cz = (ZS[i] + ZS[i + 1]) / 2;
      for (const x of [-HALF_X, HALF_X]) {
        if (rnd() < fill) out.push({ x, y, z: cz, w: BAY, h, rot: Math.PI / 2 });
      }
    }
  }
  return out;
}

const INFILL = infillWalls();

/** Where every piece of scanned debris sits. */
interface Placement {
  id: string;
  pos: [number, number, number];
  rotY: number;
  tiltX: number;
  tiltZ: number;
  scale: number;
}

const BIG_PROPS = [
  'tgdtfg0da',
  'tfxteboda',
  'uiznce1ga',
  'uknjfevga',
  'ujcgdgifa',
  'ukxkbesqa',
  'ujriaadga',
];
const BEAMS = ['ujymbbdba', 'ukmifdmva', 'ujlkbd1ga', 'ujoqec3ga', 'ujzjee0va'];
const COLUMNS = ['ujkgddqva', 'ukigcctfa', 'ujjmecwba'];
const SMALL = PROP_IDS.filter(
  (id) => !BIG_PROPS.includes(id) && !BEAMS.includes(id) && !COLUMNS.includes(id),
);

const SITE_HALF = 58;
/** How far the visible ground runs past the hoarding. */
const GROUND_HALF = 3000;

/** Is (x,z) inside the building footprint, plus a margin? */
const inFrame = (x: number, z: number, m = 0) =>
  Math.abs(x) < HALF_X + m && Math.abs(z) < HALF_Z + m;

function layOutDebris(): Placement[] {
  const rnd = mulberry32(0xc0ffee);
  const out: Placement[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  const drop = (id: string, x: number, y: number, z: number, flat: boolean, s: number) =>
    out.push({
      id,
      pos: [x, y, z],
      rotY: rnd() * Math.PI * 2,
      // Rubble settles; offcuts lie flat. Only tilt what would actually tip.
      tiltX: flat ? (rnd() - 0.5) * 0.12 : (rnd() - 0.5) * 0.5,
      tiltZ: flat ? (rnd() - 0.5) * 0.12 : (rnd() - 0.5) * 0.5,
      scale: s,
    });

  // Spoil heaps: big piles pushed out to the edges of the plot.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 26 + rnd() * 26;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inFrame(x, z, 4)) continue;
    drop(pick(BIG_PROPS), x, 0, z, true, 0.9 + rnd() * 1.5);
  }

  // Muck raked out around the frame, and a bit of it left on the slabs.
  for (let i = 0; i < 150; i++) {
    const onSlab = rnd() < 0.42;
    const k = onSlab ? Math.floor(rnd() * LEVELS) : 0;
    const x = onSlab ? (rnd() - 0.5) * HALF_X * 2 * 0.94 : (rnd() - 0.5) * SITE_HALF * 1.9;
    const z = onSlab ? (rnd() - 0.5) * HALF_Z * 2 * 0.94 : (rnd() - 0.5) * SITE_HALF * 1.9;
    if (onSlab && x > CORE.x0 && x < CORE.x1 && z > CORE.z0 && z < CORE.z1) continue;
    if (!onSlab && inFrame(x, z) && rnd() < 0.5) continue;
    drop(pick(SMALL), x, onSlab ? levelY(k) : 0, z, true, 0.7 + rnd() * 0.9);
  }

  // Stacked material, squared up the way a site actually stores it.
  const stacks: [number, number, number][] = [
    [-40, 0, -14],
    [-34, Math.PI / 2, 22],
    [38, 0, -26],
  ];
  for (const [sx, rot, sz] of stacks) {
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 5; i++) {
        const id = pick(BEAMS);
        const dx = (i - 2) * 0.55;
        out.push({
          id,
          pos: [sx + Math.cos(rot) * dx, row * 0.36, sz + Math.sin(rot) * dx],
          rotY: rot + (rnd() - 0.5) * 0.05,
          tiltX: 0,
          tiltZ: 0,
          scale: 1,
        });
      }
    }
  }

  // Precast columns lying where the crane left them, plus a few stood upright
  // against the frame.
  for (let i = 0; i < 10; i++) {
    const x = -14 + i * 3.1 + (rnd() - 0.5);
    drop(pick(COLUMNS), x, 0, 30 + (rnd() - 0.5) * 3, false, 1);
    out[out.length - 1].tiltZ = Math.PI / 2 + (rnd() - 0.5) * 0.08;
  }
  for (let i = 0; i < 6; i++) {
    drop(pick(COLUMNS), HALF_X + 1.2, 0, -10 + i * 4 + rnd(), true, 1);
  }

  return out;
}

const DEBRIS = layOutDebris();

/** Lattice tower crane, built from boxes. */
function buildCrane(mat: SiteMaterials): THREE.Group {
  const g = new THREE.Group();
  g.position.set(-42, 0, 26);

  // envMapIntensity matters as much as colour here. The site's scanned
  // materials are held at 0.3 (see TUNING in siteMaterials); anything authored
  // inline at the default 1.0 takes the full sky reflection and reads as white
  // plastic next to them — which is exactly how the crane and the cabins first
  // came out.
  const steel = new THREE.MeshStandardMaterial({
    color: '#a8842a',
    metalness: 0.6,
    roughness: 0.6,
    envMapIntensity: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#3a3d42',
    metalness: 0.65,
    roughness: 0.55,
    envMapIntensity: 0.3,
  });

  const MAST_H = 34;
  const MAST_W = 1.1; // half-width of the mast square
  const CHORD = 0.18;

  // Four corner chords plus horizontal ties every 3 m: enough to read as a
  // lattice from the air without modelling real diagonals.
  const chord = new THREE.BoxGeometry(CHORD, MAST_H, CHORD);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(chord, steel);
      m.position.set(sx * MAST_W, MAST_H / 2, sz * MAST_W);
      m.castShadow = true;
      g.add(m);
    }
  }
  const tieX = new THREE.BoxGeometry(MAST_W * 2, CHORD, CHORD);
  const tieZ = new THREE.BoxGeometry(CHORD, CHORD, MAST_W * 2);
  const ties = new THREE.InstancedMesh(tieX, steel, Math.floor(MAST_H / 3) * 2);
  const tiesZ = new THREE.InstancedMesh(tieZ, steel, Math.floor(MAST_H / 3) * 2);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let y = 3; y < MAST_H; y += 3) {
    for (const sz of [-1, 1]) {
      m4.makeTranslation(0, y, sz * MAST_W);
      ties.setMatrixAt(n, m4);
      m4.makeTranslation(sz * MAST_W, y, 0);
      tiesZ.setMatrixAt(n, m4);
      n++;
    }
  }
  ties.count = tiesZ.count = n;
  g.add(ties, tiesZ);

  // Slewing platform, cab, jib and counter-jib.
  const top = new THREE.Group();
  top.position.y = MAST_H;
  top.rotation.y = -0.6;
  g.add(top);

  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 2.6), dark);
  plat.position.y = 0.35;
  plat.castShadow = true;
  top.add(plat);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.7, 2.0), steel);
  cab.position.set(2.0, 1.5, 0);
  cab.castShadow = true;
  top.add(cab);

  const JIB = 34;
  const jib = new THREE.Mesh(new THREE.BoxGeometry(JIB, 0.9, 1.3), steel);
  jib.position.set(JIB / 2 + 1.5, 1.4, 0);
  jib.castShadow = true;
  top.add(jib);

  const cjib = new THREE.Mesh(new THREE.BoxGeometry(11, 0.8, 1.3), steel);
  cjib.position.set(-6.5, 1.4, 0);
  cjib.castShadow = true;
  top.add(cjib);

  const cwt = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 2.2), dark);
  cwt.position.set(-10.5, 1.8, 0);
  cwt.castShadow = true;
  top.add(cwt);

  // A-frame and pendants, the silhouette that says "tower crane" at distance.
  const aframe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), steel);
  aframe.position.set(0, 4.8, 0);
  top.add(aframe);

  // Hook block on a long fall, parked over the frame.
  const TROLLEY = 22;
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 26, 6), dark);
  rope.position.set(TROLLEY, 1.4 - 13, 0);
  top.add(rope);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), dark);
  hook.position.set(TROLLEY, 1.4 - 26.5, 0);
  hook.castShadow = true;
  top.add(hook);

  // A concrete skip slung under the hook — the reason the crane is there.
  const skip = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 1.6, 12), mat.surface.concrete);
  skip.position.set(TROLLEY, 1.4 - 28, 0);
  skip.castShadow = true;
  top.add(skip);

  return g;
}

/** Site cabins, skips and the rebar-cage stack that fill the rest of the plot. */
function buildSiteFurniture(mat: SiteMaterials): THREE.Group {
  const g = new THREE.Group();
  const cabin = tiled(mat.surface.concrete, 3, 1);
  cabin.color.set('#5b636d');
  cabin.roughness = 0.8;
  cabin.metalness = 0.12;

  const skipMat = tiled(mat.surface.concrete, 2, 1);
  skipMat.color.set('#5c2c17');
  skipMat.roughness = 0.88;
  skipMat.metalness = 0.18;

  // Welfare cabins, stacked two high the way they always are.
  const cabinBox = new THREE.BoxGeometry(6, 2.6, 2.8);
  for (const [x, z, up] of [
    [44, 6, 0],
    [44, 9.4, 0],
    [44, 6, 1],
  ] as [number, number, number][]) {
    const m = new THREE.Mesh(cabinBox, cabin);
    m.position.set(x, 1.4 + up * 2.9, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // Muck-away skips.
  const skipBox = new THREE.BoxGeometry(5.4, 1.7, 2.3);
  for (const [x, z, r] of [
    [24, 42, 0.2],
    [16, 44, -0.1],
    [-26, 40, 0.9],
  ] as [number, number, number][]) {
    const m = new THREE.Mesh(skipBox, skipMat);
    m.position.set(x, 0.85, z);
    m.rotation.y = r;
    m.castShadow = true;
    g.add(m);
  }

  // The next pour: a raft with starter bars, so the site reads as mid-job
  // rather than abandoned.
  const raft = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 14), tiled(mat.surface.rebar, 5, 3.5));
  raft.position.set(-36, 0.2, -34);
  raft.receiveShadow = true;
  g.add(raft);

  const bar = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5);
  const barMat = new THREE.MeshStandardMaterial({
    color: '#5f4530',
    roughness: 0.85,
    metalness: 0.35,
    envMapIntensity: 0.3,
  });
  const bars = new THREE.InstancedMesh(bar, barMat, 180);
  const m4 = new THREE.Matrix4();
  const rnd = mulberry32(7717);
  let n = 0;
  for (let i = 0; i < 180; i++) {
    const x = -45 + (i % 18) * 1.06;
    const z = -40 + Math.floor(i / 18) * 1.3;
    m4.makeTranslation(x + (rnd() - 0.5) * 0.1, 0.95, z + (rnd() - 0.5) * 0.1);
    bars.setMatrixAt(n++, m4);
  }
  bars.count = n;
  g.add(bars);

  return g;
}

function SiteVisual({ env }: { env: EnvironmentSpec }) {
  const gl = useThree((s) => s.gl);
  const maxAniso = gl.capabilities.getMaxAnisotropy();
  const mat = useSiteMaterials(Math.min(8, maxAniso));
  const { scene: propScene } = useGLTF(sitePropsUrl, DRACO_DECODER_PATH);

  const propGeo = useMemo(() => {
    const out: Record<string, THREE.BufferGeometry> = {};
    propScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out[o.name] = (o as THREE.Mesh).geometry;
    });
    return out;
  }, [propScene]);

  const root = useMemo(() => {
    const g = new THREE.Group();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    // --- Ground.
    //
    // It runs to GROUND_HALF, far past the hoarding at SITE_HALF, because a
    // plane that stopped at the fence left the site as a square of concrete
    // floating in the backdrop's flat blue — the "model on a table" look the
    // backdrop plane exists to prevent. At 8 m per tile it is well inside the
    // time preset's fog distance by the time it ends, so the edge is never
    // visible.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
      tiled(mat.surface.ground, (GROUND_HALF * 2) / 8),
    );
    ground.rotation.x = -Math.PI / 2;
    // 3 cm under the raft's top face. Coplanar, they z-fought over the entire
    // 36 x 24 m footprint; the step is far too small to see at any altitude.
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    g.add(ground);

    // --- Frame: slabs.
    // One material per role, tiled by metres so a 36 m plate and a 6 m plate
    // show the same size aggregate.
    const slabMat = tiled(mat.surface.slab, 1);
    const soffit = tiled(mat.surface.concrete, 1);
    for (let k = 0; k <= LEVELS; k++) {
      for (const [cx, cz, sx, sz] of slabPlates(k)) {
        const box = new THREE.Mesh(retileBox(new THREE.BoxGeometry(sx, SLAB_T, sz), sx, sz, 4), [
          soffit,
          soffit,
          slabMat,
          soffit,
          soffit,
          soffit,
        ]);
        box.position.set(cx, levelY(k) - SLAB_T / 2, cz);
        box.castShadow = k > 0;
        box.receiveShadow = true;
        g.add(box);
      }
    }

    // --- Frame: columns, one instanced mesh for the whole building.
    const colH = STOREY - SLAB_T;
    const colGeo = retileBox(new THREE.BoxGeometry(COL_W, colH, COL_W), COL_W, colH, 1.5);

    const colPos: [number, number, number][] = [];
    for (let k = 0; k < LEVELS; k++) {
      for (const x of XS) {
        for (const z of ZS) {
          // Every grid point gets one, the core included: the core is a whole
          // bay, so its walls run BETWEEN columns and never displace one.
          colPos.push([x, levelY(k) + colH / 2, z]);
        }
      }
    }
    // Stub columns standing proud of the unfinished roof.
    for (const x of XS) {
      for (const z of ZS) {
        if (z < 0) colPos.push([x, levelY(LEVELS) + 1.1, z]);
      }
    }
    const cols = new THREE.InstancedMesh(colGeo, tiled(mat.surface.concrete, 1, 1), colPos.length);
    colPos.forEach((p, i) => cols.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
    cols.castShadow = true;
    cols.receiveShadow = true;
    cols.instanceMatrix.needsUpdate = true;
    g.add(cols);

    // --- Core walls, full height, with a doorway on the open side each level.
    const coreMat = tiled(mat.surface.concrete, 1, 1);
    const coreH = levelY(LEVELS);
    const cw = CORE.x1 - CORE.x0;
    const cd = CORE.z1 - CORE.z0;
    const cxm = (CORE.x0 + CORE.x1) / 2;
    const czm = (CORE.z0 + CORE.z1) / 2;
    for (const [px, pz, sx, sz] of [
      [cxm, CORE.z0, cw, CORE_T],
      [cxm, CORE.z1, cw, CORE_T],
      [CORE.x0, czm, CORE_T, cd],
    ] as [number, number, number, number][]) {
      const face = Math.max(sx, sz);
      const w = new THREE.Mesh(
        retileBox(new THREE.BoxGeometry(sx, coreH, sz), face, coreH, 2.5),
        coreMat,
      );
      w.position.set(px, coreH / 2, pz);
      w.castShadow = true;
      w.receiveShadow = true;
      g.add(w);
    }
    // The +X face is the one you can fly in through: solid except for a 2.2 m
    // opening at every level.
    for (let k = 0; k < LEVELS; k++) {
      const y0 = levelY(k);
      const pier = new THREE.Mesh(
        retileBox(new THREE.BoxGeometry(CORE_T, STOREY - 2.2, cd), cd, STOREY - 2.2, 2.5),
        coreMat,
      );
      pier.position.set(CORE.x1, y0 + 2.2 + (STOREY - 2.2) / 2 - SLAB_T / 2, czm);
      pier.castShadow = true;
      g.add(pier);
      for (const sz of [-1, 1]) {
        const jamb = new THREE.Mesh(
          retileBox(new THREE.BoxGeometry(CORE_T, 2.2, cd / 2 - 0.75), cd / 2 - 0.75, 2.2, 2.5),
          coreMat,
        );
        jamb.position.set(CORE.x1, y0 + 1.1, czm + sz * (cd / 4 + 0.375));
        g.add(jamb);
      }
    }

    // --- Blockwork infill.
    const blockMat = tiled(mat.surface.block, 1, 1);
    const infillGeo = retileBox(
      new THREE.BoxGeometry(BAY, STOREY - SLAB_T, 0.2),
      BAY,
      STOREY - SLAB_T,
      2,
    );
    const infill = new THREE.InstancedMesh(infillGeo, blockMat, INFILL.length);
    INFILL.forEach((w, i) => {
      e.set(0, w.rot, 0);
      q.setFromEuler(e);
      infill.setMatrixAt(i, m4.compose(v.set(w.x, w.y, w.z), q, one));
    });
    infill.castShadow = true;
    infill.receiveShadow = true;
    infill.instanceMatrix.needsUpdate = true;
    g.add(infill);

    // --- Scanned debris, one instanced mesh per prop type.
    const byId = new Map<string, Placement[]>();
    for (const p of DEBRIS) {
      if (!propGeo[p.id] || !mat.prop[p.id]) continue;
      const list = byId.get(p.id) ?? [];
      list.push(p);
      byId.set(p.id, list);
    }
    for (const [id, list] of byId) {
      const im = new THREE.InstancedMesh(propGeo[id], mat.prop[id], list.length);
      list.forEach((p, i) => {
        e.set(p.tiltX, p.rotY, p.tiltZ);
        q.setFromEuler(e);
        im.setMatrixAt(i, m4.compose(v.set(...p.pos), q, v.clone().set(p.scale, p.scale, p.scale)));
      });
      // Debris never casts: 200-odd extra shadow casters buys nothing at the
      // altitudes this map is flown at, and costs a full extra pass over them.
      im.castShadow = false;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = true;
      g.add(im);
    }

    g.add(buildCrane(mat), buildSiteFurniture(mat));

    // --- Hoarding: the site boundary you can see, matching the collider walls.
    const panel = new THREE.BoxGeometry(3, 2.4, 0.08);
    const hoardMat = new THREE.MeshStandardMaterial({
      color: '#20395a',
      roughness: 0.85,
      envMapIntensity: 0.3,
    });
    const perSide = Math.floor((SITE_HALF * 2) / 3);
    const hoard = new THREE.InstancedMesh(panel, hoardMat, perSide * 4);
    let h = 0;
    for (let i = 0; i < perSide; i++) {
      const t = -SITE_HALF + 1.5 + i * 3;
      for (const s of [-1, 1]) {
        m4.makeTranslation(t, 1.2, s * SITE_HALF);
        hoard.setMatrixAt(h++, m4);
        e.set(0, Math.PI / 2, 0);
        q.setFromEuler(e);
        hoard.setMatrixAt(h++, m4.compose(v.set(s * SITE_HALF, 1.2, t), q, one));
      }
    }
    hoard.count = h;
    hoard.castShadow = false;
    hoard.receiveShadow = true;
    g.add(hoard);

    // Static: nothing in this map moves, so stop three re-deriving matrices.
    g.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    g.updateMatrixWorld(true);
    return g;
  }, [mat, propGeo]);

  void env;
  return <primitive object={root} />;
}

/**
 * Analytic colliders for the whole site: no trimesh anywhere.
 *
 * The frame is the only map in the game you can fly inside, so its physics has
 * to be exact — a convex-hull or trimesh approximation of a slab-and-column
 * lattice would either seal the bays shut or leave the columns passable.
 */
function SiteColliders({ env }: { env: EnvironmentSpec }) {
  const ceiling = env.bounds.max[1];
  const colH = STOREY - SLAB_T;

  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Ground */}
      <CuboidCollider args={[SITE_HALF, 0.5, SITE_HALF]} position={[0, -0.5, 0]} friction={0.9} />

      {/* Slabs */}
      {Array.from({ length: LEVELS + 1 }, (_, k) =>
        slabPlates(k).map(([cx, cz, sx, sz], i) => (
          <CuboidCollider
            key={`s${k}-${i}`}
            args={[sx / 2, SLAB_T / 2, sz / 2]}
            position={[cx, levelY(k) - SLAB_T / 2, cz]}
            friction={0.8}
          />
        )),
      )}

      {/* Columns */}
      {Array.from({ length: LEVELS }, (_, k) =>
        XS.map((x) =>
          ZS.map((z) => (
            <CuboidCollider
              key={`c${k}-${x}-${z}`}
              args={[COL_W / 2, colH / 2, COL_W / 2]}
              position={[x, levelY(k) + colH / 2, z]}
              friction={0.3}
            />
          )),
        ),
      )}

      {/* Core: three solid walls, and the fourth built around its doorways. */}
      <CuboidCollider
        args={[(CORE.x1 - CORE.x0) / 2, levelY(LEVELS) / 2, CORE_T / 2]}
        position={[(CORE.x0 + CORE.x1) / 2, levelY(LEVELS) / 2, CORE.z0]}
      />
      <CuboidCollider
        args={[(CORE.x1 - CORE.x0) / 2, levelY(LEVELS) / 2, CORE_T / 2]}
        position={[(CORE.x0 + CORE.x1) / 2, levelY(LEVELS) / 2, CORE.z1]}
      />
      <CuboidCollider
        args={[CORE_T / 2, levelY(LEVELS) / 2, (CORE.z1 - CORE.z0) / 2]}
        position={[CORE.x0, levelY(LEVELS) / 2, (CORE.z0 + CORE.z1) / 2]}
      />
      {Array.from({ length: LEVELS }, (_, k) => {
        const y0 = levelY(k);
        const cd = CORE.z1 - CORE.z0;
        const czm = (CORE.z0 + CORE.z1) / 2;
        return (
          <group key={`core${k}`}>
            <CuboidCollider
              args={[CORE_T / 2, (STOREY - 2.2) / 2, cd / 2]}
              position={[CORE.x1, y0 + 2.2 + (STOREY - 2.2) / 2 - SLAB_T / 2, czm]}
            />
            <CuboidCollider
              args={[CORE_T / 2, 1.1, cd / 4 - 0.375]}
              position={[CORE.x1, y0 + 1.1, czm - (cd / 4 + 0.375)]}
            />
            <CuboidCollider
              args={[CORE_T / 2, 1.1, cd / 4 - 0.375]}
              position={[CORE.x1, y0 + 1.1, czm + (cd / 4 + 0.375)]}
            />
          </group>
        );
      })}

      {/* Blockwork infill */}
      {INFILL.map((w, i) => (
        <CuboidCollider
          key={`i${i}`}
          args={[w.w / 2, w.h / 2, 0.1]}
          position={[w.x, w.y, w.z]}
          rotation={[0, w.rot, 0]}
        />
      ))}

      {/* Crane mast: one box round the lattice, so it stops the drone rather
          than letting it thread between four 18 cm chords. */}
      <CuboidCollider args={[1.3, 17, 1.3]} position={[-42, 17, 26]} />

      {/* Site boundary. Visible hoarding is 2.4 m, but the collider runs to the
          ceiling for the same reason the Arena's does: above the panel there
          would otherwise be nothing but the positional clamp, which grades a
          hit harder than a real wall contact. */}
      {(
        [
          [0, SITE_HALF, SITE_HALF, 0.2],
          [0, -SITE_HALF, SITE_HALF, 0.2],
          [SITE_HALF, 0, 0.2, SITE_HALF],
          [-SITE_HALF, 0, 0.2, SITE_HALF],
        ] as [number, number, number, number][]
      ).map(([x, z, hx, hz], i) => (
        <CuboidCollider
          key={`b${i}`}
          args={[hx, ceiling / 2, hz]}
          position={[x, ceiling / 2, z]}
          friction={0.05}
          restitution={0}
        />
      ))}
    </RigidBody>
  );
}

useGLTF.preload(sitePropsUrl, DRACO_DECODER_PATH);

export function ConstructionSiteEnv({ env }: { env: EnvironmentSpec }) {
  return (
    <group name="construction-site-environment">
      <SiteColliders env={env} />

      <Suspense fallback={null}>
        <SiteVisual env={env} />
      </Suspense>
    </group>
  );
}
