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
  mass: 0.05, // 50 g
  // 160 mm wheelbase measured motor-to-motor diagonally => 80 mm from CoG,
  // i.e. motors at ±56.6 mm per axis. With ~72 mm props this yields the
  // 186 mm overall span measured from the PlutoX CAD model.
  armLength: 0.08,
  motors: Array.from({ length: 4 }, () => ({
    kv: 20000,
    // 4 x 0.25 N = 1.0 N against a 0.49 N weight -> thrust-to-weight ~2.0,
    // which is typical for a trainer nano quad and puts hover at ~50% stick.
    // (At 2.8 TWR hover sat near 35% and everything above it was far too punchy.)
    maxThrustN: 0.25,
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
  maxSpeed: 8,
  /** Hard ceiling enforced by the flight controller (soft-limited from 2 m below). */
  maxAltitude: 20,
  // Nose camera, measured off the drawn airframe. Forward is -Z; the old +0.05
  // pointed the mount backwards, and unscaled it sat inside the model.
  // Drawn, the frame's nose is at z = -0.084, the prop plane at y = 0.029 and
  // the front ducts run out from x = 0.055 — so (0, 0.026, -0.09) x 1.5 threads
  // between the ducts at prop height with nothing but sky ahead.
  cameraMount: { position: [0, 0.0173, -0.06], tiltDeg: 15 },
  // Real PlutoX CAD model, optimized for realtime (20 draw calls, 253k tris).
  // Authored in metres and origin-centred, so no scaling is needed.
  model: plutoModelUrl,
  // A 160 mm airframe is a speck in the outdoor maps; drawn and collided at 1.5x so it stays readable.
  sizeScale: 1.5,
  modelScale: 1,
  // The CAD model is authored facing +Z; the sim's convention is forward = -Z,
  // so the visual needs a half turn to match the physics heading.
  modelYawDeg: 180,
  // Same rule as the other two: the lowest drawn geometry lands on the collider
  // floor at -0.024 m. The model's own minimum is -0.03467, drawn at 1.5x, so
  //   (-0.024 - (-0.03467 * 1.5)) / 1.5 = 0.01867
  // The old flat 0.01 buried the prop guards 13 mm into the ground.
  modelOffset: [0, 0.01867, 0],
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
