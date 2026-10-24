import { Grounded } from './Grounded';
import { InflatableGate } from './InflatableGate';
import { InflatableRing } from './InflatableRing';

// The Construction Site's PlutoSim race course, Free Flight only (mounted from
// Viewport, so the site's missions never see it). The Supermarket's course,
// laid round the frame (2026-10-24).
//
// The site has no plan grid, so the spots were checked against the layout the
// code builds: the seeded debris and spoil heaps (layOutDebris, re-run with each
// prop's real footprint), the cabins, skips, material stacks, the rebar raft,
// the lying columns and the crane's mast and hook. A gate needs 3.5 m clear of
// all of it, a ring 1 m (it floats over the low stuff). Everything stays well
// inside the hoarding — the user had the Supermarket's edge pieces taken out —
// and a search maximised the smallest gap: about 23 m. On the ground each piece
// is flown round the frame, not at it.
//
// Two pieces stand on the roof: the poured half, x -18..18, z 0..12 at 25.2 m.
// It is only 36 m long, so they are 18 m apart.
const ALONG_X = Math.PI / 2;
const ALONG_Z = 0;

const GATES: { x: number; z: number; yaw: number }[] = [
  { x: -9, z: 6, yaw: ALONG_X }, // roof
  { x: -1, z: -27, yaw: ALONG_X }, // north of the frame
  { x: 19, z: 18, yaw: ALONG_Z }, // south-east, past the standing columns
  { x: -27, z: 19, yaw: ALONG_Z }, // by the crane
  { x: -18, z: -42, yaw: ALONG_X }, // north, by the raft
  { x: -42, z: 42, yaw: ALONG_X }, // south-west
  { x: 42, z: 41, yaw: ALONG_X }, // south-east
];

/** Centre height above whatever is under it. */
const RING_HEIGHT = 5;
const ROOF_RING_HEIGHT = 3.5;

const RINGS: { x: number; z: number; yaw: number; height: number }[] = [
  { x: 9, z: 6, yaw: ALONG_X, height: ROOF_RING_HEIGHT }, // roof
  { x: -7, z: 32, yaw: ALONG_X, height: RING_HEIGHT }, // over the precast columns
  { x: -42, z: 0, yaw: ALONG_Z, height: RING_HEIGHT }, // west
  { x: 42, z: -1, yaw: ALONG_Z, height: RING_HEIGHT }, // east, by the cabins
  { x: -41, z: -42, yaw: ALONG_X, height: RING_HEIGHT }, // north-west, past the raft
  { x: 40, z: -42, yaw: ALONG_X, height: RING_HEIGHT }, // north-east
];

/** Over the roof and its stub columns (26.3 m), under the crane's jib (34 m). */
const RAY_FROM = 30;
const RAY_LENGTH = 31;

export function ConstructionRaceCourse() {
  return (
    <group name="construction-race-course">
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
