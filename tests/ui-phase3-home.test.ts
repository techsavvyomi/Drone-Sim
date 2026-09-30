import { describe, expect, it } from 'vitest';
import type { MissionProgress, TrainingProgress } from '@shared/types';
import { LESSONS } from '../src/renderer/training/lessons';
import { MISSIONS } from '../src/renderer/missions';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { handlingLine, homeDroneFacts, homePlan } from '../src/renderer/app/homeFacts';
import { formatMass } from '../src/renderer/app/loadout';
import { declsFor, stylesheet } from './helpers/css';

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
      expect(c.title).toBe(`Continue: Module\u00a0${l + 1}`);
      expect(c.line).toBe(`${LESSONS[l].title} · ${LESSONS[l].subtitle}.`);
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

// The Continue row clipped its title top and bottom at 1280 × 720: "Continue:
// Module 10 — Square Circuit using Yaw" beside its count took three lines of
// the 290–380 px column, and the row was allowed to shrink below its text.
// Measured over CDP after the fix, with the longest real names, at 1100 × 720,
// 1280 × 720 and 1440 × 900: every row's text inside its row, nothing cut.
// jsdom does no layout, so what is held here is what made that true.
describe('the Continue row fits the column', () => {
  const rows = () => {
    const out: { title: string; line: string }[] = [];
    for (let l = 1; l < LESSONS.length; l += 1) out.push(plan(l, 0).rows[0]);
    for (let m = 0; m < MISSIONS.length; m += 1) out.push(plan(LESSONS.length, m).rows[0]);
    return out;
  };

  it('the title is only "Continue: Module n" / "Mission n", number held to its word', () => {
    const all = rows();
    expect(all).toHaveLength(LESSONS.length - 1 + MISSIONS.length);
    for (const r of all) {
      expect(r.title).toMatch(/^Continue: (Module|Mission)\u00a0\d+$/);
      // Two lines of title beside the count, even at the 290 px minimum column.
      expect(r.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('the name moves to the line: every mission, with its map', () => {
    for (let m = 0; m < MISSIONS.length; m += 1) {
      const c = plan(LESSONS.length, m).rows[0];
      expect(c.line).toBe(`${MISSIONS[m].name} · ${ENV[MISSIONS[m].envId] ?? MISSIONS[m].envId}.`);
    }
  });

  it('a row never shrinks below its text, and its text can never outgrow it', () => {
    const css = stylesheet('home.css');
    const li = declsFor(css, '.home__list > li');
    expect(li.flex).toBe('0 1 132px');
    expect(li['min-height']).toBeUndefined();
    expect(declsFor(css, '.home__mode')['min-height']).toBeUndefined();
    const title = declsFor(css, '.home__mode-title');
    const line = declsFor(css, '.home__mode-line');
    for (const d of [title, line]) {
      expect(d.display).toBe('-webkit-box');
      expect(d.overflow).toBe('hidden');
    }
    expect(title['-webkit-line-clamp']).toBe('2');
    expect(line['-webkit-line-clamp']).toBe('3');
  });

  it('short windows (1280 × 720, 1100 × 720) tighten the rows so four still fit', () => {
    const css = stylesheet('home.css');
    const short = declsFor(css, '.home__mode', '(max-height: 820px)');
    expect(short.padding).toBe('var(--space-2) var(--space-5)');
    expect(declsFor(css, '.home__lede', '(max-height: 820px)').display).toBe('none');
  });
});
