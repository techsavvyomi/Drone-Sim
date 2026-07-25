import type { BatterySpec } from '@shared/types';
import { clamp } from '../mathx';

// 1S LiPo model.
//
// Voltage is NOT a linear function of charge — a real LiPo sits near 3.7-3.85 V
// for most of the flight and then falls off a cliff. That shape is what makes
// the battery readout meaningful, so the curve below is interpolated directly
// from the specified points rather than lerping voltage against percentage.
//
// Loaded voltage additionally sags by I·R and recovers when throttle is
// released, which is what gives the "punch the throttle and watch it dip"
// behaviour of a real pack.

/** [state of charge, open-circuit volts per cell] — highest charge first. */
const CURVE: [number, number][] = [
  [1.0, 4.2],
  [0.8, 4.0],
  [0.6, 3.85],
  [0.4, 3.7],
  [0.2, 3.5],
  [0.05, 3.3],
  [0.0, 3.2],
];

export const BATTERY_WARNING_V = 3.5;
export const BATTERY_CRITICAL_V = 3.3;
export const BATTERY_CUTOFF_V = 3.2;

/** Drain multipliers relative to hover, per the flight-condition table. */
const IDLE_MULTIPLIER = 0.3;
const HOVER_MULTIPLIER = 1.0;
const MAX_MULTIPLIER = 1.7;

/**
 * Volts of extra sag per unit of drain multiplier above hover.
 * The voltage curve describes the reading during NORMAL flight, so sag is
 * measured relative to a hover rather than to an unloaded pack: at hover the
 * displayed voltage matches the curve, a full-throttle punch (1.7x) pulls it
 * down ~0.13 V, and releasing lets it recover — e.g. 3.85 V -> 3.72 V -> 3.85 V.
 */
const SAG_PER_MULTIPLIER = 0.186;

/** Open-circuit volts per cell at a given state of charge. */
function curveVoltage(soc: number): number {
  const s = clamp(soc, 0, 1);
  for (let i = 0; i < CURVE.length - 1; i++) {
    const [sHi, vHi] = CURVE[i];
    const [sLo, vLo] = CURVE[i + 1];
    if (s <= sHi && s >= sLo) {
      const t = sHi === sLo ? 0 : (s - sLo) / (sHi - sLo);
      return vLo + (vHi - vLo) * t;
    }
  }
  return CURVE[CURVE.length - 1][1];
}

/** State of charge implied by an open-circuit voltage (inverse of the curve). */
export function socForVoltage(volts: number, cells = 1): number {
  const v = volts / cells;
  for (let i = 0; i < CURVE.length - 1; i++) {
    const [sHi, vHi] = CURVE[i];
    const [sLo, vLo] = CURVE[i + 1];
    if (v <= vHi && v >= vLo) {
      const t = vHi === vLo ? 0 : (v - vLo) / (vHi - vLo);
      return sLo + (sHi - sLo) * t;
    }
  }
  return v > CURVE[0][1] ? 1 : 0;
}

export interface BatteryState {
  soc: number;
  /** Terminal voltage under the present load (V). */
  voltage: number;
  /** Reference voltage from the discharge curve (the hover reading). */
  restingVoltage: number;
  current: number;
  drawnMah: number;
  /** Thrust multiplier from the sagging pack. */
  thrustScale: number;
}

export class Battery {
  private capacityMah: number;
  private cells: number;
  private consumedMah = 0;
  /** Current drawn while hovering (A) — sized to hit the target flight time. */
  private hoverCurrent: number;

  constructor(spec: BatterySpec, targetHoverMinutes = 7.5) {
    this.capacityMah = Math.max(spec.capacityMah, 1);
    this.cells = Math.max(spec.cells, 1);
    // Draw the usable 95% of the pack over the target hover time.
    this.hoverCurrent = (this.capacityMah / 1000) * 0.95 / (targetHoverMinutes / 60);
  }

  reset(): void {
    this.consumedMah = 0;
  }

  get fullVoltage(): number {
    return this.cells * 4.2;
  }

  /**
   * Advance the pack.
   * @param throttleFraction commanded thrust as a fraction of maximum (0..1)
   * @param hoverFraction the fraction that corresponds to a hover
   */
  update(throttleFraction: number, hoverFraction: number, dt: number): BatteryState {
    const soc = clamp(1 - this.consumedMah / this.capacityMah, 0, 1);
    const restingVoltage = this.cells * curveVoltage(soc);

    // Drain scales with how hard the motors are working relative to a hover:
    // idle 0.3x, hover 1.0x, full throttle ~1.7x.
    const ratio = hoverFraction > 1e-3 ? throttleFraction / hoverFraction : 0;
    const multiplier = clamp(
      IDLE_MULTIPLIER + (HOVER_MULTIPLIER - IDLE_MULTIPLIER) * ratio,
      IDLE_MULTIPLIER,
      MAX_MULTIPLIER,
    );

    const current = this.hoverCurrent * multiplier;
    // Sag relative to hover: zero at hover, ~0.13 V at full throttle, and a
    // small rise at idle when the pack is barely loaded.
    const sag = (multiplier - HOVER_MULTIPLIER) * SAG_PER_MULTIPLIER * this.cells;
    const voltage = Math.max(restingVoltage - sag, this.cells * 2.9);

    this.consumedMah += (current * 1000 * dt) / 3600;

    // Thrust falls with voltage (thrust ~ RPM^2 ~ V^2), floored so the drone
    // stays controllable long enough to complete the auto-landing.
    const vRatio = clamp(voltage / this.fullVoltage, 0, 1);
    const thrustScale = clamp(vRatio * vRatio, 0.55, 1);

    return { soc, voltage, restingVoltage, current, drawnMah: this.consumedMah, thrustScale };
  }
}
