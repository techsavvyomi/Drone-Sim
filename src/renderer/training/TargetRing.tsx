import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import type { Checkpoint } from './lessons/types';

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
 *  than as scenery it happens to be inside. */
const RADIUS = 0.6;
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

const RIM = '#dbe4f0';
const ARROW = '#ff2b4d';

/**
 * The arrowhead, as a flat outline pointing along +Y.
 *
 * Drawn as a SHAPE rather than taken off a primitive. It was a three-sided cone
 * first, on the reasoning that a cone is an arrow — and it is not: a cone has no
 * notch, so square on to the camera it reads as a plain triangle, and a triangle
 * sitting on a circle is a blob rather than something pointing. The tail cut in
 * behind the barbs is the whole difference. It gives the shape a direction that
 * survives being small, which is the only size it is ever seen at.
 *
 * Authored with its BASE on the origin and its tip up the +Y axis, so the marker
 * group only has to nudge it clear of the rim; the group's own rotation carries
 * +Y onto the radius. Built once at module scope — the geometry is the same for
 * every frame and every lesson.
 */
const ARROW_SHAPE = (() => {
  const a = new THREE.Shape();
  // Tip, right barb, tail notch, left barb — four points, mirrored exactly
  // about x = 0 so the head cannot lean.
  //
  // 0.14 tall and 0.10 wide against a ring 1.2 across: about a TWELFTH of the
  // circle, which is the proportion that keeps the ring the main shape and the
  // arrow a marker attached to it. It was more than twice this and read as a
  // slab of red sitting on the dial rather than as something pointing.
  //
  // The tip is long relative to the barbs on purpose. A wide, shallow head is
  // what makes an arrow look blunt, and at the size this is actually seen the
  // point is the only part carrying the meaning.
  a.moveTo(0, 0.105);
  a.lineTo(0.05, -0.035);
  a.lineTo(0, 0);
  a.lineTo(-0.05, -0.035);
  a.closePath();
  return a;
})();

/**
 * The ring, pointed at one checkpoint.
 *
 * `point` is whatever the training system is already asking for — the live entry
 * of `lesson.route`, handed down by `RouteGuide` from `trainingStore.routeTarget`.
 * Nothing about the target is computed, stored or duplicated here: this reads the
 * active checkpoint and draws a direction. It is undefined outside the
 * demonstration and the attempt, which takes the ring off the field.
 */
export function TargetRing({ point }: { point?: Checkpoint }) {
  const group = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Group>(null);
  const rim = useRef<THREE.Material>(null);
  const head = useRef<THREE.Material>(null);
  const halo = useRef<THREE.Material>(null);

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

    if (point && dronePose.present) {
      const dx = point.at[0] - dronePose.position.x;
      const dz = point.at[2] - dronePose.position.z;
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
    const t = (lit.current = point
      ? Math.min(1, lit.current + step / FADE)
      : Math.max(0, lit.current - step / FADE));

    g.visible = t > 0.002;
    if (rim.current) rim.current.opacity = t * 0.42;
    if (head.current) head.current.opacity = t;
    if (halo.current) halo.current.opacity = t * 0.2;

    // The arrow is placed ON the circumference and turned to face outward along
    // the radius. Measured clockwise from the top, which is why sin drives x and
    // cos drives y.
    const m = marker.current;
    if (m) {
      const a = angle.current;
      m.position.set(Math.sin(a) * RADIUS, Math.cos(a) * RADIUS, 0);
      m.rotation.z = -a;
    }
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
        <ringGeometry args={[RADIUS - 0.008, RADIUS + 0.008, 72]} />
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

      {/* And one arrow, standing just off the rim and pointing out along it. Its
          position on the circle is the whole message.

          FLAT, not a solid. A cone was tried and is the wrong primitive for
          this: it has no tail notch, so square on to the camera it is a plain
          triangle, and its round base bulges under a light that comes from
          nowhere — which is what made it read as a chunk rather than as a mark.
          A `ShapeGeometry` has no thickness at all, so what the camera gets is
          the outline and only the outline, at every angle the ring turns to.

          The 0.05 offset puts the barbs about 7 mm clear of the rim's outer
          edge: attached to the circle, touching nothing, and with no coplanar
          surfaces to fight over depth.

          Two copies of the one shape: a soft oversized one underneath and the
          solid head on top. The under-copy is what makes it read as LIT rather
          than as a sticker — on a bright concrete apron a small flat red mark
          with a hard edge disappears into the background, and this project can
          spend nothing on a bloom pass (512 MB of VRAM), so the glow is drawn
          rather than post-processed. */}
      <group ref={marker}>
        <mesh position={[0, 0.05, 0]} scale={1.6} renderOrder={11}>
          <shapeGeometry args={[ARROW_SHAPE]} />
          <meshBasicMaterial
            ref={halo}
            color={ARROW}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0.05, 0]} renderOrder={12}>
          <shapeGeometry args={[ARROW_SHAPE]} />
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
