import type { LessonProgress } from '@shared/types';
import type { Lesson, StarRule } from '../training/lessons/types';
import { demoLength } from '../training/lessons/types';
import type { TrainingPhase } from '../state/trainingStore';
import type { ClockState } from '../training/flightClock';
import type { Tone } from '../ds';
import type { IconName } from '../ds/Icon';

// What Pluto Flight School says, as pure functions: the blocks and rows of the
// module list, the star tiers, the lines on the Fly bar and the result card.
// Everything comes from the lessons themselves and the local progress record —
// the PDF's module titles, minutes and thresholds are placeholders.

// ---- Blocks ------------------------------------------------------------------

export interface BlockDef {
  name: string;
  /** First and last module, 1-based and inclusive. */
  from: number;
  to: number;
}

/**
 * The syllabus in four blocks, the PDF's split (1–4, 5–8, 9–12, 13–15) with
 * names that say what the real modules in each one are: arm, land, throttle and
 * yaw are all flown on the spot; pitch, roll, a straight line and a diagonal are
 * the attitude sticks; 9–12 are the shape laps; 13–15 are the gate routes.
 */
export const BLOCKS: readonly BlockDef[] = [
  { name: 'Ground Handling', from: 1, to: 4 },
  { name: 'Attitude', from: 5, to: 8 },
  { name: 'Circuits', from: 9, to: 12 },
  { name: 'Navigation', from: 13, to: 15 },
];

export function blockOf(n: number): BlockDef {
  return BLOCKS.find((b) => n >= b.from && n <= b.to) ?? BLOCKS[BLOCKS.length - 1];
}

// ---- Module rows -------------------------------------------------------------

export type RowStatus = 'done' | 'next' | 'locked';

export interface ModuleRow {
  n: number;
  id: string;
  title: string;
  goal: string;
  stars: number;
  bestTimeSec: number | null;
  status: RowStatus;
  lesson: Lesson;
}

/** One row per module. Unlocking is the game's own rule: the first module, or
 *  the one after a completed module. Linear, so at most one row is "next". */
export function moduleRows(
  lessons: readonly Lesson[],
  progress: Record<string, LessonProgress | undefined>,
): ModuleRow[] {
  return lessons.map((lesson, i) => {
    const p = progress[lesson.id];
    const unlocked = i === 0 || !!progress[lessons[i - 1].id]?.completed;
    const status: RowStatus = p?.completed ? 'done' : unlocked ? 'next' : 'locked';
    return {
      n: i + 1,
      id: lesson.id,
      title: lesson.title,
      goal: lesson.subtitle,
      stars: p?.stars ?? 0,
      bestTimeSec: p?.bestTimeSec ?? null,
      status,
      lesson,
    };
  });
}

/** The status cell's words. */
export function rowStatusText(row: ModuleRow): string {
  if (row.status === 'done') return 'Completed';
  if (row.status === 'next') return 'Start';
  return `After Module ${row.n - 1}`;
}

export interface BlockSummary extends BlockDef {
  index: number;
  done: number;
  total: number;
  stars: number;
  maxStars: number;
  locked: boolean;
  /** "● 3 of 4 done · ★ 8 of 12" or "○ Locked · finish Ground Handling". */
  line: string;
}

export function blockSummaries(rows: readonly ModuleRow[]): BlockSummary[] {
  return BLOCKS.map((b, index) => {
    const mine = rows.filter((r) => r.n >= b.from && r.n <= b.to);
    const done = mine.filter((r) => r.status === 'done').length;
    const stars = mine.reduce((sum, r) => sum + r.stars, 0);
    const locked = mine.length === 0 || mine[0].status === 'locked';
    const line = locked
      ? `Locked · finish ${BLOCKS[index - 1]?.name ?? 'the block before'}`
      : `${done} of ${mine.length} done · ★ ${stars} of ${mine.length * 3}`;
    return {
      ...b,
      index,
      done,
      total: mine.length,
      stars,
      maxStars: mine.length * 3,
      locked,
      line,
    };
  });
}

export interface ListSummary {
  done: number;
  stars: number;
  total: number;
  maxStars: number;
  next: ModuleRow | null;
  /** "3 of 15 modules · ★ 8 of 45". */
  line: string;
  /** "Next: Module 4, Yaw Control" / "Start with Module 1" / "Every module flown". */
  nextLine: string;
}

export function listSummary(rows: readonly ModuleRow[]): ListSummary {
  const done = rows.filter((r) => r.status === 'done').length;
  const stars = rows.reduce((sum, r) => sum + r.stars, 0);
  const next = rows.find((r) => r.status === 'next') ?? null;
  const nextLine = !next
    ? 'Every module flown'
    : done === 0
      ? `Start with Module ${next.n}`
      : `Next: Module ${next.n}, ${next.title}`;
  return {
    done,
    stars,
    total: rows.length,
    maxStars: rows.length * 3,
    next,
    line: `${done} of ${rows.length} modules · ★ ${stars} of ${rows.length * 3}`,
    nextLine,
  };
}

/** The block the list opens on: the one holding the next module, else the last. */
export function openingBlock(rows: readonly ModuleRow[]): number {
  const next = rows.find((r) => r.status === 'next');
  const n = next?.n ?? rows.length;
  return BLOCKS.indexOf(blockOf(n));
}

// ---- Numbers -----------------------------------------------------------------

/** "12.4 s". */
export function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`;
}

/** "0:48" — minutes and seconds, whole seconds. */
export function formatClock(s: number): string {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** "0:05 / 0:16" for the demonstration strip. */
export function demoClockText(lesson: Lesson, playedSec: number): string {
  const total = Math.round(demoLength(lesson.demo));
  return `${formatClock(Math.min(playedSec, total))} / ${formatClock(total)}`;
}

/** "Module 2 of 15 · Ground Handling · about 15 seconds". */
export function learnMeta(n: number, total: number, lesson: Lesson): string {
  const parts = [`Module ${n} of ${total}`, blockOf(n).name];
  if (lesson.explain.durationHint) parts.push(`about ${lesson.explain.durationHint}`);
  return parts.join(' · ');
}

// ---- Star tiers --------------------------------------------------------------

export interface Tier {
  stars: 1 | 2 | 3;
  text: string;
  /** The attempt time this tier allows, or null when it sets none. */
  within: number | null;
}

/** The one-star rung every lesson shares: finishing is worth a star. */
export const FINISH_TIER_TEXT = 'Finish the module. A crash keeps you here.';

/** The lesson's rubric as three tiers, one star first. */
export function tiersFor(rules: readonly StarRule[]): Tier[] {
  const byStars = (n: 2 | 3) => rules.find((r) => r.stars === n);
  const tiers: Tier[] = [{ stars: 1, text: FINISH_TIER_TEXT, within: null }];
  for (const n of [2, 3] as const) {
    const r = byStars(n);
    if (r) tiers.push({ stars: n, text: r.text, within: r.within ?? null });
  }
  return tiers;
}

/** The tiers with a time limit, fastest last — the marks on the Fly bar. */
export function timedTiers(tiers: readonly Tier[]): Tier[] {
  return tiers.filter((t) => t.within !== null);
}

/**
 * The Fly bar's line. The limits are time budgets — faster is better — and a
 * tier's other conditions (the line held, nothing touched) are only known at the
 * end, so it says "on time for", never "on track for".
 */
export function onTimeLine(tiers: readonly Tier[], elapsed: number): string {
  const timed = timedTiers(tiers).sort((a, b) => b.stars - a.stars);
  if (timed.length === 0) {
    const top = tiers[tiers.length - 1];
    return `${top.stars} stars: ${top.text}`;
  }
  const inTime = timed.find((t) => elapsed <= (t.within as number));
  if (!inTime) {
    return `Past every star time · finishing still earns 1 star`;
  }
  return `On time for ${inTime.stars} stars · ${inTime.stars} stars by ${formatSeconds(
    inTime.within as number,
  )}`;
}

/** The Fly bar's line: nothing to be on time for until the clock has started. */
export function flyLine(tiers: readonly Tier[], state: ClockState, flightSec: number): string {
  if (state === 'waiting') return 'Timer starts when you take off';
  return onTimeLine(tiers, flightSec);
}

/** The Fly bar's status chip: glyph + word + tone, never colour alone. */
export function clockStatus(
  state: ClockState,
  armed: boolean,
  crashed: boolean,
): { tone: Tone; icon: IconName; text: string } {
  if (crashed) return { tone: 'fail', icon: 'cross', text: 'Crashed' };
  if (state === 'paused')
    return { tone: 'caution', icon: 'warning', text: 'Outside the box · paused' };
  if (state === 'running') return { tone: 'armed', icon: 'dot', text: 'In box · timing' };
  return armed
    ? { tone: 'armed', icon: 'dot', text: 'Armed · on the pad' }
    : { tone: 'neutral', icon: 'ring', text: 'Not armed' };
}

export type TierState = 'earned' | 'result' | 'missed';

export interface TierRow extends Tier {
  state: TierState;
  /** "Earned" / "Your result" / "25.2 s over" / "Not reached". */
  note: string;
}

export function resultTiers(tiers: readonly Tier[], earned: number, timeSec: number): TierRow[] {
  return tiers.map((t) => {
    if (t.stars === earned) return { ...t, state: 'result', note: 'Your result' };
    if (t.stars < earned) return { ...t, state: 'earned', note: 'Earned' };
    const over = t.within !== null && timeSec > t.within ? timeSec - t.within : 0;
    return {
      ...t,
      state: 'missed',
      note: over > 0 ? `${formatSeconds(over)} over` : 'Not reached',
    };
  });
}

/** The one line under the tiers that says what the next star takes. */
export function gapLine(tiers: readonly Tier[], earned: number, timeSec: number): string {
  const next = tiers.find((t) => t.stars === earned + 1);
  if (!next) return 'Every star earned. Replay it to beat your time.';
  if (next.within !== null && timeSec > next.within) {
    const over = timeSec - next.within;
    return `${formatSeconds(timeSec)} — ${next.stars} stars needs ${formatSeconds(
      next.within,
    )} or less. Fly it ${formatSeconds(over)} faster.`;
  }
  return `${next.stars} stars needs: ${next.text}.`;
}

/** The personal-best line. Faster is better. */
export function personalBestLine(
  before: number | null,
  timeSec: number,
): { isNew: boolean; text: string } {
  if (before === null)
    return { isNew: true, text: `First time flown. Best time ${formatSeconds(timeSec)}.` };
  if (timeSec < before) {
    return {
      isNew: true,
      text: `New personal best. ${formatSeconds(timeSec)}, down from ${formatSeconds(before)}.`,
    };
  }
  return {
    isNew: false,
    text: `Best time ${formatSeconds(before)}. This go ${formatSeconds(timeSec)}.`,
  };
}

/** "Your best: 41.2 s · 2 of 3" on the Learn card, or null before a first pass. */
export function yourBestText(p: LessonProgress | undefined): string | null {
  if (!p?.completed) return null;
  const time = p.bestTimeSec !== undefined ? `${formatSeconds(p.bestTimeSec)} · ` : '';
  return `Your best: ${time}${p.stars} of 3`;
}

// ---- Step band ---------------------------------------------------------------

export const BAND_STEPS: readonly { phase: TrainingPhase; label: string }[] = [
  { phase: 'intro', label: 'Learn' },
  { phase: 'demo', label: 'Demo' },
  { phase: 'practice', label: 'Fly' },
  { phase: 'reward', label: 'Done' },
];

export type StepState = 'done' | 'now' | 'todo';

/** ✓ done, ● current, a number for steps to come. Done is ticked once reached. */
export function bandStates(phase: TrainingPhase): StepState[] {
  const at = BAND_STEPS.findIndex((s) => s.phase === phase);
  return BAND_STEPS.map((_, i) =>
    i < at || (phase === 'reward' && i === at) ? 'done' : i === at ? 'now' : 'todo',
  );
}

/** The register the band and the screen under it wear. */
export function registerFor(phase: TrainingPhase): 'classroom' | 'cockpit' {
  return phase === 'demo' || phase === 'practice' ? 'cockpit' : 'classroom';
}

/** Which step chips the demo strip shows: all of a short lesson, a window of
 *  `max` around the live one on a long route. */
export function chipWindow(count: number, index: number, max = 4): [number, number] {
  if (count <= max) return [0, count];
  const live = Math.min(Math.max(index, 0), count - 1);
  const start = Math.max(0, Math.min(live - 1, count - max));
  return [start, start + max];
}

/** "STEP 2 OF 3 · TAKE OFF" — clamped, so the all-done cursor reads the last step. */
export function stepHeading(labels: readonly string[], index: number): string | null {
  if (labels.length === 0) return null;
  const i = Math.min(Math.max(index, 0), labels.length - 1);
  return `Step ${i + 1} of ${labels.length} · ${labels[i]}`;
}
