import { useSettingsStore } from '../state/settingsStore';

// Synthesized sound effects via the Web Audio API. No asset files — every sound
// is generated from oscillators, so nothing to download and nothing blocked by
// the app's CSP. All output is scaled by the master volume setting.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function masterGain(): number {
  return useSettingsStore.getState().settings.volume ?? 0.7;
}

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
  const c = audio();
  if (!c) return;
  const vol = masterGain();
  if (vol <= 0) return;

  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + dur);

  const peak = Math.max(gain * vol, 0.0002);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
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

/** One star chime; pitch rises with the star index (0,1,2). */
export function playStar(index: number): void {
  const freqs = [660, 830, 990];
  tone({ freq: freqs[index] ?? 660, dur: 0.28, type: 'triangle', gain: 0.2 });
  tone({ freq: (freqs[index] ?? 660) * 2, dur: 0.2, type: 'sine', gain: 0.08 });
}

/** Lesson-complete flourish (major arpeggio). */
export function playSuccess(): void {
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((f, i) => tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.16, delay: i * 0.08 }));
}

/** Rank-up fanfare. */
export function playRankUp(): void {
  const notes = [523, 784, 1047, 1319]; // C5 G5 C6 E6
  notes.forEach((f, i) => {
    tone({ freq: f, dur: 0.4, type: 'square', gain: 0.12, delay: i * 0.11 });
    tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.1, delay: i * 0.11 });
  });
}
