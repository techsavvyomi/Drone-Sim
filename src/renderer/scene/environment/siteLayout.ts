// The Construction Site's dimensions, in one place.
//
// ConstructionSiteEnv builds the frame from these, and the missions flown on
// the site place their marks against them. They used to live inside the
// environment component, which would have left a mission copying "3.6" and
// "6" by hand — and a storey height changed in one file and not the other is
// a delivery mark floating in the middle of a floor with nothing saying so.

export const BAY = 6;
export const STOREY = 3.6;
/** Slab levels 0..LEVELS; level 0 is the ground raft, LEVELS is the roof. */
export const LEVELS = 7;
export const SLAB_T = 0.25;
export const COL_W = 0.5;

/** Column grid lines. The frame spans 36 m x 24 m. */
export const XS = [-18, -12, -6, 0, 6, 12, 18];
export const ZS = [-12, -6, 0, 6, 12];
export const HALF_X = 18;
export const HALF_Z = 12;

/**
 * The lift/stair core, one full bay.
 *
 * Deliberately off-centre: it lands on four real column positions, which a
 * centred 6 m shaft could not do on a 6 m grid without a column standing in
 * the middle of its own void.
 */
export const CORE = { x0: -6, x1: 0, z0: -6, z1: 0 };
export const CORE_T = 0.25;

/** Level y of a slab's TOP surface — what you land on. */
export const levelY = (k: number) => k * STOREY;

/** Half-width of the hoarded plot. */
export const SITE_HALF = 58;

/** The welfare cabins — the site office — as [x, z, tier], and their box. */
export const CABINS: readonly (readonly [number, number, number])[] = [
  [44, 6, 0],
  [44, 9.4, 0],
  [44, 6, 1],
];
export const CABIN_SIZE: readonly [number, number, number] = [6, 2.6, 2.8];
/** Centre height of a cabin on a given tier: stacked two high, 2.9 m apart. */
export const cabinY = (tier: number) => 1.4 + tier * 2.9;

/** The muck-away skips, as [x, z, yaw], and their box. */
export const SKIPS: readonly (readonly [number, number, number])[] = [
  [24, 42, 0.2],
  [16, 44, -0.1],
  [-26, 40, 0.9],
];
export const SKIP_SIZE: readonly [number, number, number] = [5.4, 1.7, 2.3];

/** Deterministic PRNG so the site is laid out identically every run. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/**
 * Every infill panel, as built. Deterministic: the same seed lays the same
 * walls every run, which is what lets a mission put a delivery on a floor and
 * a test prove the way in is open.
 */
export const INFILL = infillWalls();
