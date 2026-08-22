import type { DroneSpec } from '@shared/types';
import racerModelUrl from '../../../assets/models/RacingDrone.opt.glb?url';

// 5" freestyle/racing quad — the first airframe here that is game art rather
// than CAD, which changes two things about how it is set up.
//
// ORIENTATION. Nothing needed: the FPV camera pod sits at the model's -Z end,
// which is already the sim's forward, so modelYawDeg stays 0. (The PlutoX is
// authored facing +Z and needs a half turn; the Guru needs 165 degrees.)
//
// PROPELLERS. It has none. What look like props are four flat 18-triangle discs
// carrying a motion-blur texture — the standard trick for game-ready drone art.
// They are still tagged PROP_0..3 and still spin, so the direction convention is
// the same as every other airframe (it comes from the mixer via PROP_SPIN_Y:
// FR and RL clockwise, FL and RR counter-clockwise). What differs is how they
// are DRAWN, hence propArt below.
//
// Measurements below are taken from the model's own geometry, not guessed:
// prop hubs at (+-3.471, 0.871, -2.215 / +3.182) in authored units, giving a
// motor-to-motor diagonal of 8.793.
export const racingDrone: DroneSpec = {
  id: 'racing-drone',
  name: 'Racing Drone',
  frame: 'quad',
  // ~720 g all-up: 5" props on a frame this size is a long-range/freestyle
  // build rather than a stripped race quad, so it carries a bit more.
  mass: 0.72,
  /*
   * Half the motor-to-motor diagonal, which is DERIVED here rather than chosen.
   *
   * The props are 5" (127 mm), and in the model the blur discs measure 3.5955
   * authored units against a motor diagonal of 8.7931 — so once the props are
   * their real size the frame follows: 8.7931 / 3.5955 * 127 mm = 311 mm.
   *
   * That is a big frame for 5" props. It is what the art's proportions give:
   * the discs are drawn well clear of each other (prop diameter is 0.52 of the
   * motor spacing, where a real 5" quad runs about 0.82, props nearly touching).
   * Scaling to a 220 mm race frame instead would shrink the props to 3.5".
   */
  armLength: 0.1553,
  motors: Array.from({ length: 4 }, () => ({
    // Low kv for the class: a 311 mm frame carrying 720 g wants torque, not
    // headline RPM, and every real build this size runs 1700-2000 kv on 4S.
    // It also puts the rotors where they belong acoustically — a hover at
    // ~10,900 RPM, which is what a 5" quad actually sounds like.
    kv: 1950,
    // 4 x 6.4 N against a 7.06 N weight -> thrust-to-weight 3.6, so a hover
    // sits near 28% stick. Punchier than the trainers (both 2.0) without being
    // the 8:1 of a real race build, which would put hover at 12% and make the
    // top three-quarters of the throttle unusable.
    maxThrustN: 6.4,
    // Bigger rotating mass than a whoop, more than the Guru's 5.3".
    responseTime: 0.05,
  })),
  propDiameterIn: 5,
  // Four-blade props, measured off the blur texture by rotational symmetry
  // (4-fold scores 0.995, 3-fold is negative). Blade count only feeds the
  // engine sound, where it doubles the pitch against a 2-blade prop.
  propBlades: 4,
  battery: {
    cells: 4,
    capacityMah: 1800,
    nominalV: 3.7,
    internalResistance: 0.012,
  },
  maxSpeed: 25,
  maxAltitude: 40,
  // Pulled back and tilted like a race build's cam — enough tilt that level
  // flight is fast flight.
  cameraMount: { position: [0, 0.022, 0.075], tiltDeg: 25 },
  model: racerModelUrl,
  // 0.127 m prop / 3.5955 authored units.
  // Drawn at 1.8x so the 311 mm frame reads at chase-camera distance in the
  // outdoor maps. Render-only, like the other two — see DroneSpec.sizeScale.
  sizeScale: 1.8,
  modelScale: 0.035322,
  modelYawDeg: 0,
  // X is already centred (the prop centroid sits 3 thousandths off). Z pulls the
  // prop centroid to the origin — the frame is not symmetric front-to-back, with
  // the front motors 2.215 out and the rear 3.182.
  //
  // Y sets the drone down on the floor, and unlike X and Z it is NOT a recentring
  // term, so it must be derived at the DRAWN scale (modelScale x sizeScale), not
  // at modelScale alone. DroneModel multiplies the whole offset by sizeScale, so a
  // Y computed at modelScale gets inflated along with it — which is what buried
  // the airframe: the ground sits a fixed 0.024 m under the body origin whatever
  // the drone is drawn at, and 1.8 x -0.0155 put the lowest geometry 19 mm below
  // it, cutting the floor line straight through the motor bells.
  //
  // The model's lowest point (the nose bar) is at -0.23931 authored units:
  //   (-0.024 - (-0.23931 * 0.035322 * 1.8)) / 1.8 = -0.0049
  // which lands that bar exactly on the collider's underside.
  modelOffset: [0, -0.0049, -0.0171],
  propArt: 'blur',
  // Highest rate bandwidth of the three airframes — this is the one that should
  // feel sharp. Still inside the range the PlutoX (20) already flies stably at.
  pidDefaults: {
    rate: {
      roll: { p: 18, i: 7, d: 0.35 },
      pitch: { p: 18, i: 7, d: 0.35 },
      yaw: { p: 12, i: 5, d: 0 },
    },
    angle: {
      roll: { p: 8, i: 0, d: 0 },
      pitch: { p: 8, i: 0, d: 0 },
    },
  },
};
