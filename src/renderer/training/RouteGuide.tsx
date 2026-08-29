import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTrainingStore } from '../state/trainingStore';
import { getLesson } from './lessons';
import type { Checkpoint } from './lessons/types';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';
import { CheckpointSphere, ORB_EDGE } from '../scene/CheckpointSphere';

// The route guide.
//
// It builds NO scenery. Every checkpoint a lesson names is something already
// standing on the field — a racing gate, a painted landing pad, one of the white
// markers ringing the helipad — and the pilot flies to THAT.
//
// It has been trimmed repeatedly, always for the same reason: something drawn
// over the arena that could not be hidden. A letter over every checkpoint at
// once — the "A B C D everywhere" that made the field unreadable. A chevron
// drawn with `depthTest` off, which filled the screen whenever the target was
// underneath the drone. Route lines drawn the same way, which stopped being
// lines hanging in the air and became a yellow stripe painted flat across the
// arena floor.
//
// Four things are left, and each is opt-in, so a lesson gets none of them by
// simply naming two points.
//
//   - A NAME on the target, for a lesson that calls its checkpoint something
//     the field does not say by itself. Module 7 sends the pilot through the
//     blue square gate and calls it "A"; nothing is painted on that gate, so
//     without this the instruction names a thing the pilot cannot pick out.
//     Depth-tested, so the frame in front of it hides it like anything else.
//
//   - Module 11's RING, the one shape that is not an arena object at all: there
//     is nothing standing on the field to fly around, so without it the lesson
//     is "fly a circle of some radius somewhere near the pad".
//
//   - An ORB, for a checkpoint that is a hole to be flown through rather than a
//     thing to be named: a ball of pink light hanging in the middle of the
//     opening, which goes out as the drone passes through it. Module 7 flies it
//     instead of a letter. Same rule as the letter — asked for one checkpoint
//     at a time, never handed out for simply having a route.
//
//   - A PILLAR, the orb's answer for a checkpoint that is a place on the GROUND:
//     a column of the same pink light standing on the spot, as wide as the
//     checkpoint's own acceptance radius, which the drone flies INTO and which
//     goes out behind it. The shape circuits fly them — a corner is a patch of
//     air over one of sixteen identical white markers, and that is exactly what
//     a ball hanging at flying height cannot point at.
/** The circle lesson's painted lap line. Red, so it cannot be taken for one of
 *  the pad's own white markings — it is the one thing on that deck the pilot is
 *  being asked to fly. */
const RING = '#ff2b4d';
/** Half the width of that painted stripe, in metres. */
const RING_W = 0.2;
/** One colour for every name on the field, and one brightness.
 *
 *  Red, matching the lap line: these are the marks the pilot is being sent to,
 *  and the arena's own paint is white and its own furniture is blue and green.
 *
 *  They used to breathe on the live one and sit at 40% on the rest, which meant
 *  a letter could be on the field and barely readable, and a glance had to work
 *  out which of two half-lit letters was meant. What is still to do is what is
 *  still THERE — a name comes off the field the moment its place is behind the
 *  pilot — so the state is already being told, and telling it twice in fading
 *  paint only made the paint harder to read. */
const LABEL = '#ff2b4d';
/** How wide a number painted on the ground is, in metres. */
const PAINT_M = 2.4;
/** The beam standing on the checkpoint being flown to RIGHT NOW.
 *
 *  Yellow, and the only yellow on the field: the letters are red, the arena's
 *  own paint is white and its furniture blue and green, so nothing else can be
 *  mistaken for it. */
const BEAM = '#ffd21f';
/** How tall that beam stands, in metres, and how thick. Tall enough to clear the
 *  gates and be seen over the far side of the pad; thin enough that flying
 *  through it does not hide the corner underneath. */
const BEAM_H = 7;
const BEAM_R = 0.34;
/** How much of a gate's opening the ball fills, as a fraction of the opening.
 *
 *  Big. It is the thing the pilot flies AT from sixteen metres, and a modest
 *  ball at that range is a dot. It is deliberately not "as much as fits": the
 *  orb sits on the CHECKPOINT, which on a module flown level in altitude hold is
 *  at hover height rather than at the middle of the frame, so a ball wide enough
 *  to touch the uprights would also be buried in the bottom bar. The corona
 *  spills well past this — it is additive and allowed to lie over the frame —
 *  so the ball itself stays comfortably inside the hole. */
const ORB_FILL = 0.33;
/** Seconds a light on this field takes to go out once its checkpoint is behind
 *  the drone. The orb keeps its own copy of this timing; the pillar reads it
 *  from here so the two go out together. */
const ORB_FADE = 0.4;
/** How far ABOVE its checkpoint a gate's ball is drawn, in metres.
 *
 *  The checkpoint sits at hover height, because that is the height the module is
 *  judged at and a module flown level in altitude hold cannot be asked to climb
 *  to a mark it has not been taught to reach. The gate's OPENING is higher than
 *  that — the blue near gate is centred at 2.6 m and hover is 1.8 — so a ball
 *  drawn honestly on the checkpoint hangs in the bottom of the hole and buries
 *  its lower half in the bottom bar.
 *
 *  So the light goes up and the checkpoint stays put. `CheckpointSphere` clamps
 *  this to `reach - radius`, which for that gate is 1.99 - 1.12 = 0.87 m, so the
 *  whole visible ball is still inside the volume that scores however far this is
 *  turned up. Raise it toward the ceiling to centre the ball in the opening;
 *  this sits under it, because a ball that fills the middle of the hole also
 *  hides the hole. */
const ORB_LIFT = 0.6;
/** How far above the checkpoint the pillar's column ends, in metres.
 *
 *  Enough headroom that a corner taken a little high still enters the light —
 *  a column stopping dead at the flown height is a disc seen from the cockpit,
 *  and clearing it by half a metre would miss a checkpoint the pilot was
 *  visibly on. Not more than that: at 1.6 m the columns stood nearly a third
 *  taller than they were wide and read as chimneys standing round the pad
 *  rather than as marks on it.
 *
 *  This is ALL the height there is to give back, and it is worth being plain
 *  about why. The column runs from the DECK up past the checkpoint, because a
 *  mark on the ground is the whole reason it exists — so on the shape circuits
 *  its height is `FLY_AT` (3.3 m) plus this, and `FLY_AT` is a curriculum
 *  number, not a drawing one. Everything above the checkpoint is the only part
 *  anybody gets to choose, and at 0.25 there is just enough for a corner taken
 *  a little high to still be inside the light and no more.
 *
 *  What that buys: 3.41 m tall against 3.6 m across, so the column is now wider
 *  than it is tall. Widening it to make it look shorter is NOT an option — the
 *  radius is the checkpoint's own `reach`, and the pink has to keep meaning
 *  "inside here scores". */
const PILLAR_TOP = 0.25;
/** How much of the column's brightness survives to its top edge, 0..1, and how
 *  much is left half way up.
 *
 *  It fades upward rather than ending in a hard rim. A ruled circle hanging in
 *  the air reads as a hoop to be flown through, which is the wrong instruction —
 *  the pilot is being asked to fly INTO this, at any height inside it.
 *
 *  Both were far lower, and between them they were most of why the columns came
 *  out as pale dust rather than as pink light. The fade MULTIPLIES the wall's
 *  opacity, so at 0.5 half way up it was quietly halving an alpha that was
 *  already low — and half way up is exactly where the circuit is flown and where
 *  the pilot is looking. Raising the floor of the fade lifts the whole column
 *  without touching the shape of it. */
const PILLAR_FADE_TOP = 0.05;
const PILLAR_FADE_MID = 0.8;
/** Where the top taper ends, as a fraction of the column's height measured DOWN
 *  from its top, and what the column is worth once it is past it.
 *
 *  This is the shape that stops a column reading as a tall slab. Spread the fade
 *  evenly from top to bottom and every part of it is half-lit, which looks like
 *  a curtain hanging the full height of the thing; put the whole fade in the top
 *  tenth instead and the column has a soft END, with everything below it at full
 *  strength. Shorter to look at and brighter where it is flown, from the same
 *  geometry.
 *
 *  It has to be a small fraction for a second reason: the circuit is flown near
 *  the TOP of this column — 3.3 m of a 3.6 m column — so a taper that starts any
 *  lower is dimming the band the pilot is actually inside. */
const PILLAR_TAPER = 0.1;
const PILLAR_FADE_SHOULDER = 0.55;
/** The wall's opacity, and how much the live one's pulse adds on top.
 *
 *  Alpha-blended, so this is literally how much of the magenta survives against
 *  the background: at 0.26 over pale concrete the wall came back as a dusty
 *  mauve with the colour washed out of it. */
const PILLAR_WALL = 0.4;
const PILLAR_WALL_PULSE = 0.12;
/** The light the column throws on the deck: its colour, its opacity, and its
 *  pulse.
 *
 *  The colour is SATURATED, which is the whole point of changing it. The disc is
 *  additive, so what it adds is what you get — and it used to add the orb's
 *  near-white pale pink, which brightens all three channels almost equally and
 *  therefore bleaches the concrete rather than colouring it. A saturated magenta
 *  adds almost nothing to green, so the deck goes PINK instead of pale. */
const PILLAR_POOL = '#ff5ce0';
const PILLAR_DISC = 0.45;
const PILLAR_DISC_PULSE = 0.2;
/** How much of full brightness a corner that is NOT the one being flown to right
 *  now keeps.
 *
 *  It was 0.4, which on top of everything else left the corners still to come
 *  almost invisible — and on a shape circuit every remaining corner is part of
 *  the shape the pilot is trying to see. Enough of a gap that the live one still
 *  reads as the live one, and no more. */
const PILLAR_DIM = 0.62;

/**
 * A checkpoint's name, painted into a canvas.
 *
 * The arena has no text renderer — every marking on the field is geometry — so
 * the text is drawn once per label and cached.
 *
 * `ground` is the version that goes on the FLOOR, and it is a different picture,
 * not the same one turned flat: it carries its own dark disc, because a bare
 * white glyph lying on white pad paint is not a number, it is a scuff.
 */
const labelTextures = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string, ground = false): THREE.CanvasTexture {
  const key = ground ? `g:${text}` : text;
  const cached = labelTextures.get(key);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (ground) {
      ctx.fillStyle = 'rgba(12, 16, 24, 0.72)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = size * 0.045;
      ctx.strokeStyle = LABEL;
      ctx.stroke();
    }
    ctx.fillStyle = ground ? LABEL : '#ffffff';
    ctx.font = `700 ${text.length > 1 ? 108 : 176}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  labelTextures.set(key, texture);
  return texture;
}

/**
 * The height the floor sits at under a point, in world Y.
 *
 * The helipad is a slab standing 0.12 m proud of the field, and the markers
 * these numbers go on ring its edge — paint dropped at y = 0 there disappears
 * inside the concrete.
 */
function floorY(x: number, z: number): number {
  const onPad =
    Math.hypot(x - ACADEMY_PAD.center[0], z - ACADEMY_PAD.center[1]) <= ACADEMY_PAD.radius;
  return (onPad ? ACADEMY_PAD.surfaceY : 0) + 0.02;
}

/**
 * A checkpoint's name, PAINTED ON THE GROUND under it.
 *
 * For anything standing on the floor — the ring markers, the pads, the "H" —
 * this is where the number belongs. Sprites hanging over them floated in the
 * middle of the flying space, in front of the very corners they were labelling,
 * and read as clutter; on the deck they read as a marked-out course, and the
 * pilot looks DOWN at the shape they are being asked to fly. It is a marking
 * like any other marking in the arena, so it is drawn like one: flat, offset out
 * of the concrete, and depth-tested.
 *
 * The text points down the field (its top toward -Z), which is the way the
 * chase camera reads it on every lesson that uses this — none of them turn.
 */
function GroundLabel({ point }: { point: Checkpoint }) {
  const [px, , pz] = point.at;
  // Pulled in far enough to sit WHOLLY on the concrete. The ring markers stand
  // 6.8 m out on a 7 m slab, so a 2.4 m disc centred on one would hang most of
  // its far half over the grass — and the slab is 0.12 m proud, so that half
  // would be floating.
  //
  // NOT under a pillar, though. The pull-in moves the letter a full metre in
  // from the checkpoint, and a pillar is drawn at the checkpoint's own reach —
  // so a letter that has been slid a metre sideways inside a 1.8 m pool sits
  // visibly off to one side of the light standing on it, and the two read as two
  // different marks rather than as one. The light is the half that cannot move:
  // it IS the acceptance volume, and sliding it to meet the paint would put the
  // pink somewhere the validator does not score. So the paint moves back onto
  // the checkpoint instead and is allowed to overhang.
  //
  // Which costs less than it sounds. The pillar's own pool is 1.8 m across at
  // that same centre and already spills 1.6 m onto the grass, so the letter's
  // 0.9 m is not a new kind of thing on the field — and it lands INSIDE that
  // pool, where a bright additive light over the edge of the slab is doing most
  // of the work of hiding where the concrete stops.
  const [x, z] = useMemo(() => {
    if (point.pillar) return [px, pz];
    const [cx, cz] = ACADEMY_PAD.center;
    const r = Math.hypot(px - cx, pz - cz);
    const max = ACADEMY_PAD.radius - PAINT_M / 2;
    if (r <= max || r < 1e-6) return [px, pz];
    return [cx + ((px - cx) / r) * max, cz + ((pz - cz) / r) * max];
  }, [px, pz, point.pillar]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, floorY(x, z), z]}>
      <planeGeometry args={[PAINT_M, PAINT_M]} />
      <meshBasicMaterial
        map={labelTexture(point.tag ?? '', true)}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  );
}

/**
 * A checkpoint's name IN a gate, as a sprite hanging in the opening.
 *
 * A gate is the one landmark that is not on the floor, and it is met head-on
 * from tens of metres away: paint under it would be looked at edge-on and read
 * as nothing at all.
 *
 * It sits on the checkpoint itself — the middle of the hole, at the height the
 * lesson is actually judged at — rather than perched above the frame. Above it,
 * the letter named the gate; in it, the letter IS the thing to fly at, and the
 * pilot lines up on the letter and goes through it.
 */
function GateLabel({ point }: { point: Checkpoint }) {
  const [x, y, z] = point.at;
  return (
    <sprite position={[x, y, z]} scale={[2.2, 2.2, 2.2]}>
      <spriteMaterial
        map={labelTexture(point.tag ?? '')}
        color={LABEL}
        transparent
        opacity={1}
        depthWrite={false}
      />
    </sprite>
  );
}

/**
 * A gate's checkpoint, marked with a ball of light instead of a letter.
 *
 * All of the light is `CheckpointSphere`'s; what is here is the part that is
 * about the ARENA. `GateLabel` writes the checkpoint's name in the hole, which
 * answers "which gate"; this answers "where exactly, and did I get it". On a
 * module whose whole exercise is one straight line the second is the useful
 * question: the pilot lines up on the light, holds it in the middle of the view,
 * and flies through it.
 *
 * The LESSON stays the authority on whether the pass counted — `out` is its
 * route cursor — but the sphere's own trigger is left armed underneath it, so
 * the light also goes out the moment the drone is visibly inside it. The two
 * agree by construction: the trigger is handed the checkpoint's own `reach`,
 * which is the radius the validator scores on.
 */
function CheckpointOrb({ point, out }: { point: Checkpoint; out: boolean }) {
  return (
    <CheckpointSphere
      position={point.at}
      // A GATE's ball is sized off the opening it hangs in; anything else is
      // sized off the checkpoint's own `reach`, which for a plain point is
      // literally the sphere the validator tests. So on a ground corner the ball
      // does not merely mark the checkpoint, it IS it — inside the light is
      // scored and outside it is not, the same promise the pillar makes.
      //
      // `markSize` is no use off a gate: on a ring marker it is the size of the
      // little white sphere itself, 0.9 m, and a third of that is a 30 cm token
      // being aimed at from across the pad.
      radius={point.mark === 'gate' ? (point.markSize ?? 3) * ORB_FILL : point.reach}
      // `hole` first, and only `reach` when there is none.
      //
      // On a gate the lesson flies THROUGH, the two are different measurements:
      // `reach` is how much slack there is ALONG the axis — generous, because a
      // pass a moment early or late is the same pass — while `hole` is the half
      // opening, and it is the one the validator tests across the axis. The
      // sphere here has only one radius for every direction, so handing it
      // `reach` would let the light go out for a drone that flew a couple of
      // metres wide of the frame and never went through anything. `hole` is the
      // conservative half of the pair: inside it is inside the pass on both
      // axes, so the light can never claim a gate the lesson has not.
      triggerRadius={point.hole ?? point.reach}
      collected={out}
      lift={ORB_LIFT}
    />
  );
}

/**
 * The vertical falloff painted down a pillar's wall, as a one-pixel-wide texture.
 *
 * The column is brightest where it meets the deck — that is the corner, the
 * thing being pointed at — and thins as it rises, so it never becomes a wall
 * standing between the pilot and the rest of the shape. Drawn rather than
 * fetched, like the halo and the letters: nothing on this project may come off
 * the network. One column of pixels, stretched round the tube.
 *
 * Three.js flips textures vertically, so the canvas's TOP row is the cylinder's
 * top — the faint end is written first.
 */
let pillarFalloff: THREE.CanvasTexture | undefined;

function pillarTexture(): THREE.CanvasTexture {
  if (pillarFalloff) return pillarFalloff;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, `rgba(255, 255, 255, ${PILLAR_FADE_TOP})`);
    g.addColorStop(PILLAR_TAPER, `rgba(255, 255, 255, ${PILLAR_FADE_SHOULDER})`);
    g.addColorStop(0.55, `rgba(255, 255, 255, ${PILLAR_FADE_MID})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 128);
  }
  pillarFalloff = new THREE.CanvasTexture(canvas);
  pillarFalloff.colorSpace = THREE.SRGBColorSpace;
  return pillarFalloff;
}

/**
 * A column of pink light STANDING ON a checkpoint, which the drone flies INTO.
 *
 * The ground answer to `CheckpointOrb`. A gate is a hole, and a ball hanging in
 * it says "here, exactly". A corner of a circuit is a place on the DECK, and a
 * ball over it says almost nothing: at flying height it is read against the sky
 * from the far side of the pad, with no way to tell which of sixteen identical
 * white markers is underneath it. A column has a foot. The pilot sees the spot
 * on the ground and the space above it as one object, and the corner is taken by
 * putting the aircraft inside the light rather than by watching a number.
 *
 * It is drawn at the checkpoint's own `reach`, which makes the pink volume the
 * ACCEPTANCE volume: inside the light is scored, and outside it is not. That is
 * the whole reason to prefer it to the yellow beam here — the beam is a 0.34 m
 * pointer standing on a checkpoint judged at 1.8 m, so a corner could be flown
 * visibly clear of the light and still count, or flown straight at the light and
 * still come up short, and neither told the pilot anything they could act on.
 *
 * Alpha-blended rather than additive, for the same reason the orb's body is:
 * additive over the academy's pale sky sums to white and the colour is gone at
 * exactly the range the corner has to be picked out from. The disc on the DECK
 * is additive, because it is lying on concrete — there additive reads as light
 * thrown on the ground, and it brightens the painted letter under it instead of
 * covering it up. Both depth-tested and neither writing depth: the drone inside
 * the column is never hidden by it.
 *
 * `live` is this being the corner to fly to right now; the ones after it stand
 * dimmer and still, so four columns still read as one shape with one of them
 * awake. `out` is it being behind the aircraft: the column widens as it dims, so
 * taking a corner is something the arena does in answer to the flight rather
 * than a mesh being unmounted.
 */
function CheckpointPillar({
  point,
  live,
  out,
}: {
  point: Checkpoint;
  live: boolean;
  out: boolean;
}) {
  const [x, y, z] = point.at;
  const base = floorY(x, z);
  const height = Math.max(y + PILLAR_TOP - base, 1);
  const r = point.reach;

  const group = useRef<THREE.Group>(null);
  const wall = useRef<THREE.Material>(null);
  const disc = useRef<THREE.Material>(null);
  /** How lit it is, 0..1. Driven both ways, so a retried attempt lights the
   *  corners back up instead of leaving dark stumps standing round the pad. */
  const lit = useRef(1);

  useFrame(({ clock }, dt) => {
    // Clamped, like the orb: a frame lost to a shader compile or a window drag
    // must not put the whole fade through in one step.
    const step = Math.min(dt, 0.1) / ORB_FADE;
    const t = (lit.current = out
      ? Math.max(0, lit.current - step)
      : Math.min(1, lit.current + step));

    if (group.current) {
      group.current.visible = t > 0.002;
      // Wider, not taller. A column that grew upward as it went out would read
      // as something being launched rather than as something being passed.
      const s = 1 + 0.3 * (1 - t);
      group.current.scale.set(s, 1, s);
    }

    // Shallow, and only on the live one — the same rule the beam follows. This
    // is a landmark being aimed at, and something that visibly throbs is harder
    // to hold a line on.
    const pulse = live ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.7) : 0;
    const k = t * (live ? 1 : PILLAR_DIM);
    if (wall.current) wall.current.opacity = k * (PILLAR_WALL + PILLAR_WALL_PULSE * pulse);
    if (disc.current) disc.current.opacity = k * (PILLAR_DISC + PILLAR_DISC_PULSE * pulse);
  });

  return (
    <group ref={group} position={[x, base, z]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[r, r, height, 40, 1, true]} />
        <meshBasicMaterial
          ref={wall}
          map={pillarTexture()}
          color={ORB_EDGE}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* The light it throws on the deck. Offset out of the concrete and
          polygon-offset on top of it, the way every other marking here is, so it
          never fights the pad's own paint for the same depth. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[r, 40]} />
        <meshBasicMaterial
          ref={disc}
          color={PILLAR_POOL}
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-6}
        />
      </mesh>
    </group>
  );
}

/**
 * The lap the circle lesson flies, PAINTED ON THE DECK.
 *
 * The one piece of geometry the guide adds, because it is the one shape with
 * nothing standing on the field to fly around — the ring of white markers is
 * sixteen dots, not a line, and Module 11 is judged on how evenly the radius was
 * held between them.
 *
 * On the deck rather than hanging at flying height, for the same reason the
 * corner letters are: a stripe in the air sits in the middle of the space the
 * drone is trying to occupy, and to be seen through the pad at all it had to
 * skip depth testing, which put it over everything. Painted, it is a lap line
 * like the ones on a running track, and the pilot flies above it and looks down.
 *
 * The outer edge is held inside the slab, so the stripe never leaves the
 * concrete for the grass 0.12 m below it.
 */
function Ring({ radius }: { radius: number }) {
  const [cx, cz] = ACADEMY_PAD.center;
  const outer = Math.min(radius + RING_W, ACADEMY_PAD.radius);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY(cx + radius, cz), cz]}>
      <ringGeometry args={[Math.max(outer - RING_W * 2, 0.1), outer, 96]} />
      <meshBasicMaterial
        color={RING}
        transparent
        opacity={0.9}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  );
}

/**
 * A column of light standing on the checkpoint being flown to right now.
 *
 * The letters say what the shape IS. They do not say which corner is next, and
 * once they stopped coming off the field as they were passed — they now stand
 * for the whole lesson, because a pilot halfway round a triangle still needs to
 * see the triangle — nothing did. Reading it off the step row means looking away
 * from the arena at the moment the drone is moving.
 *
 * So the answer stands on the field itself, and it is the one thing here that
 * MOVES: it marks a single corner, goes out the moment that corner is reached,
 * and lights up on the next one. Arriving is the beam going out, which is a
 * thing the pilot sees happen rather than a number they have to check.
 *
 * Drawn as two nested tubes, both additive and depth-tested: a soft wide one for
 * the glow and a bright narrow core so it still reads against a pale sky. It
 * breathes slowly, because a steady column at this size sits in the scene like
 * scenery and this is not scenery.
 */
function TargetBeam({ point, live }: { point: Checkpoint; live: boolean }) {
  const [x, , z] = point.at;
  const glow = useRef<THREE.Material>(null);
  const core = useRef<THREE.Material>(null);

  useFrame(({ clock }) => {
    // The corner being flown to breathes; the ones after it stand steady and
    // dimmer. Every remaining corner is lit, so without that difference three
    // identical columns say "somewhere over there" — which is the question the
    // beam exists to answer. Same colour and same shape, so they still read as
    // one set of three, just one of them awake.
    const pulse = live ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.2) : 0;
    if (glow.current) glow.current.opacity = (live ? 0.16 : 0.08) + 0.14 * pulse;
    if (core.current) core.current.opacity = (live ? 0.5 : 0.24) + 0.3 * pulse;
  });

  const y = floorY(x, z) + BEAM_H / 2;

  return (
    <group position={[x, y, z]}>
      <mesh>
        <cylinderGeometry args={[BEAM_R, BEAM_R, BEAM_H, 20, 1, true]} />
        <meshBasicMaterial
          ref={glow}
          color={BEAM}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <cylinderGeometry args={[BEAM_R * 0.36, BEAM_R * 0.36, BEAM_H, 12, 1, true]} />
        <meshBasicMaterial
          ref={core}
          color={BEAM}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/** Two checkpoints are the same PLACE if they are the same spot on the field. */
function samePlace(a: Checkpoint, b: Checkpoint): boolean {
  return Math.abs(a.at[0] - b.at[0]) < 0.2 && Math.abs(a.at[2] - b.at[2]) < 0.2;
}

export function RouteGuide() {
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const routeTarget = useTrainingStore((s) => s.routeTarget);
  const phase = useTrainingStore((s) => s.phase);

  const lesson = useMemo(
    () => (activeLessonId ? getLesson(activeLessonId) : undefined),
    [activeLessonId],
  );

  // A name goes up once per PLACE, and STAYS UP for the whole lesson.
  //
  // It used to come down as the pilot passed it, on the reasoning that what is
  // still on the field should be what is still to do. That reasoning was right
  // when nothing else on the field said where to go next; it is wrong now that
  // the beam does. A shape lesson is flown by looking at the SHAPE, and a
  // triangle that loses a corner each time you round it stops being a triangle
  // by the third leg — exactly when the pilot most needs to see where the
  // closing side is going to run.
  //
  // So the letters are the shape and the beam — or, on the shape circuits, the
  // pillar — is the cursor: one tells you what you are flying, the other tells
  // you which bit of it is next.
  const named = useMemo(() => {
    const route = lesson?.route ?? [];
    return route
      .map((c, i) => ({
        point: c,
        // A circuit closes on the corner it opened at, so the same place can
        // appear twice in a route. It gets ONE letter and ONE beam.
        first: route.findIndex((d) => samePlace(d, c)) === i,
        // The LAST time the route asks for this place. A triangle comes back to
        // A to close the loop, so A is not finished the first time it is
        // reached — its beam has to survive the pass and go out at the end.
        last: route.reduce((n, d, j) => (samePlace(d, c) ? j : n), i),
      }))
      .filter((e) => e.first && (e.point.tag !== undefined || e.point.orb || e.point.pillar));
  }, [lesson]);

  if (!lesson) return null;
  // Only while something is actually being flown. Outside those phases there is
  // no "next", so a beam would be pointing at a corner nobody is on the way to.
  const tracking = phase === 'practice' || phase === 'demo';
  const live = tracking ? lesson.route?.[routeTarget] : undefined;

  return (
    <>
      {lesson.guideRing && <Ring radius={lesson.guideRing.radius} />}
      {/* One beam per corner still to be taken, going out as each is reached.
          Not on a gate: a gate already carries its letter in the opening, at the
          height it is flown through, and a column of light standing in a hole
          the pilot is aiming to fly through hides the hole. */}
      {named.map((e, i) => {
        if (e.point.mark === 'gate') return null;
        // A pillar already stands on this spot, and it is the wider, better-aimed
        // column of the two. Two lit columns in one place read as two corners.
        if (e.point.pillar) return null;
        // Same rule for a ball. It is drawn at the checkpoint's own reach, so it
        // is the better-aimed mark of the two — and a 7 m beam standing through
        // the middle of it is a second, taller mark in the same place.
        if (e.point.orb) return null;
        if (tracking && routeTarget > e.last) return null;
        return (
          <TargetBeam
            key={`beam-${e.point.label}-${i}`}
            point={e.point}
            live={!!live && samePlace(live, e.point)}
          />
        );
      })}
      {/* The pillars, drawn before the letters so a lit column never paints over
          the letter at its own foot: both are transparent and neither writes
          depth, so what is drawn last wins.

          `out` is not gated on `tracking`, for the same reason the orb's is not:
          the flight ends the moment the last corner is scored, and a column that
          lit back up over the result card would be undoing the pass the pilot
          had just watched it acknowledge. */}
      {named.map((e, i) =>
        e.point.pillar ? (
          <CheckpointPillar
            key={`pillar-${e.point.label}-${i}`}
            point={e.point}
            live={!!live && samePlace(live, e.point)}
            out={routeTarget > e.last}
          />
        ) : null,
      )}
      {named.map((e, i) => {
        // The orb is the one mark here that has a STATE, so it is the one that
        // is told when its checkpoint has been taken. Not gated on `tracking`:
        // the flight ends the moment the last checkpoint is scored, and a light
        // that came back on over the result card would be undoing the pass the
        // pilot had just watched it acknowledge.
        if (e.point.orb) {
          return (
            <CheckpointOrb
              key={`orb-${e.point.label}-${i}`}
              point={e.point}
              out={routeTarget > e.last}
            />
          );
        }
        return e.point.mark === 'gate' ? (
          <GateLabel key={`label-${e.point.label}-${i}`} point={e.point} />
        ) : (
          <GroundLabel key={`label-${e.point.label}-${i}`} point={e.point} />
        );
      })}
    </>
  );
}
