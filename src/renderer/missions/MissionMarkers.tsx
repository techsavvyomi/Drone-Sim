import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
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
}: {
  zone: MissionZone;
  groundY: number;
  live: boolean;
  /** 0..1 of the release conditions met — drop zone only. Colours the mark. */
  ready?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const column = useRef<THREE.Mesh>(null);
  const lit = useRef(0);

  const base = useMemo(() => new THREE.Color(ZONE_COLOR[zone.kind]), [zone.kind]);
  const ready1 = useMemo(() => new THREE.Color(DROP_READY), []);
  const tint = useMemo(() => new THREE.Color(), []);

  /**
   * How tall the column of light stands, in metres.
   *
   * It is a POINTER, not a landmark. Its job is to say "the mark is here" from
   * far enough out to turn towards, and then to get out of the way — the ring on
   * the deck is what the pilot actually flies to.
   *
   * It was `band.max * 1.4` with a floor of 4, and the floor was doing all the
   * work: the pickup's height band is 0.9 m deep, so a mark you have to descend
   * to within a metre of the deck stood a four metre pillar of green up into the
   * street trees. It read as a wall the drone had to fly into rather than as a
   * mark to come down onto, and over the city it was tall enough to be mistaken
   * for a checkpoint.
   *
   * Now it is barely more than the band it is drawing, floored at 2.2. Every
   * mark in the game got SHORTER, which is the point: the pickup drops from 4 m
   * to 2.2, the city's drop from 4 to 2.2, the pad from 4.2 to 3.3, and the
   * forest fire's hover — a genuinely 11 m deep band, in a hollow — from 15.4 to
   * 12.1. A zone that needs a tall column now has to say so through its band,
   * which is the number the column is meant to be describing in the first place.
   */
  const height = Math.max(zone.band.max * 1.1, 2.2);
  const tex = columnTexture();

  useFrame(({ clock, camera }, dt) => {
    const step = Math.min(dt, 0.1) / FADE;
    const t = (lit.current = live
      ? Math.min(1, lit.current + step)
      : Math.max(0, lit.current - step));

    if (group.current) {
      group.current.visible = t > 0.002;
      // Opening out as it dims: a light that widens and fades reads as being
      // switched off, which is what has happened.
      const s = 1 + 0.35 * (1 - t);
      group.current.scale.set(s, 1, s);
    }

    // A slow breath while it is the target, and nothing once it is not. The
    // drop mark beats faster the closer the pilot is to satisfying it, which is
    // the world telling them they are nearly there.
    const urgency = 1 + (ready ?? 0) * 2.2;
    const pulse = live ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.9 * urgency) : 0;
    tint.copy(base);
    if (ready !== undefined) tint.lerp(ready1, ready);

    const ringMat = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (ringMat) {
      ringMat.color.copy(tint);
      ringMat.opacity = t * (0.3 + 0.22 * pulse);
    }
    const colMat = column.current?.material as THREE.MeshBasicMaterial | undefined;
    if (colMat) {
      colMat.color.copy(tint);
      // The column is additive and the camera follows the drone INTO it on the
      // descent, where a full-screen white wash is the one thing the pilot
      // cannot fly through. So it thins out as the view gets close and is gone
      // by the time the camera is inside: by then the ring on the deck is the
      // cue, and the column has nothing left to point at.
      const dx = camera.position.x - zone.at[0];
      const dz = camera.position.z - zone.at[1];
      const near = Math.min(1, Math.max(0, Math.hypot(dx, dz) / (zone.radius * 3) - 0.4) / 0.6);
      colMat.opacity = t * near * (0.2 + 0.12 * pulse);
    }
  });

  return (
    <group ref={group} position={[zone.at[0], groundY, zone.at[1]]}>
      {/* The mark on the deck. A RING, not a disc: the drone hovers over the
          middle of its own mark, so the middle is the part hidden under the
          airframe and its shadow — lit as a ring, the brightest thing on the
          street is exactly the line where "close enough" stops. */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[zone.radius * 0.72, zone.radius, 48]} />
        <meshBasicMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* The column, so the mark can be found from the air. Open-ended and
          double-sided: no lid to see from above, and the far wall draws too,
          which is most of what makes it read as a volume. */}
      <mesh ref={column} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[zone.radius, zone.radius, height, 32, 1, true]} />
        <meshBasicMaterial
          map={tex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* The height band, on the drop only. Two hoops at the floor and ceiling
          of the window the release is judged in, so "descend to the right
          height" is a thing the pilot can SEE rather than a number to guess. */}
      {zone.kind === 'drop' && (
        <>
          <BandHoop radius={zone.radius} y={zone.band.min} live={live} />
          <BandHoop radius={zone.radius} y={zone.band.max} live={live} />
        </>
      )}
    </group>
  );
}

/** One hoop of the delivery height band. Thin and dim on purpose: it is a guide
 *  for the descent, not another target. */
function BandHoop({ radius, y, live }: { radius: number; y: number; live: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const lit = useRef(0);
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1) / FADE;
    lit.current = live ? Math.min(1, lit.current + step) : Math.max(0, lit.current - step);
    const mat = mesh.current?.material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = lit.current * 0.22;
    if (mesh.current) mesh.current.visible = lit.current > 0.002;
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <ringGeometry args={[radius * 0.94, radius, 40]} />
      <meshBasicMaterial
        color={DROP_READY}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
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
  // Sampled off `dronePose` on a timer rather than on every frame: an optional
  // ring stops being the guidance once the drone is past it, which makes the
  // choice depend on where the aircraft is, and re-running this component sixty
  // times a second to move one light is exactly what the mounted-and-dark
  // approach below exists to avoid. Four times a second is faster than a pilot
  // can fly past a 3 m ball.
  const [droneAt, setDroneAt] = useState(() => ({ x: 0, z: 0 }));
  useEffect(() => {
    if (!flying) return;
    const id = window.setInterval(() => {
      const p = dronePose.position;
      setDroneAt((prev) =>
        Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.z - p.z) < 0.5 ? prev : { x: p.x, z: p.z },
      );
    }, 250);
    return () => window.clearInterval(id);
  }, [flying]);

  const next = nextCheckpointOf(mission, liveLeg, collected, droneAt);

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

      {(['pickup', 'drop', 'base'] as const).map((kind) => (
        <ZoneMark
          key={kind}
          zone={mission.zones[kind]}
          groundY={zoneGroundY(mission, mission.zones[kind])}
          live={flying && zoneKind === kind}
          ready={kind === 'drop' ? ready : undefined}
        />
      ))}
    </group>
  );
}
