import type { DroneSpec } from '@shared/types';
import { GRAVITY } from '../sim/constants';
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

/**
 * ESC idle floor as a fraction of max RPM — rotors that are TURNING never drop
 * below it. It is not a floor for being armed: this simulator deliberately
 * leaves the props stopped on the pad (see `altitudeThrust`), so an idle floor
 * keyed on `armed` alone had the aircraft humming away with four motionless
 * propellers the instant the pilot armed it.
 */
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
const BODY_GAIN = 0.34;

/**
 * Propeller diameter the low-end scalings are referenced to: a 55 mm whoop
 * prop, the smallest thing that flies here, which gets essentially no bass.
 */
const REFERENCE_PROP_M = 0.055;

/**
 * Thrust at which the body mode reaches its nominal level, Newtons — roughly a
 * 1.4 kg aircraft hovering.
 *
 * The body is loaded by ABSOLUTE thrust, which is why this is in Newtons and
 * not a fraction of maximum. Driving it off throttle fraction gets the ordering
 * backwards: the racer hovers at 28% and the Guru at 50%, so the racer came out
 * with half the Guru's bass despite pushing nearly twice the thrust through a
 * bigger frame. Measured 8.7% sub-120 Hz against the Guru's 14.2%.
 */
const REFERENCE_THRUST_N = 14;

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
  /** Propeller diameter, metres. Drives how much low end the rotors radiate. */
  propDiameter: number;
  /** Motor arm length, metres. Sets where the airframe's body mode sits. */
  frameSize: number;
  /** Total thrust at full throttle, Newtons — how hard the frame gets loaded. */
  maxThrust: number;
  /** Fraction of full thrust needed to hover, 0..1. */
  hoverFraction: number;
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
function bladeWave(c: AudioContext, blades: number, lowOrder: number): PeriodicWave {
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    imag[h] =
      h % blades === 0
        ? // Blade-pass and its overtones: the tone you actually hear.
          //
          // The rolloff is steep on purpose. At -1.45 the overtones sat at
          // 0.37 / 0.21 / 0.14 of the fundamental, and four detuned copies of
          // a series that dense beat against each other three and four kHz up,
          // which is what reads as METALLIC rather than as a propeller.
          Math.pow(h / blades, -2)
        : // Shaft-order content, below the blade-pass peak. How far below is
          // what `lowOrder` decides — see rotorLowEnd.
          lowOrder / h;
  }
  return c.createPeriodicWave(real, imag);
}

/**
 * How much shaft-order (sub-blade-pass) energy a rotor radiates.
 *
 * Two things raise it. A bigger propeller carries more mass, more blade-to-blade
 * variation and a slower, heavier column of air. And a higher blade count means
 * every blade flies through the wake of the one ahead of it, which is unsteady
 * once per revolution — the reason multi-blade props sound throatier than
 * two-blade ones rather than just higher.
 *
 * It matters most on a 4-blade prop, where blade-pass sits two octaves above
 * shaft rate and without this there is nothing at all in between.
 */
function rotorLowEnd(propDiameter: number, blades: number): number {
  const size = Math.max(propDiameter, REFERENCE_PROP_M) / REFERENCE_PROP_M;
  const wake = 1 + 0.18 * Math.max(0, blades - 2);
  return clamp(0.09 * Math.pow(size, 1.45) * wake, 0.09, 0.7);
}

/**
 * Where the airframe's own body mode sits, in Hz.
 *
 * The frame is a structure rung by four rotors, and bigger structures resonate
 * lower — so the whoop thrums around 165 Hz and the 5" racer around 117 Hz.
 *
 * Deliberately not lower. An earlier constant put the racer at 86 Hz, which
 * measured as plenty of sub-120 Hz energy and still sounded thin, because most
 * of what people listen on cannot reproduce 86 Hz at all. Bass you can hear on
 * a laptop lives just above 100.
 */
function bodyModeHz(frameSize: number): number {
  return clamp(46 / Math.sqrt(Math.max(frameSize, 0.02)), 70, 260);
}

/**
 * How far the downwash band drops for a larger rotor.
 *
 * Turbulence scales with the thing making it: a big disc sheds big, slow eddies
 * and a small one sheds fast little ones. Tracking shaft rate alone (as this
 * did) puts a 5" prop's broadband roar in the same place as a whoop's hiss.
 */
function washSizeFactor(propDiameter: number): number {
  return Math.pow(REFERENCE_PROP_M / Math.max(propDiameter, REFERENCE_PROP_M), 0.4);
}

/**
 * How much louder a larger rotor's downwash is: more disc area, more air, more
 * roar. Also what puts back the level the steeper harmonic rolloff took off the
 * big airframes — as broadband, which is where it belongs, rather than as the
 * high harmonics that made them ring in the first place.
 */
function washSizeGain(propDiameter: number): number {
  return clamp(Math.pow(Math.max(propDiameter, REFERENCE_PROP_M) / REFERENCE_PROP_M, 0.6), 1, 2.5);
}

/** Derive the engine's tuning from the airframe's own spec. */
export function motorAudioConfig(spec: DroneSpec): MotorAudioConfig {
  const packVolts = spec.battery.cells * spec.battery.nominalV;
  return {
    maxRpm: spec.motors[0].kv * packVolts * PROP_LOAD,
    blades: spec.propBlades ?? 2,
    propDiameter: (spec.propDiameterIn * 25.4) / 1000,
    frameSize: spec.armLength,
    maxThrust: spec.motors.reduce((sum, m) => sum + m.maxThrustN, 0),
    hoverFraction: clamp(
      (spec.mass * GRAVITY) / spec.motors.reduce((sum, m) => sum + m.maxThrustN, 1e-6),
      0.02,
      1,
    ),
  };
}

/**
 * Output trim that keeps an airframe's engine at a sensible level regardless of
 * how much thrust it has in reserve.
 *
 * Every layer here is driven by rotor speed as a FRACTION of maximum, which is
 * right for timbre and wrong for loudness. The racer hovers at 28% throttle
 * against the trainers' 50%, so it came out 4.6 dB quieter than the Guru while
 * moving nearly twice the air — a real 5" quad hovering next to a 400 g one is
 * not the quieter of the two.
 *
 * Referenced to a spin of 0.7, which is where a 2:1 thrust-to-weight trainer
 * hovers, so the existing airframes are left where they were.
 */
function levelTrim(hoverFraction: number): number {
  return clamp(Math.pow(0.7 / Math.sqrt(hoverFraction), 1.8), 0.7, 3);
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
  private body!: { src: AudioBufferSourceNode; lp: BiquadFilterNode; gain: GainNode };
  /** How hard this rotor size drives the body mode, relative to a whoop. */
  private readonly bodyDrive: number;
  private readonly maxThrust: number;
  /** How far this rotor size pulls the downwash band down. */
  private readonly washFactor: number;
  private readonly washGain: number;
  private readonly trim: number;

  /** Smoothed shaft speed per motor (RPM) — what the voices are actually at. */
  private readonly rpm = [0, 0, 0, 0];

  constructor(cfg: MotorAudioConfig) {
    this.maxRpm = Math.max(cfg.maxRpm, 1);
    this.blades = Math.max(Math.round(cfg.blades), 1);
    // A bigger disc moves more air and hits the frame harder, so it excites the
    // body mode more. Steeper than the harmonic scaling above because this is
    // about how much air is being shifted, not how the rotor itself rings.
    this.bodyDrive = clamp(
      Math.pow(Math.max(cfg.propDiameter, REFERENCE_PROP_M) / REFERENCE_PROP_M, 1.4),
      1,
      6,
    );
    this.maxThrust = Math.max(cfg.maxThrust, 1e-3);
    this.washFactor = washSizeFactor(cfg.propDiameter);
    this.washGain = WASH_GAIN * washSizeGain(cfg.propDiameter);
    this.trim = levelTrim(cfg.hoverFraction);

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

    const wave = bladeWave(c, this.blades, rotorLowEnd(cfg.propDiameter, this.blades));
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

    // Body mode. A resonant lowpass rather than a bandpass: the frame passes
    // everything below its mode and rings AT it, which is what gives a big quad
    // a floor under the rotor tone instead of a narrow hum.
    const bodyLp = c.createBiquadFilter();
    bodyLp.type = 'lowpass';
    bodyLp.frequency.value = bodyModeHz(cfg.frameSize);
    // Broad, not resonant. At Q 4 this rang on one note, which is a hum sitting
    // under the drone rather than the drone itself having weight.
    bodyLp.Q.value = 1.4;
    const bodyGain = c.createGain();
    bodyGain.gain.value = 0;
    const bodySrc = c.createBufferSource();
    bodySrc.buffer = noise;
    bodySrc.loop = true;
    bodySrc.connect(bodyLp).connect(bodyGain).connect(this.mix);
    bodySrc.start(0, 1.41);
    this.body = { src: bodySrc, lp: bodyLp, gain: bodyGain };
  }

  update(dt: number, f: MotorAudioFrame): void {
    const c = this.ctx;
    if (!c) return;

    const t = c.currentTime;
    // A backgrounded window hands back a huge delta; letting that through would
    // snap the rotors to their target in one step and click.
    const step = clamp(dt, 0, 0.1);
    const idle = this.maxRpm * IDLE_RPM_FRACTION;

    // Silence unless the mixer is actually asking for something. Judged on the
    // collective rather than per motor, so a hover that trims one rotor to
    // nothing does not switch that voice off underneath the other three.
    const collective =
      (f.motors[0] ?? 0) + (f.motors[1] ?? 0) + (f.motors[2] ?? 0) + (f.motors[3] ?? 0);
    const spinning = f.armed && collective > 0.002;

    let sum = 0;
    for (let i = 0; i < 4; i++) {
      // Thrust goes as the SQUARE of rotor speed, so audible pitch tracks the
      // square root of the mixer's output. This is why a real quad's tone moves
      // a lot in the bottom half of the stick and hardly at all in the top.
      const load = clamp(f.motors[i] ?? 0, 0, 1);
      const target = spinning ? Math.max(idle, this.maxRpm * Math.sqrt(load)) : 0;
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
    const shaftHz = meanRpm / 60;

    // Downwash follows how fast the DISC turns, not how many blades are bolted
    // to it — it is the turbulence of the air column, and a 4-blade prop does
    // not make that hiss an octave higher than a 2-blade one at the same RPM.
    // Scaling it by blade count (as this did) is what left the 4-blade racer
    // with its whole broadband layer an octave too high, and no bass at all.
    this.wash.band.frequency.setTargetAtTime(
      clamp(shaftHz * 3.2 * this.washFactor, 90, 9000),
      t,
      0.05,
    );
    let wash = Math.pow(spin, 2.6) * this.washGain;
    // Near the surface the air column has something to break against, and the
    // wash thickens noticeably. It is the cue you land by with the drone out of
    // sight below the horizon.
    const agl = clamp(f.altitude, 0, GROUND_WASH_ALT);
    wash *= 1 + 0.7 * (1 - agl / GROUND_WASH_ALT);
    this.wash.gain.gain.setTargetAtTime(wash, t, 0.06);

    // Body mode, driven by the thrust actually passing through the frame:
    // rotor speed squared IS thrust as a fraction of maximum, so multiplying by
    // the airframe's own maximum turns it back into Newtons.
    const thrustN = spin * spin * this.maxThrust;
    this.body.gain.gain.setTargetAtTime(
      BODY_GAIN * this.bodyDrive * clamp(thrustN / REFERENCE_THRUST_N, 0, 1.6),
      t,
      0.06,
    );

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
    this.out.gain.setTargetAtTime(clamp(f.level, 0, 1) * proximity * this.trim, t, 0.05);
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
    this.body.src.stop(stopAt);
    window.setTimeout(() => this.out.disconnect(), 250);
  }
}
