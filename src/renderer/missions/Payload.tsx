import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useSettingsStore } from '../state/settingsStore';
import { useMissionStore } from '../state/missionStore';
import { getDrone } from '../plugins/registry';
import { allZonesOf, zoneGroundY, type Mission, type MissionDelivery } from './types';

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
  /** Which object is slung: a tank on a suppression mission, a case on a
   *  delivery. Both come off at the end of their middle leg. */
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

  const deliveries = mission.deliveries;

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
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const flat = useMemo(() => new THREE.Quaternion(), []);

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
    // A SPENT TANK STAYS ON THE AIRCRAFT.
    //
    // It is bolted to the airframe, not slung on a hook: a fire crew comes back
    // with an empty tank, they do not drop it in the woods.
    //
    // What made it fall was that nothing told the pilot the job was finished, so
    // an empty tank hanging under them looked exactly like a full one. That is a
    // READOUT problem and it is now answered twice over: the strip's PAYLOAD
    // cell reads 'Empty' the moment the fire is out, and `spent` drains the tank
    // to grey under the aircraft, where the pilot is already looking. Neither
    // needed the tank on the ground.
    //
    // And the flight it was protecting does not exist: the suppression mission
    // sets `endsAtDrop`, so there IS no leg home to carry an empty tank down —
    // the attempt is scored over the fire. What the drop actually bought was a
    // tank falling out of the aircraft at the moment of the mission's climax.
    //
    // A delivery is the opposite and is unchanged: a parcel is dropped off
    // BECAUSE being put down at the mark is the whole job.
    const held = carrying || (keepsPayload && payload === 'delivered');
    const wrecked = phase === 'failed';

    if (payload === 'waiting' && motion.current !== 'waiting') {
      motion.current = 'waiting';
      at.current.copy(rest);
      fall.current = 0;
      pull.current = 0;
    } else if (held && !wrecked && motion.current !== 'attaching' && motion.current !== 'carried') {
      motion.current = 'attaching';
      pull.current = 0;
      from.current.copy(at.current);
    } else if (held && wrecked && motion.current !== 'falling' && motion.current !== 'down') {
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
      // Delivered means PUT DOWN — on a DELIVERY. The parcel comes off on the
      // mark because being left there is the job. A suppression mission never
      // reaches here: see `held` above.
      motion.current = 'falling';
      fall.current = 0;
    }

    // --- Move it -------------------------------------------------------------
    switch (motion.current) {
      case 'waiting': {
        // Cargo that has somewhere to wait sits still: the food box on the
        // restaurant's deck, the tank on the hydrant's fill pad. The ring and
        // what is built around it already say where it is.
        if (mission.kind === 'search' || mission.kind === 'suppression') {
          at.current.copy(rest);
          g.rotation.set(0, 0.35, 0);
          break;
        }
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

        /*
         * IT IS SET DOWN AND SLID CLEAR, not pushed up into the aircraft.
         *
         * This is the multi-point delivery's set-down, brought back to the
         * single-package missions it was first needed on — see `PackageSet`
         * below for the long version.
         *
         * The old guard here only refused to let the box go below the deck. That
         * is half the answer: neither object can move out of the way VERTICALLY,
         * so on every throttle-down the box rode up and swallowed the aircraft.
         * Nothing was see-through about it — the shell is opaque — the drone was
         * simply inside the box, poking out through its faces.
         *
         * So the box moves horizontally instead. As the last of the room runs
         * out it settles onto the deck and eases forward along the drone's own
         * heading until it is clear of the airframe, coming flat as it goes: a
         * parcel on the ground does not keep the aircraft's bank. Off the deck
         * nothing changes — it is the anchor exactly, as before — and the whole
         * thing only happens inside the last 25 cm of a descent.
         *
         * MAX_SQUEEZE matters as much as the slide. `deckUnder` answers with the
         * NEAREST zone's deck, so without a cap a mission whose marks sit at
         * different heights would hoist the parcel off the aircraft mid-flight
         * to meet a "floor" belonging somewhere else.
         */
        {
          const floor = deckUnder(mission, at.current.x, at.current.z) + belly;
          const squeeze = floor - at.current.y;
          // A BOLTED TANK IS NEVER SET DOWN, so it never takes the slide.
          //
          // The set-down exists because a parcel and the aircraft cannot share
          // the last few centimetres over a mark, and the parcel is the one that
          // may move: it settles on the deck and slides clear. A suppression tank
          // may not. It is part of the aircraft, it is carried home spent, and
          // there is no moment in the mission when putting it on the ground is
          // the right answer.
          //
          // Left ungated, the guard fired the instant the drone rested on the
          // road at the emergency station: `floor` there is the road plus the
          // tank's own belly, which is ABOVE the airframe's origin, so the tank
          // was teleported up and sat on top of the propellers.
          //
          // What it still gets is a lift out of the tarmac — a tank hanging
          // under a landed drone has its nozzle through the road — but capped
          // below the aircraft's own origin, so it can tuck into the belly and
          // no further. Slung under, never over.
          if (keepsPayload) {
            if (squeeze > 0 && squeeze < MAX_SQUEEZE && dronePose.present) {
              const ceiling = dronePose.position.y - drop * 0.35;
              at.current.y = Math.max(at.current.y, Math.min(floor, ceiling));
            }
            if (dronePose.present) g.quaternion.copy(dronePose.quaternion);
            break;
          }
          const setDown = squeeze > 0 && squeeze < MAX_SQUEEZE;
          if (setDown) {
            const out = Math.min(1, squeeze / SET_DOWN);
            at.current.y = floor;
            if (dronePose.present) {
              fwd.set(0, 0, -1).applyQuaternion(dronePose.quaternion);
              fwd.y = 0;
              if (fwd.lengthSq() > 1e-6) {
                at.current.addScaledVector(fwd.normalize(), CLEAR_OUT * out);
              }
              flat.copy(dronePose.quaternion).slerp(UPRIGHT, out);
              g.quaternion.copy(flat);
            }
          } else if (dronePose.present) {
            g.quaternion.copy(dronePose.quaternion);
          }
        }
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

  // A MULTI-POINT DELIVERY draws its own cargo.
  //
  // Three boxes rather than one, and never in the same state: some are still
  // waiting on the hub pad, one may be under the aircraft, and the ones already
  // placed are standing on the marks they were put on. The single box above
  // cannot be three things, so this hands the whole job over — the hooks above
  // have all run by here, so the early return is safe.
  if (deliveries) {
    return (
      <PackageSet mission={mission} deliveries={deliveries} size={size} drop={drop} belly={belly} />
    );
  }

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

  // The search mission's supply drop: a food box rather than a medical case.
  if (mission.kind === 'search') {
    return (
      <group ref={group}>
        <FoodBox size={size} />
      </group>
    );
  }

  return (
    <group ref={group}>
      <MedicalCase size={size} />
    </group>
  );
}

/**
 * A cardboard food box: kraft shell, packing tape over the lid and down two
 * sides, and a white label with a green band on the other two. No behaviour —
 * `Payload` moves it exactly as it moves the medical case.
 */
function FoodBox({ size }: { size: number }) {
  const half = size / 2;
  const skin = size * 0.004;
  const tape = size * 0.22;
  return (
    <>
      <mesh castShadow>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial color="#b8864f" roughness={0.92} metalness={0} />
      </mesh>
      {/* Tape: over the lid, and down the front and back. */}
      <mesh position={[0, half + skin, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[tape, size]} />
        <meshStandardMaterial color="#d8c39a" roughness={0.45} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 0, s * (half + skin)]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[tape, size]} />
          <meshStandardMaterial color="#d8c39a" roughness={0.45} />
        </mesh>
      ))}
      {/* Labels on the two sides the tape leaves bare. */}
      {[1, -1].map((s) => (
        <group key={s} position={[s * (half + skin), 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
          <mesh>
            <planeGeometry args={[size * 0.6, size * 0.38]} />
            <meshStandardMaterial color="#f1eee6" roughness={0.8} />
          </mesh>
          <mesh position={[0, size * 0.09, skin]}>
            <planeGeometry args={[size * 0.6, size * 0.1]} />
            <meshBasicMaterial color="#2f9e44" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * The parcel itself, with no behaviour at all.
 *
 * Pulled out of `Payload` when the multi-point delivery arrived: that mission
 * has three of these on screen at once, in three different states, and a box
 * that carried its own motion could not be one of three.
 */
function MedicalCase({ size }: { size: number }) {
  const half = size / 2;
  /** How far a face decal stands off the box, so it never fights the box's own
   *  surface for depth. Small enough that the cross reads as printed on. */
  const skin = size * 0.004;
  const arm = size * 0.52;
  const bar = size * 0.17;
  return (
    <>
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
    </>
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
  // Every mark, not the record of three: a multi-point delivery puts packages
  // down on two roofs that `mission.zones` has no room to name, and a box that
  // asked the record would settle onto the street twenty-five metres below the
  // roof it was just placed on.
  for (const zone of allZonesOf(mission)) {
    const d = Math.hypot(zone.at[0] - x, zone.at[1] - z);
    // ONLY A DECK THE AIRCRAFT IS ACTUALLY OVER.
    //
    // This used to answer with the nearest zone's deck from anywhere on the map,
    // and a rooftop mark is 25 m up. So the "floor" under a drone crossing the
    // city was a roof it was nowhere near, and every climb or descent through
    // that height put the parcel inside the set-down: the box pinned itself to
    // the deck plane, which is ABOVE the aircraft when the aircraft is under it,
    // and snapped back the moment the drone passed through. That is the box
    // jumping over the drone and re-attaching, and MAX_SQUEEZE could not stop it
    // — it caps how far the parcel is lifted, not whether the lift makes sense.
    //
    // A set-down only means anything over the mark being set down on, so a deck
    // out of reach horizontally is not a floor at all. Outside every zone the
    // answer is the street, which is what is really under the drone there.
    if (d > zone.radius + DECK_REACH) continue;
    if (d < bestD) {
      bestD = d;
      best = zoneGroundY(mission, zone);
    }
  }
  return best;
}

/**
 * How far outside a zone's own radius its deck still counts as the floor,
 * metres.
 *
 * It has to cover the parcel's slide clear of the airframe (`CLEAR_OUT`) plus
 * the aircraft's own span, or a box set down at the edge of the mark would find
 * the street under it halfway through the slide and drop the rest of the way.
 */
const DECK_REACH = 1.5;

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

// ----------------------------------------------------------------------------
// Multi-point cargo.
//
// One component per package, and the state of each is DERIVED from the store
// every frame rather than remembered: delivered if the mission has counted it,
// carried if it is the live one and the drone is holding it, waiting on the pad
// otherwise. Nothing here has a teardown of its own to get wrong, so a restart —
// which puts `runIndex` and `deliveredCount` back to zero — puts all three boxes
// back on the pad without this file being told.
// ----------------------------------------------------------------------------

/**
 * How much of the parcel's height has to be squeezed out before it counts as
 * fully set down, metres. Roughly the box itself, so the slide is spread over
 * the last part of a descent rather than snapping at the moment of contact.
 */
const SET_DOWN = 0.22;
/**
 * How far forward a set-down parcel ends up, metres from under the airframe.
 *
 * Enough to clear a Guru's 0.575 m span plus the half-box, so the two solids
 * never share space at any attitude the aircraft can be resting at.
 */
const CLEAR_OUT = 0.42;
/**
 * The largest gap the set-down will act on, metres.
 *
 * `deckUnder` answers with the nearest ZONE's declared deck, which is exact at
 * the places the aircraft is ever low and meaningless everywhere else. A mission
 * with a rooftop made that visible: carrying the package out to Rooftop B, the
 * nearest zone flips to the roof somewhere over the city and the "floor" under
 * the parcel jumps from the road to twenty-five metres. The guard then dutifully
 * lifted the box to a deck it was nowhere near — the parcel left the aircraft,
 * hung in the air, and snapped back on once the drone had climbed past the roof.
 *
 * A real set-down is small. The load hangs 0.17 m under the airframe and the
 * body rests centimetres off the deck, so the most that is ever squeezed out is
 * about a quarter of a metre. Anything bigger than this is not a landing — it is
 * a deck reading that belongs somewhere else, and the right answer is to ignore
 * it and keep carrying.
 */
const MAX_SQUEEZE = 0.6;
/** No rotation, for slerping a set-down parcel flat. Built once. */
const UPRIGHT = new THREE.Quaternion();

/**
 * Where a package that is NOT the live one stands on the hub pad, in metres
 * from the mark.
 *
 * The live one always sits dead centre, because the mark is what the pilot
 * descends onto — a package the pilot has to aim at while it stands off to one
 * side would be a mark that lies.
 *
 * The others stand INSIDE the ring with it. They were pushed outside it once, on
 * the theory that a ring with three boxes in it reads as three things to
 * collect. What it actually read as was two parcels dumped on the road beside
 * the pad, with the mark apparently missing most of its cargo. The hub is a
 * depot and the ring is its footprint, so everything waiting to go stands in it.
 * Every offset here is inside the 1 m pickup circle with the half-box to spare.
 */
const STANDBY: readonly (readonly [number, number])[] = [
  [-0.58, 0.44],
  [0.58, 0.44],
  [0, 0.66],
];

function PackageSet({
  mission,
  deliveries,
  size,
  drop,
  belly,
}: {
  mission: Mission;
  deliveries: readonly MissionDelivery[];
  size: number;
  drop: number;
  belly: number;
}) {
  const runIndex = useMissionStore((s) => s.runIndex);
  const deliveredCount = useMissionStore((s) => s.deliveredCount);
  const payload = useMissionStore((s) => s.payload);

  const hub = mission.zones.pickup;
  const hubY = zoneGroundY(mission, hub) + belly;

  return (
    <group>
      {deliveries.map((d, i) => {
        // Delivered is decided by the COUNT, not by this package's own flag:
        // the store counts them in order and the order is the mission, so a box
        // is down exactly when the mission says that many are down.
        const placed = i < deliveredCount;
        const carried = !placed && i === runIndex && payload === 'attached';
        const at: [number, number, number] = placed
          ? [d.zone.at[0], zoneGroundY(mission, d.zone) + belly, d.zone.at[1]]
          : [
              hub.at[0] + (i === runIndex ? 0 : STANDBY[i % STANDBY.length][0]),
              hubY,
              hub.at[1] + (i === runIndex ? 0 : STANDBY[i % STANDBY.length][1]),
            ];
        return (
          <OnePackage
            key={d.id}
            size={size}
            drop={drop}
            belly={belly}
            mission={mission}
            rest={at}
            carried={carried}
            placed={placed}
          />
        );
      })}
    </group>
  );
}

function OnePackage({
  size,
  drop,
  belly,
  mission,
  rest,
  carried,
  placed,
}: {
  size: number;
  drop: number;
  belly: number;
  mission: Mission;
  rest: readonly [number, number, number];
  carried: boolean;
  placed: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const at = useMemo(() => new THREE.Vector3(), []);
  const from = useMemo(() => new THREE.Vector3(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  /** Scratch for the drone's forward direction — see the set-down below. */
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const flat = useMemo(() => new THREE.Quaternion(), []);
  /** 0..1 through the attach pull, so the box leaps to the airframe rather than
   *  appearing under it. The one bit of motion this component keeps. */
  const pull = useRef(0);
  const wasCarried = useRef(false);
  const started = useRef(false);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;

    if (!started.current) {
      started.current = true;
      at.set(rest[0], rest[1], rest[2]);
    }

    if (carried && !wasCarried.current) {
      pull.current = 0;
      from.copy(at);
    }
    wasCarried.current = carried;

    if (carried) {
      pull.current = Math.min(1, pull.current + dt / ATTACH_SEC);
      anchorUnder(anchor, drop);
      const t = 1 - (1 - pull.current) * (1 - pull.current);
      at.lerpVectors(from, anchor, t);

      /*
       * IT IS SET DOWN AND SLID CLEAR, not pushed up into the aircraft.
       *
       * The parcel hangs 0.17 m under the airframe's origin and the drone's own
       * body sits a few centimetres off the deck, so an aircraft resting on the
       * ground has nowhere to put a 0.24 m box: there is not enough room under
       * it for the thing it is carrying. The old guard simply refused to let the
       * box go below the deck, which meant that on every throttle-down the box
       * rode UP and swallowed the aircraft — two solid objects occupying the
       * same space, with the drone visible inside the parcel.
       *
       * Neither object can move out of the way vertically, so the box moves
       * horizontally instead. As the last of the room runs out it settles onto
       * the deck and eases forward along the drone's own heading until it is
       * clear of the airframe, which is what a pilot lowering a parcel to the
       * ground actually produces. Off the deck nothing changes — it is the
       * anchor exactly, as before — and the whole thing only happens inside the
       * last 25 cm of a descent.
       */
      const floor = deckUnder(mission, at.x, at.z) + belly;
      const squeeze = floor - at.y;
      const setDown = squeeze > 0 && squeeze < MAX_SQUEEZE;
      if (setDown) {
        const out = Math.min(1, squeeze / SET_DOWN);
        at.y = floor;
        if (dronePose.present) {
          fwd.set(0, 0, -1).applyQuaternion(dronePose.quaternion);
          fwd.y = 0;
          if (fwd.lengthSq() > 1e-6) at.addScaledVector(fwd.normalize(), CLEAR_OUT * out);
        }
        // Flat on the deck by the time it is fully set down: a parcel on the
        // ground does not keep the aircraft's bank.
        if (dronePose.present) {
          flat.copy(dronePose.quaternion).slerp(UPRIGHT, out);
          g.quaternion.copy(flat);
        }
      } else if (dronePose.present && pull.current >= 1) {
        g.quaternion.copy(dronePose.quaternion);
      }

      g.scale.setScalar(1 + Math.sin(pull.current * Math.PI) * 0.22);
      if (!setDown && !(dronePose.present && pull.current >= 1)) {
        g.rotation.set(0, g.rotation.y * (1 - t), 0);
      }
    } else if (placed) {
      // Down, and staying down. No bob and no spin: a package that has been
      // delivered is finished, and a box still dancing on its mark would read as
      // one more thing to go and collect.
      at.set(rest[0], rest[1], rest[2]);
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(1);
    } else {
      // Waiting on the pad: a slow turn and a shallow bob, so a white box on a
      // grey street is something the eye finds.
      at.set(rest[0], rest[1] + 0.06 + Math.sin(clock.elapsedTime * 1.6) * 0.05, rest[2]);
      g.rotation.set(0, clock.elapsedTime * 0.55, 0);
      g.scale.setScalar(1);
      pull.current = 0;
    }

    g.position.copy(at);
  });

  return (
    <group ref={group}>
      <MedicalCase size={size} />
    </group>
  );
}
