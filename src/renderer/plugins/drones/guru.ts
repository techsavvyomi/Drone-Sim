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
  maxSpeed: 18,
  /** Hard ceiling enforced by the flight controller (soft-limited from 2 m below). */
  maxAltitude: 30,
  // Mirrors the PlutoX mount, scaled by the ratio of the two arm lengths so FPV
  // frames the airframe the same way on both.
  cameraMount: { position: [0, 0.015, 0.07], tiltDeg: 15 },
  // Guru Kit CAD export, optimized for realtime (222 draw calls, 275k tris —
  // on a par with the PlutoX's 219 / 277k).
  // The four props are tagged PROP_* by scripts/prepare-drone-model.mjs so the
  // runtime can pivot them independently — see that script for why they have to
  // be named explicitly for this model.
  model: guruModelUrl,
  // The export is ~9% under real scale: its props measure 121.9 mm against the
  // real 135 mm, and its wheelbase 210 mm against the real 230 mm. Those two
  // ratios agree to 1%, so a single uniform scale fixes both.
  modelScale: 1.1013,
  // The airframe is authored at an angle rather than axis-aligned; this brings
  // the front prop pair's bisector onto -Z, the sim's forward.
  modelYawDeg: 165.08,
  // The export is not origin-centred — it sits ~126 mm off in X. This recentres
  // it on the prop centroid and drops the visual so its lowest point rests on
  // the collider floor (Drone.tsx uses a fixed 0.024 m half-height).
  modelOffset: [-0.1263, -0.0398, -0.0454],
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
