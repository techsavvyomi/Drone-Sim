import type { StickInput, Vec3 } from '@shared/types';
import type { DroneStatus } from '../../state/flightStore';

// ----------------------------------------------------------------------------
// Pluto Flight School — lesson content model.
//
// A lesson is pure data + pure functions. It never touches the engine directly:
// it declares a demonstration timeline, a per-frame validator, an optional 3D
// scene and a scorer. The generic Director (../Director.tsx) runs any lesson
// through Explain -> Demonstrate -> Practice -> Validate -> Reward.
// ----------------------------------------------------------------------------

/** A live snapshot handed to a validator each frame during Practice. */
export interface Probe {
  armed: boolean;
  onGround: boolean;
  crashed: boolean;
  status: DroneStatus;
  altitude: number;
  position: Vec3;
  /** Heading in radians (sim yaw). */
  yaw: number;
  verticalSpeed: number;
  groundSpeed: number;
  roll: number;
  pitch: number;
  /** Throttle stick position 0..1 (0.5 = centre in altitude-managed modes). */
  throttle: number;
  /** This frame's delta time, seconds. */
  dt: number;
  /** Seconds elapsed since the Practice phase began. */
  elapsed: number;
}

export type DemoCommand = 'arm' | 'disarm' | 'takeoffLand';

/** One keyframe of a scripted demonstration, timed from the demo's start. */
export interface DemoStep {
  /** Seconds from the start of the demo at which to apply this step. */
  at: number;
  /** Discrete command to issue (arm/disarm/take-off-land). */
  cmd?: DemoCommand;
  /** Stick channels to set (unset channels keep their current value). */
  stick?: Partial<StickInput>;
  /** Caption shown in the demo banner while this step is the latest applied. */
  caption?: string;
  /** KeyboardEvent.code to flash on the keycap row while this step plays. */
  key?: string;
  /** Which step of the lesson this is demonstrating, 0-based, into `stages` or
   *  `route`. The checkpoint row walks along with the demonstration, so what the
   *  intro card promised is what the pilot then watches being flown. */
  stage?: number;
  /** The ROUTE cursor once this beat has happened: how many checkpoints are
   *  behind the aircraft.
   *
   *  Separate from `stage` because they are not the same number on a lesson
   *  with `stages` — there Arm is step 0 and the first gate is step 2 — and
   *  because they move at different moments: `stage` lights the step the demo
   *  is FLYING, this one records the checkpoint it has just gone THROUGH. It is
   *  what takes a gate's letter off the field mid-demonstration, the same way
   *  the pilot's own route cursor does in practice.
   *
   *  Emitted by `routeLegs`/`planDemo` on the arrival beat of each leg; a
   *  hand-written demo step leaves it out. */
  rt?: number;
  /** Hold the demonstration here until the drone is actually within `reach`
   *  metres of this spot on the ground.
   *
   *  The timeline is open-loop, and over a long route the error adds up: every
   *  leg under-shoots a little, every turn costs a little more than it was
   *  budgeted, and by the end of a ninety-second circuit the aircraft can be a
   *  gate behind the script. A beat that only has to look right can absorb that.
   *  A LANDING cannot — fired on the clock it puts the drone down wherever it
   *  happens to be, which on Module 14 was beside the last gate rather than on
   *  the "H" the lesson had just told the pilot to come home to.
   *
   *  The Director holds the clock, exactly as it does while an auto sequence
   *  owns the aircraft, and gives up after `DEMO_WAIT_MAX` so a demonstration
   *  that has gone properly astray still ends. */
  waitNear?: { x: number; z: number; reach: number };
  /** Turn to this heading, in radians, and HOLD it — `null` releases the yaw.
   *
   *  The only closed-loop channel in a demonstration, and it has to be. Every
   *  other channel is open-loop by design: a leg that lands a metre off still
   *  looks like the manoeuvre it is teaching. A turn that lands ten degrees off
   *  does not — the heading is the frame the next leg's sticks are computed in,
   *  so the error does not stay in the turn, it rotates the whole rest of the
   *  route. Timed yaw holds got this right on some runs and not others; the
   *  Director drives this one from the drone's real heading instead. */
  yawTo?: number | null;
}

/**
 * One named step of a lesson: 'Arm', then 'Take off', then 'Hover'.
 *
 * `cap` is the keycap that performs it, and it is what makes the intro card
 * answer "what do I actually press" before the pilot has flown anything. A step
 * with nothing to press — settling into a hover — simply leaves it out.
 */
export interface LessonStage {
  label: string;
  cap?: string;
}

/** A keycap shown under the flight view, highlighted while its key is active. */
export interface KeyHint {
  /** KeyboardEvent.code, e.g. 'Enter', 'KeyW', 'Space'. */
  code: string;
  /** Short face label, e.g. 'ENTER', 'W', 'SPACE'. */
  label: string;
  /** What the key does in this lesson. */
  hint: string;
}

/** What a validator returns each frame. */
export interface ValidationResult {
  /** The success condition is fully met — advance to Reward. */
  done: boolean;
  /** A hard failure (crash, out of bounds) — surface "Try Again". */
  failed?: boolean;
  /**
   * This failure wrecked the aircraft — the Director raises a real crash for it.
   *
   * A plain `failed` restarts the attempt on its own, because the drone is still
   * fit to fly: flown out of the box, landed off the pad. Some failures are not
   * like that. A hover drill that ends with the drone on the deck is over, and
   * quietly lifting it back up teaches that putting it down costs nothing —
   * which is exactly the mistake Module 3 lists as its own. Raising the crash
   * gets the card, the star cap and "press R to try again" from the machinery
   * that already handles a real one, instead of a second, parallel way to fail.
   */
  wrecked?: boolean;
  /** 0..1 completion for the on-screen progress bar. */
  progress?: number;
  /** Contextual guidance to show right now (e.g. "Hold this altitude"). */
  hint?: string;
  /** The control the pilot should be using RIGHT NOW, as KeyboardEvent.codes.
   *
   *  The keycap row breathes the caps named here and the on-screen sticks glow
   *  in the matching direction, so the answer to "what do I press" is on screen
   *  rather than in the sentence above it. A validator that names nothing
   *  simply leaves the row still. */
  cue?: readonly string[];
}

/** Cue sets, so lessons name a control once and every one of them agrees. */
export const CUE = {
  arm: ['Enter'] as const,
  throttleUp: ['KeyW'] as const,
  throttleDown: ['KeyS'] as const,
  /** Hands-off climb to the hover height. Module 1 teaches it, and every whole
   *  flight from Module 7 on reuses it: those modules are about a stick, not
   *  about the throttle, so they show SPACE rather than W and S. */
  autoTakeoff: ['Space'] as const,
  /** Hands-off descent onto the pad. Module 2 teaches it; same story. */
  autoLand: ['Space'] as const,
  forward: ['ArrowUp'] as const,
  backward: ['ArrowDown'] as const,
  left: ['ArrowLeft'] as const,
  right: ['ArrowRight'] as const,
  yawLeft: ['KeyA'] as const,
  yawRight: ['KeyD'] as const,
} satisfies Record<string, readonly string[]>;

/**
 * Which stick direction takes the drone from one point to another.
 *
 * The stick modules and the shape circuits are all flown nose-forward down the
 * arena (heading 0 faces -Z), so a leg's world direction is also the direction
 * the pilot has to push. One dominant axis per leg, which is exactly what a
 * highlight can show: a square's side is one arrow, not two.
 */
export function cueBetween(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): readonly string[] {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? CUE.forward : CUE.backward;
  return dx > 0 ? CUE.right : CUE.left;
}

/** Mutable per-attempt scratch pad for validators (hold timers, accumulators). */
export type LessonMemory = Record<string, number>;

/** Standard performance metrics the Director collects for scoring. */
export interface ScoreInput {
  /** Seconds taken to satisfy the lesson. */
  timeSec: number;
  /** Crashes during the attempt. */
  collisions: number;
  /**
   * Everything the drone touched while airborne, crashes included.
   *
   * A clean flight is one that went round without brushing anything, and until
   * this existed nothing said so: only crashes were counted, so a pilot could
   * scrape a gate upright the whole way through the course and still take three
   * stars. Every rubric's top rung asks for zero.
   */
  touches: number;
  /** Control smoothness 0..1 (1 = very smooth), from stick jerk. */
  smoothness: number;
  /** The same scratch pad the validator wrote to — for lesson-specific scoring. */
  mem: LessonMemory;
}

export type Stars = 1 | 2 | 3;

/**
 * One rung of a lesson's star rubric.
 *
 * The words and the test live in the SAME object on purpose. The card that
 * promises "three stars: airborne in 16 seconds, smoothly" is the code that
 * awards them, so what the pilot is told cannot drift from what the pilot gets —
 * and the rubric can be put on screen at all, which it never could while every
 * lesson buried its thresholds in a hand-written `score` function.
 *
 * A crash caps an attempt at one star, so every rule tests for that itself.
 */
export interface StarRule {
  stars: Stars;
  /** What it takes, in the pilot's words. One short line. */
  text: string;
  test: (i: ScoreInput) => boolean;
}

/** The stars an attempt earns: the best rung it passes, or one for finishing. */
export function starsFor(rules: readonly StarRule[], input: ScoreInput): Stars {
  for (const rule of rules) if (rule.test(input)) return rule.stars;
  return 1;
}

/** How the route guide draws a highlight over the arena object it names. */
export type MarkKind = 'gate' | 'pad' | 'marker' | 'helipad';

/**
 * One point in the ACADEMY ARENA that a lesson sends the pilot to.
 *
 * A checkpoint never creates scenery. It names something already standing in
 * the arena — a racing gate, a painted landing pad, one of the white markers
 * ringing the helipad — and the guide puts a highlight on THAT. Lessons used to
 * draw their own rings and pylons a few metres from the "H"; the pilot then
 * learned an arena that does not exist outside the lesson.
 *
 * The same list drives all three things that have to agree: what the validator
 * accepts, what the demonstration flies, and what is lit up on screen.
 */
export interface Checkpoint {
  /** Shown in the HUD as the target: 'A', 'B', 'blue gate'... */
  label: string;
  /** World position of the point to reach — for a gate, the centre of its
   *  opening, so "reached it" and "flew through it" are the same test. */
  at: readonly [number, number, number];
  /** How close counts, in metres, measured in 3-D. */
  reach: number;
  /** Which arena object this is, so the guide draws the right highlight. */
  mark: MarkKind;
  /** Size of that object — a gate's opening, a pad's painted radius. */
  markSize?: number;
  /** Accent for the highlight; defaults to the object's own colour. */
  color?: string;
  /** What to WRITE on the arena object, if anything.
   *
   *  Setting it is what puts a name on the field, so it is asked for one
   *  checkpoint at a time rather than one lesson at a time: a route to the blue
   *  gate and back to the "H" wants a letter on the gate and nothing on the
   *  pad, which already has an "H" painted on it.
   *
   *  It is not the same text as `label`. The step row has room for "Corner B"
   *  and needs it; the marker itself wants "B", because a phrase written across
   *  the deck beside a 0.9 m sphere is a phrase covering the field. */
  tag?: string;
  /** Draw a lit sphere hanging in the middle of this checkpoint, which goes out
   *  as the drone passes through it.
   *
   *  The alternative to writing a NAME on the thing (`tag`). A letter says which
   *  gate this is; a ball of light says where the hole is and, by going out,
   *  says the pass has been scored — the arrival becomes something the pilot
   *  sees happen in the arena instead of a chip changing on the HUD.
   *
   *  Opt-in one checkpoint at a time, the same way `tag` is: on a route of four
   *  gates every orb would be lit at once and the field would read as four
   *  targets rather than one next one. */
  orb?: boolean;
  /** Draw a standing COLUMN of pink light on this checkpoint, from the deck up
   *  past the height it is flown at, which goes out as the drone enters it.
   *
   *  The orb's answer for a checkpoint that is a place on the GROUND rather than
   *  a hole in the air. A ball hanging at flying height over a white marker says
   *  nothing about which marker it belongs to — it is read against the sky from
   *  half the pad — and the corner circuits are flown by looking DOWN at the
   *  shape. A column joins the two: its foot is the corner, its body is the
   *  space the drone has to be in, and entering it puts the aircraft inside the
   *  light rather than beside it.
   *
   *  It is drawn at the checkpoint's own `reach`, so the pink volume IS the
   *  acceptance volume: "inside the light" and "scored" are the same thing, and
   *  the pilot is never told they missed a corner they appeared to be on.
   *
   *  It replaces the yellow target beam on the checkpoints that ask for it — two
   *  columns standing in the same spot is one column too many. */
  pillar?: boolean;
  /** Stand a hollow BEACON on this checkpoint: an open cylinder of light at the
   *  checkpoint's own `reach`, solid where it meets the deck and faded to
   *  nothing by its top rim, with a glowing ring on the ground at its foot.
   *
   *  The third answer for a checkpoint that is a place on the GROUND, after the
   *  letter and the column. It says what the column said — the corner is here,
   *  and this much of it counts — but it says it by lighting the FLOOR and the
   *  air immediately over it, rather than by putting a body of light in the
   *  space the aircraft is being flown into. A circuit flown at 3.3 m is flown
   *  by looking DOWN at the shape, and this is a mark you look down at.
   *
   *  The ring's middle is CUT OUT. A filled disc is what a real spotlight makes
   *  and it is the wrong picture here: the drone hovers over the centre of its
   *  own mark, so the centre is the part hidden under the airframe and its
   *  shadow, and the pilot ends up judging the corner against an edge they
   *  cannot see. Lit as a ring, the brightest thing on the deck is exactly the
   *  line where "close enough" stops being close enough.
   *
   *  Like `pillar`, it replaces the yellow target beam on the checkpoints that
   *  ask for it: two columns standing in one place is one column too many. */
  beacon?: boolean;
  /** Metres to draw this checkpoint's ORB above the point itself, leaving what
   *  scores exactly where it is.
   *
   *  A gate's checkpoint is often NOT in the middle of its opening: a module
   *  flown level in altitude hold is judged at hover height, which on a gate
   *  standing 2.6 m up is well under the hole, and a ball drawn honestly on that
   *  point hangs in the bottom of the frame with half of it buried in the bar.
   *  This is the offset that puts the light back in the middle of the opening.
   *
   *  DERIVED, not chosen: `gate()` sets it to the distance the checkpoint was
   *  pulled down from the gate's own centre, so it is zero for a gate judged in
   *  its opening and exactly right for one that is not. It used to be a single
   *  constant in the guide, picked to look correct on one gate — which quietly
   *  pushed the ball ABOVE centre on every gate that did not need lifting at all.
   *
   *  `CheckpointSphere` clamps it so the whole visible ball still fits inside the
   *  volume that scores. That is the promise a ball makes by being a ball, and a
   *  lift big enough to break it would put light where the validator does not. */
  lift?: number;
  /** For a gate: the unit direction THROUGH its opening, in world space.
   *
   *  A gate is not a place to arrive at, it is a hole to pass through, and a
   *  demonstration that brakes on the centre point stops inside the frame. With
   *  an axis the planner can line the drone up in front of the gate and carry it
   *  out the far side — the flight the lesson is actually asking for.
   *
   *  It is also what makes the PASS a pass rather than a near miss: see `hole`. */
  axis?: readonly [number, number, number];
  /** For a gate: half its opening, in metres — how far off the centre line a
   *  pass may be and still be inside the frame.
   *
   *  Without it `reach` is a sphere, and a sphere around a gate sticks out
   *  through the uprights: gate A's is 1.64 m and the ring itself is 1.4 m, so
   *  flying BESIDE the gate, outside the frame entirely, scored the checkpoint.
   *  With it the acceptance becomes a cylinder lying down the axis — loose along
   *  the direction of travel, where a frame either side of the plane makes no
   *  difference to anything, and tight across it, which is the whole test. */
  hole?: number;
}

export interface Lesson {
  id: string;
  /** 1-based position in the curriculum; also drives unlock order. */
  order: number;
  title: string;
  subtitle: string;

  /** Step 1 — Introduction. */
  explain: { title: string; body: string[]; durationHint?: string };

  /** Step 2 — Demonstration timeline (scripted autopilot). */
  demo: DemoStep[];

  /** Step 3 — Practice prompt + a default standing hint. */
  practice: { prompt: string; hint: string };

  /** The arena checkpoints this lesson flies, in order.
   *
   *  Drives the validator, the demonstration and the on-screen highlight from
   *  one list, so the demo cannot show a route the attempt does not ask for. */
  route?: readonly Checkpoint[];

  /** The named steps of a lesson that is not a route: 'Arm', 'Take off',
   *  'Hover'. They drive two things — the flow shown on the intro card, and the
   *  same checkpoint row a route's labels drive — so a drill shows its shape
   *  before it starts and its progress while it runs. The validator moves
   *  between them by writing `mem.wp`. */
  stages?: readonly LessonStage[];

  /** A closed circular path to PAINT on the deck, for a lesson whose route is
   *  not a list of points. Only Full Circle uses it: the ring is the task, and
   *  chopping it into checkpoints would turn the one shape with no corners into
   *  a rounded polygon. Centred on the helipad, and flat on it — the height the
   *  lap is flown at is the lesson's business, not the marking's. */
  guideRing?: {
    radius: number;
    /** Half-width of the lane the lap is meant to be held in, in metres. Drawn
     *  on the map as a band around the line, so "on the ring" is a place with a
     *  width rather than a word. */
    band?: number;
  };

  /** How high that hover is, in metres. Defaults to `HOVER`.
   *
   *  The circuits fly higher than the stick drills do, and for a reason that is
   *  about SEEING rather than about flying: their corners are numbered on the
   *  ground, and from the standard 1.8 m hover the far ones are read edge-on
   *  across the pad. A metre and a half more turns the shape into something the
   *  pilot is looking down at. The lesson's own checkpoints have to be lifted to
   *  match — they are judged in 3-D — which is why this is a number the lesson
   *  states once and passes to its markers. */
  hoverHeight?: number;

  /** 💡 Pilot tips — best-practice pointers, shown on the intro card. */
  tips?: string[];
  /** ⚠ Common mistakes beginners make, shown on the intro card. */
  commonMistakes?: string[];

  /** Keycaps to show under the flight view for this lesson's controls. */
  keys?: KeyHint[];

  /** Step 4 — Validation, evaluated every frame during Practice. */
  validate: (p: Probe, mem: LessonMemory) => ValidationResult;

  /** Step 5 — Reward: what three stars takes, then what two takes. Best first;
   *  an attempt that passes none of them is worth one star for finishing. Shown
   *  on the intro card before the flight and on the result after it. */
  stars: readonly StarRule[];

  /** Optional setup run once when the lesson starts (e.g. pre-arm the drone). */
  setup?: () => void;

  /** Seconds of *no progress* before the demo auto-replays (default 45). The
   *  clock restarts whenever the attempt gets closer to the goal, so this is a
   *  stall timeout, not a time limit on the lesson. */
  practiceTimeout?: number;
}

// ---- Small validator helpers ------------------------------------------------

/** Clamp to 0..1. Progress bars read straight off this, and an un-clamped
 *  "1 - distance/span" goes negative the moment the drone is further out than
 *  the span, which the HUD then renders as a negative percentage. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Track "condition held continuously for `seconds`". Returns the held fraction
 * 0..1; reaching 1 means the hold is complete. Uses `mem[key]` as the timer.
 */
export function holdFor(
  mem: LessonMemory,
  key: string,
  condition: boolean,
  dt: number,
  seconds: number,
): number {
  const t = (mem[key] ?? 0) + (condition ? dt : -dt * 2);
  mem[key] = Math.max(0, Math.min(seconds, t));
  return mem[key] / seconds;
}

/**
 * Once true, stays true for the rest of the attempt.
 *
 * A validator that reports `done` from a live check — "am I within 1.3 m of the
 * marker *right now*" — flickers: the drone arrives, one frame says done, and a
 * hand's width of drift says not-done again. The Director needs the success to
 * hold continuously for over a second before it awards the lesson, so an attempt
 * that visibly reached the target could run out of time having never finished.
 * `flyRoute` latches its checkpoints for the same reason; this is the same rule
 * for the lessons judged on a held condition rather than on a route.
 */
export function latch(mem: LessonMemory, key: string, condition: boolean): boolean {
  if (condition) mem[key] = 1;
  return mem[key] === 1;
}

/** Straight-line distance from the drone to a world point, height included. */
export function dist3(position: Vec3, at: readonly [number, number, number]): number {
  return Math.hypot(position[0] - at[0], position[1] - at[1], position[2] - at[2]);
}

/** What `flyRoute` saw this frame. */
export interface RouteState {
  /** Index of the checkpoint being flown to now. */
  next: number;
  /** Every checkpoint has been taken, in order. */
  complete: boolean;
  /** A LATER checkpoint was reached first — the route was cut. */
  outOfOrder: boolean;
  /** Distance to the current target. */
  distance: number;
  /** 0..1 across the whole route, counting part-way along the current leg. */
  progress: number;
}

/**
 * Walk a lesson's checkpoints in order.
 *
 * The one route walker for every lesson that has a route. It replaced an XZ-only
 * pair of walkers once checkpoints became arena gates with a height, rather
 * than marks drawn on the floor beside the pad. Arrival LATCHES: passing through a gate
 * at speed counts, and the success cannot then be lost to the drift on the far
 * side.
 *
 * `strict` reports reaching a LATER checkpoint first as `outOfOrder`, so a
 * navigation lesson can end the attempt; without it an early corner is simply
 * not the corner that was asked for, and is ignored.
 */
/**
 * Has the drone taken this checkpoint?
 *
 * A plain point is a sphere: get within `reach` of it. A GATE is a hole, and a
 * hole is not round in every direction — passing a metre to the left of a ring
 * is not a pass at all, while passing a metre before or after its plane is the
 * same pass a moment earlier or later. So a checkpoint that carries an axis and
 * an opening is judged as a cylinder lying down that axis: `reach` along it,
 * `hole` across it. Everything else keeps the sphere.
 */
export function reachedCheckpoint(c: Checkpoint, position: Vec3): boolean {
  const dx = position[0] - c.at[0];
  const dy = position[1] - c.at[1];
  const dz = position[2] - c.at[2];
  if (!c.axis || c.hole === undefined) return Math.hypot(dx, dy, dz) < c.reach;
  const along = dx * c.axis[0] + dy * c.axis[1] + dz * c.axis[2];
  if (Math.abs(along) > c.reach) return false;
  // What is left after the along-axis part is taken out is the miss distance in
  // the plane of the opening — sideways and vertical together, because the
  // frame bounds both.
  const off = Math.hypot(dx - along * c.axis[0], dy - along * c.axis[1], dz - along * c.axis[2]);
  return off <= c.hole;
}

export function flyRoute(
  mem: LessonMemory,
  position: Vec3,
  route: readonly Checkpoint[],
  opts: { strict?: boolean; key?: string } = {},
): RouteState {
  // Which scratch-pad field holds the cursor. It is `wp` by default, because
  // that is also the field the Director reads for the live step on screen — for
  // most lessons the checkpoint reached IS the step reached. `flyMission` is
  // the exception: its rows are the stages of a flight, of which the route is
  // only the middle, so it walks the route on a field of its own and writes the
  // step number itself.
  const key = opts.key ?? 'wp';
  const next = mem[key] ?? 0;
  if (next >= route.length) {
    return { next: route.length, complete: true, outOfOrder: false, distance: 0, progress: 1 };
  }

  const target = route[next];
  const distance = dist3(position, target.at);
  if (reachedCheckpoint(target, position)) {
    mem[key] = next + 1;
    const done = next + 1;
    return {
      next: done,
      complete: done >= route.length,
      outOfOrder: false,
      distance: 0,
      progress: done / route.length,
    };
  }

  if (opts.strict) {
    // A later checkpoint only counts as CUT once the drone has actually been
    // clear of it. Without that guard a route which finishes where it starts —
    // Module 14 ends back over the "H" it took off from — fails on its very
    // first frame, before the pilot has moved.
    let left = mem.left ?? 0;
    for (let j = next + 1; j < route.length; j++) {
      const bit = 1 << j;
      const away = dist3(position, route[j].at);
      if (away >= route[j].reach * 1.6) left |= bit;
      // Cutting a gate means going THROUGH the later one, on the same test that
      // would have scored it. Flying past the outside of its frame is not a
      // shortcut, and ending the attempt for it would be punishing the pilot
      // for a gate they missed.
      else if (left & bit && reachedCheckpoint(route[j], position)) {
        mem.left = left;
        return { next, complete: false, outOfOrder: true, distance, progress: next / route.length };
      }
    }
    mem.left = left;
  }

  // How far along this leg, measured from WHERE THE LEG STARTED. The first
  // reading of a leg is its full length, so the bar sits at zero until the pilot
  // moves and reaches one on arrival, whatever the leg's length.
  //
  // It used to be measured against a fixed "spread" of metres around the target,
  // which meant a leg shorter than that spread began part-way along: Roll
  // Control opened at 19% before the pilot had touched anything, and a pilot who
  // has done nothing being told they are a fifth of the way there is the bar
  // saying something untrue about them.
  const startKey = `${key}leg${next}`;
  if (mem[startKey] === undefined) mem[startKey] = Math.max(distance, target.reach + 0.01);
  const span = Math.max(mem[startKey] - target.reach, 0.01);
  const leg = Math.max(0, Math.min(1, (mem[startKey] - distance) / span));
  return {
    next,
    complete: false,
    outOfOrder: false,
    distance,
    progress: (next + leg) / route.length,
  };
}

/** Horizontal distance from a world position to a world XZ point. */
export function horizontalDist(position: Vec3, x: number, z: number): number {
  return Math.hypot(position[0] - x, position[2] - z);
}

/**
 * How far the drone has strayed sideways from the straight line A->B, in metres.
 * Shape lessons score on this: reaching the corners is the task, holding the
 * line between them is the skill.
 */
export function lineDeviation(
  position: Vec3,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return horizontalDist(position, ax, az);
  // Perpendicular distance from the point to the infinite line through A and B.
  return Math.abs((position[0] - ax) * dz - (position[2] - az) * dx) / len;
}

/**
 * The heading that points from one place at another, in radians.
 *
 * Zero faces -Z, the same convention as the sim's yaw and `DemoLeg.face`: the
 * drone's nose is `(-sin yaw, 0, -cos yaw)`. Returns 0 for a target underfoot,
 * where no heading points at it.
 */
export function bearingTo(from: Vec3, to: readonly [number, number, number]): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(-dx, -dz);
}

/** Smallest signed difference a-b between two angles (radians), in degrees. */
export function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
