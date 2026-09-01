import type { DroneSpec } from '../../src/shared/types';

/**
 * A stand-in for the Guru, built here rather than imported from
 * `plugins/drones/guru.ts` — that module imports its `.glb` through Vite's
 * `?url`, which is a renderer concern and nothing the flight controller needs.
 *
 * The numbers that matter to the controller are real Guru figures: 1.5 kg on
 * four 7.36 N motors, i.e. a hover at exactly half throttle.
 */
export function testSpec(over: Partial<DroneSpec> = {}): DroneSpec {
  const motor = { kv: 920, maxThrustN: 7.36, responseTime: 0.05 };
  return {
    id: 'test-quad',
    name: 'Test Quad',
    frame: 'quad',
    mass: 1.5,
    armLength: 0.1155,
    motors: [motor, motor, motor, motor],
    propDiameterIn: 5.3,
    battery: { cells: 3, capacityMah: 2200, nominalV: 11.1, internalResistance: 0.03 },
    maxSpeed: 20,
    maxAltitude: 120,
    cameraMount: { position: [0, 0.02, -0.05], tiltDeg: 15 },
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
    ...over,
  };
}
