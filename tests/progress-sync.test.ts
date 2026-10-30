import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { UserDashboard } from '@shared/backend/contract';
import { mergedProgress, syncProgress } from '../src/renderer/state/progressSync';
import { UserService } from '../src/renderer/services/userService';
import { useSettingsStore } from '../src/renderer/state/settingsStore';

const mission = (missionId: string, over = {}) => ({
  missionId,
  missionName: missionId,
  attempts: 1,
  sessions: 1,
  completed: 1,
  bestScore: 80,
  ...over,
});
const lesson = (trainingId: string, over = {}) => ({
  trainingId,
  trainingName: trainingId,
  order: 1,
  sessions: 1,
  completed: true,
  bestStars: 2,
  ...over,
});
const dash = (missions: object[], modules: object[] = []) =>
  ({ missions, training: { completed: 0, total: 0, modules } }) as unknown as UserDashboard;
const empty = () => ({ missions: DEFAULT_SETTINGS.missions, training: DEFAULT_SETTINGS.training });

describe('progress from the account', () => {
  it('a new computer gets what the account completed', () => {
    const out = mergedProgress(
      empty(),
      dash(
        [mission('a', { bestStars: 3, bestTimeSec: 120 })],
        [lesson('hover', { bestTimeSec: 40 })],
      ),
    );
    expect(out?.missions.missions.a).toEqual({
      completed: true,
      stars: 3,
      bestPoints: 80,
      bestTimeSec: 120,
    });
    expect(out?.training.lessons.hover).toMatchObject({
      completed: true,
      stars: 2,
      bestTimeSec: 40,
    });
    expect(out?.training.lessons.hover.bestScore).toBeCloseTo(2 / 3);
  });

  it('a mission or lesson never finished stays unfinished', () => {
    expect(
      mergedProgress(
        empty(),
        dash([mission('a', { completed: 0 })], [lesson('hover', { completed: false })]),
      ),
    ).toBeNull();
  });

  it('works on a backend that sends no stars or time', () => {
    const out = mergedProgress(empty(), dash([mission('a')]));
    expect(out?.missions.missions.a).toEqual({
      completed: true,
      stars: 0,
      bestPoints: 80,
      bestTimeSec: 0,
    });
  });

  it('never lowers what this computer already has', () => {
    const local = {
      ...empty(),
      missions: {
        missions: { a: { completed: true, stars: 3, bestPoints: 100, bestTimeSec: 90 } },
      },
    };
    const out = mergedProgress(
      local,
      dash([mission('a', { bestStars: 1, bestScore: 10, bestTimeSec: 300 })]),
    );
    expect(out).toBeNull();
  });

  it('keeps the better of each value', () => {
    const local = {
      ...empty(),
      missions: {
        missions: { a: { completed: true, stars: 3, bestPoints: 10, bestTimeSec: 300 } },
      },
    };
    const out = mergedProgress(
      local,
      dash([mission('a', { bestStars: 1, bestScore: 80, bestTimeSec: 90 })]),
    );
    expect(out?.missions.missions.a).toEqual({
      completed: true,
      stars: 3,
      bestPoints: 80,
      bestTimeSec: 90,
    });
  });
});

describe('syncProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), hydrated: true });
  });

  it('writes the account progress into settings', async () => {
    vi.spyOn(UserService, 'dashboard').mockResolvedValue({
      success: true,
      data: dash([mission('a')]),
    } as never);
    await syncProgress();
    expect(useSettingsStore.getState().settings.missions.missions.a?.completed).toBe(true);
  });

  it('waits for settings to load, so they are not overwritten', async () => {
    useSettingsStore.setState({ hydrated: false });
    vi.spyOn(UserService, 'dashboard').mockResolvedValue({
      success: true,
      data: dash([mission('a')]),
    } as never);
    const running = syncProgress();
    await new Promise((r) => setTimeout(r, 0));
    expect(useSettingsStore.getState().settings.missions.missions.a).toBeUndefined();
    useSettingsStore.setState({ hydrated: true });
    await running;
    expect(useSettingsStore.getState().settings.missions.missions.a?.completed).toBe(true);
  });

  it('changes nothing when offline', async () => {
    vi.spyOn(UserService, 'dashboard').mockRejectedValue(new Error('offline'));
    await syncProgress();
    expect(useSettingsStore.getState().settings.missions.missions).toEqual({});
  });
});
