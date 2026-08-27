import { BEGINNER_CONFIG, type ControllerConfig } from '../../sim/control/flightController';
import type { StickInput } from '@shared/types';
import type { DemoStep } from './types';

// ----------------------------------------------------------------------------
// Demonstration flight planner.
//
// A demo used to be a hand-timed list of stick positions: "hold roll 0.4 from
// 3.2 s to 5.4 s". Nothing tied those numbers to the markers the lesson draws,
// so the demonstration flew past its own pylons — and every caption said it had
// arrived somewhere it was nowhere near. Watching it taught the wrong thing.
//
// Legs are declared in METRES instead, and the timings are solved here from the
// same physics the drone actually flies with. Move a marker and its demo moves
// with it. Two rules come out of the model:
//
//   1. A leg is tilt out, then tilt BACK to stop. Levelling off does not stop a
//      drone — linear damping alone takes about ten seconds to bleed off a
//      cruise, which is why the old demos drifted away from every waypoint.
//      This is also exactly what the lessons tell the pilot to do, so now the
//      demonstration and the tip agree.
//   2. Tilt does not appear the instant the stick moves; the rate controller
//      takes a moment to establish the angle. Ignoring that lag under-shoots
//      every leg by roughly its own length in the first half-second.
// ----------------------------------------------------------------------------

export const G = 9.81;
const DEG2RAD = Math.PI / 180;
/**
 * The flight envelope every demonstration is SOLVED against.
 *
 * Plans are built at module load — a lesson's `demo` array is a module-scope
 * constant — which is long before a drone has been chosen, so they cannot be
 * solved for the airframe that will fly them. They are solved for the trainer
 * envelope instead, and `scaleScriptedStick` converts a planned stick into
 * whatever stick asks the ACTIVE airframe for the same angle, rate or climb.
 * Without that, giving the racer 45 degrees of tilt would send every demo
 * sailing past its own markers at twice the planned acceleration.
 */
const PLAN_ENVELOPE = BEGINNER_CONFIG;
/** Mirrors the rigid body's `linearDamping` in `sim/drone/Drone.tsx`. */
export const LINEAR_DAMPING = 0.3;
/** First-order lag between commanding a tilt and holding it, seconds. */
export const TILT_LAG = 0.25;
/** Integration step for the leg solver. Runs once at module load. */
const DT = 0.004;
/** Default tilt used for a leg — brisk enough to watch, gentle enough to copy. */
const DEFAULT_STICK = 0.38;
/** Pause between legs, so each stop reads as a stop. */
const DEFAULT_GAP = 0.7;
/** Climb stick offset from centre. 0.25 -> 0.9 m/s, brisk without looking jumpy. */
const CLIMB_STICK = 0.25;
/** Yaw stick the turn is budgeted against; the Director may use less closing in. */
const YAW_STICK = 0.5;
/** Turns smaller than this are not worth their own beat in the demonstration. */
const MIN_TURN_DEG = 12;
/** Slack after a turn's nominal time, for the closed-loop hold to settle. */
const YAW_SETTLE = 0.6;

/**
 * Horizontal acceleration from holding a tilt stick at `stick`.
 *
 * In altitude hold the controller keeps vertical thrust at `mg / cos θ`, so the
 * horizontal component is `mg · tan θ` — the mass cancels and every drone in
 * the sim accelerates the same, which is why one table of timings serves all of
 * them.
 */
export function accelFor(stick: number): number {
  return G * Math.tan(stick * PLAN_ENVELOPE.maxTiltDeg * DEG2RAD);
}

/**
 * A leg flown with no brake: push, let go, and drift onto the mark.
 *
 * The braked leg above is the right shape for a module that shows both pitch
 * directions. Module 7 shows one — pitch forward, and nothing to stop with — so
 * a demonstration that counter-tilted would be flying with a key the pilot has
 * not been given, and the caption telling them to ease off early would be a lie
 * about what they had just watched.
 *
 * Without a brake there is no stopping, only slowing: linear damping alone
 * bleeds speed asymptotically, so the drone is always still creeping. What can
 * be demonstrated is arriving SLOWLY — push early, let go early, and cross the
 * mark at a walking pace. `arriveAt` is that pace, and the push is solved for
 * it. Returns when to let go and when the mark is crossed, both relative to the
 * start of the push.
 */
export function solveCoast(
  metres: number,
  stick: number,
  arriveAt = 0.35,
): { tPush: number; tArrive: number } {
  const cmdAngle = stick * PLAN_ENVELOPE.maxTiltDeg * DEG2RAD;
  const k = Math.min(1, DT / TILT_LAG);

  /** Fly it: push for `tPush`, release, and report the crossing. */
  const run = (tPush: number): { v: number; t: number } => {
    let v = 0;
    let x = 0;
    let angle = 0;
    let t = 0;
    for (; t < tPush; t += DT) {
      angle += (cmdAngle - angle) * k;
      v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
      x += v * DT;
      if (x >= metres) return { v, t };
    }
    // Released: the tilt decays to nothing and damping does the rest. Give up
    // after a minute — a push too short to cover the distance never will.
    for (; t < 60; t += DT) {
      angle += (0 - angle) * k;
      v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
      x += v * DT;
      if (x >= metres) return { v, t };
    }
    return { v: -1, t: 60 };
  };

  // Arrival speed rises with the length of the push, so bisect on it. A push
  // that never gets there reads as v = -1, which sits below any target and
  // pushes the search the right way.
  let lo = 0.05;
  let hi = 12;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid).v < arriveAt) lo = mid;
    else hi = mid;
  }
  const tPush = (lo + hi) / 2;
  return { tPush, tArrive: run(tPush).t };
}

/**
 * Fly one leg offline: accelerate, brake, release, coast to a stop.
 *
 * The lag is on the ANGLE, and the acceleration is `g tan(angle)` — the same
 * shape the drone actually flies, so the plan and the flight agree.
 *
 * The release matters more than it looks. Holding the counter-tilt until the
 * velocity reaches zero leaves the drone standing there still leaning back, and
 * that leftover lean then pushes it BACKWARDS: every leg used to stop on its
 * marker and then slide a third of a metre off it. Letting go while there is
 * still `a x TILT_LAG` of speed to lose hands the last of the braking to the
 * tilt as it decays, and the drone settles on the spot the lesson asks for.
 */
function simulateLeg(cmdAngle: number, tAccel: number): { distance: number; tBrake: number } {
  let v = 0;
  let x = 0;
  let angle = 0;
  const k = Math.min(1, DT / TILT_LAG);
  for (let t = 0; t < tAccel; t += DT) {
    angle += (cmdAngle - angle) * k;
    v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
    x += v * DT;
  }
  const release = G * Math.tan(cmdAngle) * TILT_LAG;
  let tBrake = 0;
  while (v > release && tBrake < 12) {
    angle += (-cmdAngle - angle) * k;
    v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
    x += v * DT;
    tBrake += DT;
  }
  for (let tc = 0; v > 0.01 && tc < 4; tc += DT) {
    angle += (0 - angle) * k;
    v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
    x += v * DT;
  }
  return { distance: x, tBrake };
}

/** Speed at which a coasting leg hands over to the next one, m/s.
 *
 *  Not "stopped" — a walking pace. Damping bleeds speed exponentially, so
 *  waiting for still costs seven seconds a gate and turns a route into a
 *  crawl; handing over while the drone is still drifting is both quicker to
 *  watch and closer to how the route is actually flown. The leftover speed
 *  carries along the plan's own direction, so the next leg starts a little
 *  further on than it thinks — which the gates' acceptance and the landing's
 *  `waitNear` both absorb. */
const COAST_END = 1.1;

/**
 * A leg flown THROUGH something: tilt out, then let go and carry on.
 *
 * The braked leg is right for a drill that stops on a marker. A gate is not a
 * marker — it is a hole — and a route through four of them was being flown as
 * eight separate hops, each ending in a counter-tilt and a full stop. On screen
 * that is the drone running at the gate, stopping dead, LEANING BACKWARDS, and
 * only then setting off again: it reads as a mistake being corrected rather
 * than as a pass, which is the opposite of what the module is teaching.
 *
 * Letting go instead means the drone sails out of the far side while the next
 * turn begins, and nothing ever pitches back. Damping alone never quite brings
 * it to rest, so the leg is finished at `COAST_END` — slow enough that the next
 * leg starts from roughly where the plan says it does.
 */
export function solveThrough(metres: number, stick: number): { tAccel: number; tCoast: number } {
  const cmdAngle = stick * PLAN_ENVELOPE.maxTiltDeg * DEG2RAD;
  const k = Math.min(1, DT / TILT_LAG);

  const run = (tAccel: number): { distance: number; tCoast: number } => {
    let v = 0;
    let x = 0;
    let angle = 0;
    for (let t = 0; t < tAccel; t += DT) {
      angle += (cmdAngle - angle) * k;
      v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
      x += v * DT;
    }
    let tCoast = 0;
    while (v > COAST_END && tCoast < 12) {
      angle += (0 - angle) * k;
      v += (G * Math.tan(angle) - LINEAR_DAMPING * v) * DT;
      x += v * DT;
      tCoast += DT;
    }
    return { distance: x, tCoast };
  };

  let lo = 0.05;
  let hi = 12;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid).distance < metres) lo = mid;
    else hi = mid;
  }
  const tAccel = (lo + hi) / 2;
  return { tAccel, tCoast: run(tAccel).tCoast };
}

/** How long to hold the tilt, and then the counter-tilt, to cover `metres`. */
function solveLeg(metres: number, stick: number): { tAccel: number; tBrake: number } {
  const cmdAngle = stick * PLAN_ENVELOPE.maxTiltDeg * DEG2RAD;
  let lo = 0.05;
  let hi = 12;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (simulateLeg(cmdAngle, mid).distance < metres) lo = mid;
    else hi = mid;
  }
  const tAccel = (lo + hi) / 2;
  return { tAccel, tBrake: simulateLeg(cmdAngle, tAccel).tBrake };
}

/** One point-to-point hop of a demonstration. Keycaps are not declared here —
 *  the Director lights them from the sticks these steps set. */
export interface DemoLeg {
  /** Where to end up, in world metres [x, y, z] — the checkpoint's own
   *  coordinates, so a gate leg flies THROUGH the gate rather than under it. */
  to: readonly [number, number, number];
  /** Tilt magnitude 0..1 for the run out. Bigger is faster and less precise. */
  stick?: number;
  /** Caption while flying out. */
  caption: string;
  /** Caption while braking — this is the "arrived" beat. */
  arrive?: string;
  /** Fly THROUGH the target rather than stopping on it: hold the tilt, then let
   *  go and carry on. A gate is a hole, not a marker. */
  coast?: boolean;
  /** Turn to POINT AT the target before flying the leg, rather than sliding
   *  there sideways on the stick mix.
   *
   *  The stick lessons deliberately fly without it: "roll right" has to be seen
   *  as the drone moving right, not as it turning right. Navigation is the
   *  opposite — a route flown facing one way the whole time is a crab walk, the
   *  chase camera never looks at the gate being flown, and the yaw keys the
   *  lesson puts on screen are never touched. */
  face?: boolean;
  /** What to call the target in the turn caption. */
  label?: string;
  /** Which checkpoint of the lesson's route this leg is flying to, 0-based.
   *  Carried onto the emitted steps so the HUD's checkpoint row and the route
   *  guide follow the demonstration the same way they follow the pilot. */
  stage?: number;
  /** The route cursor once this leg has ARRIVED — set only on the leg that
   *  actually finishes a checkpoint, so a gate's two legs (line up, then run
   *  through) advance it once, on the way out. */
  rt?: number;
}

/**
 * Turn a list of legs into a demo timeline.
 *
 * `from` is where the drone starts (the pad, unless a lesson says otherwise) and
 * `startAt` is when the first leg begins — leave room for the take-off climb.
 */
export function planDemo(
  legs: readonly DemoLeg[],
  opts: {
    startAt?: number;
    from?: readonly [number, number, number];
    /** Which way the drone is pointing at the start, radians; 0 faces -Z. */
    heading?: number;
    gap?: number;
  } = {},
): DemoStep[] {
  const gap = opts.gap ?? DEFAULT_GAP;
  // The pilot starts hovering over the helipad at the auto take-off height.
  let [x, y, z] = opts.from ?? [0, 1.8, 0];
  let heading = opts.heading ?? 0;
  let at = opts.startAt ?? 3.0;
  const steps: DemoStep[] = [];

  for (const leg of legs) {
    const dx = leg.to[0] - x;
    const dy = leg.to[1] - y;
    const dz = leg.to[2] - z;
    const dist = Math.hypot(dx, dz);
    const stick = leg.stick ?? DEFAULT_STICK;
    const solved =
      dist < 0.01
        ? { tAccel: 0, tBrake: 0, tCoast: 0 }
        : leg.coast
          ? { ...solveThrough(dist, stick), tBrake: 0 }
          : { ...solveLeg(dist, stick), tCoast: 0 };
    const { tAccel, tBrake, tCoast } = solved;

    // Point at the target first, if the leg asks for it. Yaw is a rate command
    // with nothing to brake, so this is one hold and one release — and because
    // the Director reads the keycaps off the sticks, it is also what finally
    // lights the yaw keys the navigation lessons show.
    if (leg.face && dist >= 0.5) {
      const want = Math.atan2(-dx / dist, -dz / dist);
      let turn = want - heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) > MIN_TURN_DEG * DEG2RAD) {
        // The turn is asked for as a HEADING, not as a stick hold. A timed hold
        // is only as accurate as the yaw controller's ramp on the day, and the
        // heading is the frame every following leg is flown in — so a turn that
        // came up short did not just look untidy, it swung the rest of the route
        // and the drone went past the gate instead of through it. On some runs,
        // not others, which is the worst kind of wrong. The Director closes the
        // loop on the drone's real heading; the time below is only the budget it
        // is given to get there.
        const tTurn = yawTime(Math.abs(turn) / DEG2RAD, YAW_STICK) + YAW_SETTLE;
        steps.push({
          at,
          yawTo: want,
          caption: `Yaw ${turn > 0 ? 'left' : 'right'} to face ${leg.label ?? 'the next one'}`,
        });
        steps.push({ at: at + tTurn, yawTo: null });
        at += tTurn + gap;
        heading = want;
      }
    }

    // Height runs alongside the leg, not before it: throttle is its own channel,
    // and in altitude hold it commands a climb RATE, so the timing is just
    // distance over rate. The gates stand between 2.4 m and 5 m up — a demo held
    // at hover height would fly under every one of them.
    const climb = Math.abs(dy) > 0.15 ? Math.sign(dy) * CLIMB_STICK : 0;
    let tClimb = 0;
    if (climb !== 0) {
      tClimb = Math.abs(dy) / (CLIMB_STICK * 2 * PLAN_ENVELOPE.maxClimbRate) + 0.3;
      steps.push({ at, stick: { throttle: 0.5 + climb } });
      steps.push({ at: at + tClimb, stick: { throttle: 0.5 } });
    }

    if (dist >= 0.01) {
      // The sticks tilt the drone in its OWN frame — roll is its right, pitch
      // is its nose — so the world direction of travel has to be turned back
      // through the current heading before it becomes a stick position. At
      // heading 0 that is the identity and this is the old "roll is +X, pitch
      // is -Z"; after a turn it is what keeps the leg pointing where the plan
      // says, instead of flying off at the angle the drone was turned by.
      const c = Math.cos(heading);
      const sn = Math.sin(heading);
      const ux = dx / dist;
      const uz = dz / dist;
      const roll = stick * (ux * c - uz * sn);
      const pitch = stick * -(ux * sn + uz * c);
      steps.push({ at, stick: { roll, pitch }, caption: leg.caption, stage: leg.stage });
      steps.push({
        at: at + tAccel,
        // Let go, or lean back to stop. A pass through a gate does the former:
        // nothing on screen pitches backwards on the way out of a hole.
        stick: leg.coast ? { roll: 0, pitch: 0 } : { roll: -roll, pitch: -pitch },
        caption: leg.arrive,
        stage: leg.stage,
        // This beat IS the arrival: past the gate, on the way out. That is the
        // moment the letter comes off it.
        rt: leg.rt,
      });
      if (!leg.coast) {
        steps.push({ at: at + tAccel + tBrake, stick: { roll: 0, pitch: 0 } });
      }
    } else if (leg.caption) {
      steps.push({ at, caption: leg.caption, stage: leg.stage, rt: leg.rt });
    }

    at += Math.max(tAccel + tBrake + tCoast, tClimb) + gap;
    [x, y, z] = leg.to;
  }
  // Climb steps interleave with the tilt steps, and the Director walks the
  // timeline strictly in order.
  return steps.sort((a, b) => a.at - b.at);
}

/**
 * Seconds of yaw stick needed to turn `degrees`.
 *
 * Yaw is a RATE command, not a tilt, so there is nothing to brake: centring the
 * stick asks for zero rate and the turn stops. Only the rate controller's own
 * ramp-up has to be paid for.
 */
export function yawTime(degrees: number, stick: number): number {
  const rate = stick * PLAN_ENVELOPE.maxYawRate;
  // No allowance for the rate controller's ramp: what a turn loses spinning up
  // it gives back spinning down. Paying for it made the demo turn 109 degrees
  // while the lesson asks for 90 and the caption says "about 90".
  return (Math.abs(degrees) * DEG2RAD) / rate;
}

/**
 * A demonstration lap of a circle: the approach, the run-up and the arc.
 *
 * A circle is the one shape that cannot be flown as legs, because it never
 * stops. What holds a drone on a ring is a tilt that points at the CENTRE and
 * rotates with it, sized to `v^2 / r` — plus a little forward lean to pay off
 * the air drag that would otherwise bleed the speed away.
 *
 * Three things have to be right or the lap spirals away, and all three were
 * wrong before: the demonstration swept 27 degrees and wandered out to a 15 m
 * radius while the lesson asks for a full turn on a 4 m ring.
 *
 *   1. The run-up has to END on the ring, moving along it. It starts one run-up
 *      length BEFORE the entry point, so the straight acceleration finishes
 *      exactly on the ring, tangent to it, at the speed the bank assumes.
 *   2. The commanded direction has to LEAD the drone by the tilt lag. The stick
 *      rotates the whole way round; a tilt that is always a quarter-second
 *      behind under-banks the entire lap and the radius grows.
 *   3. The first arc command has to go in a tilt-lag EARLY, while the run-up is
 *      still finishing, so the bank is established at the moment the drone
 *      reaches the ring instead of a quarter-second into the turn.
 */
export function planCircle(opts: {
  startAt?: number;
  radius: number;
  /** Height to fly the lap at. */
  height?: number;
  /** Ground speed to hold, m/s. Sets the lap time and the bank angle. */
  speed?: number;
  /** How many stick updates go around the lap. */
  segments?: number;
  /** Captions: approach, run-up, one per quarter of the lap, then the exit. */
  captions?: readonly string[];
}): DemoStep[] {
  const r = opts.radius;
  const v = opts.speed ?? 2.2;
  const n = opts.segments ?? 96;
  const c = opts.captions ?? [];
  const runUpStick = 0.42;

  // How long the straight run-up takes, and how far it covers.
  let vNow = 0;
  let angle = 0;
  let along = 0;
  let tRunUp = 0;
  const cmdAngle = runUpStick * PLAN_ENVELOPE.maxTiltDeg * DEG2RAD;
  const k = Math.min(1, DT / TILT_LAG);
  while (vNow < v && tRunUp < 8) {
    angle += (cmdAngle - angle) * k;
    vNow += (G * Math.tan(angle) - LINEAR_DAMPING * vNow) * DT;
    along += vNow * DT;
    tRunUp += DT;
  }

  // Entry is the +X side of the ring, run up to along +Z — the tangent there.
  const steps = planDemo([{ to: [r, opts.height ?? 1.8, -along], caption: c[0] ?? '' }], {
    startAt: opts.startAt ?? 3.0,
    gap: 0.8,
  });
  const runUpAt = steps[steps.length - 1].at + 0.8;
  steps.push({ at: runUpAt, stick: { roll: 0, pitch: -runUpStick }, caption: c[1] });

  const aIn = (v * v) / r;
  const aFwd = LINEAR_DAMPING * v;
  const bank = Math.atan(Math.hypot(aIn, aFwd) / G) / DEG2RAD;
  const mag = bank / PLAN_ENVELOPE.maxTiltDeg;
  // The drag term, expressed as a rotation away from "straight at the centre".
  const lead = Math.atan2(aFwd, aIn);
  const lap = (2 * Math.PI * r) / v;
  const omega = (2 * Math.PI) / lap;
  // Starting the schedule a tilt-lag early IS the lead compensation of (2) and
  // (3): the whole thing is shifted, so the phase term stays plain.
  const arcAt = runUpAt + tRunUp - TILT_LAG;

  for (let i = 0; i <= n; i++) {
    const t = (i * lap) / n;
    const phi = omega * t - lead;
    steps.push({
      at: arcAt + t,
      stick: { roll: mag * -Math.cos(phi), pitch: mag * Math.sin(phi) },
      caption: c[2 + Math.floor((i * 4) / (n + 1))],
    });
  }

  const end = arcAt + lap;
  steps.push({ at: end, stick: { roll: 0, pitch: runUpStick * 0.6 }, caption: c[6] });
  steps.push({ at: end + 1.2, stick: { roll: 0, pitch: 0 } });
  return steps;
}

/**
 * A planned stick hold, converted into the same command on the active airframe.
 *
 * The planner works in stick units against `PLAN_ENVELOPE`; a drone with its own
 * `handling` reads that same stick as a bigger angle, a faster turn or a quicker
 * climb. Rescaling by the ratio of the limits keeps the PHYSICAL command — the
 * bank angle, the yaw rate, the climb rate — exactly what the plan solved for,
 * so a demonstration still stops on its markers whatever is flying it.
 *
 * Throttle is the odd channel: it is centred at 0.5 in Altitude Hold, so it is
 * the OFFSET from centre that scales, not the value.
 */
export function scaleScriptedStick(
  s: Partial<StickInput>,
  cfg: ControllerConfig,
): Partial<StickInput> {
  if (cfg === PLAN_ENVELOPE) return s;
  const tilt = PLAN_ENVELOPE.maxTiltDeg / cfg.maxTiltDeg;
  const yaw = PLAN_ENVELOPE.maxYawRate / cfg.maxYawRate;
  const climb = PLAN_ENVELOPE.maxClimbRate / cfg.maxClimbRate;
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    ...(s.roll !== undefined && { roll: clamp1(s.roll * tilt) }),
    ...(s.pitch !== undefined && { pitch: clamp1(s.pitch * tilt) }),
    ...(s.yaw !== undefined && { yaw: clamp1(s.yaw * yaw) }),
    ...(s.throttle !== undefined && {
      throttle: Math.max(0, Math.min(1, 0.5 + (s.throttle - 0.5) * climb)),
    }),
  };
}
