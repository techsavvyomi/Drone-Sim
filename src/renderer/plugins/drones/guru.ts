import type { DroneSpec } from '@shared/types';
// Vite emits the .glb as a file and hands back its URL (relative base, so it
// resolves under Electron's file:// protocol in the packaged app).
import guruModelUrl from '../../../assets/models/PlutoGuru.opt.glb?url';

// Pluto Guru — the 230 mm trainer, roughly 8x the mass of the PlutoX nano and a
// noticeably calmer, heavier machine to fly.
//
// Dimensions are real (supplied with the CAD): 230 mm diagonal wheelbase
// motor-to-motor, 135 mm propellers. Everything the airframe does NOT dictate —
// mass, pack, thrust, gains — is game-sim tuned like the PlutoX rather than
// hardware-exact, and is the part to revisit once bench figures exist.
export const guruDrone: DroneSpec = {
  id: 'pluto-guru',
  name: 'Pluto Guru',
  frame: 'quad',
  // 1.5 kg realistic trainer quad. Solid momentum, smooth gliding, and authentic airframe inertia.
  mass: 1.5,
  // Motor-to-CoG = half the 230 mm diagonal wheelbase. Confirmed against the
  // model: the four tagged props sit at +/-81.7 mm per axis, i.e. 115.5 mm out
  // on a clean 45-degree X.
  armLength: 0.115,
  motors: Array.from({ length: 4 }, () => ({
    kv: 2300,
    // 4 x 7.36 N = 29.44 N against a 14.71 N weight -> thrust-to-weight ~2.0,
    // matching standard high-stability trainer flight characteristics.
    maxThrustN: 7.36,
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
  // 9.81 * tan(32 deg) = 0.3 v + (0.5 * 1.225 * 0.0238 / 1.5) v^2 -> 14 m/s.
  maxSpeed: 14,
  /** Hard ceiling enforced by the flight controller (soft-limited from 2 m below). */
  maxAltitude: 30,
  /**
   * A trainer, but no longer a trainer pinned to the beginner envelope. At 22
   * degrees of tilt this 1.5 kg airframe cruised at about 10 m/s and felt like
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
  // Nose camera, MEASURED off the drawn airframe rather than mirrored from the
  // PlutoX. Forward is -Z (the old +0.07 put it behind the CoG, i.e. inside the
  // fuselage once sizeScale inflated the model around it).
  //
  // In drawn metres, this airframe's fuselage nose is at z = -0.145, its front
  // props sweep z = -0.348..-0.062 at y = 0.108..0.145, and their inner edge
  // comes in to x = 0.063. So (0, 0.09, -0.17) x 2.5 sits just ahead of the
  // nose and just under the prop plane: the world is clear ahead and each front
  // prop clips the frame edge at about 38 degrees off-axis, which is the sliver
  // of blade a real FPV feed shows.
  cameraMount: { position: [0, 0.036, -0.068], tiltDeg: 15 },
  // Guru Kit CAD export, optimized for realtime (222 draw calls, 275k tris —
  // on a par with the PlutoX's 219 / 277k).
  // The four props are tagged PROP_* by scripts/prepare-drone-model.mjs so the
  // runtime can pivot them independently — see that script for why they have to
  // be named explicitly for this model.
  model: guruModelUrl,
  // The export is ~9% under real scale: its props measure 121.9 mm against the
  // real 135 mm, and its wheelbase 210 mm against the real 230 mm. Those two
  // ratios agree to 1%, so a single uniform scale fixes both.
  // Drawn and collided at 2.5x so the trainer reads clearly at chase-camera distance.
  sizeScale: 2.5,
  modelScale: 1.1013,
  // The airframe is authored at an angle rather than axis-aligned; this brings
  // the front prop pair's bisector onto -Z, the sim's forward.
  modelYawDeg: 165.08,
  // The export is not origin-centred — it sits ~126 mm off in X. This recentres
  // it on the prop centroid and drops the visual so its lowest point rests on
  // the collider floor (Drone.tsx uses a fixed 0.024 m half-height).
  //
  // Y is MEASURED, not chosen, and the old -0.0398 was 36 mm too low: the
  // export's lowest geometry sits at +0.01436 authored units (the model is
  // entirely ABOVE its own origin), so
  //   (-0.024 - 0.01436 * 1.1013 * 2.5) / 2.5 = -0.02541
  // puts the landing legs on the collider's underside. At -0.0398 they sank
  // through the deck in every arena, which is what made the trainer look like
  // it was parked in the concrete rather than on it.
  modelOffset: [-0.1263, -0.02541, -0.0454],
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
