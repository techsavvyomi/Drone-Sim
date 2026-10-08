import type { FlightMode, HudWidgets } from '@shared/types';
import { HUD_WIDGETS } from '@shared/types';
import { RAD2DEG } from '../sim/mathx';

// ----------------------------------------------------------------------------
// The Free Flight cockpit's facts (Phase 6), as pure functions: every line the
// cockpit prints is built here from plain numbers, so the tests can read it
// without a canvas, a store or a clock. The components only lay them out.
// ----------------------------------------------------------------------------

/** The cockpit samples its readouts at this rate, Hz (the brief's 10 Hz). */
export const HUD_HZ = 10;
/** Steady flight this long, seconds, before the cockpit goes quiet. */
export const QUIET_AFTER = 3;
/** Battery below this share brings its plate back and reads ▲ LAND SOON. */
export const LOW_SOC = 0.2;
/** Within this many metres of the ceiling the altitude tape comes back. */
export const CEILING_NEAR = 0.5;

/** "3:12" — minutes and seconds, no hours. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `toFixed` that never prints "-0.0": a value that rounds to zero is zero. */
export function fixed(v: number, digits: number): string {
  const t = v.toFixed(digits);
  return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t;
}

/** "4.00 V", or "— V" before the pack has reported (the sim publishes 0 until
 *  the first physics step on a fresh drone). */
export function voltsText(v: number): string {
  return v > 0 ? `${v.toFixed(2)} V` : '— V';
}

/** "2", "2.5" — one decimal below 10, none from 10 up, never "2.0". */
function num(v: number): string {
  const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

// ---- Heading -----------------------------------------------------------------

/** Compass heading from the sim's yaw (radians, CCW positive), 0..359 — the
 *  rounding happens BEFORE the wrap, so 359.6° reads 000, never 360. */
export function headingDeg(yaw: number): number {
  const h = Math.round(-yaw * RAD2DEG);
  return ((h % 360) + 360) % 360;
}

/** "049" */
export function headingText(deg: number): string {
  return String(((Math.round(deg) % 360) + 360) % 360).padStart(3, '0');
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** The nearest of the eight compass points. */
export function compassPoint(deg: number): (typeof POINTS)[number] {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return POINTS[i];
}

export interface RibbonTick {
  deg: number;
  /** Where along the ribbon, -1 (left edge) … 1 (right edge). */
  at: number;
  /** "N", "030" — every 30°; cardinals by letter. */
  label?: string;
}

/** The ribbon's ticks every 10° across ±`span` degrees of the heading. */
export function ribbonTicks(heading: number, span = 60): RibbonTick[] {
  const out: RibbonTick[] = [];
  const first = Math.ceil((heading - span) / 10) * 10;
  for (let d = first; d <= heading + span; d += 10) {
    const deg = ((d % 360) + 360) % 360;
    const tick: RibbonTick = { deg, at: (d - heading) / span };
    if (deg % 90 === 0) tick.label = POINTS[deg / 45];
    else if (deg % 30 === 0) tick.label = headingText(deg);
    out.push(tick);
  }
  return out;
}

// ---- Wind --------------------------------------------------------------------

export type GustLevel = 'off' | 'light' | 'strong';

/** The gustiness each PHYSICS button sets (a fraction of the base speed). */
export const GUST_LEVELS: Record<GustLevel, number> = { off: 0, light: 0.3, strong: 0.7 };

/** The button a gustiness value reads as: the nearest level. */
export function gustLevel(gustiness: number): GustLevel {
  let best: GustLevel = 'off';
  for (const k of Object.keys(GUST_LEVELS) as GustLevel[]) {
    if (Math.abs(GUST_LEVELS[k] - gustiness) < Math.abs(GUST_LEVELS[best] - gustiness)) best = k;
  }
  return best;
}

export interface WindFacts {
  calm: boolean;
  /** "2 m/s from NE · gust light", or "Calm". */
  line: string;
  /** Where the wind comes FROM, degrees. */
  fromDeg: number;
  /** The arrow's rotation on screen: where the air goes, relative to the nose
   *  (0 = straight ahead, up the screen). */
  arrowDeg: number;
}

/** The sim's `directionDeg` is where the wind blows TO (0 = north); a pilot
 *  names where it comes from, so "from" is the opposite way. */
export function windFacts(
  wind: { speed: number; directionDeg: number; gustiness: number },
  heading: number,
): WindFacts {
  const fromDeg = (((wind.directionDeg + 180) % 360) + 360) % 360;
  const arrowDeg = (((wind.directionDeg - heading) % 360) + 360) % 360;
  if (wind.speed < 0.05) return { calm: true, line: 'Calm', fromDeg, arrowDeg };
  return {
    calm: false,
    line: `${num(wind.speed)} m/s from ${compassPoint(fromDeg)} · gust ${gustLevel(wind.gustiness) === 'off' ? 'none' : gustLevel(wind.gustiness)}`,
    fromDeg,
    arrowDeg,
  };
}

// ---- Aircraft ----------------------------------------------------------------

/** The game's three modes, with what each does in a few words. */
export const FLIGHT_MODES: Record<FlightMode, { name: string; note: string }> = {
  'altitude-hold': { name: 'Alt Hold', note: 'holds height' },
  stabilize: { name: 'Stabilize', note: 'self-level' },
  acro: { name: 'Acro', note: 'manual control' },
};

/** "Alt Hold · holds height"; an unknown mode reads as itself. */
export function flightModeLine(mode: FlightMode): string {
  const m = FLIGHT_MODES[mode];
  return m ? `${m.name} · ${m.note}` : String(mode);
}

export type Tone = 'neutral' | 'armed' | 'caution' | 'fail';

export interface MotorsFacts {
  tone: Tone;
  /** "Armed", "Armed · taking off", "Disarmed", "Crashed". */
  word: string;
}

export function motorsFacts(f: {
  armed: boolean;
  crashed: boolean;
  auto: 'manual' | 'takeoff' | 'land';
}): MotorsFacts {
  if (f.crashed) return { tone: 'fail', word: 'Crashed' };
  if (!f.armed) return { tone: 'neutral', word: 'Disarmed' };
  if (f.auto === 'takeoff') return { tone: 'armed', word: 'Armed · taking off' };
  if (f.auto === 'land') return { tone: 'armed', word: 'Armed · landing' };
  return { tone: 'armed', word: 'Armed' };
}

export interface BatteryFacts {
  pct: number;
  volts: string;
  tone: Tone;
  /** "~6 MIN LEFT", "LAND SOON", … — shown in capitals beside BATTERY. */
  note: string;
  /** Low enough that the plate must be on screen even in quiet flight. */
  warn: boolean;
}

/**
 * Minutes of flight the pack has left: the charge still in it over the average
 * drain since it was last full. Null until there is enough flying to average
 * (20 s and 1 % used) — a guess from a take-off's first second would swing
 * wildly. The average over the flight so far is judgement, not a battery model.
 */
export function minutesLeft(socStart: number, soc: number, seconds: number): number | null {
  const used = socStart - soc;
  if (seconds < 20 || used < 0.01) return null;
  return soc / (used / seconds) / 60;
}

export function batteryFacts(b: {
  soc: number;
  voltage: number;
  minutesLeft: number | null;
  warning: boolean;
  critical: boolean;
  autoLanding?: boolean;
  empty: boolean;
}): BatteryFacts {
  const pct = Math.max(0, Math.min(100, Math.round(b.soc * 100)));
  const volts = voltsText(b.voltage);
  if (b.empty) return { pct, volts, tone: 'fail', note: 'Empty · press R', warn: true };
  if (b.critical)
    return {
      pct,
      volts,
      tone: 'fail',
      note: b.autoLanding === false ? 'Critical · manual control' : 'Critical · landing',
      warn: true,
    };
  if (b.soc < LOW_SOC || b.warning)
    return { pct, volts, tone: 'caution', note: 'Land soon', warn: true };
  const m = b.minutesLeft;
  const note = m === null ? '' : m < 1 ? '< 1 min left' : `~${Math.round(m)} min left`;
  return { pct, volts, tone: 'neutral', note, warn: false };
}

/** Within `CEILING_NEAR` of the ceiling (or over it). */
export function nearCeiling(altitude: number, ceiling: number): boolean {
  return ceiling > 0 && ceiling - altitude <= CEILING_NEAR;
}

// ---- Quiet in flight ---------------------------------------------------------

export interface QuietInput {
  enabled: boolean;
  armed: boolean;
  airborne: boolean;
  /** The dock, the HUD panel, the camera menu, the pause card or a crash. */
  covered: boolean;
  /** Seconds since the last wake (mouse, H, T, C, Esc) or lift-off. */
  sinceWake: number;
}

/** Quiet only while armed and flying, with nothing open, after 3 s of it. */
export function isQuiet(q: QuietInput): boolean {
  return q.enabled && q.armed && q.airborne && !q.covered && q.sinceWake >= QUIET_AFTER;
}

/** Keys that wake a quiet cockpit. Flying keys do not. */
export const WAKE_CODES = new Set(['KeyH', 'KeyT', 'KeyC', 'Escape']);

// ---- Crash -------------------------------------------------------------------

/** "At 3:12, 1.2 m up, flying at 2.4 m/s." */
export function crashLine(c: { when: string; altitude: number; speed: number }): string {
  const where = c.altitude < 0.15 ? 'on the ground' : `${num(c.altitude)} m up`;
  const how = c.speed >= 0.3 ? `, flying at ${num(c.speed)} m/s` : '';
  return `At ${c.when}, ${where}${how}.`;
}

/**
 * One way to avoid it next time. The stopping distance is the impact speed
 * times ~0.45 s, rounded to the half metre — judgement for a light quad with
 * the stick released, not a measurement.
 */
export function crashTip(speed: number): string {
  if (speed < 1) {
    return 'Come down slowly near the ground and obstacles: ease the throttle down, never off.';
  }
  const stop = Math.max(0.5, Math.round(speed * 0.45 * 2) / 2);
  return `Ease off about ${num(stop)} m before an obstacle. At ${num(speed)} m/s the drone needs that long to stop.`;
}

// ---- Pause -------------------------------------------------------------------

export type PauseContext =
  | { kind: 'free'; arena: string; drone: string; flownSec: number }
  | { kind: 'lesson'; num: number; title: string; step: string; flightSec: number }
  | { kind: 'mission'; num: number; name: string; usedSec: number; limitSec: number };

export interface PauseLines {
  context: string;
  line: string;
}

/** The pause card's two lines. Only these change between the three views. */
export function pauseLines(p: PauseContext): PauseLines {
  switch (p.kind) {
    case 'free':
      return {
        context: `Free Flight · ${p.arena} · ${p.drone}`,
        line: `${clock(p.flownSec)} flown. The drone holds its position while paused. Nothing is lost.`,
      };
    case 'lesson':
      return {
        context: `Module ${p.num} · ${p.title} · ${p.step}`,
        line: `${p.flightSec.toFixed(1)} s on the flight clock. The timer is paused and resumes where it stopped.`,
      };
    case 'mission':
      return {
        context: `Mission ${p.num} · ${p.name}`,
        line: `${clock(p.usedSec)} used of ${clock(p.limitSec)}. The mission clock is paused and resumes where it stopped.`,
      };
  }
}

/** The exit question for a lesson or a mission. */
export function exitAsk(kind: 'lesson' | 'mission'): { title: string; body: string } {
  const what = kind === 'lesson' ? 'module' : 'mission';
  return {
    title: `Exit the ${what}?`,
    body: `You'll go back to the ${what} list. This attempt ends and won't count.`,
  };
}

// ---- HUD panel ---------------------------------------------------------------

/** "8 of 13 on" — only the widgets the panel lists count. */
export function hudCount(hud: HudWidgets): { on: number; total: number } {
  return { on: HUD_WIDGETS.filter((w) => hud[w.key]).length, total: HUD_WIDGETS.length };
}

/** The one key list: the HUD panel carries it (it was the H controls panel) and
 *  Settings → Controls shows the same rows, so the two can never disagree. */
export const KEY_GROUPS: readonly { title: string; rows: readonly [string, string][] }[] = [
  {
    title: 'Flight',
    rows: [
      ['W S', 'Throttle up / down'],
      ['A D', 'Yaw left / right'],
      ['↑ ↓', 'Pitch forward / back'],
      ['← →', 'Roll left / right'],
    ],
  },
  {
    title: 'Aircraft',
    rows: [
      ['Enter', 'Arm / disarm'],
      ['Space', 'Auto take off / land (not in Acro)'],
      ['M', 'Next flight mode'],
      ['R', 'Reset to the start pad'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['C', 'Next camera'],
      ['T', 'Telemetry'],
      ['H', 'HUD panel'],
      ['Esc / P', 'Pause'],
    ],
  },
];

/** The telemetry dock's motor rows, in the sim's motor order. */
export const MOTOR_LABELS = ['M1 FR', 'M2 FL', 'M3 BR', 'M4 BL'] as const;

/** mAh drawn from a pack of `capacityMah` at state of charge `soc`. */
export function usedMah(capacityMah: number, soc: number): number {
  return Math.round(capacityMah * Math.max(0, 1 - soc));
}

// ---- Esc ---------------------------------------------------------------------

export type EscStep = 'pause' | 'cancelAdvance' | 'exitLesson' | 'exitMission' | 'back' | 'none';

/**
 * What Esc does, app-wide (Phase 6): it pauses a flight and never ends one —
 * Free Flight, a lesson's practice, a mission's flight — and on a paused flight
 * (the pause card, or its exit question) it resumes, which is also "pause".
 * Off a flight it steps back as before: a counting result card stops its
 * countdown first, a lesson or a mission goes to its list, a page goes back.
 */
export function escapeStep(s: {
  section: string;
  paused: boolean;
  lesson: { phase: string; autoAdvance: boolean } | null;
  mission: { phase: string } | null;
}): EscStep {
  if (s.section === 'fly' || s.paused) return 'pause';
  if (s.section === 'training') {
    if (!s.lesson) return 'back';
    if (s.lesson.phase === 'practice') return 'pause';
    if (s.lesson.phase === 'reward' && s.lesson.autoAdvance) return 'cancelAdvance';
    return 'exitLesson';
  }
  if (s.section === 'missions') {
    if (!s.mission) return 'back';
    return s.mission.phase === 'flying' ? 'pause' : 'exitMission';
  }
  return s.section === 'home' ? 'none' : 'back';
}
