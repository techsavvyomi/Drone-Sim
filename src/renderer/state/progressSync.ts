import type { UserDashboard } from '@shared/backend/contract';
import type { AppSettings, MissionProgress, TrainingProgress } from '@shared/types';
import { MISSION_IDS, TRAINING_IDS } from '../services/catalog';
import { UserService } from '../services/userService';
import { useSettingsStore } from './settingsStore';

// What a pilot has completed lives in settings.json, which belongs to the
// computer. Their flights live on the backend, which belongs to the account, so
// a second computer learns the progress from there. Progress only ever goes up:
// anything better on this computer stays.

type Progress = Pick<AppSettings, 'missions' | 'training'>;

/** The backend names things by catalog id; settings key them by the game's own slug. */
const slugsOf = (ids: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(ids).map(([slug, id]) => [id, slug]));
const MISSION_SLUGS = slugsOf(MISSION_IDS);
const LESSON_SLUGS = slugsOf(TRAINING_IDS);

/** The faster of two best times, where 0 or undefined means no time on record. */
function faster(a: number | undefined, b: number | undefined): number {
  if (!a) return b ?? 0;
  return b ? Math.min(a, b) : a;
}

/** This computer's progress with the account's on top, or null when nothing is new. */
export function mergedProgress(local: Progress, dash: UserDashboard): Progress | null {
  const missions: MissionProgress['missions'] = { ...local.missions.missions };
  const lessons: TrainingProgress['lessons'] = { ...local.training.lessons };
  let changed = false;

  for (const m of dash.missions) {
    const slug = MISSION_SLUGS[m.missionId];
    if (!slug || m.completed <= 0) continue;
    const prev = missions[slug];
    const next = {
      completed: true,
      stars: Math.max(prev?.stars ?? 0, m.bestStars ?? 0),
      bestPoints: Math.max(prev?.bestPoints ?? 0, m.bestScore),
      bestTimeSec: faster(prev?.bestTimeSec, m.bestTimeSec),
    };
    if (
      prev?.completed &&
      prev.stars === next.stars &&
      prev.bestPoints === next.bestPoints &&
      prev.bestTimeSec === next.bestTimeSec
    )
      continue;
    missions[slug] = next;
    changed = true;
  }

  for (const t of dash.training.modules) {
    const slug = LESSON_SLUGS[t.trainingId];
    if (!slug || !t.completed) continue;
    const prev = lessons[slug];
    const stars = Math.max(prev?.stars ?? 0, t.bestStars);
    const time = faster(prev?.bestTimeSec, t.bestTimeSec);
    if (prev?.completed && prev.stars === stars && (prev.bestTimeSec ?? 0) === time) continue;
    lessons[slug] = {
      completed: true,
      stars,
      bestScore: Math.max(prev?.bestScore ?? 0, stars / 3),
      ...(time ? { bestTimeSec: time } : {}),
    };
    changed = true;
  }

  if (!changed) return null;
  return { missions: { ...local.missions, missions }, training: { ...local.training, lessons } };
}

/** Settings are read from disk at boot; writing before that would wipe them. */
function hydrated(): Promise<void> {
  return new Promise((resolve) => {
    if (useSettingsStore.getState().hydrated) return resolve();
    const off = useSettingsStore.subscribe((s) => {
      if (!s.hydrated) return;
      off();
      resolve();
    });
  });
}

/** Bring the account's progress to this computer. Offline it is simply skipped. */
export async function syncProgress(): Promise<void> {
  try {
    const res = await UserService.dashboard({ recentLimit: 1, days: 1 });
    if (!res.success || !res.data) return;
    await hydrated();
    // Read after the wait: a mission may have finished in the meantime.
    const store = useSettingsStore.getState();
    const merged = mergedProgress(store.settings, res.data);
    if (!merged) return;
    store.set('missions', merged.missions);
    store.set('training', merged.training);
  } catch {
    // Progress catches up at the next sign-in or launch.
  }
}
