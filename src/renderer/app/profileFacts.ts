import type { SessionSummary, UserDashboard } from '@shared/backend/contract';
import type { IconName, Tone } from '../ds';

// The Profile page's figures, worked out apart from the page so they can be
// tested. Every value comes with a number or a word; colour only repeats it.

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A flight's length as a clock: 3:12, 1:05:40. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "2 Sep": day and short month, the same on every system locale. */
export function dayMonth(d: Date): string {
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
}

/** "Today 10:42", "Yesterday 14:05", "28 Sep 14:05". */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${dayMonth(d)} ${time}`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export interface ResultMark {
  tone: Tone;
  icon: IconName;
  word: string;
}

/** ✓ Passed / ▲ Not passed / ✕ Crashed, and the free-flight and syncing cases. */
export function sessionResult(s: Pick<SessionSummary, 'flightType' | 'result' | 'crashCount'>): ResultMark {
  if (s.result === 'IN_PROGRESS') return { tone: 'neutral', icon: 'ring', word: 'Syncing' };
  // A lesson or mission passed despite a knock counts as passed; a free flight
  // has no pass, so any crash is its result.
  if (s.crashCount > 0 && (s.flightType === 'FREE_FLIGHT' || s.result !== 'SUCCESS')) {
    return { tone: 'fail', icon: 'cross', word: s.crashCount === 1 ? 'Crashed' : `Crashed ${s.crashCount} times` };
  }
  if (s.flightType === 'FREE_FLIGHT') return { tone: 'armed', icon: 'check', word: 'Flown' };
  if (s.result === 'SUCCESS') return { tone: 'armed', icon: 'check', word: 'Passed' };
  if (s.result === 'ABORTED') return { tone: 'caution', icon: 'warning', word: 'Stopped early' };
  return { tone: 'caution', icon: 'warning', word: 'Not passed' };
}

export function sessionTitle(s: SessionSummary): string {
  if (s.flightType === 'MISSION') return s.missionName || s.missionId;
  if (s.flightType === 'TRAINING') return s.trainingName || s.trainingId;
  return 'Free flight';
}

export const TYPE_LABEL: Record<SessionSummary['flightType'], string> = {
  MISSION: 'Mission',
  TRAINING: 'Lesson',
  FREE_FLIGHT: 'Free flight',
};

/**
 * The longest free flight among the sessions given, in seconds, or null when
 * there is none. Measured as the history table's Time column (the session's
 * duration), so the two agree. Sessions still syncing are left out.
 */
export function longestFreeFlight(
  sessions: readonly Pick<SessionSummary, 'flightType' | 'result' | 'duration'>[],
): number | null {
  let best: number | null = null;
  for (const s of sessions) {
    if (s.flightType !== 'FREE_FLIGHT' || s.result === 'IN_PROGRESS') continue;
    if (best === null || s.duration > best) best = s.duration;
  }
  return best;
}

export interface ProgressCounts {
  /** Best stars summed over the lessons, out of 3 per lesson. */
  stars: number;
  starsOf: number;
  lessons: number;
  lessonsOf: number;
  missions: number;
  missionsOf: number;
}

/**
 * Counted from the dashboard: a mission counts once however often it was
 * completed. The totals are the game's own (15 lessons, 10 missions): the
 * backend's catalogue sheet can lag behind the game — on 2026-09-29 it still
 * listed 6 missions.
 */
export function progressCounts(
  dash: Pick<UserDashboard, 'training' | 'missions'>,
  game: { lessons: number; missions: number },
): ProgressCounts {
  const modules = dash.training.modules;
  return {
    stars: modules.reduce((sum, m) => sum + (m.completed ? m.bestStars : 0), 0),
    starsOf: game.lessons * 3,
    lessons: dash.training.completed,
    lessonsOf: game.lessons,
    missions: dash.missions.filter((m) => m.completed > 0).length,
    missionsOf: game.missions,
  };
}
