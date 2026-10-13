import type { DroneSpec } from '@shared/types';
// Vite emits the .glb as a file and hands back its URL (relative base, so it
// resolves under Electron's file:// protocol in the packaged app).
import guruModelUrl from '../../../assets/models/PlutoGuru.opt.glb?url';

// Pluto Guru — the 230 mm trainer, a bigger frame than the PlutoX nano and a
// noticeably calmer machine to fly.
//
// Dimensions are real (supplied with the CAD): 230 mm diagonal wheelbase
// motor-to-motor, 135 mm propellers. Everything the airframe does NOT dictate —
// mass, pack, thrust, gains — is game-sim tuned like the PlutoX rather than
// hardware-exact, and is the part to revisit once bench figures exist.
export const guruDrone: DroneSpec = {
  id: 'pluto-guru',
  name: 'Pluto Guru',
  frame: 'quad',
  // 130.1 g, the real Guru's weight. The airframe was tuned at 1.5 kg, so the
  // thrust and drag area below are scaled by the same 0.1301 / 1.5: hover
  // throttle, tilt-to-speed and wind response stay what was flown and tuned.
  mass: 0.1301,
  // Motor-to-CoG = half the 230 mm diagonal wheelbase. Confirmed against the
  // model: the four tagged props sit at +/-81.7 mm per axis, i.e. 115.5 mm out
  // on a clean 45-degree X.
  armLength: 0.115,
  motors: Array.from({ length: 4 }, () => ({
    kv: 2300,
    // 4 x 0.6384 N = 2.553 N against a 1.276 N weight -> thrust-to-weight ~2.0,
    // matching standard high-stability trainer flight characteristics.
    maxThrustN: 0.6384,
    responseTime: 0.05,
  })),
  propDiameterIn: 5.31, // 135 mm
  battery: {
    cells: 4,
    capacityMah: 2200,
    nominalV: 14.8,
    internalResistance: 0.025,
  },
  // Descriptive: nothing reads this yet. It is the figure the numbers below
  // actually produce, solved from tilt against damping and drag —
  // 9.81 * tan(32 deg) = 0.3 v + (0.5 * 1.225 * 0.002065 / 0.1301) v^2 -> 14 m/s.
  maxSpeed: 14,
  // The default armLength^2 * 1.8 = 0.0238 m^2, scaled with the mass (see
  // `mass`) so drag and wind accelerate this airframe exactly as they did.
  dragArea: 0.002065,
  /** Hard ceiling enforced by the flight controller (soft-limited from 2 m below). */
  maxAltitude: 30,
  /**
   * A trainer, but no longer a trainer pinned to the beginner envelope. At 22
   * degrees of tilt this airframe cruised at about 10 m/s and felt like
   * it was wading; 32 degrees is still a long way from a freestyle lean and
   * takes it to roughly 14. The climb comes up with it, so the same stick that
   * banks harder also gets it off the deck without waiting.
   *
   * Chosen by judgement, not measured against hardware — these want flying.
   */
  handling: {
    maxTiltDeg: 32,
    maxClimbRate: 2.6,
    maxYawRate: 3.0,
  },
  // ON the model's own camera lens. The 2026-10-13 export ("Guru Drone with
  // Camera (Primus X2 v1)") carries the Guru Cam Module under the nose; its
  // "Glass - Heavy Color" lens has its front face at (0.0132, -0.0194, 0.0466)
  // in the Y-up model, drawn (x2.5, with DroneModel's 2 cm paint clearance)
  // at (0.0020, 0.0618, -0.1319). (0.0008, 0.0247, -0.0532) x 2.5 sits 1 mm
  // ahead of it. From there the front props sit in the upper corners, which
  // is the sliver of blade a real feed shows. Checked by offscreen render of
  // the .glb, not flown.
  // 25 degrees of uptilt: faster than the Pluto, so it flies more nose-down.
  cameraMount: { position: [0.0008, 0.0247, -0.0532], tiltDeg: 25 },
  // Guru Kit CAD export with the camera module, optimized for realtime
  // (195 meshes, 276k tris — on a par with the PlutoX's).
  //
  // The export arrived Z-UP. "Pluto Guru.glb" is it with one parent node
  // rotated -90 degrees about X, so it is Y-up like the other airframes;
  // the geometry itself is untouched.
  //
  // The four props are tagged PROP_* by scripts/prepare-drone-model.mjs so the
  // runtime can pivot them independently — see that script for why they have to
  // be named explicitly for this model.
  model: guruModelUrl,
  // The export is ~9% under real scale: its props measure 121.9 mm against the
  // real 135 mm, and its wheelbase 210 mm against the real 230 mm. Those two
  // ratios agree to 1%, so a single uniform scale fixes both. (Re-measured on
  // the camera export: same props, same 210 mm, same scale.)
  // Drawn and collided at 2.5x so the trainer reads clearly at chase-camera distance.
  sizeScale: 2.5,
  modelScale: 1.1013,
  // The airframe is authored at an angle rather than axis-aligned; this brings
  // the front prop pair's bisector (the side the camera lens faces) onto -Z,
  // the sim's forward. Measured off the prop hubs: 15.08 degrees off +Z.
  modelYawDeg: 164.92,
  // X and Z recentre the prop centroid, authored (0.00145, -, 0.00015), on
  // the body origin.
  //
  // Y is MEASURED, not chosen: the lowest geometry (the landing legs) sits
  // at -0.0433 authored units, so
  //   (-0.024 - (-0.0433) * 1.1013 * 2.5) / 2.5 = 0.03809
  // puts the legs on the collider's underside (Drone.tsx uses a fixed
  // 0.024 m half-height). Too low and they sink through the deck, which is
  // what made the trainer look parked in the concrete rather than on it.
  modelOffset: [0.0015, 0.03809, 0.00057],
  // The CAD export ships three white props and one black, which reads as an
  // asymmetry rather than an orientation cue. Both pairs are set explicitly so
  // the result is a clean black nose / white tail whatever the .glb bakes in.
  propColors: { front: '#15181c', rear: '#eef2f7' },
  // Same inertia-normalized units as the PlutoX (rad/s^2 per rad/s of error),
  // but wound back: this airframe's slower motor response makes the PlutoX's
  // rate gains ring rather than track.
  pidDefaults: {
    rate: {
      roll: { p: 24, i: 8, d: 0.65 },
      pitch: { p: 24, i: 8, d: 0.65 },
      yaw: { p: 14, i: 5, d: 0 },
    },
    angle: {
      roll: { p: 10, i: 0, d: 0 },
      pitch: { p: 10, i: 0, d: 0 },
    },
  },
};
