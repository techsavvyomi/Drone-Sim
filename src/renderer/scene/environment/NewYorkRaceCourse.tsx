import { useState, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { InflatableGate } from './InflatableGate';
import { InflatableRing } from './InflatableRing';

// New York's PlutoSim race course, Free Flight only (mounted from Viewport, so
// the city's missions never see it).
//
// The city has four open roads that run the whole map: North St (z -36..-28),
// South St (z 26..34, the spawn's), West Ave (x -34..-26) and East Ave
// (x 24..32). Gates and rings are spread along all four, end to end, and
// spaced so no two pieces are closer than 36 m (the user found 22 m crowded,
// 2026-10-21). Every spot was checked on NewYorkPlan.ts as clear road — no roof,
// canopy, sidewalk or street prop under a gate's feet, no roof or canopy within
// a ring's reach — and none sits in an intersection. Each faces along its road.
const ALONG_X = Math.PI / 2;
const ALONG_Z = 0;

const GATES: { x: number; z: number; yaw: number }[] = [
  { x: -98, z: -33, yaw: ALONG_X }, // North St, far west
  { x: -58, z: -31, yaw: ALONG_X }, // North St, west
  { x: 1, z: -31, yaw: ALONG_X }, // North St, middle
  { x: 97, z: -31, yaw: ALONG_X }, // North St, far east
  { x: -29, z: -75, yaw: ALONG_Z }, // West Ave, far north
  { x: -30, z: -5, yaw: ALONG_Z }, // West Ave, middle
  { x: 27, z: -57, yaw: ALONG_Z }, // East Ave, north
  { x: 62, z: 29, yaw: ALONG_X }, // South St, east
];

/** Centre height above the road. Picked to clear the street lamps, by eye. */
const RING_HEIGHT = 6;

const RINGS: { x: number; z: number; yaw: number }[] = [
  { x: -81, z: 30, yaw: ALONG_X }, // South St, far west
  { x: -42, z: 30, yaw: ALONG_X }, // South St, west
  { x: 98, z: 30, yaw: ALONG_X }, // South St, far east
  { x: 57, z: -32, yaw: ALONG_X }, // North St, east
  { x: -30, z: 78, yaw: ALONG_Z }, // West Ave, far south
  { x: 28, z: -3, yaw: ALONG_Z }, // East Ave, middle
  { x: 28, z: 41, yaw: ALONG_Z }, // East Ave, south
  { x: 28, z: 77, yaw: ALONG_Z }, // East Ave, far south
];

/** The road is at 0 to within a kerb's height; the ray looks this far either side. */
const RAY_FROM = 2;
const RAY_LENGTH = 4;

/**
 * Stands a piece on the real road. Waits for the city's colliders (they load
 * with the model), then casts once straight down from just above the plan's
 * road height. Nothing of the piece itself exists yet, so the first hit is the
 * ground.
 */
function Grounded({
  x,
  z,
  children,
}: {
  x: number;
  z: number;
  children: (y: number) => ReactElement;
}) {
  const { world, rapier } = useRapier();
  const [y, setY] = useState<number | null>(null);

  useFrame(() => {
    if (y !== null) return;
    const ray = new rapier.Ray({ x, y: RAY_FROM, z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(
      ray,
      RAY_LENGTH,
      true,
      rapier.QueryFilterFlags.EXCLUDE_DYNAMIC | rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    if (hit) setY(RAY_FROM - hit.timeOfImpact);
  });

  return y === null ? null : children(y);
}

export function NewYorkRaceCourse() {
  return (
    <group name="new-york-race-course">
      {GATES.map((g, i) => (
        <Grounded key={`g${i}`} x={g.x} z={g.z}>
          {(y) => <InflatableGate position={[g.x, y, g.z]} rotation={[0, g.yaw, 0]} />}
        </Grounded>
      ))}
      {RINGS.map((r, i) => (
        <Grounded key={`r${i}`} x={r.x} z={r.z}>
          {(y) => (
            <InflatableRing
              position={[r.x, y, r.z]}
              rotation={[0, r.yaw, 0]}
              height={RING_HEIGHT}
            />
          )}
        </Grounded>
      ))}
    </group>
  );
}
