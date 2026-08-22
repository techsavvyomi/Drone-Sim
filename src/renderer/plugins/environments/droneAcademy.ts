import type { EnvironmentSpec } from '@shared/types';

// Outdoor drone training academy: helipad, practice arena (gates, slalom,
// precision pads, hover boxes, waypoint towers) and facility scenery.
// The play area is far larger than the indoor arena, so the soft containment
// in the drone entity reads these bounds rather than hard-coded numbers.
export const droneAcademy: EnvironmentSpec = {
  id: 'drone-academy',
  name: 'Drone Academy',
  kind: 'outdoor',
  // Spawn on the painted "H" at the centre of the helipad.
  spawn: { position: [0, 0.2, 0], heading: 0 },
  bounds: { min: [-60, 0, -60], max: [60, 30, 60] },
  // Flat field — a single ground height, so the under-floor rescue applies.
  groundY: 0,
};

/**
 * The helipad at the centre of the academy, shared by the prop that draws it
 * (`scene/environment/props.tsx`) and by Flight School, which runs its lessons
 * on this pad and has to place their props on the pad SURFACE — the slab stands
 * 0.12 m proud of the ground, so anything drawn at y = 0 disappears inside it.
 */
export const ACADEMY_PAD = {
  center: [0, 0] as [number, number],
  /** Slab radius, metres. */
  radius: 7,
  /** Top of the slab in world Y — the height everything on the pad sits at. */
  surfaceY: 0.12,
  /** Radius of the painted white ring around the "H". */
  markRadius: 4.5,
  /** The ring of white perimeter markers: how many, and how far out. Flight
   *  School rolls between two of them, flies a square and a triangle on four
   *  and three of them, and laps the whole ring — so these are lesson geometry
   *  as much as they are scenery. */
  perimeterLights: 16,
  lightRadius: 6.8,
} as const;

// ----------------------------------------------------------------------------
// Arena landmarks.
//
// These were literals inside `scene/environment/AcademyEnv.tsx`, which left
// Flight School no way to refer to the things the pilot can actually see — so
// its lessons drew private pylons and rings beside the arena's own furniture.
// Declared once here instead: the environment renders from these lists and the
// lessons route through them by id. Nothing about the arena moves; this is the
// same six gates and four pads, in the same places.
// ----------------------------------------------------------------------------

const DEG = Math.PI / 180;

export type GateKind = 'square' | 'circle' | 'rect';

export interface AcademyGate {
  id: string;
  /** Centre of the opening in world space — the point to fly THROUGH. */
  position: readonly [number, number, number];
  kind: GateKind;
  color: string;
  /** Height of the opening; `rect` is 1.5x as wide as it is tall. */
  size: number;
  rotation?: readonly [number, number, number];
}

/** The six racing gates, in the order they are drawn. */
export const ACADEMY_GATES: readonly AcademyGate[] = [
  { id: 'blue-near', position: [0, 2.6, -16], kind: 'square', color: '#2f7fff', size: 3.4 },
  {
    id: 'red-right',
    position: [7, 3.2, -24],
    kind: 'circle',
    color: '#ff2b4d',
    size: 3.6,
    rotation: [0, -18 * DEG, 6 * DEG],
  },
  {
    id: 'green-left',
    position: [-7.5, 2.4, -31],
    kind: 'rect',
    color: '#22e06a',
    size: 2.6,
    rotation: [0, 22 * DEG, -8 * DEG],
  },
  {
    id: 'blue-far',
    position: [2.5, 4.4, -39],
    kind: 'square',
    color: '#2f7fff',
    size: 2.8,
    rotation: [0, -8 * DEG, 0],
  },
  {
    id: 'red-left',
    position: [-14, 3.0, -20],
    kind: 'circle',
    color: '#ff2b4d',
    size: 2.8,
    rotation: [0, 40 * DEG, 0],
  },
  {
    id: 'green-right',
    position: [15, 5.0, -33],
    kind: 'rect',
    color: '#22e06a',
    size: 3.0,
    rotation: [0, -32 * DEG, 5 * DEG],
  },
];

/** The four painted precision landing pads down the left-hand side. */
export const ACADEMY_PADS: readonly {
  label: string;
  position: readonly [number, number, number];
  color: string;
}[] = [
  { label: 'A', position: [-16, 0, -6], color: '#3b82f6' },
  { label: 'B', position: [-16, 0, 0], color: '#22c55e' },
  { label: 'C', position: [-16, 0, 6], color: '#f5a524' },
  { label: 'D', position: [-16, 0, 12], color: '#a855f7' },
];

/** Painted radius of one of those pads. */
export const ACADEMY_PAD_R = 1.25;

export function academyGate(id: string): AcademyGate {
  const gate = ACADEMY_GATES.find((g) => g.id === id);
  if (!gate) throw new Error(`Unknown academy gate: ${id}`);
  return gate;
}

export function academyPad(label: string): readonly [number, number, number] {
  const pad = ACADEMY_PADS.find((p) => p.label === label);
  if (!pad) throw new Error(`Unknown academy pad: ${label}`);
  return pad.position;
}

/**
 * World position of one of the helipad's white perimeter markers.
 *
 * `index` counts round from the marker straight out to the RIGHT of the "H"
 * (+X); a quarter of the way round (index 4) is directly behind it.
 */
export function academyMarker(index: number): readonly [number, number] {
  const a = ((index % ACADEMY_PAD.perimeterLights) / ACADEMY_PAD.perimeterLights) * Math.PI * 2;
  return [Math.cos(a) * ACADEMY_PAD.lightRadius, Math.sin(a) * ACADEMY_PAD.lightRadius];
}

