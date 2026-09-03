import { audioContext, masterBus, noiseBuffer } from './engine';

// One-shot sound effects via the Web Audio API. No asset files — every sound is
// generated from oscillators and a noise buffer, so nothing to download and
// nothing blocked by the app's CSP.
//
// Everything routes through the shared master bus (see engine.ts), which is
// what applies the pilot's volume setting.

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Exponential glide to this frequency over the tone's duration. */
  slideTo?: number;
  /** Start offset in seconds. */
  delay?: number;
}

function tone({ freq, dur, type = 'sine', gain = 0.2, slideTo, delay = 0 }: ToneOpts): void {
  const c = audioContext();
  const bus = masterBus();
  if (!c || !bus) return;

  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + dur);

  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

interface BurstOpts {
  /** Filter centre / cutoff in Hz. */
  freq: number;
  dur: number;
  gain?: number;
  q?: number;
  type?: BiquadFilterType;
  /** Sweep the filter to this frequency over the burst. */
  slideTo?: number;
  delay?: number;
}

/** A filtered burst of noise — impacts, scrapes, anything without a pitch. */
function noiseBurst({
  freq,
  dur,
  gain = 0.2,
  q = 1,
  type = 'bandpass',
  slideTo,
  delay = 0,
}: BurstOpts): void {
  const c = audioContext();
  const bus = masterBus();
  const buf = noiseBuffer();
  if (!c || !bus || !buf) return;

  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 20), t + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(f).connect(g).connect(bus);
  // Start somewhere random in the buffer so two hits in a row are not identical.
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

/** A short UI click. */
export function playClick(): void {
  tone({ freq: 320, dur: 0.06, type: 'square', gain: 0.08, slideTo: 220 });
}

/** Arming: two rising blips + a low idle whir. */
export function playArm(): void {
  tone({ freq: 620, dur: 0.09, type: 'square', gain: 0.12 });
  tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.12, delay: 0.1 });
  tone({ freq: 120, dur: 0.25, type: 'sawtooth', gain: 0.05, slideTo: 180, delay: 0.12 });
}

/** Disarming: two falling blips. */
export function playDisarm(): void {
  tone({ freq: 700, dur: 0.09, type: 'square', gain: 0.1 });
  tone({ freq: 440, dur: 0.14, type: 'square', gain: 0.1, delay: 0.09 });
}

/** A gentle whoosh for phase transitions. */
export function playWhoosh(): void {
  tone({ freq: 300, dur: 0.28, type: 'sine', gain: 0.09, slideTo: 720 });
}

/** Failure buzzer. */
export function playFail(): void {
  tone({ freq: 200, dur: 0.28, type: 'sawtooth', gain: 0.14, slideTo: 120 });
}

/**
 * Ground / obstacle contact, graded by impact speed.
 *
 * The thresholds match the ones Drone.tsx grades collisions on: 1.8 m/s is a
 * scuff you walk away from, 4.5 m/s is the floor slam that ends the flight. So
 * how hard it sounds and whether it actually crashed agree by construction.
 */
export function playImpact(speed: number, propSnapped = false): void {
  const hard = Math.max(0, Math.min(1, (speed - 1.8) / (4.5 - 1.8)));
  // Carbon and plastic against a hard surface — brighter the harder it lands.
  noiseBurst({
    freq: 260 + hard * 900,
    slideTo: 140 + hard * 220,
    q: 0.8,
    dur: 0.09 + hard * 0.13,
    gain: 0.16 + hard * 0.3,
  });
  // The part you feel rather than hear.
  tone({
    freq: 110 - hard * 28,
    dur: 0.16 + hard * 0.14,
    type: 'sine',
    gain: 0.2 + hard * 0.24,
    slideTo: 42,
  });
  // Only on a real break: the snap of a blade letting go.
  if (propSnapped) noiseBurst({ freq: 3200, q: 2.4, dur: 0.05, gain: 0.22, delay: 0.02 });
}

/**
 * Low-pack buzzer, the way a real flight controller nags you.
 *
 * Single blip on the warning threshold, urgent double on the critical one — the
 * same escalation the firmware uses, so the sound tells you whether you still
 * have a choice about landing.
 */
export function playBatteryBeep(critical = false): void {
  const freq = critical ? 3100 : 2400;
  tone({ freq, dur: 0.07, type: 'square', gain: 0.09 });
  if (critical) tone({ freq, dur: 0.07, type: 'square', gain: 0.09, delay: 0.11 });
}

/**
 * Checkpoint taken.
 *
 * The moment a corner or a gate is scored, and the only sound in a lesson that
 * answers "did that count". Everything else the guide does about it is visual —
 * the light goes out, the step row ticks, the dial moves on — and all three are
 * off to the side of a pilot who is looking at where they are going next.
 *
 * Short and bright on purpose. It plays while the aircraft is still carrying its
 * speed out the far side of the thing it just took, so anything with a tail on
 * it would still be sounding over the next leg. Two notes a fifth apart, the
 * second above the first: rising reads as "got it" where falling reads as a
 * mistake, which is the job `playFail` already has.
 *
 * Deliberately NOT the success flourish. That one means the lesson is over, and
 * a checkpoint is a step inside it — a pilot who hears the same sound at both
 * cannot tell a corner from the finish.
 */
export function playCollect(): void {
  tone({ freq: 1047, dur: 0.09, type: 'triangle', gain: 0.15 });
  tone({ freq: 1568, dur: 0.14, type: 'triangle', gain: 0.12, delay: 0.05 });
  // A touch of air over the top, so it reads as a chime rather than as a beep.
  tone({ freq: 3136, dur: 0.09, type: 'sine', gain: 0.045, delay: 0.05 });
}

/** One star chime; pitch rises with the star index (0,1,2). */
export function playStar(index: number): void {
  const freqs = [660, 830, 990];
  tone({ freq: freqs[index] ?? 660, dur: 0.28, type: 'triangle', gain: 0.2 });
  tone({ freq: (freqs[index] ?? 660) * 2, dur: 0.2, type: 'sine', gain: 0.08 });
}

/** Lesson-complete flourish (major arpeggio). */
export function playSuccess(): void {
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((f, i) =>
    tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.16, delay: i * 0.08 }),
  );
}

/** Rank-up fanfare. */
export function playRankUp(): void {
  const notes = [523, 784, 1047, 1319]; // C5 G5 C6 E6
  notes.forEach((f, i) => {
    tone({ freq: f, dur: 0.4, type: 'square', gain: 0.12, delay: i * 0.11 });
    tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.1, delay: i * 0.11 });
  });
}

/**
 * A package latching onto the airframe.
 *
 * Mechanical rather than musical, and deliberately unlike `playCollect`: a
 * checkpoint is a score and this is a THING attaching to the aircraft, so it is
 * a short metal clack with a low body under it rather than a chime. A pilot who
 * hears both in the same flight should never have to ask which just happened.
 */
export function playLatch(): void {
  noiseBurst({ freq: 1900, slideTo: 620, q: 3.2, dur: 0.06, gain: 0.16 });
  tone({ freq: 150, dur: 0.16, type: 'sine', gain: 0.16, slideTo: 92 });
  tone({ freq: 880, dur: 0.1, type: 'triangle', gain: 0.07, delay: 0.03 });
}

/** The same latch letting go, and the package settling on the mark. */
export function playDrop(): void {
  tone({ freq: 620, dur: 0.09, type: 'triangle', gain: 0.1, slideTo: 380 });
  noiseBurst({ freq: 420, slideTo: 180, q: 1.2, dur: 0.14, gain: 0.14, delay: 0.06 });
  tone({ freq: 96, dur: 0.2, type: 'sine', gain: 0.16, slideTo: 60, delay: 0.06 });
}
