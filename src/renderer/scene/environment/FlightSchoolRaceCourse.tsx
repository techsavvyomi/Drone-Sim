import { Grounded } from './Grounded';
import { InflatableRing } from './InflatableRing';

// Flight School's PlutoSim race course, Free Flight only (mounted from
// Viewport; the lessons fly in their own TrainingViewport and never see it).
//
// The hall is small — 24 x 24 m, walls at ±12, the ceiling at 8 — so the user
// asked for only a few pieces, and rings only: no gates (2026-10-24). Four rings
// stand on a 7.5 m circle round the spawn, one on each side, so they fly as a
// loop: the first is straight ahead on spawn (heading 0 looks down -Z), and each
// faces along the loop. About 10.6 m between neighbours.
const ALONG_X = Math.PI / 2;
const ALONG_Z = 0;

/**
 * Smaller than the outdoor rings, which the user found too big for the hall:
 * 1.75 m to the outside of the tube, a 2.4 m hole.
 */
const RING_SCALE = 0.7;
/** Centre height: the top of the ring is then 5.2 m, under the 8 m ceiling. */
const RING_HEIGHT = 3.5;

const RINGS: { x: number; z: number; yaw: number }[] = [
  { x: 0, z: -7.5, yaw: ALONG_X }, // ahead of the spawn
  { x: 7.5, z: 0, yaw: ALONG_Z }, // right
  { x: 0, z: 7.5, yaw: ALONG_X }, // behind
  { x: -7.5, z: 0, yaw: ALONG_Z }, // left
];

/** The floor is flat at 0; the ray looks this far either side. */
const RAY_FROM = 2;
const RAY_LENGTH = 4;

export function FlightSchoolRaceCourse() {
  return (
    <group name="flight-school-race-course">
      {RINGS.map((r, i) => (
        <Grounded key={`r${i}`} x={r.x} z={r.z} from={RAY_FROM} length={RAY_LENGTH}>
          {(y) => (
            <InflatableRing
              position={[r.x, y, r.z]}
              rotation={[0, r.yaw, 0]}
              height={RING_HEIGHT}
              scale={RING_SCALE}
            />
          )}
        </Grounded>
      ))}
    </group>
  );
}
