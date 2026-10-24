import { Grounded } from './Grounded';
import { InflatableGate } from './InflatableGate';
import { InflatableRing } from './InflatableRing';

// The Supermarket's PlutoSim race course, Free Flight only (mounted from
// Viewport, so the store's missions never see it). New York's gates and rings,
// on the rooftops and the open ground inside the map (2026-10-24). Nothing on
// the grass round the map's edge: the user had those taken out the same day.
//
// Two flat roofs stand at 6.0 m: the store (x -64..-4, z -41..-7) and the
// warehouse (x 5..28, z -37..-5), with a 7 m alley between them. Around them
// are the car park and the paved back yard east of the warehouse. Spots were
// picked off SupermarketPlan.ts: a gate needs a 3.5 m disc of one level (all
// ground or all roof, nothing standing), a ring a 3 m disc; then a search
// maximised the smallest gap: 27 m (New York's 22 m was crowded, 2026-10-21).
// Three more roof rings came later at the user's ask, as far from the rest as
// the roofs allow — 20 m on the store roof. Each faces along the open run it
// sits in.
const ALONG_X = Math.PI / 2;
const ALONG_Z = 0;

const GATES: { x: number; z: number; yaw: number }[] = [
  { x: 1, z: -15, yaw: ALONG_Z }, // the alley between store and warehouse
  { x: -36, z: -11, yaw: ALONG_X }, // store roof, front
  { x: -60, z: -29, yaw: ALONG_X }, // store roof, west end
  { x: -44, z: 17, yaw: ALONG_Z }, // car park, by the spawn
  { x: -8, z: 19, yaw: ALONG_X }, // car park, middle
  { x: 24, z: 23, yaw: ALONG_X }, // car park, east
  { x: 46, z: -20, yaw: ALONG_Z }, // back yard
];

/** Centre height above the roof under it. */
const ROOF_RING_HEIGHT = 3.5;

const RINGS: { x: number; z: number; yaw: number; height: number }[] = [
  { x: -22, z: -39, yaw: ALONG_X, height: ROOF_RING_HEIGHT }, // store roof, back
  { x: 22, z: -33, yaw: ALONG_Z, height: ROOF_RING_HEIGHT }, // warehouse roof
  { x: 25, z: -7, yaw: ALONG_Z, height: ROOF_RING_HEIGHT }, // warehouse roof, front
  { x: -43, z: -41, yaw: ALONG_X, height: ROOF_RING_HEIGHT }, // store roof, back edge
  { x: -57, z: -9, yaw: ALONG_X, height: ROOF_RING_HEIGHT }, // store roof, front west
];

/** Above the roofs (and the 8.3 m shopfront sign), down past the ground. */
const RAY_FROM = 20;
const RAY_LENGTH = 25;

export function SupermarketRaceCourse() {
  return (
    <group name="supermarket-race-course">
      {GATES.map((g, i) => (
        <Grounded key={`g${i}`} x={g.x} z={g.z} from={RAY_FROM} length={RAY_LENGTH}>
          {(y) => <InflatableGate position={[g.x, y, g.z]} rotation={[0, g.yaw, 0]} />}
        </Grounded>
      ))}
      {RINGS.map((r, i) => (
        <Grounded key={`r${i}`} x={r.x} z={r.z} from={RAY_FROM} length={RAY_LENGTH}>
          {(y) => (
            <InflatableRing position={[r.x, y, r.z]} rotation={[0, r.yaw, 0]} height={r.height} />
          )}
        </Grounded>
      ))}
    </group>
  );
}
