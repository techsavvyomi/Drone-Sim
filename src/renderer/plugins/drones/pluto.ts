import type { DroneSpec } from '@shared/types';
// Vite emits the .glb as a file and hands back its URL (relative base, so it
// resolves under Electron's file:// protocol in the packaged app).
import plutoModelUrl from '../../../assets/models/PlutoX.opt.glb?url';

// Pluto-class nano quad. Values are game-sim tuned (not hardware-exact) and will
// be refined during the Phase 1 flight-feel pass. Full model roster (TinyWhoop,
// 250 racer, 450 quad, hex) arrives in Phase 3.
export const plutoDrone: DroneSpec = {
  id: 'pluto',
  name: 'Pluto',
  frame: 'quad',
  mass: 0.054, // 54 g, the PlutoX's published weight (dronaaviation.com)
  // 160 mm wheelbase measured motor-to-motor diagonally => 80 mm from CoG,
  // i.e. motors at ±56.6 mm per axis. With ~72 mm props this yields the
  // 186 mm overall span measured from the PlutoX CAD model.
  armLength: 0.08,
  motors: Array.from({ length: 4 }, () => ({
    kv: 20000,
    // 4 x 0.27 N = 1.08 N against a 0.53 N weight -> thrust-to-weight ~2.0,
    // which is typical for a trainer nano quad and puts hover at ~50% stick.
    // (At 2.8 TWR hover sat near 35% and everything above it was far too punchy.)
    maxThrustN: 0.27,
    responseTime: 0.03,
  })),
  propDiameterIn: 2.17, // 55 mm — measured from the airframe
  battery: {
    cells: 1,
    capacityMah: 300,
    nominalV: 3.7,
    // Sized so a full-throttle punch sags roughly 0.13 V and recovers on
    // release, matching the specified 3.85 V hover -> 3.72 V full-throttle.
    internalResistance: 0.035,
  },
  // The default armLength^2 * 1.8 = 0.01152 m^2 was tuned at 50 g; scaled to
  // 54 g with the thrust so drag and wind act on it as they did.
  dragArea: 0.01244,
  maxSpeed: 8,
  /** Hard ceiling enforced by the flight controller (soft-limited from 2 m below). */
  maxAltitude: 20,
  // ON the model's own camera. The 2026-10-13 export ("Pluto X with Camera
  // (Primus X2 v1)") carries the Pluto Cam Module under the frame, and its
  // lens glass ("Glass - Window") is at authored x = -0.0023..0.0051,
  // y = -0.0155..-0.0075, front face z = +0.0268. Through the yaw, offset and
  // sizeScale below that face is drawn at (-0.0012, 0.0167, -0.0618), i.e.
  // (-0.0008, 0.0111, -0.0412) x 1.5; the mount sits 1 mm ahead of it.
  // From there the front props and their arms frame the upper corners and the
  // centre stays clear. Checked by offscreen render of the .glb, not flown.
  // 20 degrees of uptilt: a slow trainer flies nearly level, so the horizon
  // sits in the lower half of the 110-degree FPV frame in a hover.
  cameraMount: { position: [-0.0008, 0.0111, -0.0418], tiltDeg: 20 },
  // PlutoX CAD with the camera module, optimized for realtime by
  // scripts/prepare-drone-model.mjs (220 meshes, 285k tris; 3,677 raw).
  // Authored in metres, so no scaling is needed: its props measure 39.6 mm,
  // the same as the previous export's.
  model: plutoModelUrl,
  // A 160 mm airframe is a speck in the outdoor maps; drawn and collided at 1.5x so it stays readable.
  sizeScale: 1.5,
  modelScale: 1,
  // The CAD model is authored facing +Z (the camera lens is at its +Z end);
  // the sim's convention is forward = -Z, so the visual needs a half turn to
  // match the physics heading.
  modelYawDeg: 180,
  // This export is NOT origin-centred: its prop centroid sits at authored
  // (0.000575, -, -0.01441). X and Z move that centroid onto the body origin
  // (after the half turn, the authored offset is the centroid itself).
  //
  // Y is the usual rule: the lowest drawn geometry lands on the collider floor
  // at -0.024 m. The model's own minimum is -0.0253, drawn at 1.5x, so
  //   (-0.024 - (-0.0253 * 1.5)) / 1.5 = 0.0093
  modelOffset: [0.000575, 0.0093, -0.01441],
  // Rate-loop gains output angular acceleration (rad/s^2) per rad/s of error
  // (see FlightController's inertia-normalized torque). p ~ loop bandwidth.
  pidDefaults: {
    rate: {
      roll: { p: 20, i: 8, d: 0.3 },
      pitch: { p: 20, i: 8, d: 0.3 },
      yaw: { p: 12, i: 5, d: 0 },
    },
    angle: {
      roll: { p: 9, i: 0, d: 0 },
      pitch: { p: 9, i: 0, d: 0 },
    },
  },
};
