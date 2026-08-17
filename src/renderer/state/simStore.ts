import { create } from 'zustand';
import type { SupportInfo, Vec3 } from '@shared/types';

// Hot simulation + telemetry state. Written by the drone entity each frame and
// read by the HUD/telemetry panel. Values are flat primitives where possible so
// widgets can subscribe to just the field they display.

export interface TelemetrySample {
  position: Vec3;
  altitude: number;
  roll: number; // rad
  pitch: number; // rad
  yaw: number; // rad
  groundSpeed: number; // m/s (horizontal)
  verticalSpeed: number; // m/s
  throttle: number; // 0..1
  motors: [number, number, number, number]; // 0..1
  /** Live stick positions for the on-screen gimbals. */
  sticks: { roll: number; pitch: number; yaw: number; throttle: number };
  // --- Phase 2 ---
  batteryVoltage: number; // V
  batteryCurrent: number; // A
  batterySoc: number; // 0..1
  flightTime: number; // s, accumulated while armed
  /** Motors clipped — attitude authority degraded. */
  saturated: boolean;
  /** Body-frame angular rates (rad/s) for the gyro trace. */
  gyro: Vec3;
  /** Body-frame specific force (g) for the accelerometer trace. */
  accel: Vec3;
  /** Live 4-corner physical support & stability state */
  support: SupportInfo;
}

interface SimState extends TelemetrySample {
  running: boolean;
  tick: number;
  simTime: number;
  fps: number;
  resetToken: number;

  setTelemetry: (sample: TelemetrySample) => void;
  setClock: (tick: number, simTime: number) => void;
  setFps: (fps: number) => void;
  requestReset: () => void;
  reset: () => void;
}

const initialTelemetry: TelemetrySample = {
  position: [0, 0, 0],
  altitude: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  groundSpeed: 0,
  verticalSpeed: 0,
  throttle: 0,
  motors: [0, 0, 0, 0],
  sticks: { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
  batteryVoltage: 0,
  batteryCurrent: 0,
  batterySoc: 1,
  flightTime: 0,
  saturated: false,
  gyro: [0, 0, 0],
  accel: [0, 1, 0],
  support: {
    supported: [false, false, false, false],
    supportedCount: 0,
    isStable: false,
    contactState: 'AIRBORNE',
    distances: [1, 1, 1, 1],
  },
};

export const useSimStore = create<SimState>((set) => ({
  ...initialTelemetry,
  running: true,
  tick: 0,
  simTime: 0,
  fps: 0,
  resetToken: 0,

  setTelemetry: (sample) => set(sample),
  setClock: (tick, simTime) => set({ tick, simTime }),
  setFps: (fps) => set({ fps }),
  requestReset: () => set((s) => ({ resetToken: s.resetToken + 1, tick: 0, simTime: 0 })),
  reset: () => set({ ...initialTelemetry, tick: 0, simTime: 0 }),
}));
