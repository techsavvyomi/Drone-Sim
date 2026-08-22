import {
  ACADEMY_PAD,
  ACADEMY_PAD_R,
  ACADEMY_PADS,
  academyGate,
  academyMarker,
} from '../../plugins/environments/droneAcademy';
import type { Checkpoint } from './types';

// ----------------------------------------------------------------------------
// The academy arena, as Flight School names it.
//
// Every lesson flies things that are already standing in the arena: the six
// racing gates, the four painted landing pads, the ring of white markers around
// the helipad. Nothing here creates scenery — it only names what is already
// there, so a lesson can say "the blue gate" and the route guide can light up
// that gate.
//
// One arena, fourteen objectives. That is the whole idea: the same field should
// feel like it is getting harder, not like fourteen maps.
// ----------------------------------------------------------------------------

/** Height the auto take-off settles at — where every lesson begins, in world Y. */
export const HOVER = 1.8;

/**
 * A racing gate as a checkpoint.
 *
 * The same gate serves two standards, which is what the options pick between.
 * `ease` widens the acceptance sphere for the teaching lessons: Module 2 asks
 * the pilot to get TO the blue gate and stop on it. `through` says the gate is
 * a hole to pass, not a place to arrive — the navigation modules fly it
 * properly, and the demonstration lines up on its axis and carries on out the
 * far side instead of parking inside the frame.
 */
export function gate(
  id: string,
  label: string,
  opts: { ease?: number; through?: boolean } = {},
): Checkpoint {
  const g = academyGate(id);
  // Every gate is modelled facing local +Z — the torus hole and the square
  // frame both open along it — so its world axis is that vector turned by the
  // gate's yaw. The small roll the arena gives some gates tilts the frame in
  // its own plane and leaves the axis where it is, so only yaw matters here.
  const yaw = g.rotation?.[1] ?? 0;
  return {
    label,
    at: g.position,
    // Half the opening, kept inside the frame so a pass that clips an upright
    // does not read as a clean one.
    reach: g.size * 0.45 * (opts.ease ?? 1),
    mark: 'gate',
    markSize: g.size,
    color: g.color,
    axis: opts.through ? [Math.sin(yaw), 0, Math.cos(yaw)] : undefined,
  };
}

/** A painted precision landing pad, as a checkpoint at flying height. */
export function pad(label: string, opts: { height?: number } = {}): Checkpoint {
  const p = ACADEMY_PADS.find((q) => q.label === label);
  if (!p) throw new Error(`Unknown academy pad: ${label}`);
  return {
    label,
    at: [p.position[0], opts.height ?? HOVER, p.position[2]],
    reach: 2.2,
    mark: 'pad',
    markSize: ACADEMY_PAD_R,
    color: p.color,
  };
}

/**
 * One of the white markers ringing the helipad.
 *
 * `index` counts round from the marker straight out to the RIGHT of the "H".
 * They are level with the pad, evenly spaced and close in, which is what makes
 * them the natural targets for the stick lessons and the shape circuits: the
 * exercise stays about the control, not about the distance.
 */
export function marker(index: number, label: string, opts: { height?: number } = {}): Checkpoint {
  const [x, z] = academyMarker(index);
  return {
    label,
    at: [x, opts.height ?? HOVER, z],
    reach: 1.8,
    mark: 'marker',
    markSize: 0.9,
    color: '#e2e8f0',
  };
}

/** The hover point over the painted "H". */
export function home(label = 'H', opts: { height?: number; reach?: number } = {}): Checkpoint {
  return {
    label,
    at: [ACADEMY_PAD.center[0], opts.height ?? HOVER, ACADEMY_PAD.center[1]],
    reach: opts.reach ?? 2.2,
    mark: 'helipad',
    markSize: ACADEMY_PAD.markRadius,
    color: '#34d399',
  };
}

/** How far in front of a gate the demonstration lines up, in metres. */
const LINE_UP = 5;
/** How far past a gate it flies before stopping, in metres. */
const FLY_THROUGH = 4;

type Leg = {
  to: readonly [number, number, number];
  caption: string;
  arrive?: string;
  stick?: number;
  face?: boolean;
  label?: string;
};

/**
 * The checkpoints of a route, as a demo flight plan.
 *
 * A checkpoint with no axis — a pad, a marker, the "H" — is one leg: fly there
 * and stop. A GATE is three quarters of the same thing done twice, because a
 * gate is a hole, not a destination. The planner brakes on whatever point it is
 * given, so a single leg to the gate centre parks the drone inside the frame
 * and the demonstration never shows the pass at all. Instead the gate becomes
 * two legs: stop short of it, lined up on its axis, and then run straight
 * through and out the far side. That is also the flight the lesson is asking
 * the pilot to copy — "line up, then fly through", not "creep up and stop".
 *
 * Which side it lines up on is whichever side the drone is already on, so a
 * route never doubles back through a gate to approach it from the front.
 *
 * `face` turns the whole route into flying rather than crabbing: the drone
 * points at each target before setting off. Navigation lessons want it — the
 * chase camera then looks down the route, the gate is dead ahead through the
 * frame, and the yaw keys those lessons show on screen are actually used. The
 * stick lessons deliberately do not: "roll right" has to read as the drone
 * moving right, not as it turning right.
 */
export function routeLegs(
  route: readonly Checkpoint[],
  captions: readonly { caption: string; arrive?: string }[],
  stick?: number,
  opts: { from?: readonly [number, number, number]; face?: boolean } = {},
): Leg[] {
  let [px, , pz] = opts.from ?? [ACADEMY_PAD.center[0], HOVER, ACADEMY_PAD.center[1]];
  const face = opts.face;
  const legs: Leg[] = [];

  route.forEach((c, i) => {
    const caption = captions[i]?.caption ?? `Fly to ${c.label}`;
    const arrive = captions[i]?.arrive;

    if (!c.axis) {
      legs.push({ to: c.at, caption, arrive, stick, face, label: c.label });
      [px, , pz] = c.at;
      return;
    }

    const [ax, , az] = c.axis;
    const [gx, gy, gz] = c.at;
    // Approach from the side the drone is already on; dot > 0 means the +axis
    // side. Dead on the plane of the gate, take +axis and let the line-up leg
    // sort it out.
    const side = (px - gx) * ax + (pz - gz) * az >= 0 ? 1 : -1;

    legs.push({
      to: [gx + ax * LINE_UP * side, gy, gz + az * LINE_UP * side],
      caption,
      arrive: `Lined up on ${c.label} — hold this line`,
      stick,
      face,
      label: c.label,
    });
    legs.push({
      to: [gx - ax * FLY_THROUGH * side, gy, gz - az * FLY_THROUGH * side],
      caption: `Straight through ${c.label}`,
      arrive,
      stick,
      face,
      label: c.label,
    });
    px = gx - ax * FLY_THROUGH * side;
    pz = gz - az * FLY_THROUGH * side;
  });

  return legs;
}
