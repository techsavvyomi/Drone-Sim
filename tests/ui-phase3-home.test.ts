import { describe, expect, it } from 'vitest';
import type { MissionProgress, TrainingProgress } from '@shared/types';
import { LESSONS } from '../src/renderer/training/lessons';
import { MISSIONS } from '../src/renderer/missions';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { handlingLine, homeDroneFacts, homePlan } from '../src/renderer/app/homeFacts';
import { formatMass } from '../src/renderer/app/loadout';

// Phase 3 — Home, against the real curriculum rather than the home-screen
// suite's three-lesson stand-ins: walk every pilot from a first run to having
// flown everything, and hold the brief's rules at each step — one signal row,
// every row leads somewhere real, every line is a fact.

const ENV: Record<string, string> = {
  'new-york': 'New York City',
  forest: 'Forest',
  'construction-site': 'Construction Site',
  supermarket: 'Supermarket',
};

function plan(lessonsDone: number, missionsDone: number, pilotName: string | null = null) {
  const training: TrainingProgress = {
    xp: 0,
    lessons: Object.fromEntries(
      LESSONS.slice(0, lessonsDone).map((l) => [l.id, { completed: true, stars: 2, bestScore: 0.7 }]),
    ),
  };
  const missionProgress: MissionProgress = {
    missions: Object.fromEntries(
      MISSIONS.slice(0, missionsDone).map((m) => [
        m.id,
        { completed: true, stars: 1, bestPoints: 1, bestTimeSec: 100 },
      ]),
    ),
  };
  return homePlan({
    lessons: LESSONS,
    missions: MISSIONS,
    training,
    missionProgress,
    pilotName,
    envName: (id) => ENV[id],
  });
}

describe('Home over the whole journey', () => {
  const states: [number, number][] = [];
  for (let l = 0; l <= LESSONS.length; l += 1) states.push([l, 0]);
  for (let m = 1; m <= MISSIONS.length; m += 1) states.push([LESSONS.length, m]);
  states.push([3, 2]);

  it.each(states)('%i lessons, %i missions: one signal row, and every row goes somewhere real', (l, m) => {
    const p = plan(l, m, 'Asha Kulkarni');
    expect(p.rows.filter((r) => r.primary)).toHaveLength(1);
    for (const r of p.rows) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.line.length).toBeGreaterThan(0);
      const t = r.target;
      if (t.kind === 'lesson') expect(LESSONS.some((x) => x.id === t.id)).toBe(true);
      if (t.kind === 'mission') expect(MISSIONS.some((x) => x.id === t.id)).toBe(true);
    }
    // No row twice.
    expect(new Set(p.rows.map((r) => r.id)).size).toBe(p.rows.length);
  });

  it('first run is only the untouched pilot; it points at Training', () => {
    const first = plan(0, 0);
    expect(first.firstRun).toBe(true);
    expect(first.rows.find((r) => r.primary)!.id).toBe('training');
    expect(plan(1, 0).firstRun).toBe(false);
  });

  it('Continue always names the next unfinished module, in order', () => {
    for (let l = 1; l < LESSONS.length; l += 1) {
      const c = plan(l, 0).rows.find((r) => r.id === 'continue')!;
      expect(c.target).toEqual({ kind: 'lesson', id: LESSONS[l].id });
      expect(c.title).toContain(LESSONS[l].title);
    }
  });

  it('once every module is done, Continue walks the missions in order', () => {
    for (let m = 0; m < MISSIONS.length; m += 1) {
      const c = plan(LESSONS.length, m).rows.find((r) => r.id === 'continue')!;
      expect(c.target).toEqual({ kind: 'mission', id: MISSIONS[m].id });
    }
  });

  it('a signed-in name is welcomed by first name only', () => {
    expect(plan(2, 0, 'Asha Kulkarni').heading).toContain('Asha');
    expect(plan(2, 0, 'Asha Kulkarni').heading).not.toContain('Kulkarni');
  });
});

describe('the spec column', () => {
  it.each([plutoDrone, guruDrone, racingDrone])('$name: mass, motors, props, battery — all from the plugin', (d) => {
    const f = homeDroneFacts(d);
    expect(f.map((x) => x.label)).toEqual(['Mass', 'Motors', 'Props', 'Battery']);
    expect(f[0].value).toBe(formatMass(d.mass));
    expect(f[1].value).toMatch(new RegExp(`^${d.motors.length}`));
    expect(f[2].value).toMatch(/^\d+ mm, \d-blade$/);
    expect(f[3].value).toContain(`${d.battery.cells}S`);
    expect(handlingLine(d).startsWith(`${formatMass(d.mass)}. Tilts `)).toBe(true);
    expect(handlingLine(d)).toContain(`${d.maxSpeed} m/s`);
  });
});
