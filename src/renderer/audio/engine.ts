import { useSettingsStore } from '../state/settingsStore';

// Shared Web Audio plumbing: one AudioContext for the whole app, one master
// gain everything routes through, and one noise buffer the synths borrow.
//
// The master gain node matters more than it looks. The one-shot effects could
// get away with reading the volume setting when a sound started, because they
// were over in 200 ms. The motor engine is SUSTAINED, so the slider has to act
// on a live node — otherwise turning the volume down while flying does nothing
// until the next time the drone is armed.

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let noise: AudioBuffer | null = null;
/** Latched once construction throws, so we stop retrying every frame. */
let unavailable = false;

/** Browsers start a context suspended until the user has interacted. */
const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;

function armAutoResume(c: AudioContext): void {
  const resume = () => {
    if (c.state === 'suspended') void c.resume();
  };
  // Left attached rather than once-only: the OS can suspend a context again
  // (sleep, audio device change), and the next click should bring it back.
  for (const e of GESTURES) window.addEventListener(e, resume, { passive: true });
}

export function audioContext(): AudioContext | null {
  if (unavailable) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      armAutoResume(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

/** Master output. Connect everything audible here, never to `destination`. */
export function masterBus(): GainNode | null {
  const c = audioContext();
  if (!c) return null;
  if (bus) return bus;

  const g = c.createGain();
  g.gain.value = volumeSetting();
  g.connect(c.destination);
  bus = g;

  useSettingsStore.subscribe((s) => {
    // Ramp rather than jump — stepping a gain mid-tone is an audible click.
    g.gain.setTargetAtTime(clamp01(s.settings.volume), c.currentTime, 0.02);
  });

  return bus;
}

/**
 * Two seconds of looping noise, shared by every synth that needs it.
 *
 * Tilted towards the low end rather than flat white. Rotor downwash and the
 * rush of air over an airframe both carry most of their energy low, and white
 * noise through a bandpass still reads as hiss; a one-pole tilt is enough to
 * hear the difference.
 */
export function noiseBuffer(): AudioBuffer | null {
  const c = audioContext();
  if (!c) return null;
  if (noise) return noise;

  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    lp = lp * 0.86 + w * 0.14;
    const v = w * 0.45 + lp * 2.6;
    d[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  // Normalise so callers can reason about gains in the same units as the
  // oscillator voices, instead of guessing what the tilt did to the level.
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] *= k;
  }

  noise = buf;
  return noise;
}

function volumeSetting(): number {
  return clamp01(useSettingsStore.getState().settings.volume ?? 0.7);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
