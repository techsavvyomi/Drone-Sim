import { TelemetryBuffer } from '../sim/telemetryBuffer';
import { useSimStore } from './simStore';
import { RAD2DEG } from '../sim/mathx';

// Ring buffers for the live traces. Fed by a plain zustand subscription (not a
// React hook) so streaming telemetry never triggers a render.

export const gyroBuffer = new TelemetryBuffer([
  { key: 'x', label: 'roll', color: '#4ea1ff' },
  { key: 'y', label: 'pitch', color: '#37e08a' },
  { key: 'z', label: 'yaw', color: '#ffcf4d' },
]);

export const attitudeBuffer = new TelemetryBuffer([
  { key: 'roll', label: 'roll°', color: '#4ea1ff' },
  { key: 'pitch', label: 'pitch°', color: '#37e08a' },
]);

export const motorBuffer = new TelemetryBuffer([
  { key: 'fr', label: 'FR', color: '#4ea1ff' },
  { key: 'fl', label: 'FL', color: '#37e08a' },
  { key: 'br', label: 'BR', color: '#ffcf4d' },
  { key: 'bl', label: 'BL', color: '#ff8a3d' },
]);

export const powerBuffer = new TelemetryBuffer([
  { key: 'v', label: 'V', color: '#4ea1ff' },
  { key: 'a', label: 'A', color: '#ff5c5c' },
]);

let samples = 0;

export function clearTelemetryBuffers(): void {
  samples = 0;
  gyroBuffer.clear();
  attitudeBuffer.clear();
  motorBuffer.clear();
  powerBuffer.clear();
}

/** Start feeding the buffers. Returns an unsubscribe function. */
export function startTelemetryFeed(): () => void {
  return useSimStore.subscribe((s, prev) => {
    // setTelemetry allocates a fresh position array each frame; an unchanged
    // reference means this update was something else (fps/clock), so skip it.
    if (s.position === prev.position) return;

    const t = samples++;
    gyroBuffer.push(t, { x: s.gyro[2], y: s.gyro[0], z: s.gyro[1] });
    attitudeBuffer.push(t, { roll: s.roll * RAD2DEG, pitch: s.pitch * RAD2DEG });
    motorBuffer.push(t, {
      fr: s.motors[0],
      fl: s.motors[1],
      br: s.motors[2],
      bl: s.motors[3],
    });
    powerBuffer.push(t, { v: s.batteryVoltage, a: s.batteryCurrent });
  });
}
