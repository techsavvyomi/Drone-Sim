import type { DroneSpec } from '@shared/types';
import { clamp } from '../sim/mathx';
import { audioContext, masterBus, noiseBuffer } from './engine';

// Synthesised quadcopter engine.
//
// Nothing is sampled — the whole sound is built from the drone's own spec and
// the mixer's live per-motor output, so a 50 g whoop and a 5" quad sound
// different for the same reason they do in the air: their rotors turn at very
// different speeds.
//
// The three layers, in order of how much they carry the sound:
//
//   1. Four independent rotor voices. Each is one oscillator on a custom
//      periodic wave whose harmonic peaks land on the blade-pass frequency.
//   2. Broadband downwash, tracking mean rotor speed and thickening near the
//      ground.
//   3. Airframe rush, tracking airspeed — a near-field sound, mostly for FPV.
//
// Layer 1 is what makes it read as a QUAD rather than a siren: the four voices
// are never quite in tune, so they beat against each other, and any stick input
// splits them further apart because the mixer is already driving them apart.

/** Speed of sound, m/s. Doppler is computed against this. */
const SOUND_SPEED = 343;

/**
 * Fraction of the unloaded `kv x volts` figure a loaded propeller actually
 * turns. A motor only reaches its kv rating spinning free; bolt a prop on and
 * aerodynamic drag holds it back by roughly a third under full power.
 */
const PROP_LOAD = 0.72;

/** ESC idle floor as a fraction of max RPM — armed rotors never fully stop. */
const IDLE_RPM_FRACTION = 0.1;

/**
 * Spool time constants, seconds. Deliberately asymmetric: a rotor is driven up
 * to speed but only coasts down, so the run-down is the slower half and that
 * asymmetry is very audible on a hard throttle chop.
 */
const SPOOL_UP = 0.09;
const SPOOL_DOWN = 0.3;

/**
 * Per-motor RPM scatter. No two motors, ESCs or props are identical, so four
 * rotors commanded to the same thrust still sit a fraction of a percent apart.
 * That mistuning is what makes a hovering quad warble instead of drone flatly —
 * at ~600 Hz these offsets beat at a few Hz, which is the sound you know.
 */
const MOTOR_TRIM = [1, 0.9925, 1.0068, 0.9971] as const;

/** Level of one rotor voice at full RPM. Four of these sum. */
const VOICE_GAIN = 0.13;
const WASH_GAIN = 0.5;
const RUSH_GAIN = 0.45;

/** Height below which downwash starts breaking against the surface, metres. */
const GROUND_WASH_ALT = 0.9;

/**
 * Distance at which the engine has dropped to half level, metres. Tuned to
 * chase-camera range rather than realism — see the rolloff in `update`.
 */
const REF_DISTANCE = 3.2;

export interface MotorAudioConfig {
  /** Shaft speed at full throttle, under load (RPM). */
  maxRpm: number;
  /** Blades per propeller — sets which harmonic carries the blade-pass tone. */
  blades: number;
}

export interface MotorAudioFrame {
  /** Per-motor normalised thrust, 0..1, in the mixer's FR/FL/BR/BL order. */
  motors: readonly number[];
  armed: boolean;
  /** Airspeed, m/s. */
  speed: number;
  /** Height above the ground, m. */
  altitude: number;
  /** Listener-to-drone distance, m. Zero for an onboard (FPV) listener. */
  distance: number;
  /** Stereo placement, -1 hard left to +1 hard right. */
  pan: number;
  /** Frequency multiplier from relative motion (1 = no shift). */
  doppler: number;
  /** Engine level, 0..1, ahead of the master bus. */
  level: number;
}

/**
 * Rotor spectrum as harmonics of SHAFT rate, not of blade-pass rate.
 *
 * Running the oscillator at shaft rate rather than blade-pass costs nothing and
 * buys the once-per-revolution content that comes from a prop never being
 * perfectly balanced. It is quiet, but it is the difference between a rotor and
 * a tone generator — and it is why a damaged prop sounds wrong to a pilot
 * before anything else does.
 */
function bladeWave(c: AudioContext, blades: number): PeriodicWave {
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    imag[h] =
      h % blades === 0
        ? // Blade-pass and its overtones: the tone you actually hear.
          Math.pow(h / blades, -1.45)
        : // Shaft-order imbalance, well down on the fundamental.
          0.09 / h;
  }
  return c.createPeriodicWave(real, imag);
}

/** Derive the engine's tuning from the airframe's own spec. */
export function motorAudioConfig(spec: DroneSpec): MotorAudioConfig {
  const packVolts = spec.battery.cells * spec.battery.nominalV;
  return {
    maxRpm: spec.motors[0].kv * packVolts * PROP_LOAD,
    blades: spec.propBlades ?? 2,
  };
}

/** Doppler factor for a listener and source closing at `radialSpeed` m/s. */
export function dopplerFactor(radialSpeed: number): number {
  // Positive radial speed = receding = lower pitch. Clamped because a bad frame
  // delta can briefly produce a nonsense velocity, and a pitch spike is far more
  // noticeable than the missing shift would have been.
  return clamp(SOUND_SPEED / (SOUND_SPEED + radialSpeed), 0.86, 1.18);
}

export class MotorAudio {
  private readonly ctx: AudioContext | null;
  private readonly maxRpm: number;
  private readonly blades: number;

  private out!: GainNode;
  private panner!: StereoPannerNode;
  private air!: BiquadFilterNode;
  private mix!: GainNode;
  private voices!: { osc: OscillatorNode; gain: GainNode }[];
  private wash!: { src: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode };
  private rush!: { src: AudioBufferSourceNode; lp: BiquadFilterNode; gain: GainNode };

  /** Smoothed shaft speed per motor (RPM) — what the voices are actually at. */
  private readonly rpm = [0, 0, 0, 0];

  constructor(cfg: MotorAudioConfig) {
    this.maxRpm = Math.max(cfg.maxRpm, 1);
    this.blades = Math.max(Math.round(cfg.blades), 1);

    const c = audioContext();
    const bus = masterBus();
    const noise = noiseBuffer();
    this.ctx = c && bus && noise ? c : null;
    if (!c || !bus || !noise) return;

    // Shared tail: everything sums, gets filtered for distance, then placed.
    this.mix = c.createGain();
    this.air = c.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 20000;
    this.air.Q.value = 0.4;
    this.panner = c.createStereoPanner();
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.mix.connect(this.air).connect(this.panner).connect(this.out).connect(bus);

    const wave = bladeWave(c, this.blades);
    this.voices = MOTOR_TRIM.map(() => {
      const osc = c.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = 1;
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.mix);
      osc.start();
      return { osc, gain };
    });

    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    const washGain = c.createGain();
    washGain.gain.value = 0;
    const washSrc = c.createBufferSource();
    washSrc.buffer = noise;
    washSrc.loop = true;
    washSrc.connect(band).connect(washGain).connect(this.mix);
    washSrc.start();
    this.wash = { src: washSrc, band, gain: washGain };

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    const rushGain = c.createGain();
    rushGain.gain.value = 0;
    const rushSrc = c.createBufferSource();
    rushSrc.buffer = noise;
    rushSrc.loop = true;
    rushSrc.connect(lp).connect(rushGain).connect(this.mix);
    // Offset into the same buffer so the two noise layers do not correlate and
    // collapse into one louder, obviously-looping hiss.
    rushSrc.start(0, 0.83);
    this.rush = { src: rushSrc, lp, gain: rushGain };
  }

  update(dt: number, f: MotorAudioFrame): void {
    const c = this.ctx;
    if (!c) return;

    const t = c.currentTime;
    // A backgrounded window hands back a huge delta; letting that through would
    // snap the rotors to their target in one step and click.
    const step = clamp(dt, 0, 0.1);
    const idle = this.maxRpm * IDLE_RPM_FRACTION;

    let sum = 0;
    for (let i = 0; i < 4; i++) {
      // Thrust goes as the SQUARE of rotor speed, so audible pitch tracks the
      // square root of the mixer's output. This is why a real quad's tone moves
      // a lot in the bottom half of the stick and hardly at all in the top.
      const load = clamp(f.motors[i] ?? 0, 0, 1);
      const target = f.armed ? Math.max(idle, this.maxRpm * Math.sqrt(load)) : 0;
      const tau = target > this.rpm[i] ? SPOOL_UP : SPOOL_DOWN;
      this.rpm[i] += (target - this.rpm[i]) * (1 - Math.exp(-step / tau));
      sum += this.rpm[i];

      const shaft = (this.rpm[i] / 60) * f.doppler * MOTOR_TRIM[i];
      const v = this.voices[i];
      v.osc.frequency.setTargetAtTime(Math.max(shaft, 0.001), t, 0.03);
      // Rotor noise climbs much faster than thrust does, so an idling drone is
      // barely there and a punch-out is genuinely loud.
      v.gain.gain.setTargetAtTime(Math.pow(this.rpm[i] / this.maxRpm, 2.2) * VOICE_GAIN, t, 0.04);
    }

    const meanRpm = sum / 4;
    const spin = meanRpm / this.maxRpm;
    const bladePass = (meanRpm / 60) * this.blades;

    // Downwash sits above the blade tone and is steeply thrust-dependent.
    this.wash.band.frequency.setTargetAtTime(clamp(bladePass * 1.7, 120, 9000), t, 0.05);
    let wash = Math.pow(spin, 2.6) * WASH_GAIN;
    // Near the surface the air column has something to break against, and the
    // wash thickens noticeably. It is the cue you land by with the drone out of
    // sight below the horizon.
    const agl = clamp(f.altitude, 0, GROUND_WASH_ALT);
    wash *= 1 + 0.7 * (1 - agl / GROUND_WASH_ALT);
    this.wash.gain.gain.setTargetAtTime(wash, t, 0.06);

    // Airframe rush: near-field, so weight it heavily towards the FPV listener.
    // From the ground you hear the rotors, not the air over the frame.
    const speed = Math.max(f.speed, 0);
    this.rush.lp.frequency.setTargetAtTime(clamp(240 + speed * 300, 240, 6000), t, 0.08);
    const nearField = f.distance < 0.5 ? 1 : 0.3;
    const rush = Math.min(0.5, Math.pow(speed / 14, 2) * 0.6) * nearField * RUSH_GAIN;
    this.rush.gain.gain.setTargetAtTime(rush, t, 0.1);

    // Inverse-DISTANCE rolloff, not inverse-square. True 1/r^2 puts the drone
    // near-silent by 15 m, which is exactly the range you fly it at from a
    // chase camera; this keeps it present out to the edge of the arena.
    const dist = Math.max(f.distance, 0);
    const proximity = REF_DISTANCE / (REF_DISTANCE + dist);
    // Air absorbs the top end with distance, so a far drone is not just quieter
    // but duller. That difference is most of the sense of range.
    this.air.frequency.setTargetAtTime(clamp(19000 * Math.exp(-dist / 26), 700, 20000), t, 0.08);
    this.panner.pan.setTargetAtTime(clamp(f.pan, -1, 1), t, 0.05);
    this.out.gain.setTargetAtTime(clamp(f.level, 0, 1) * proximity, t, 0.05);
  }

  dispose(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    // Fade before stopping; cutting a running oscillator dead is a loud click.
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.02);
    const stopAt = t + 0.12;
    for (const v of this.voices) v.osc.stop(stopAt);
    this.wash.src.stop(stopAt);
    this.rush.src.stop(stopAt);
    window.setTimeout(() => this.out.disconnect(), 250);
  }
}
