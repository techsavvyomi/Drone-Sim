import { create } from 'zustand';
import type { TrainingProgress } from '@shared/types';
import { useSettingsStore } from './settingsStore';
import { usePilotStore } from './pilotStore';
import { LESSONS } from '../training/lessons';
import type { ClockState } from '../training/flightClock';

// Runtime state for a Flight School session. The *persistent* record of what has
// been completed lives in settings.training (settingsStore); this store holds
// only the live UI state of the lesson currently being run, and writes results
// back through settingsStore so they survive a restart.

export type TrainingPhase = 'intro' | 'demo' | 'practice' | 'reward';

/** Seconds the result card counts down before opening the next module. The
 *  Director owns the clock; the card prints `advanceIn`. */
export const AUTO_ADVANCE_SEC = 10;

/** XP awarded the first time a lesson is cleared, plus a per-star bonus. */
const XP_BASE = 60;
const XP_PER_STAR = 40;

interface Validation {
  progress: number;
  failed: boolean;
}

interface TrainingState {
  /** The lesson being run, or null when browsing the lesson list. */
  activeLessonId: string | null;
  phase: TrainingPhase;
  /** Caption under the demo banner (step 2). */
  demoCaption: string;
  /** Which demonstration pass is playing (1-based) and how many in total. */
  demoRound: number;
  demoRounds: number;
  /** Keys the demo is "holding" right now, for the keycap highlight. Derived
   *  from the scripted sticks, so a diagonal lights two caps and a brake lights
   *  the opposite one — the row shows what is being flown, not a cue that was
   *  flashed once at the top of the leg. */
  demoKeys: readonly string[];
  /** How many of the active lesson's checkpoints have been taken. Drives the
   *  route guide's "done / next / still to come" and the HUD's NEXT readout. */
  routeIndex: number;
  /** The control the pilot should be using right now, as KeyboardEvent.codes.
   *  The keycap row breathes these and the sticks glow in the same direction —
   *  see ValidationResult.cue. */
  cue: readonly string[];
  /** Contextual guidance during practice (step 3/4). */
  hint: string;
  validation: Validation;
  /** Seconds into the current attempt. Published at 10 Hz, not per frame. */
  elapsed: number;
  /** Which of the lesson's ROUTE checkpoints is being flown to.
   *
   *  Not the same number as `routeIndex`, which counts the steps on the row —
   *  a whole flight's steps are Arm, Take off, then the flying, so the two
   *  disagree by however many steps come before the route. The map needs the
   *  checkpoint. */
  routeTarget: number;
  /** Result shown on the reward panel (step 5). */
  lastStars: number;
  /** Seconds the completed attempt took. */
  lastTimeSec: number;
  lastXp: number;
  /** New rank name if this completion triggered a rank-up, else null. */
  lastRankUp: string | null;
  /** The personal best BEFORE this attempt, seconds, or null on a first pass
   *  (or a result saved before best times were kept). */
  lastBestBefore: number | null;
  /** The flight clock the stars are judged on, seconds, published at 10 Hz:
   *  from take-off, paused outside the lesson's box (training/flightClock.ts). */
  flightSec: number;
  clockState: ClockState;
  /** Whole seconds the demonstration has played, for "0:05 / 0:16". */
  demoSec: number;
  /** The result card is counting down to the next module. Esc or Cancel turns
   *  it off; the Director only advances while it is on. */
  autoAdvance: boolean;
  /** Whole seconds left on that countdown. */
  advanceIn: number;

  start: (lessonId: string) => void;
  setPhase: (phase: TrainingPhase) => void;
  setDemoCaption: (caption: string) => void;
  setDemoRound: (round: number, rounds?: number) => void;
  setDemoKeys: (keys: readonly string[]) => void;
  setRouteIndex: (index: number) => void;
  setCue: (cue: readonly string[]) => void;
  setHint: (hint: string) => void;
  setValidation: (v: Validation) => void;
  setElapsed: (seconds: number) => void;
  setRouteTarget: (index: number) => void;
  setDemoSec: (seconds: number) => void;
  setFlightClock: (seconds: number, state: ClockState) => void;
  setAdvanceIn: (seconds: number) => void;
  /** Stop the result card's countdown; the pilot stays on the card. */
  cancelAutoAdvance: () => void;
  /** Persist a completed lesson, award XP, and move to the reward phase. */
  completeLesson: (lessonId: string, stars: number, score: number, timeSec: number) => void;
  /** Leave the current lesson and return to the lesson list. */
  exitLesson: () => void;
}

export const useTrainingStore = create<TrainingState>((set) => ({
  activeLessonId: null,
  phase: 'intro',
  demoCaption: '',
  demoRound: 1,
  demoRounds: 3,
  demoKeys: [],
  routeIndex: 0,
  cue: [],
  hint: '',
  validation: { progress: 0, failed: false },
  elapsed: 0,
  routeTarget: 0,
  lastStars: 0,
  lastTimeSec: 0,
  lastXp: 0,
  lastRankUp: null,
  lastBestBefore: null,
  flightSec: 0,
  clockState: 'waiting',
  demoSec: 0,
  autoAdvance: false,
  advanceIn: AUTO_ADVANCE_SEC,

  start: (lessonId) =>
    set({
      activeLessonId: lessonId,
      phase: 'intro',
      demoCaption: '',
      demoRound: 1,
      demoKeys: [],
      routeIndex: 0,
      cue: [],
      hint: '',
      validation: { progress: 0, failed: false },
      elapsed: 0,
      routeTarget: 0,
      lastStars: 0,
      lastTimeSec: 0,
      lastXp: 0,
      lastRankUp: null,
      lastBestBefore: null,
      flightSec: 0,
      clockState: 'waiting',
      demoSec: 0,
      autoAdvance: false,
      advanceIn: AUTO_ADVANCE_SEC,
    }),

  setPhase: (phase) => set({ phase }),
  setDemoCaption: (demoCaption) => set({ demoCaption }),
  setDemoRound: (demoRound, demoRounds) =>
    set(demoRounds ? { demoRound, demoRounds } : { demoRound }),
  setDemoKeys: (demoKeys) => set({ demoKeys }),
  setRouteIndex: (routeIndex) => set({ routeIndex }),
  setCue: (cue) => set({ cue }),
  setHint: (hint) => set({ hint }),
  setValidation: (validation) => set({ validation }),
  setElapsed: (elapsed) => set({ elapsed }),
  setRouteTarget: (routeTarget) => set({ routeTarget }),
  setFlightClock: (flightSec, clockState) =>
    set((s) =>
      s.flightSec === flightSec && s.clockState === clockState ? s : { flightSec, clockState },
    ),
  setDemoSec: (demoSec) => set((s) => (s.demoSec === demoSec ? s : { demoSec })),
  setAdvanceIn: (advanceIn) => set((s) => (s.advanceIn === advanceIn ? s : { advanceIn })),
  cancelAutoAdvance: () => set({ autoAdvance: false }),

  completeLesson: (lessonId, stars, score, timeSec) => {
    const settings = useSettingsStore.getState();
    const training = settings.settings.training;
    const prev = training.lessons[lessonId];

    const firstTime = !prev?.completed;
    const prevStars = prev?.stars ?? 0;
    const bestStars = Math.max(prevStars, stars);
    const bestScore = Math.max(prev?.bestScore ?? 0, score);
    const bestBefore = prev?.bestTimeSec ?? null;
    const bestTimeSec = bestBefore === null ? timeSec : Math.min(bestBefore, timeSec);

    // Full award the first time; on a replay only pay for the improvement.
    const xpGained = firstTime
      ? XP_BASE + stars * XP_PER_STAR
      : Math.max(0, stars - prevStars) * XP_PER_STAR;

    const prevRank = usePilotStore.getState().rank;
    const newTotal = usePilotStore.getState().addXp(xpGained);
    const newRank = usePilotStore.getState().rank;
    const rankedUp = newRank !== prevRank ? newRank : null;

    const nextTraining: TrainingProgress = {
      xp: newTotal,
      lessons: {
        ...training.lessons,
        [lessonId]: { completed: true, stars: bestStars, bestScore, bestTimeSec },
      },
    };
    // Fire-and-forget persistence through the settings document.
    settings.set('training', nextTraining);

    set({
      phase: 'reward',
      lastStars: stars,
      lastXp: xpGained,
      lastRankUp: rankedUp,
      lastTimeSec: timeSec,
      lastBestBefore: bestBefore,
      autoAdvance: true,
      advanceIn: AUTO_ADVANCE_SEC,
    });
  },

  exitLesson: () =>
    set({
      activeLessonId: null,
      phase: 'intro',
      demoCaption: '',
      hint: '',
      cue: [],
      autoAdvance: false,
    }),
}));

// ---- Derived selectors (progress lives in settings) -------------------------

/** True if a lesson can be opened: the first lesson, or the prior one is done. */
export function isLessonUnlocked(lessonId: string): boolean {
  const i = LESSONS.findIndex((l) => l.id === lessonId);
  if (i <= 0) return true;
  const prev = LESSONS[i - 1];
  return !!useSettingsStore.getState().settings.training.lessons[prev.id]?.completed;
}
