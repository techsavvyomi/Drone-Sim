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
        [mission('MISSION-001', { bestStars: 3, bestTimeSec: 120 })],
        [lesson('TRAINING-001', { bestTimeSec: 40 })],
      ),
    );
    expect(out?.missions.missions['precision-delivery']).toEqual({
      completed: true,
      stars: 3,
      bestPoints: 80,
      bestTimeSec: 120,
    });
    expect(out?.training.lessons['arm-takeoff']).toMatchObject({
      completed: true,
      stars: 2,
      bestTimeSec: 40,
    });
    expect(out?.training.lessons['arm-takeoff'].bestScore).toBeCloseTo(2 / 3);
  });

  it('stores progress under the slug the screens read, not the catalog id', () => {
    const out = mergedProgress(empty(), dash([mission('MISSION-010')], [lesson('TRAINING-015')]));
    expect(Object.keys(out?.missions.missions ?? {})).toEqual(['supermarket-stock-check']);
    expect(Object.keys(out?.training.lessons ?? {})).toEqual(['nav-abcd']);
  });

  it('skips a catalog row the game does not have', () => {
    expect(mergedProgress(empty(), dash([mission('MISSION-999')]))).toBeNull();
  });

  it('a mission or lesson never finished stays unfinished', () => {
    expect(
      mergedProgress(
        empty(),
        dash(
          [mission('MISSION-001', { completed: 0 })],
          [lesson('TRAINING-001', { completed: false })],
        ),
      ),
    ).toBeNull();
  });

  it('works on a backend that sends no stars or time', () => {
    const out = mergedProgress(empty(), dash([mission('MISSION-001')]));
    expect(out?.missions.missions['precision-delivery']).toEqual({
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
        missions: {
          'precision-delivery': { completed: true, stars: 3, bestPoints: 100, bestTimeSec: 90 },
        },
      },
    };
    const out = mergedProgress(
      local,
      dash([mission('MISSION-001', { bestStars: 1, bestScore: 10, bestTimeSec: 300 })]),
    );
    expect(out).toBeNull();
  });

  it('keeps the better of each value', () => {
    const local = {
      ...empty(),
      missions: {
        missions: {
          'precision-delivery': { completed: true, stars: 3, bestPoints: 10, bestTimeSec: 300 },
        },
      },
    };
    const out = mergedProgress(
      local,
      dash([mission('MISSION-001', { bestStars: 1, bestScore: 80, bestTimeSec: 90 })]),
    );
    expect(out?.missions.missions['precision-delivery']).toEqual({
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
      data: dash([mission('MISSION-001')]),
    } as never);
    await syncProgress();
    expect(
      useSettingsStore.getState().settings.missions.missions['precision-delivery']?.completed,
    ).toBe(true);
  });

  it('waits for settings to load, so they are not overwritten', async () => {
    useSettingsStore.setState({ hydrated: false });
    vi.spyOn(UserService, 'dashboard').mockResolvedValue({
      success: true,
      data: dash([mission('MISSION-001')]),
    } as never);
    const running = syncProgress();
    await new Promise((r) => setTimeout(r, 0));
    expect(
      useSettingsStore.getState().settings.missions.missions['precision-delivery'],
    ).toBeUndefined();
    useSettingsStore.setState({ hydrated: true });
    await running;
    expect(
      useSettingsStore.getState().settings.missions.missions['precision-delivery']?.completed,
    ).toBe(true);
  });

  it('changes nothing when offline', async () => {
    vi.spyOn(UserService, 'dashboard').mockRejectedValue(new Error('offline'));
    await syncProgress();
    expect(useSettingsStore.getState().settings.missions.missions).toEqual({});
  });
});
