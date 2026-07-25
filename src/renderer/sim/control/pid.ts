import { clamp } from '../mathx';
import type { Pid } from '@shared/types';

export interface PidLimits {
  /** Hard integrator clamp (absolute, on the raw integral). */
  iLimit?: number;
  /** Clamp on the I-term's contribution to the output (absolute). */
  iTermLimit?: number;
  /** Clamp on the D-term's contribution to the output (absolute). */
  dTermLimit?: number;
  /** Output clamp (absolute). */
  outLimit?: number;
  /** First-order low-pass cutoff for the D term, Hz. 0 disables. */
  dCutHz?: number;
}

/** First-order (Pt1) low-pass, matching Magis' filterApplyPt1. */
function pt1(input: number, state: number, cutHz: number, dt: number): number {
  const rc = 1 / (2 * Math.PI * cutHz);
  return state + (dt / (rc + dt)) * (input - state);
}

// Reusable single-axis PID, structured to mirror the Magis V2 firmware's
// pidLuxFloat controller (Cleanflight lineage) that runs on the real Pluto:
//
//   RateError = AngleRate - gyroRate
//   PTerm     = RateError * P
//   ITerm     = constrain(ITerm + RateError * dt * I, -limit, +limit)
//   DTerm     = constrain(lowpass(avg(delta)) * D, -limit, +limit)
//   out       = constrain(PTerm + ITerm + DTerm, -outLimit, +outLimit)
//
// Magis bounds the I contribution to 25% and the D contribution to 30% of the
// total output range; those same proportions are applied here. Bounding the
// terms (rather than only the sum) is what stops the integral charging up
// during saturation and unwinding slowly as overshoot.
export class PidController {
  private integral = 0;
  private prevError = 0;
  private primed = false;
  /** Last two derivative samples, for the 3-point moving average. */
  private d1 = 0;
  private d2 = 0;
  private dState = 0;

  constructor(
    private gains: Pid,
    private limits: PidLimits = {},
  ) {}

  setGains(gains: Pid): void {
    this.gains = gains;
  }

  reset(): void {
    this.integral = 0;
    this.prevError = 0;
    this.primed = false;
    this.d1 = 0;
    this.d2 = 0;
    this.dState = 0;
  }

  /** Zero only the integral (used when disarmed / at idle throttle). */
  resetIntegral(): void {
    this.integral = 0;
  }

  update(error: number, dt: number, measurementRate?: number): number {
    const { p, i, d } = this.gains;

    // ---- Derivative: 3-sample moving average, then optional Pt1 low-pass ----
    let raw = 0;
    if (measurementRate !== undefined) {
      raw = -measurementRate; // derivative-on-measurement: no setpoint kick
    } else if (this.primed) {
      raw = (error - this.prevError) / dt;
    }
    this.prevError = error;
    this.primed = true;

    let deltaSum = (raw + this.d1 + this.d2) / 3;
    this.d2 = this.d1;
    this.d1 = raw;

    if (this.limits.dCutHz && this.limits.dCutHz > 0) {
      this.dState = pt1(deltaSum, this.dState, this.limits.dCutHz, dt);
      deltaSum = this.dState;
    }

    let dTerm = d * deltaSum;
    if (this.limits.dTermLimit !== undefined) {
      dTerm = clamp(dTerm, -this.limits.dTermLimit, this.limits.dTermLimit);
    }

    const pTerm = p * error;

    // ---- Integral with conditional integration (anti-windup) ----
    let integral = this.integral + error * dt;
    if (this.limits.iLimit !== undefined) {
      integral = clamp(integral, -this.limits.iLimit, this.limits.iLimit);
    }
    let iTerm = i * integral;
    if (this.limits.iTermLimit !== undefined) {
      const capped = clamp(iTerm, -this.limits.iTermLimit, this.limits.iTermLimit);
      if (capped !== iTerm && i !== 0) {
        integral = capped / i; // keep the stored integral consistent with the cap
        iTerm = capped;
      }
    }

    let out = pTerm + iTerm + dTerm;
    const oLim = this.limits.outLimit;

    if (oLim !== undefined && Math.abs(out) > oLim) {
      // Saturated: hold the integral unless the new value eases the saturation.
      if (Math.sign(error) === Math.sign(out)) {
        integral = this.integral;
        out = pTerm + i * integral + dTerm;
      }
      out = clamp(out, -oLim, oLim);
    }

    this.integral = integral;
    return out;
  }
}
