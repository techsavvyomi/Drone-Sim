import type { InputMode } from '@shared/backend/contract';

// Continuous measurements for one session, accumulated from periodic samples.
//
// Kept free of stores and timers so the arithmetic can be tested on its own:
// the telemetry controller reads the live state a few times a second and hands
// it here.

export interface FlightSample {
  armed: boolean;
  onGround: boolean;
  paused: boolean;
  /** A lesson's demonstration is flying the aircraft, not the pilot. */
  scripted: boolean;
  position: readonly [number, number, number];
  altitude: number;
  /** Battery state of charge, 0..1. */
  batterySoc: number;
  /** flightStore's lifetime contact counter. */
  touches: number;
  input: InputMode;
}

/** A position jump bigger than this between samples is a reset, not flight. */
const TELEPORT_M = 25;
/** A charge jump bigger than this is a recharge or a reset, not use. */
const MAX_SOC_STEP = 0.2;
/** Samples further apart than this (a stalled page) count for no more. */
const MAX_DT = 1;

export class FlightMetrics {
  /** Session time, excluding pauses. */
  activeSec = 0;
  /** Airborne, armed and under the pilot's own control. */
  flightSec = 0;
  distanceM = 0;
  maxAltitudeM = 0;
  /** Fraction of a pack used, summed across recharges. */
  batteryUsed = 0;
  collisions = 0;
  private inputSec: Partial<Record<InputMode, number>> = {};
  private prev: FlightSample | null = null;

  sample(s: FlightSample, dtSec: number): void {
    const dt = Math.max(0, Math.min(MAX_DT, dtSec));
    const prev = this.prev;
    this.prev = { ...s, position: [s.position[0], s.position[1], s.position[2]] };
    if (!prev) return;
    if (s.paused) return;

    this.activeSec += dt;
    const piloted = s.armed && !s.scripted;
    const airborne = piloted && !s.onGround;
    if (airborne) {
      this.flightSec += dt;
      this.maxAltitudeM = Math.max(this.maxAltitudeM, s.altitude);
      if (!prev.onGround && prev.armed) {
        const dx = s.position[0] - prev.position[0];
        const dy = s.position[1] - prev.position[1];
        const dz = s.position[2] - prev.position[2];
        const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (step < TELEPORT_M) this.distanceM += step;
      }
    }
    if (piloted) this.inputSec[s.input] = (this.inputSec[s.input] ?? 0) + dt;

    const drop = prev.batterySoc - s.batterySoc;
    if (drop > 0 && drop < MAX_SOC_STEP) this.batteryUsed += drop;

    const touched = s.touches - prev.touches;
    if (touched > 0) this.collisions += touched;
  }

  /** The input the pilot flew with longest; the latest one if they never flew. */
  dominantInput(): InputMode {
    let best: InputMode | null = null;
    for (const [mode, sec] of Object.entries(this.inputSec) as [InputMode, number][]) {
      if (best === null || sec > (this.inputSec[best] ?? 0)) best = mode;
    }
    return best ?? this.prev?.input ?? 'KEYBOARD';
  }
}
