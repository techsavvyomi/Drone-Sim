import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS } from '../src/renderer/training/lessons';
import { isLessonUnlocked, useTrainingStore } from '../src/renderer/state/trainingStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { usePilotStore } from '../src/renderer/state/pilotStore';
import { DEFAULT_SETTINGS } from '../src/shared/types';

// Flight School progression: what unlocks what, what a replay is worth, and the
// rule that a worse run can never take away a result already earned.
//
// The live lesson state is in trainingStore; the RECORD is in settings, which is
// why both stores appear here.

const first = LESSONS[0];
const second = LESSONS[1];

function progressFor(lessonId: string) {
  return useSettingsStore.getState().settings.training.lessons[lessonId];
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, training: { xp: 0, lessons: {} } },
    hydrated: true,
  });
  usePilotStore.getState().syncFromTotal(0);
  useTrainingStore.getState().start(first.id);
});

describe('unlocking', () => {
  it('TC-129 only the first module is open on a fresh profile', () => {
    expect(isLessonUnlocked(first.id)).toBe(true);

    for (const lesson of LESSONS.slice(1)) {
      expect(isLessonUnlocked(lesson.id)).toBe(false);
    }
  });

  it('TC-131 completing a module opens the next one, and only the next one', () => {
    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    expect(isLessonUnlocked(second.id)).toBe(true);
    if (LESSONS[2]) expect(isLessonUnlocked(LESSONS[2].id)).toBe(false);
  });

  it('TC-130 a module stays locked while the one before it is unfinished', () => {
    // Completing something further down the list must not open a gap.
    useTrainingStore.getState().completeLesson(second.id, 3, 100, 12);

    expect(isLessonUnlocked(LESSONS[2].id)).toBe(true);
    // ...but the one after the untouched first lesson is still governed by it.
    expect(isLessonUnlocked(second.id)).toBe(false);
  });
});

describe('results and XP', () => {
  it('TC-131 a completed module is recorded with its stars', () => {
    useTrainingStore.getState().completeLesson(first.id, 2, 80, 20);

    expect(progressFor(first.id)).toMatchObject({ completed: true, stars: 2, bestScore: 80 });
  });

  it('TC-155 the first completion pays the full award', () => {
    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    // 60 base plus 40 a star.
    expect(useTrainingStore.getState().lastXp).toBe(180);
    expect(usePilotStore.getState().totalXp).toBe(180);
  });

  it('TC-157 a replay at the same standard pays nothing', () => {
    useTrainingStore.getState().completeLesson(first.id, 2, 80, 20);
    const after = usePilotStore.getState().totalXp;

    useTrainingStore.getState().completeLesson(first.id, 2, 80, 19);

    expect(useTrainingStore.getState().lastXp).toBe(0);
    expect(usePilotStore.getState().totalXp).toBe(after);
  });

  it('TC-157 a better replay pays only for the improvement', () => {
    useTrainingStore.getState().completeLesson(first.id, 1, 40, 30);
    const after = usePilotStore.getState().totalXp;

    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    // Two more stars at 40 each, not the base award again.
    expect(useTrainingStore.getState().lastXp).toBe(80);
    expect(usePilotStore.getState().totalXp).toBe(after + 80);
  });

  it('TC-132 a worse replay never lowers the recorded stars', () => {
    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    useTrainingStore.getState().completeLesson(first.id, 1, 30, 40);

    expect(progressFor(first.id).stars).toBe(3);
    expect(progressFor(first.id).bestScore).toBe(100);
  });

  it('TC-134 the record is written through settings, so it survives a restart', () => {
    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    const saved = useSettingsStore.getState().settings.training;
    expect(saved.lessons[first.id].completed).toBe(true);
    expect(saved.xp).toBe(usePilotStore.getState().totalXp);
  });

  it('TC-156 a completion that crosses a rank threshold reports the rank up', () => {
    usePilotStore.getState().syncFromTotal(480);

    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    expect(useTrainingStore.getState().lastRankUp).toBe('Cadet');
  });

  it('TC-153 a completion moves to the reward phase and keeps the time flown', () => {
    useTrainingStore.getState().completeLesson(first.id, 2, 80, 17.4);

    const t = useTrainingStore.getState();
    expect(t.phase).toBe('reward');
    expect(t.lastStars).toBe(2);
    expect(t.lastTimeSec).toBeCloseTo(17.4);
  });

  it('TC-162 leaving a lesson clears the live state but not the record', () => {
    useTrainingStore.getState().completeLesson(first.id, 3, 100, 12);

    useTrainingStore.getState().exitLesson();

    expect(useTrainingStore.getState().activeLessonId).toBeNull();
    expect(progressFor(first.id).completed).toBe(true);
  });
});
