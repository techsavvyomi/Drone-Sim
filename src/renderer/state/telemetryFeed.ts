import { TelemetryBuffer } from '../sim/telemetryBuffer';
import { useSimStore } from './simStore';
import { RAD2DEG } from '../sim/mathx';

// Ring buffers for the telemetry dock's GRAPHS tab. Fed by a plain zustand
// subscription (not a React hook) so streaming telemetry never triggers a
// render. Time is wall-clock seconds, so a chart can show exactly "the last 6 s"
// whatever the frame rate. Line colours are the chart's (the `plot` token).

export const gyroBuffer = new TelemetryBuffer([
  { key: 'x', label: 'roll rate °/s' },
  { key: 'y', label: 'pitch rate °/s' },
  { key: 'z', label: 'yaw rate °/s' },
]);

export const attitudeBuffer = new TelemetryBuffer([
  { key: 'roll', label: 'roll°' },
  { key: 'pitch', label: 'pitch°' },
]);

export const motorBuffer = new TelemetryBuffer([
  { key: 'fr', label: 'FR' },
  { key: 'fl', label: 'FL' },
  { key: 'br', label: 'BR' },
  { key: 'bl', label: 'BL' },
  { key: 'mean', label: 'mean' },
]);

export const powerBuffer = new TelemetryBuffer([
  { key: 'v', label: 'V' },
  { key: 'a', label: 'A' },
]);

/** Start feeding the buffers. Returns an unsubscribe function. */
export function startTelemetryFeed(): () => void {
  return useSimStore.subscribe((s, prev) => {
    // setTelemetry allocates a fresh position array each frame; an unchanged
    // reference means this update was something else (fps/clock), so skip it.
    if (s.position === prev.position) return;

    const t = performance.now() / 1000;
    // Body frame is y-up: gyro[1] is the yaw rate, gyro[2] roll, gyro[0] pitch.
    gyroBuffer.push(t, {
      x: s.gyro[2] * RAD2DEG,
      y: s.gyro[0] * RAD2DEG,
      z: s.gyro[1] * RAD2DEG,
    });
    attitudeBuffer.push(t, { roll: s.roll * RAD2DEG, pitch: s.pitch * RAD2DEG });
    const [fr, fl, br, bl] = s.motors;
    motorBuffer.push(t, { fr, fl, br, bl, mean: (fr + fl + br + bl) / 4 });
    powerBuffer.push(t, { v: s.batteryVoltage, a: s.batteryCurrent });
  });
}
