import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';

// ----------------------------------------------------------------------------
// The target ring — a floating direction indicator AROUND the drone.
//
// The chase camera sits behind the nose, so it can only ever show what is in
// front of the aircraft. The question a pilot has mid-route is "where is the one
// I am flying to", and on the navigation modules the answer is regularly behind
// them: coming out the far side of a gate leaves the next one off the edge of
// the picture entirely.
//
// So the answer is drawn round the drone itself. A thin ring floats at the
// aircraft's own position with ONE red arrow riding its rim, and the arrow sits
// where the checkpoint is RELATIVE TO THE NOSE: straight ahead puts it at the
// top of the ring, hard right puts it on the right, behind puts it at the
// bottom. Turn the aircraft and the arrow travels round to meet the new heading;
// bring it back to the top and you are pointed at the checkpoint. Nothing has to
// be read — the arrow is the instruction.
//
// Three things this is NOT, each of which it was at some point:
//
//   - It is NOT a ring on the ground. `scene/GroundMarker.tsx` is that, it is a
//     different feature answering a different question ("how high am I, and what
//     is under me"), and it takes its height from the support probe. This takes
//     nothing from the ground: no surface height, no terrain, no probe, no y=0.
//     It sits at the drone's own position and floats with it.
//   - It is NOT a compass. A compass says where NORTH is. This says where the
//     CHECKPOINT is, and that is why there are no bearings, no cardinal marks
//     and no numbers on it — one ring, one arrow, nothing else.
//   - It is NOT a mark on the edge of the screen. That was built first and taken
//     out: a screen-edge chevron lives in a different space from the thing it is
//     about, so it has to be read as a symbol and then converted into a turn.
//     This is in the world with the aircraft, at its scale.
//
// The CIRCLE never turns to show anything. It is a fixed dial and it looks
// identical wherever the checkpoint is; only the arrow moves on it. The ring
// does face the camera, which is not the same thing — that is what makes a
// circle read as a circle instead of as an ellipse seen edge-on, and a circle
// looks the same at every roll angle, so nothing about the direction is being
// said by it.
// ----------------------------------------------------------------------------

/** How far out the ring floats from the drone's centre, in metres.
 *
 *  The airframes here span 0.32 m (Pluto) to 0.62 m (Racer) across the props, so
 *  this clears the widest of them — the drone sits INSIDE the circle with room
 *  around it — while staying close enough to read as part of the aircraft rather
 *  than as scenery it happens to be inside.
 *
 *  It was 0.6, which cleared the props twice over and, from the chase camera,
 *  drew a white hoop most of the way across the picture. The dial only has to be
 *  big enough for the arrow's position on it to be readable; anything past that
 *  is a line over the city. */
const RADIUS = 0.42;
/** How quickly the arrow chases a new bearing, and the seconds the whole ring
 *  takes to fade in or out.
 *
 *  The chase is deliberately not instant. The bearing is recomputed from a
 *  position and a heading that both move every frame, so an arrow pinned exactly
 *  to it twitches; and a checkpoint being scored moves the target to the next
 *  one in a single frame, which without damping is a jump rather than a
 *  movement. */
const TURN_RATE = 8;
const FADE = 0.25;
/** Inside this many metres the arrow HOLDS its last position instead of
 *  tracking.
 *
 *  Right on top of a checkpoint the relative bearing swings through half a turn
 *  in a stride, and an arrow chasing that spins. The ring stays up — it is only
 *  the tracking that pauses, for the moment when the pilot should be looking at
 *  the gate rather than at an instrument. */
const HOLD_M = 0.9;

const RIM = '#cbd5e1';
const ARROW = '#ff2b4d';
/** How much of the circle the marker occupies, in radians.
 *
 *  The rim is a hairline so it stops drawing a hoop over the city, and the
 *  marker is the stretch of it that is doing work: thickened, red, and swelling
 *  to a point. Wide enough to be found at a glance, narrow enough that WHERE on
 *  the dial it sits is still the thing being read. */
const ARC = 0.2;

/**
 * The marker, as a filled outline in the ring's own plane.
 *
 * There is no separate arrow any more. A head standing off the rim is two
 * objects that have to be read as one, and at the size this is actually flown it
 * never was: the ring went faint enough to stay out of the city's way, and what
 * was left was a red splinter floating over the street with nothing under it.
 *
 * So the marker IS a piece of the circle. A stretch of the rim thickens, turns
 * red, and swells outward to a point in the middle of that stretch. Nothing
 * hovers, nothing has to be joined up, and the thing the pilot reads — where on
 * the dial the red is — is the same as it ever was.
 *
 * Built in absolute ring coordinates with the segment centred on the TOP of the
 * circle, so the group carrying it only has to turn by the arrow's angle.
 */
const MARK_SHAPE = (() => {
  /** Half the band's thickness, and how far the middle of it reaches past the
   *  rim to make the point. The tip is a little over three times the band, which
   *  is what reads as "pointed" rather than as a bump.
   *
   *  Both are small. The mark is a hand on a dial and it is read by WHERE it is,
   *  not by how much of the picture it takes: at four times this thickness it
   *  was a slab of red hanging off the side of the aircraft. */
  const w = 0.005;
  const tip = 0.055;
  /** How much of the segment the point occupies, as a fraction of its HALF
   *  width. It must never exceed it: with a wider nose the taper is still part
   *  way up when the segment runs out, so the outer edge stops on a step rather
   *  than closing on the apex, and the mark comes out as a blunt lopsided wedge.
   *  Equal to it, the rise reaches zero at both ends and the shape is a clean
   *  triangle standing on the rim. */
  const nose = ARC / 2;
  const STEPS = 24;

  const shape = new THREE.Shape();
  const at = (t: number, r: number): [number, number] => {
    // t is measured from the top of the circle, clockwise, matching the way the
    // arrow's angle is measured.
    const th = Math.PI / 2 - t;
    return [Math.cos(th) * r, Math.sin(th) * r];
  };

  // Outer edge, left to right: flat, up to the point, flat again.
  for (let i = 0; i <= STEPS; i++) {
    const t = -ARC / 2 + (ARC * i) / STEPS;
    const rise = Math.max(0, 1 - Math.abs(t) / nose);
    const [x, y] = at(t, RADIUS + w + tip * rise);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // Inner edge, back the other way. Plain: the point belongs on the outside,
  // where it is pointing.
  for (let i = STEPS; i >= 0; i--) {
    const t = -ARC / 2 + (ARC * i) / STEPS;
    const [x, y] = at(t, RADIUS - w);
    shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
})();

/**
 * The ring, pointed at one place.
 *
 * `at` is a world position and nothing else — whatever the caller is already
 * asking the pilot for. Flight School hands it the live entry of `lesson.route`;
 * a mission hands it the checkpoint its route cursor is on, or the zone once the
 * leg's checkpoints are behind it. Nothing about the target is computed, stored
 * or duplicated here: this reads a point and draws a direction, which is why it
 * can serve both without knowing what either of them is.
 *
 * Undefined takes the ring off the field — outside a flight there is no "next",
 * and an arrow pointing at nothing is worse than no arrow.
 */
export function TargetRing({ at }: { at?: readonly [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Group>(null);
  const rim = useRef<THREE.Material>(null);
  const head = useRef<THREE.Material>(null);

  /** How lit it is, 0..1, and where the arrow sits on the rim, in radians
   *  clockwise from the top of the circle. */
  const lit = useRef(0);
  const angle = useRef(0);

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g) return;

    // Clamped, like every other fade in the guide: a frame lost to a shader
    // compile or a window drag must not put the whole thing through in one step.
    const step = Math.min(dt, 0.1);

    // POSITION — the drone's own, and nothing else. Not the ground under it, not
    // a surface height, not an offset from y = 0. The ring floats with the
    // aircraft and stays centred on it.
    if (dronePose.present) g.position.copy(dronePose.position);

    // ORIENTATION — square to the camera, so the circle is always a circle and
    // the drone is always inside it. This is also what keeps the ring free of
    // the airframe's PITCH and ROLL: it is never given the drone's quaternion,
    // so banking hard through a corner does not tip the instrument with it.
    g.quaternion.copy(camera.quaternion);

    if (at && dronePose.present) {
      const dx = at[0] - dronePose.position.x;
      const dz = at[2] - dronePose.position.z;
      // FLAT. A checkpoint two metres overhead is still straight ahead, and
      // folding height into this would send the arrow round the ring for a
      // difference the pilot answers with throttle, not with a turn.
      const flat = Math.hypot(dx, dz);

      if (flat > HOLD_M) {
        // Where the checkpoint is RELATIVE TO THE NOSE. The same yaw the plan
        // view reads off the pose quaternion, and the same convention: heading 0
        // faces -Z.
        const q = dronePose.quaternion;
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        // Right-hand side of the aircraft: the forward vector turned a quarter
        // turn, so that +X is "right" when the nose is down -Z.
        const rx = -fz;
        const rz = fx;
        // Resolve the line to the checkpoint onto those two axes and the angle
        // between them IS the place on the rim: 0 is ahead and therefore the top
        // of the ring, a quarter turn is the right-hand side, half a turn is
        // behind and therefore the bottom.
        const ahead = dx * fx + dz * fz;
        const right = dx * rx + dz * rz;
        const wanted = Math.atan2(right, ahead);

        // The SHORT way round. Without this the arrow walks the long way across
        // the ring every time the bearing crosses the back of it — 359 to 1
        // degrees would travel 358 rather than 2 — which is exactly what happens
        // when a route doubles back on itself.
        let d = wanted - angle.current;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        angle.current += d * Math.min(1, step * TURN_RATE);
      }
    }

    // Driven both ways, so a retried attempt brings the ring back rather than
    // leaving it off for the rest of the lesson.
    const t = (lit.current = at
      ? Math.min(1, lit.current + step / FADE)
      : Math.max(0, lit.current - step / FADE));

    g.visible = t > 0.002;
    // The rim is a DIAL, not a mark: it exists so the arrow has somewhere to
    // sit, and the pilot reads the arrow. It was at 0.09 of a mid grey, which
    // over a concrete pad in daylight is not a hairline, it is nothing at all —
    // the arrow was left floating beside the aircraft with no circle under it.
    // Light grey at a third opacity reads as a thin circle on both the pad and
    // the city without going back to being a hoop drawn over the view.
    if (rim.current) rim.current.opacity = t * 0.34;
    if (head.current) head.current.opacity = t;

    // The arrow is placed ON the circumference and turned to face outward along
    // the radius. Measured clockwise from the top, which is why sin drives x and
    // cos drives y.
    // The mark is authored centred on the top of the circle, so turning it by
    // the angle carries it round to where the target is. It is drawn AT the
    // rim's radius, so there is nothing to position — only to rotate.
    if (marker.current) marker.current.rotation.z = -angle.current;
  });

  return (
    // `depthTest: false` plus a `renderOrder` on each MESH — it does not
    // inherit from a group — makes this an instrument rather than an object in
    // the scene. Without them the lower half of the ring is buried in the deck
    // every time the drone flies low: the circle reaches 0.6 m below the
    // aircraft's centre, and a HUD element half eaten by the ground reads as a
    // bug rather than as a mark on the world.
    <group ref={group} visible={false}>
      {/* One thin circle. It carries no marks of any kind: it is the dial the
          arrow is read against, and anything else on it would be answering a
          question nobody asked. */}
      <mesh renderOrder={10}>
        <ringGeometry args={[RADIUS - 0.0032, RADIUS + 0.0032, 72]} />
        <meshBasicMaterial
          ref={rim}
          color={RIM}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>

      {/* The marker: a short stretch of the same circle, thickened and drawn out
          to a point, turned round to where the target is.

          ONE mesh, deliberately. There used to be an oversized soft copy
          underneath it for a drawn-on glow. That works for a shape centred on
          its own origin and does not work for this one: the mark is authored in
          absolute ring coordinates, so scaling it up walks it outward and round
          the circle, and what landed on the screen was a second, displaced,
          darker mark beside the real one — read, correctly, as a shadow. There
          is no glow to add here anyway; solid red on grey concrete is already
          the strongest mark in the picture. */}
      <group ref={marker}>
        <mesh renderOrder={12}>
          <shapeGeometry args={[MARK_SHAPE]} />
          <meshBasicMaterial
            ref={head}
            color={ARROW}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
