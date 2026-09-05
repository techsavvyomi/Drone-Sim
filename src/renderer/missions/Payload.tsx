import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useSettingsStore } from '../state/settingsStore';
import { useMissionStore } from '../state/missionStore';
import { getDrone } from '../plugins/registry';
import { zoneGroundY, type Mission } from './types';

// ----------------------------------------------------------------------------
// The package.
//
// Carried, not slung. It hangs off the airframe's transform and NOTHING about it
// reaches the flight model — no rope, no joint, no mass. That is a deliberate
// limit rather than a shortcut: a swinging load is a different flying exercise
// from the one this mission is teaching, and the brief asks for precision
// placement, not for pendulum management.
//
// It is WELDED on. It used to chase the point under the drone with a lag and
// lean into the swing, which was meant to read as a slung load; at any real
// speed it read as a box that had come loose and was flying along beside the
// aircraft, tilted, several hand-widths behind. A package clamped under an
// airframe does not do that. It now takes the drone's position and its FULL
// orientation every frame, so it banks and turns as one object with it and
// cannot drift, lag or tumble in flight however hard the drone is flown.
//
// It is never hidden mid-flight. The only states it has are: waiting on its
// mark, carried, and down — and "down" still leaves it standing on the deck
// where it landed.
//
// TWO CARGOES, one behaviour. A delivery carries a medical case and puts it
// DOWN, so 'delivered' drops it. A suppression mission carries a retardant tank
// and empties it in the air, so 'delivered' there means SPENT: the tank stays
// bolted under the airframe for the flight home and is drawn empty. That is the
// only branch in this file, and it is a look plus one early return rather than a
// second component — a tank that fell out of the sky the moment the fire went
// out would be the mission littering the forest it had just saved.
// ----------------------------------------------------------------------------

/** Seconds the attach animation takes to pull the box up to the airframe. */
const ATTACH_SEC = 0.35;
/** Gravity for the drop, m/s². Its own number: this is an animation, not the
 *  sim, and it must not start reading the world's physics by accident. */
const DROP_G = 12;
/** How much of its speed the box keeps on the bounce. */
const BOUNCE = 0.32;

type Motion = 'waiting' | 'attaching' | 'carried' | 'falling' | 'down';

export function Payload({ mission }: { mission: Mission }) {
  const droneId = useSettingsStore((s) => s.settings.selectedDroneId);
  const payload = useMissionStore((s) => s.payload);
  const phase = useMissionStore((s) => s.phase);
  /** A tank is emptied, not dropped. */
  const keepsPayload = mission.kind === 'suppression';
  const spent = keepsPayload && payload === 'delivered';

  /** Sized off the airframe it hangs under, so it reads as cargo on every drone
   *  rather than as a crate on the small one and a pebble on the big one. */
  const { size, drop } = useMemo(() => {
    const spec = getDrone(droneId);
    const span = (spec?.armLength ?? 0.1) * (spec?.sizeScale ?? 1) * 2;
    const s = THREE.MathUtils.clamp(span * 0.5, 0.13, 0.24);
    // Hung clear of the airframe, not tucked into it. The gap has to cover the
    // half-box AND whatever the drone has below its own origin — skids, belly,
    // the props' own thickness — or the two meshes share the same space and the
    // box reads as being INSIDE the drone rather than under it. It also means
    // the box touches down first on a descent, which is what a slung load does.
    // Tight to the belly. The gap only has to clear the half-box and whatever
    // the drone carries below its own origin — skids, belly, the props'
    // thickness. It was nearly twice this, which left the box hanging in open
    // air under the aircraft with daylight between them; clamped cargo sits
    // against the airframe.
    return { size: s, drop: s * 0.5 + span * 0.06 + 0.015 };
  }, [droneId]);

  /**
   * How far the load's lowest point sits under its own origin.
   *
   * The case is a box, so it is half of one. The tank is a cylinder slung
   * crosswise with a nozzle beneath it, and the nozzle is the lowest thing on
   * the aircraft — it reaches further down than a half-box does, which is what
   * put it through the road. Both numbers are read off the geometry below, the
   * case's including the `skin` its decals stand proud by: the underside plate
   * is the lowest thing on it, not the box face.
   */
  const belly = keepsPayload ? size * 0.549 : size * 0.504;

  const group = useRef<THREE.Group>(null);
  /** Where the box actually is, and how fast it is falling. */
  const at = useRef(new THREE.Vector3());
  const fall = useRef(0);
  const motion = useRef<Motion>('waiting');
  /** 0..1 through the attach pull. */
  const pull = useRef(0);
  /** Where the pull started from. */
  const from = useRef(new THREE.Vector3());
  /** Scratch, so the frame loop never allocates. */
  const anchor = useMemo(() => new THREE.Vector3(), []);

  const rest = useMemo(
    () =>
      new THREE.Vector3(
        mission.zones.pickup.at[0],
        zoneGroundY(mission, mission.zones.pickup) + belly,
        mission.zones.pickup.at[1],
      ),
    [mission, belly],
  );

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;

    // --- Which of the five things is it doing --------------------------------
    //
    // Derived from the store every frame rather than remembered, so a restart —
    // which puts `payload` back to 'waiting' — puts the box back on its mark
    // with no teardown of its own to get wrong.
    const carrying = payload === 'attached';
    const wrecked = phase === 'failed';

    if (payload === 'waiting' && motion.current !== 'waiting') {
      motion.current = 'waiting';
      at.current.copy(rest);
      fall.current = 0;
      pull.current = 0;
    } else if (
      carrying &&
      !wrecked &&
      motion.current !== 'attaching' &&
      motion.current !== 'carried'
    ) {
      motion.current = 'attaching';
      pull.current = 0;
      from.current.copy(at.current);
    } else if (carrying && wrecked && motion.current !== 'falling' && motion.current !== 'down') {
      // The aircraft is wrecked, so the package it was holding comes down with
      // it. This is the brief's "payload lost" made visible: there is no state
      // for it, there is a box on the street.
      motion.current = 'falling';
      fall.current = 0;
    } else if (
      payload === 'delivered' &&
      !keepsPayload &&
      motion.current !== 'falling' &&
      motion.current !== 'down'
    ) {
      motion.current = 'falling';
      fall.current = 0;
    }

    // --- Move it -------------------------------------------------------------
    switch (motion.current) {
      case 'waiting': {
        // Alive on its mark: a slow turn and a shallow bob, so a box on a grey
        // street is something the eye finds.
        at.current.set(rest.x, rest.y + 0.06 + Math.sin(clock.elapsedTime * 1.6) * 0.05, rest.z);
        g.rotation.set(0, clock.elapsedTime * 0.55, 0);
        break;
      }
      case 'attaching': {
        pull.current = Math.min(1, pull.current + dt / ATTACH_SEC);
        anchorUnder(anchor, drop);
        // Ease out: it leaps off the deck and settles under the airframe rather
        // than sliding there at a constant rate.
        const t = 1 - (1 - pull.current) * (1 - pull.current);
        at.current.lerpVectors(from.current, anchor, t);
        // A short squash on arrival — the only "pop" in the mission, and it is
        // on the one event that changes what the drone is.
        const pop = 1 + Math.sin(pull.current * Math.PI) * 0.22;
        g.scale.setScalar(pop);
        g.rotation.set(0, g.rotation.y * (1 - t), 0);
        if (pull.current >= 1) {
          motion.current = 'carried';
          g.scale.setScalar(1);
        }
        break;
      }
      case 'carried': {
        // Bolted on: the anchor exactly, and the airframe's own orientation.
        // No chase, no lean, nothing that can be left behind by a fast run.
        anchorUnder(anchor, drop);
        at.current.copy(anchor);
        // ...but never through the deck.
        //
        // The load hangs 0.30 m under the airframe's origin and the drone's
        // collider is 0.024 m deep, so an aircraft sitting on the road has its
        // slung load a quarter of a metre INSIDE it: the tank was buried to its
        // waist in the dirt on every take-off and every landing. Nothing in the
        // physics can fix that — the tank is drawn, not simulated, and the body
        // that rests on the ground is the airframe's.
        //
        // So the load rides up the last few centimetres instead. Off the deck it
        // is the anchor exactly, as before; near the ground it stops falling and
        // the drone settles the rest of the way onto it, which is what a slung
        // load does anyway.
        at.current.y = Math.max(at.current.y, deckUnder(mission, at.current.x, at.current.z) + belly);
        if (dronePose.present) g.quaternion.copy(dronePose.quaternion);
        break;
      }
      case 'falling': {
        fall.current += DROP_G * dt;
        at.current.y -= fall.current * dt;
        const floor = deckUnder(mission, at.current.x, at.current.z) + belly;
        if (at.current.y <= floor) {
          at.current.y = floor;
          fall.current *= -BOUNCE;
          // Below a nudge it has stopped bouncing and is simply on the ground.
          if (Math.abs(fall.current) < 0.6) {
            fall.current = 0;
            motion.current = 'down';
            g.rotation.x = 0;
            g.rotation.z = 0;
          }
        }
        // Tumble a little on the way down, then stop.
        g.rotation.x += dt * 1.1;
        g.rotation.z += dt * 0.7;
        break;
      }
      case 'down':
        break;
    }

    g.position.copy(at.current);
  });

  // The firefighting tank. Same transform, same states, different object — and
  // it returns before the medical case's decals are built at all, so a mission
  // carrying one never pays for the other.
  if (keepsPayload) {
    return (
      <group ref={group}>
        <RetardantTank size={size} spent={spent} />
      </group>
    );
  }

  const half = size / 2;
  /** How far a face decal stands off the box, so it never fights the box's own
   *  surface for depth. Small enough that the cross reads as printed on. */
  const skin = size * 0.004;
  const arm = size * 0.52;
  const bar = size * 0.17;
  return (
    <group ref={group}>
      {/* The parcel. A medical supply case: white shell, red cross, which is
          what says WHAT is being carried at the one glance a pilot can spare. */}
      <mesh castShadow>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#f2f4f5" roughness={0.7} metalness={0} />
      </mesh>
      {/* No band round the middle. It was a grey strap standing 1% proud of the
          shell, there to give a white cube an edge against a bright sky — and it
          ran straight through the waist of the red cross on all four side faces,
          so the marking on a medical case read as a box someone had taped shut.
          The cross is the thing that says what is being carried; nothing gets to
          cross it. The shell keeps its edge from its own shading. */}
      {/* The cross, on all six faces — the box tumbles when it is dropped and
          spins on its mark, so there is no face that can afford to be blank.
          Two flat bars per face rather than a texture: no canvas, no upload, and
          it stays crisp at every distance. */}
      {CROSS_FACES.map(([rot, pos], i) => (
        <group
          key={i}
          rotation={rot}
          position={pos.map((v) => v * (half + skin)) as [number, number, number]}
        >
          <mesh>
            <planeGeometry args={[arm, bar]} />
            <meshBasicMaterial color="#e03131" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <planeGeometry args={[bar, arm]} />
            <meshBasicMaterial color="#e03131" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* No ring under the box. It was an amber halo meant to give the box an
          outline from twenty metres up, and it sat inside the pickup mark's own
          ring — two circles round one object, the outer one green and the inner
          one amber, which read as a second target rather than as a shadow. The
          mark under it is doing that job already. */}
    </group>
  );
}

/**
 * The fire-suppression tank: a red cylinder slung crosswise with a nozzle under
 * it.
 *
 * CROSSWISE, not fore-and-aft. Slung along the drone's nose it disappeared
 * behind the airframe in the chase camera — which is the only camera most of
 * this mission is flown in — and the pilot had no way to tell a loaded drone
 * from an empty one. Across the airframe it reads from behind as a bar under
 * the aircraft at every attitude.
 *
 * `spent` is what the pilot sees after the fire is out: the same tank, drained
 * of its colour, with the nozzle dark. It is the HUD's "Payload: Empty" said in
 * the world, and it is why the tank is not simply hidden — a payload that
 * vanished would leave nothing to have been emptied.
 */
function RetardantTank({ size, spent }: { size: number; spent: boolean }) {
  const shell = spent ? '#6d5b57' : '#e03131';
  const trim = spent ? '#8d8177' : '#f2f4f5';
  const len = size * 1.7;
  const r = size * 0.42;
  return (
    <group>
      {/* The body, lying across the airframe. */}
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, len, 14]} />
        <meshStandardMaterial color={shell} roughness={0.55} metalness={0.1} />
      </mesh>
      {/* Two white bands, which is what gives a smooth cylinder an edge against
          both a dark canopy and a bright sky. */}
      {[-len * 0.28, len * 0.28].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[r * 1.04, r * 1.04, size * 0.16, 14]} />
          <meshStandardMaterial color={trim} roughness={0.6} />
        </mesh>
      ))}
      {/* The nozzle. Small, and it points at the ground — the one part that says
          which way this thing works. */}
      <mesh position={[0, -r * 0.95, 0]}>
        <cylinderGeometry args={[size * 0.09, size * 0.13, size * 0.3, 10]} />
        <meshStandardMaterial color={spent ? '#4a4440' : '#2b2f33'} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** The six faces of the box, as a rotation for the decal plane and the unit
 *  direction the face sits along. Built once: the box never changes shape. */
const CROSS_FACES: ReadonlyArray<[[number, number, number], [number, number, number]]> = [
  [
    [0, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, Math.PI, 0],
    [0, 0, -1],
  ],
  [
    [0, Math.PI / 2, 0],
    [1, 0, 0],
  ],
  [
    [0, -Math.PI / 2, 0],
    [-1, 0, 0],
  ],
  [
    [-Math.PI / 2, 0, 0],
    [0, 1, 0],
  ],
  [
    [Math.PI / 2, 0, 0],
    [0, -1, 0],
  ],
];

/**
 * The ground height under a point, as well as this component can know it.
 *
 * A map with one deck answers with it. The forest does not have one — its ground
 * falls 12.5 m between the road and the fire — so the answer is the declared
 * deck of the NEAREST zone, which is exact at the three places the aircraft is
 * ever low: the pickup, the fire and the pad. Between them the drone is flying,
 * where nothing is resting on anything and the number is never read.
 */
function deckUnder(mission: Mission, x: number, z: number): number {
  let best = mission.groundY;
  let bestD = Infinity;
  for (const kind of ['pickup', 'drop', 'base'] as const) {
    const zone = mission.zones[kind];
    const d = (zone.at[0] - x) ** 2 + (zone.at[1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = zoneGroundY(mission, zone);
    }
  }
  return best;
}

/** The point directly under the airframe the parcel hangs from. Taken from the
 *  drone's own transform, so it follows roll and pitch instead of floating flat
 *  under a banking aircraft. */
function anchorUnder(out: THREE.Vector3, drop: number): void {
  out.set(0, -drop, 0);
  if (dronePose.present) {
    out.applyQuaternion(dronePose.quaternion);
    out.add(dronePose.position);
  }
}
