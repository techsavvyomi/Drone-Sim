import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CheckpointSphere } from '../scene/CheckpointSphere';
import { useMissionStore, activeZone, legOf } from '../state/missionStore';
import { playCollect } from '../audio/sfx';
import { nextCheckpointOf, zoneGroundY } from './types';
import type { Mission, MissionZone, MissionZoneKind } from './types';

// ----------------------------------------------------------------------------
// Everything the mission puts in the world: the route's checkpoints and the
// three zone marks.
//
// The checkpoints are `CheckpointSphere` — the same pink corona Flight School
// flies through, with the same promise that what you can see is what you fly
// into. It scores itself off its own trigger volume, so this file does not
// re-test the distance; it just says which point was taken.
//
// A zone is NOT a checkpoint and is deliberately drawn as a different KIND of
// thing: a lit patch of ground with a column of light standing on it, in its own
// colour. A checkpoint is a hole in the air to fly through; a zone is a place to
// come to a stop over. A pilot who has met both should never have to work out
// which of two lights they are meant to fly INTO.
// ----------------------------------------------------------------------------

/** Seconds a mark takes to light up or go out. Matches the checkpoint fade, so
 *  the pickup going dark as the drop lights up reads as one movement. */
const FADE = 0.45;

/** How close the drone has to be, flat, before a zone's mark lights at all.
 *  Matches the Director's `CALL_NEAR`, so the light comes up on the same
 *  boundary Mission Control says "you are getting close" on. */
const REVEAL = 75;

/**
 * The same boundary for a mark standing on a ROOF, and why it is not 75.
 *
 * 75 m is a sensible reveal for a mark painted on the street: the pilot is
 * flying down the road it is on and it comes up as they arrive. A drop that is
 * twenty-five metres in the air is a different problem — the pilot has to know
 * it is up there while they are still deciding what height to cross the city
 * at, and a mark that lights only once they are nearly on top of it tells them
 * after the climb is already owed. This one is visible from across the map.
 */
const REVEAL_RAISED = 220;

/** Deck height above its own base, in metres, past which a zone counts as being
 *  on a roof rather than on the ground. */
const RAISED_MIN = 2;

/** Zone colours. Green is "go here": the pickup mark and its column, and the
 *  pad you come home to, the same green the radar's dot uses for whatever is
 *  next. The drop keeps its own amber until the release conditions are met,
 *  which is when it turns green too. */
const ZONE_COLOR: Record<MissionZoneKind, string> = {
  pickup: '#37e08a',
  drop: '#ffcf4d',
  base: '#37e08a',
};
/**
 * How brightly a mark that is NOT the live one but still has business with the
 * pilot burns: the hub, while packages are still standing on it.
 *
 * Low, and it never pulses. The rule that only one mark is live is what makes a
 * mission readable, and this does not break it — a third of the light and no
 * beat is a place remembered, not a place being sent to.
 */
const STANDBY = 0.34;

/** What the drop mark turns as the release conditions come good — the single
 *  clearest answer to "am I positioned correctly" the mission can give, and it
 *  is in the world rather than on the HUD, where the pilot is already looking. */
const DROP_READY = '#37e08a';

/** A vertical alpha ramp: solid at the deck, gone by the top of the column.
 *  A canvas gradient rather than a shader — the column is a soft cue, and a
 *  one-off shader program is a compile and a look to maintain for a fade. */
let columnTex: THREE.CanvasTexture | null = null;
function columnTexture(): THREE.CanvasTexture {
  if (columnTex) return columnTex;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  }
  columnTex = new THREE.CanvasTexture(canvas);
  return columnTex;
}

/**
 * The delivery platform a rooftop mark stands on.
 *
 * SCENERY, not a marker. It has no state, it never lights and it never fades:
 * it is a structure on a roof, and it is there for the whole flight so a pilot
 * crossing the city can see where they are going before the mark itself comes
 * up.
 *
 * It exists because of how this city's colliders are made. They merge cells into
 * rectangles and fill each one to the tallest thing inside it, so a roof with a
 * parapet is SOLID up to the parapet — the aircraft stops a metre above the slab
 * the pilot can see, and a mark drawn at the height the aircraft stops at hangs
 * in mid-air over the roof. Neither number can move: the collider is what the
 * drone rests on and the slab is what the pilot sees. So the gap gets a
 * building. The collider was always claiming something solid was there; this is
 * that thing, drawn.
 *
 * An octagon rather than a circle, and untextured: eight segments and two
 * materials, on a map that is VRAM-bound before the mission adds anything.
 */
function RooftopPad({ zone, deck }: { zone: MissionZone; deck: number }) {
  const base = zone.padBase;
  if (base === undefined) return null;
  const h = deck - base;
  if (h <= 0.02) return null;
  // Wide enough that the whole mark lands on the deck, and no wider.
  //
  // It was 0.8 m of margin, which is a generous apron and was fine while there
  // was one rooftop. The second one is on a smaller slab: the widest platform
  // whose footprint stays on ONE roof height there is 1.5 m, and a platform that
  // ran onto the step behind it would put its deck level with real roof
  // geometry — the same coplanar depth fight the plinth already had to be moved
  // out of. The apron gave way, because the mark cannot.
  const r = zone.radius + PAD_MARGIN;
  // The plinth's own height: up to the underside of the slab, plus a little
  // buried in it so no two faces are ever level with each other.
  const plinth = Math.max(h - DECK_T + PAD_BITE, 0.02);
  return (
    <group position={[zone.at[0], base, zone.at[1]]}>
      {/* The plinth, tapered a little so it reads as built rather than as a
          cylinder someone left on a roof.

          It stops UNDER the deck slab and pushes a few centimetres up into it.
          Both meshes used to reach exactly the platform's top, which put the
          plinth's top cap and the deck's top cap on the same plane — and two
          coplanar faces are a depth fight, which is what covered the deck in
          banded grey patches from every angle. The give-away was the shape of
          the mess: it stopped at an octagon INSIDE the deck's own edge, because
          that is exactly where the plinth's cap ended. */}
      <mesh position={[0, plinth / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.9, r * 0.97, plinth, 8]} />
        <meshStandardMaterial
          color={PAD_STONE}
          emissive={PAD_LIFT}
          emissiveIntensity={0.22}
          roughness={0.88}
          metalness={0}
        />
      </mesh>
      {/* The deck itself, standing proud of the plinth: the overhang is what
          gives the whole thing an edge against the roof behind it, which a flat
          drum on grey concrete would not have. */}
      <mesh position={[0, h - DECK_T / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, DECK_T, 8]} />
        <meshStandardMaterial
          color={PAD_TOP}
          emissive={PAD_LIFT}
          emissiveIntensity={0.34}
          roughness={0.8}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/** Thickness of the platform's top slab, metres. */
const DECK_T = 0.16;
/**
 * The platform's stone, and why it is not simply "concrete grey".
 *
 * A mission is flown at the blue half hour and this thing stands on a roof
 * twenty-five metres up, so nothing but sky is bouncing light back onto it. The
 * first pass was a cool slate that took its colour from exactly that — it came
 * out as a dark shape the same value as the roof it was standing on, which is
 * the one thing the platform must never be: the pilot is looking for it from
 * across the city.
 *
 * Warm stone reads against a blue evening the way cool grey cannot, the top
 * course is lighter than the plinth so the deck has an edge of its own, and a
 * little emissive keeps both off the floor of the exposure rather than
 * brightening the scene. It also stops RECEIVING shadow: a landing platform that
 * goes dark because the tower next door is between it and the sun is a landmark
 * that disappears at exactly the hour this mission is flown.
 */
/**
 * How far the plinth is buried in the deck slab above it, metres.
 *
 * Small, and it only has to be non-zero. Two meshes that meet exactly are two
 * coplanar faces, and a depth buffer cannot choose between them — the surface
 * then flickers between the two materials in bands as the camera moves, which is
 * what a pilot reads as a platform covered in dirty patches.
 */
const PAD_BITE = 0.04;
/** How far the platform's deck reaches past the mark drawn on it, metres. */
const PAD_MARGIN = 0.4;
const PAD_STONE = '#a09883';
const PAD_TOP = '#cdc4ad';
const PAD_LIFT = '#4a4335';

/**
 * One zone mark: a ring on the deck, a column of light standing in it, and — on
 * the drop only — the height band drawn as two faint hoops.
 *
 * `live` lights it; anything else fades it out and leaves it out. The fade is
 * driven both ways so a restart lights the pickup back up rather than leaving a
 * dark patch on the street.
 */
function ZoneMark({
  zone,
  groundY,
  live,
  standby = false,
  ready,
  column: withColumn = true,
  xray = false,
}: {
  zone: MissionZone;
  groundY: number;
  live: boolean;
  /** Not the mark being flown to, but still worth seeing: kept dimly alight,
   *  unpulsed. */
  standby?: boolean;
  /** 0..1 of the release conditions met — drop zone only. Colours the mark. */
  ready?: number;
  /** Draw the column of light. Off over fire where smoke and flame provide natural landmark. */
  column?: boolean;
  /** Let the column draw through the scenery once the mark is the one being
   *  arrived at. The mission's `seeThroughMarks` — off over a city. */
  xray?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const column = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const lit = useRef(0);

  const base = useMemo(() => new THREE.Color(ZONE_COLOR[zone.kind]), [zone.kind]);
  const ready1 = useMemo(() => new THREE.Color(DROP_READY), []);
  const tint = useMemo(() => new THREE.Color(), []);

  const height = Math.min(Math.max(zone.band.max * 1.1, 2.2), 6);
  const colR = Math.max(zone.radius, 1.2);
  const tex = columnTexture();

  // A mark on a roof gets a shaft of light hanging UNDER it, from the deck down
  // to the foot of the platform.
  //
  // Everything the mission gave the pilot about where to go was flat — a bearing
  // arrow, a top-down radar, a ring drawn on the deck itself — so a drop on a
  // roof looked exactly like a drop on the street until they were over it. The
  // ring cannot help: it is painted on the one surface a pilot at street level
  // cannot see. This can, because it reaches down to where they are looking.
  const drop = zone.padBase !== undefined ? groundY - zone.padBase : 0;
  const raised = drop > RAISED_MIN;
  const reveal = raised ? REVEAL_RAISED : REVEAL;

  useFrame(({ clock, camera }, dt) => {
    const dx = camera.position.x - zone.at[0];
    const dz = camera.position.z - zone.at[1];
    const flat = Math.hypot(dx, dz);

    const near = flat <= reveal;
    const step = Math.min(dt, 0.1) / FADE;
    // Where this mark's light is heading: full for the one being flown to, a
    // third for one that is merely still standing there, out otherwise. The
    // fade itself is unchanged, so a mark dropping from live to standby eases
    // down at the same rate the drop mark comes up.
    const target = near ? (live ? 1 : standby ? STANDBY : 0) : 0;
    const t = (lit.current =
      lit.current < target
        ? Math.min(target, lit.current + step)
        : Math.max(target, lit.current - step));

    if (group.current) {
      group.current.visible = t > 0.002;
      const s = 1 + 0.35 * (1 - t);
      group.current.scale.set(s, 1, s);
    }

    const urgency = 1 + (ready ?? 0) * 2.2;
    const pulse = live ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.9 * urgency) : 0;
    tint.copy(base);
    if (ready !== undefined) tint.lerp(ready1, ready);

    const ringMat = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (ringMat) {
      ringMat.color.copy(tint);
      ringMat.opacity = t * (0.35 + 0.25 * pulse);
    }

    const colMat = column.current?.material as THREE.MeshBasicMaterial | undefined;
    if (colMat) {
      colMat.color.copy(tint);
      const fade = Math.min(1, Math.max(0, flat / (colR * 3) - 0.4) / 0.6);
      const punch = Math.min(1, Math.max(0.6, 1.6 / colR));
      colMat.opacity = t * fade * punch * (0.3 + 0.16 * pulse);
      colMat.depthTest = !xray || flat > REVEAL * 0.9;
    }

    // The hanging shaft. It does NOT take the column's distance fade — that
    // fade exists to get the column out of the way once the pilot is on top of
    // the mark, and this one's whole job is to be seen from far off. It does
    // fade out on close approach, when the deck is in view and the beam would
    // only be standing between the drone and the ring it is landing in.
    const beamMat = beam.current?.material as THREE.MeshBasicMaterial | undefined;
    if (beamMat) {
      beamMat.color.copy(tint);
      const close = Math.min(1, Math.max(0, flat - colR * 2.5) / (colR * 3));
      beamMat.opacity = t * close * (0.26 + 0.14 * pulse);
    }
  });

  return (
    <group ref={group} position={[zone.at[0], groundY, zone.at[1]]}>
      {/* Sleek, glowing perimeter ring on the ground */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, zone.ringLift ?? 0.03, 0]}>
        <ringGeometry args={[zone.radius * 0.93, zone.radius, 64]} />
        <meshBasicMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* The shaft under a rooftop mark. Rotated a half turn so the column
          texture's solid end lands at the DECK and it fades toward the street:
          the light belongs to the mark above, not to the pavement below it. */}
      {raised && (
        <mesh ref={beam} position={[0, -drop / 2, 0]} rotation={[Math.PI, 0, 0]} renderOrder={3}>
          <cylinderGeometry args={[colR * 0.8, colR * 0.62, drop, 24, 1, true]} />
          <meshBasicMaterial
            map={tex}
            transparent
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Soft column pointer for standard ground marks */}
      {withColumn && (
        <mesh ref={column} position={[0, height / 2, 0]} renderOrder={3}>
          <cylinderGeometry args={[colR * 1.2, colR, height, 32, 1, true]} />
          <meshBasicMaterial
            map={tex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * The mission's furniture: the checkpoints in play, and the three zones.
 *
 * Not all of them at once. Twenty-three balls lit across a city is twenty-three
 * targets and no route at all, so what is drawn is the leg being flown — PLUS
 * any checkpoint from an earlier leg that is still outstanding and still
 * required. That second half is not a nicety: the package will not release until
 * the outbound checkpoints are all taken, and a checkpoint the pilot must go
 * back for has to be somewhere they can see.
 */
export function MissionMarkers({ mission }: { mission: Mission }) {
  const leg = useMissionStore((s) => s.leg);
  const phase = useMissionStore((s) => s.phase);
  const collected = useMissionStore((s) => s.collected);
  const checks = useMissionStore((s) => s.checks);
  const collect = useMissionStore((s) => s.collect);
  const gate = useMissionStore((s) => s.gate);
  const runIndex = useMissionStore((s) => s.runIndex);

  const liveLeg = legOf(leg);
  const zoneKind = activeZone(leg);
  const flying = phase === 'flying';

  // ONE ring at a time.
  //
  // Every outstanding ring used to be lit at once, which over a city is a
  // constellation: fourteen pink balls between the buildings and no way to tell
  // which one is yours, so the route read as scenery to be hoovered up rather
  // than as a line to fly. The next one lights the moment the last is taken, and
  // `nextCheckpointOf` picks it in route order — the same call the radar dot and
  // the DISTANCE readout use, so what is lit in the world is what the dial is
  // pointing at.
  //
  // It does NOT depend on where the drone is, which is why this reads nothing
  // from `dronePose`: a missed ring stays lit until it is flown through, so the
  // light changes only when a ring is taken. This used to sample the pose on a
  // timer to drop rings the aircraft was past, and that is gone with the rule.
  const next = nextCheckpointOf(mission, liveLeg, collected);

  // How close the drop is to firing, as one number the mark can be coloured by.
  //
  // Zero while checkpoints are still owed. The release REFUSES until the gate is
  // clear, so a mark that goes green and beats faster as the pilot settles over
  // it is telling them a delivery is about to happen that cannot: they hold a
  // perfect hover over a locked door and nothing fires. It stays in its own
  // colour until the gate is actually open.
  // Packages still standing on the hub pad: everything after the one being
  // flown. Zero on a single-drop mission, which is what keeps its pickup mark
  // going dark the moment the package is aboard.
  const waitingAtHub = mission.deliveries ? mission.deliveries.length - runIndex - 1 : 0;

  const locked = gate.left > 0;
  const ready = locked
    ? 0
    : (Number(checks.centred) + Number(checks.inBand) + Number(checks.steady)) / 3;

  return (
    <group>
      {/* No ring around the aircraft here. Flight School flies inside an arena
          where a target can be off the edge of the picture with nothing to hold
          on to, so the ring earns its place. A mission is flown over a city with
          the radar in the corner answering the same question from above, and two
          instruments saying "that way" put a large circle over the view for the
          second one. The radar keeps it; the world stays clear. */}

      {/* Every ring on the route is mounted for the whole flight, and all but
          one of them is dark.

          Mounting only the live ring drew the same picture and it JERKED. Taking
          a ring tore one sphere down and built the next: a geometry, three
          materials and two sprites, allocated and uploaded on the frame the
          drone was passing through the marker. That frame ran long, and a long
          frame is where the rigid body's interpolation regresses, so the
          aircraft appeared to snap BACKWARDS at the moment of the pass, which is
          the one moment the pilot is watching it.

          So nothing is built or thrown away while the drone is flying. A dark
          ring sets `visible = false` and costs one distance check a frame. */}
      {mission.route.map((c) => {
        const live = flying && next?.id === c.id;
        return (
          <CheckpointSphere
            key={c.id}
            position={c.at}
            radius={c.radius}
            triggerRadius={c.reach}
            collected={!live}
            onCollect={
              live
                ? () => {
                    collect(c.id, c.label);
                    playCollect();
                  }
                : undefined
            }
          />
        );
      })}

      {/* The pickup and the pad.

          On a multi-point delivery these are the SAME PLACE — the hub is where
          the packages wait and where the drone comes home — and they are still
          drawn as two marks, because they are two different tests with two
          different bands. Only one of them is ever live, so what the pilot sees
          is one ring that changes its job, not two rings arguing. */}
      {(['pickup', 'base'] as const).map((kind) => (
        <ZoneMark
          key={kind}
          zone={mission.zones[kind]}
          groundY={zoneGroundY(mission, mission.zones[kind])}
          live={flying && zoneKind === kind}
          /* The hub goes on burning while packages are still on it.
             It used to go out the moment the drone lifted the first one, which
             left two boxes sitting on an unlit pad — the pilot is coming back
             here twice, and the place they are coming back to was the one thing
             on the map with no light on it. Only on a multi-delivery, only
             while something is still waiting, and never on the pad itself. */
          standby={kind === 'pickup' && flying && zoneKind !== 'pickup' && waitingAtHub > 0}
          xray={mission.seeThroughMarks === true}
        />
      ))}

      {/* The destinations.

          Every one of them is mounted for the whole flight and all but one is
          dark — the same rule the rings follow, and for the same reason: a mark
          built while the drone is flying costs a frame at the moment the pilot
          is watching the aircraft. Which one is LIT is `runIndex`, so a pilot
          holding a perfect hover over rooftop C on run A gets nothing, and
          nothing on screen ever suggested they would.

          `mission.zones.drop` is the first entry on such a mission, so a
          single-drop mission draws exactly the one mark it always did. */}
      {(mission.deliveries ?? [{ id: 'drop', zone: mission.zones.drop }]).map((d, i) => (
        <group key={d.id}>
          {/* Drawn whether or not this destination is the live one: it is a
              structure on a roof, and one that appeared when the pilot was sent
              to it would be a building materialising over the city. */}
          <RooftopPad zone={d.zone} deck={zoneGroundY(mission, d.zone)} />
          <ZoneMark
            zone={d.zone}
            groundY={zoneGroundY(mission, d.zone)}
            live={flying && zoneKind === 'drop' && i === runIndex}
            ready={i === runIndex ? ready : undefined}
            column={!mission.fire}
            xray={mission.seeThroughMarks === true}
          />
        </group>
      ))}
    </group>
  );
}
