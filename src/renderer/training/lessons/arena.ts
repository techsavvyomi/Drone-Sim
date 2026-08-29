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
 * `ease` widens the acceptance sphere for the teaching lessons: the pitch module
 * asks the pilot to get TO the blue gate and stop on it. `through` says the gate is
 * a hole to pass, not a place to arrive — the navigation modules fly it
 * properly, and the demonstration lines up on its axis and carries on out the
 * far side instead of parking inside the frame.
 *
 * `through` also changes what SCORES it. A sphere big enough to be fair along
 * the line of flight is wider than the frame, so beside the gate counted as
 * through it; a through-gate is judged inside its opening instead (`hole`).
 */
export function gate(
  id: string,
  label: string,
  opts: { ease?: number; through?: boolean; height?: number; tag?: string; orb?: boolean } = {},
): Checkpoint {
  const g = academyGate(id);
  // Every gate is modelled facing local +Z — the torus hole and the square
  // frame both open along it — so its world axis is that vector turned by the
  // gate's yaw. The small roll the arena gives some gates tilts the frame in
  // its own plane and leaves the axis where it is, so only yaw matters here.
  const yaw = g.rotation?.[1] ?? 0;
  return {
    label,
    tag: opts.tag,
    // A ball of light in the opening instead of a letter on it — see
    // `Checkpoint.orb`. Sized off `markSize` by the guide, so a gate asks for
    // one without also having to say how big it should be.
    orb: opts.orb,
    // `height` moves the point the lesson is judged on to the height the pilot
    // will actually be at. A module that shows no throttle keys is flown level
    // in altitude hold, and a checkpoint sitting at the gate's own centre then
    // asks for a climb the pilot has not been taught and cannot see how to make.
    // The opening is tall enough that a level pass still goes through it.
    at: opts.height === undefined ? g.position : [g.position[0], opts.height, g.position[2]],
    // Along the axis, how much of a frame either side of the gate's plane still
    // counts — generous, because a pass a moment early or late is the same pass.
    // Across it, `hole` is the test, and `ease` deliberately does NOT widen that.
    reach: g.size * 0.45 * (opts.ease ?? 1),
    // Half the opening, kept inside the frame so a pass that clips an upright
    // does not read as a clean one. Only a gate the lesson flies THROUGH gets
    // one: a gate used as a destination (Module 5 stops on the blue one) is a
    // place, and a place is a sphere.
    hole: opts.through ? g.size * 0.45 : undefined,
    mark: 'gate',
    markSize: g.size,
    color: g.color,
    axis: opts.through ? [Math.sin(yaw), 0, Math.cos(yaw)] : undefined,
  };
}

/** A painted precision landing pad, as a checkpoint at flying height. */
export function pad(label: string, opts: { height?: number; tag?: string } = {}): Checkpoint {
  const p = ACADEMY_PADS.find((q) => q.label === label);
  if (!p) throw new Error(`Unknown academy pad: ${label}`);
  return {
    label,
    tag: opts.tag,
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
export function marker(
  index: number,
  label: string,
  opts: { height?: number; tag?: string; pillar?: boolean; orb?: boolean } = {},
): Checkpoint {
  const [x, z] = academyMarker(index);
  return {
    label,
    tag: opts.tag,
    // A column of pink light standing on the marker instead of the thin yellow
    // beam — see `Checkpoint.pillar`. Sized off `reach` by the guide, so a
    // corner asks for one without also having to say how wide it should be.
    pillar: opts.pillar,
    // Or a BALL on it instead of a column. Sized off `reach` by the guide, like
    // the pillar is, so a corner asks for one without saying how big it should
    // be — which on a ground checkpoint means the ball IS the acceptance sphere
    // rather than a token floating near it.
    orb: opts.orb,
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

/** How far in front of a gate the demonstration lines up, in metres.
 *
 *  Close enough that the line-up and the pass read as one movement. At 5 m the
 *  drone was stopping a car's length short of every gate, leaning back to do it,
 *  and only then setting off through — two hops where the module is teaching
 *  one. */
const LINE_UP = 3;
/** How far past a gate it coasts before the next leg takes over, in metres. */
const FLY_THROUGH = 4;
/**
 * How square-on an approach has to be for the line-up to be skipped, in degrees.
 *
 * A drone that is already pointing down a gate's axis has nothing to line up
 * with: braking short of it only to set off again through the same hole is the
 * run-up-halt-lean-backwards that #42 exists to get rid of. Within this cone the
 * two legs become one pass. Wider than it, the drone really is arriving from the
 * side and the stop is the manoeuvre — kill the speed, turn onto the axis, then
 * run through.
 */
const ALIGNED_DEG = 15;

type Leg = {
  to: readonly [number, number, number];
  caption: string;
  arrive?: string;
  stick?: number;
  face?: boolean;
  /** Fly THROUGH the target rather than stopping on it. */
  coast?: boolean;
  label?: string;
  /** Index of the checkpoint this leg flies to, for the on-screen step row. */
  stage?: number;
  /** The route cursor once this leg has arrived — only on the leg that finishes
   *  a checkpoint, so the guide can drop its name mid-demonstration. */
  rt?: number;
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
 * Unless it is ALREADY lined up. The first gate of every navigation route sits
 * almost straight ahead of the helipad, so the drone was turning onto it, flying
 * the whole way at it, braking to a dead stop three metres short — leaning
 * backwards to do it — and only then flying through a hole it had been pointing
 * at the entire time. Two hops, a stop and a lean backwards where the module
 * teaches one continuous pass. Inside `ALIGNED_DEG` the line-up is dropped and
 * the gate is flown as a single leg, aimed through the middle of the opening
 * and out the far side.
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
      legs.push({ to: c.at, caption, arrive, stick, face, label: c.label, stage: i, rt: i + 1 });
      [px, , pz] = c.at;
      return;
    }

    const [ax, , az] = c.axis;
    const [gx, gy, gz] = c.at;
    // Approach from the side the drone is already on; dot > 0 means the +axis
    // side. Dead on the plane of the gate, take +axis and let the line-up leg
    // sort it out.
    const side = (px - gx) * ax + (pz - gz) * az >= 0 ? 1 : -1;

    // Is the drone already square-on to the opening? Measured against the
    // direction the pass itself is flown in, which is the axis pointing away
    // from the side the drone is on.
    const [tx, tz] = [gx - px, gz - pz];
    const toGate = Math.hypot(tx, tz);
    const aligned =
      toGate > LINE_UP &&
      ((tx / toGate) * -ax + (tz / toGate) * -az) * side >= Math.cos((ALIGNED_DEG * Math.PI) / 180);

    if (aligned) {
      // One leg, aimed along the line the drone is already on so it passes
      // through the CENTRE of the opening rather than through the axis point
      // three metres short of it, and coasting out the far side like any other
      // pass. The gate is a few degrees off the line, which the opening
      // swallows — that is what `ALIGNED_DEG` is measuring.
      const through: readonly [number, number, number] = [
        gx + (tx / toGate) * FLY_THROUGH,
        gy,
        gz + (tz / toGate) * FLY_THROUGH,
      ];
      legs.push({
        to: through,
        caption,
        // The release, on a pass this long, is the technique worth naming: the
        // sticks go to centre several seconds out and the drone sails the rest.
        arrive: 'Ease off early — it carries on through',
        coast: true,
        stick,
        face,
        label: c.label,
        stage: i,
      });
      // The arrival is its own beat, standing still at the end of the coast:
      // the gate is behind the aircraft by then, which is the moment its letter
      // comes off. Hanging it on the release instead would drop the letter while
      // the drone was still most of the run short of the hole — a long pass lets
      // go early and drifts the rest.
      legs.push({
        to: through,
        caption: arrive ?? `Through ${c.label}`,
        stage: i,
        rt: i + 1,
      });
      [px, , pz] = through;
      return;
    }

    legs.push({
      to: [gx + ax * LINE_UP * side, gy, gz + az * LINE_UP * side],
      caption,
      arrive: `Lined up on ${c.label} — hold this line`,
      stick,
      face,
      label: c.label,
      stage: i,
    });
    legs.push({
      to: [gx - ax * FLY_THROUGH * side, gy, gz - az * FLY_THROUGH * side],
      caption: `Straight through ${c.label}`,
      arrive,
      // A gate is a hole. The drone holds the tilt through it and lets go on the
      // far side rather than braking to a stop past it, so the pass looks like a
      // pass instead of a run-up, a halt and a lean backwards.
      coast: true,
      stick,
      face,
      label: c.label,
      stage: i,
      // Out the far side: the gate is behind the aircraft now, so its letter
      // goes with it. The line-up leg above deliberately does not do this — the
      // letter is what the pilot is aiming at right up to the pass.
      rt: i + 1,
    });
    px = gx - ax * FLY_THROUGH * side;
    pz = gz - az * FLY_THROUGH * side;
  });

  return legs;
}
