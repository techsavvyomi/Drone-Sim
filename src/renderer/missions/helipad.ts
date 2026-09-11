import { newYork } from '../plugins/environments/newYork';

// ----------------------------------------------------------------------------
// The New York helipad, as a place to LAND as well as to launch from.
//
// `LaunchPad` paints the H under the environment's spawn. A mission that ends
// with "come home and land" has to judge the landing on that same H — it used to
// be judged on a separate mark 13.6 m down the street, so the pilot came back to
// the pad they had left and was scored somewhere else. Read from the spawn
// rather than copied, so moving the spawn moves the landing with it.
// ----------------------------------------------------------------------------

/** Centre of the painted H, world x, z. */
export const NEW_YORK_HELIPAD_AT: readonly [number, number] = [
  newYork.spawn.position[0],
  newYork.spawn.position[2],
];

/** The sidewalk plate the H is painted on, metres — not the road plane. */
export const NEW_YORK_HELIPAD_GROUND = newYork.spawnGround ?? newYork.groundY ?? 0;

/**
 * How far off the H's centre a touchdown still counts, metres.
 *
 * Just outside the 1.15 m paint, so the green ring sits round the H and the
 * aircraft has to be ON it. It cannot be much wider: the tower's face is 1.56 m
 * behind the pad, and a larger ring would be drawn into the wall.
 */
export const HELIPAD_LAND_RADIUS = 1.2;
