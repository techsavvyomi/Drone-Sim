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

/** Zone colours. Green is "go here": the pickup mark and its column, and the
 *  pad you come home to, the same green the radar's dot uses for whatever is
 *  next. The drop keeps its own amber until the release conditions are met,
 *  which is when it turns green too. */
const ZONE_COLOR: Record<MissionZoneKind, string> = {
  pickup: '#37e08a',
  drop: '#ffcf4d',
  base: '#37e08a',
};
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
  ready,
  column: withColumn = true,
  xray = false,
}: {
  zone: MissionZone;
  groundY: number;
  live: boolean;
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
  const lit = useRef(0);

  const base = useMemo(() => new THREE.Color(ZONE_COLOR[zone.kind]), [zone.kind]);
  const ready1 = useMemo(() => new THREE.Color(DROP_READY), []);
  const tint = useMemo(() => new THREE.Color(), []);

  const height = Math.min(Math.max(zone.band.max * 1.1, 2.2), 6);
  const colR = Math.max(zone.radius, 1.2);
  const tex = columnTexture();

  useFrame(({ clock, camera }, dt) => {
    const dx = camera.position.x - zone.at[0];
    const dz = camera.position.z - zone.at[1];
    const flat = Math.hypot(dx, dz);

    const near = flat <= REVEAL;
    const step = Math.min(dt, 0.1) / FADE;
    const t = (lit.current =
      live && near ? Math.min(1, lit.current + step) : Math.max(0, lit.current - step));

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
        <ZoneMark
          key={d.id}
          zone={d.zone}
          groundY={zoneGroundY(mission, d.zone)}
          live={flying && zoneKind === 'drop' && i === runIndex}
          ready={i === runIndex ? ready : undefined}
          column={!mission.fire}
          xray={mission.seeThroughMarks === true}
        />
      ))}
    </group>
  );
}
