import { create } from 'zustand';
import type { TrainingProgress } from '@shared/types';
import { useSettingsStore } from './settingsStore';
import { usePilotStore } from './pilotStore';
import { LESSONS } from '../training/lessons';

// Runtime state for a Flight School session. The *persistent* record of what has
// been completed lives in settings.training (settingsStore); this store holds
// only the live UI state of the lesson currently being run, and writes results
// back through settingsStore so they survive a restart.

export type TrainingPhase = 'intro' | 'demo' | 'practice' | 'reward';

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
  /** Key currently being "pressed" by the demo, for the keycap highlight. */
  demoKey: string | null;
  /** Contextual guidance during practice (step 3/4). */
  hint: string;
  validation: Validation;
  /** Result shown on the reward panel (step 5). */
  lastStars: number;
  lastXp: number;

  start: (lessonId: string) => void;
  setPhase: (phase: TrainingPhase) => void;
  setDemoCaption: (caption: string) => void;
  setDemoRound: (round: number) => void;
  setDemoKey: (key: string | null) => void;
  setHint: (hint: string) => void;
  setValidation: (v: Validation) => void;
  /** Persist a completed lesson, award XP, and move to the reward phase. */
  completeLesson: (lessonId: string, stars: number, score: number) => void;
  /** Leave the current lesson and return to the lesson list. */
  exitLesson: () => void;
}

export const useTrainingStore = create<TrainingState>((set) => ({
  activeLessonId: null,
  phase: 'intro',
  demoCaption: '',
  demoRound: 1,
  demoRounds: 3,
  demoKey: null,
  hint: '',
  validation: { progress: 0, failed: false },
  lastStars: 0,
  lastXp: 0,

  start: (lessonId) =>
    set({
      activeLessonId: lessonId,
      phase: 'intro',
      demoCaption: '',
      demoRound: 1,
      demoKey: null,
      hint: '',
      validation: { progress: 0, failed: false },
      lastStars: 0,
      lastXp: 0,
    }),

  setPhase: (phase) => set({ phase }),
  setDemoCaption: (demoCaption) => set({ demoCaption }),
  setDemoRound: (demoRound) => set({ demoRound }),
  setDemoKey: (demoKey) => set({ demoKey }),
  setHint: (hint) => set({ hint }),
  setValidation: (validation) => set({ validation }),

  completeLesson: (lessonId, stars, score) => {
    const settings = useSettingsStore.getState();
    const training = settings.settings.training;
    const prev = training.lessons[lessonId];

    const firstTime = !prev?.completed;
    const prevStars = prev?.stars ?? 0;
    const bestStars = Math.max(prevStars, stars);
    const bestScore = Math.max(prev?.bestScore ?? 0, score);

    // Full award the first time; on a replay only pay for the improvement.
    const xpGained = firstTime
      ? XP_BASE + stars * XP_PER_STAR
      : Math.max(0, stars - prevStars) * XP_PER_STAR;

    const newTotal = usePilotStore.getState().addXp(xpGained);

    const nextTraining: TrainingProgress = {
      xp: newTotal,
      lessons: {
        ...training.lessons,
        [lessonId]: { completed: true, stars: bestStars, bestScore },
      },
    };
    // Fire-and-forget persistence through the settings document.
    settings.set('training', nextTraining);

    set({ phase: 'reward', lastStars: stars, lastXp: xpGained });
  },

  exitLesson: () =>
    set({ activeLessonId: null, phase: 'intro', demoCaption: '', hint: '' }),
}));

// ---- Derived selectors (progress lives in settings) -------------------------

/** True if a lesson can be opened: the first lesson, or the prior one is done. */
export function isLessonUnlocked(lessonId: string): boolean {
  const i = LESSONS.findIndex((l) => l.id === lessonId);
  if (i <= 0) return true;
  const prev = LESSONS[i - 1];
  return !!useSettingsStore.getState().settings.training.lessons[prev.id]?.completed;
}
