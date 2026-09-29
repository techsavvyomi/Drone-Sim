// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type MissionProgress, type TrainingProgress } from '@shared/types';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { classroom2 } from '../src/renderer/plugins/environments/classroom2';
import { droneAcademy } from '../src/renderer/plugins/environments/droneAcademy';
import { registerDrone, registerEnvironment } from '../src/renderer/plugins/registry';
import { LESSONS } from '../src/renderer/training/lessons';
import { MISSIONS } from '../src/renderer/missions';
import type { Lesson } from '../src/renderer/training/lessons/types';
import type { Mission } from '../src/renderer/missions/types';
import {
  handlingLine,
  homeDroneFacts,
  homePlan,
  missionMaps,
  type HomeInput,
} from '../src/renderer/app/homeFacts';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { useShellStore } from '../src/renderer/state/shellStore';
import { useAccountStore } from '../src/renderer/state/accountStore';
import { useTrainingStore } from '../src/renderer/state/trainingStore';
import { useMissionStore } from '../src/renderer/state/missionStore';
import { Home } from '../src/renderer/app/Home';
import { StatusBar } from '../src/renderer/app/StatusBar';

// Phase 3 — Home, "the hangar", against the Phase 3 brief: one signal-filled
// primary, first run vs returning, Continue, the drone picker, and every line
// a fact from the game's own data.

// The turntable is a WebGL canvas; jsdom has no WebGL, and nothing here is about it.
vi.mock('../src/renderer/app/HangarScene', () => ({ HangarScene: () => null }));

const lesson = (id: string, order: number, title = `Lesson ${order}`): Lesson =>
  ({ id, order, title, subtitle: `Subtitle ${order}` }) as Lesson;
const mission = (id: string, order: number, envId: string): Mission =>
  ({ id, order, name: `Mission ${id}`, envId }) as Mission;

const L3 = [lesson('a', 1, 'Arm & Take Off'), lesson('b', 2, 'Land & Disarm'), lesson('c', 3, 'Yaw')];
const M3 = [mission('m1', 1, 'city'), mission('m2', 2, 'forest'), mission('m3', 3, 'city')];
const NAMES: Record<string, string> = { city: 'New York City', forest: 'Forest' };

function input(
  done: string[] = [],
  missionsDone: string[] = [],
  extra: Partial<HomeInput> = {},
): HomeInput {
  const training: TrainingProgress = {
    xp: 0,
    lessons: Object.fromEntries(done.map((id) => [id, { completed: true, stars: 2, bestScore: 1 }])),
  };
  const missionProgress: MissionProgress = {
    missions: Object.fromEntries(
      missionsDone.map((id) => [id, { completed: true, stars: 1, bestPoints: 1, bestTimeSec: 1 }]),
    ),
  };
  return {
    lessons: L3,
    missions: M3,
    training,
    missionProgress,
    envName: (id) => NAMES[id],
    ...extra,
  };
}

describe('what Home says (homePlan)', () => {
  it('first run: Training is the one primary, and opens Module 1', () => {
    const p = homePlan(input());
    expect(p.firstRun).toBe(true);
    expect(p.heading).toBe('New pilot? Start with Training.');
    expect(p.rows.map((r) => r.id)).toEqual(['training', 'fly', 'missions']);
    expect(p.rows.filter((r) => r.primary).map((r) => r.id)).toEqual(['training']);
    expect(p.rows[0]).toMatchObject({
      count: '0 of 3',
      line: 'Start here · Module 1, Arm & Take Off.',
      target: { kind: 'lesson', id: 'a' },
    });
    expect(p.statusTag).toBe('New pilot');
    expect(p.statusContext).toBe('Start with Module 1 of 3');
  });

  it('first run: the Missions row names the real maps, each once', () => {
    const row = homePlan(input()).rows.find((r) => r.id === 'missions')!;
    expect(row.count).toBe('0 of 3');
    expect(row.line).toBe('3 story missions on New York City and Forest.');
  });

  it('returning: Continue names the next module on top; Training drops to a star count', () => {
    const p = homePlan(input(['a', 'b'], [], { pilotName: 'Asha Kulkarni' }));
    expect(p.firstRun).toBe(false);
    expect(p.heading).toBe('Welcome back, Asha');
    expect(p.rows.map((r) => r.id)).toEqual(['continue', 'training', 'fly', 'missions']);
    expect(p.rows[0]).toMatchObject({
      title: 'Continue: Module 3 — Yaw',
      count: '2 of 3',
      primary: true,
      target: { kind: 'lesson', id: 'c' },
    });
    expect(p.rows[1]).toMatchObject({ count: '4 of 9', countStars: true, primary: false });
    expect(p.rows.filter((r) => r.primary)).toHaveLength(1);
    expect(p.statusTag).toBe('');
    expect(p.statusContext).toBe('Next: Module 3 of 3 · Yaw');
  });

  it('returning without a signed-in name still welcomes', () => {
    expect(homePlan(input(['a'])).heading).toBe('Welcome back');
  });

  it('every module done: Continue names the next mission and opens its briefing', () => {
    const p = homePlan(input(['a', 'b', 'c'], ['m1']));
    expect(p.rows[0]).toMatchObject({
      title: 'Continue: Mission 2 — Mission m2',
      count: '1 of 3',
      line: 'Missions · Forest.',
      target: { kind: 'mission', id: 'm2' },
      primary: true,
    });
    expect(p.rows.find((r) => r.id === 'missions')!.line).toBe('Next: Mission 2, Mission m2.');
  });

  it('everything flown: no Continue, Free Flight becomes the one primary', () => {
    const p = homePlan(input(['a', 'b', 'c'], ['m1', 'm2', 'm3']));
    expect(p.rows.map((r) => r.id)).toEqual(['training', 'fly', 'missions']);
    expect(p.rows.filter((r) => r.primary).map((r) => r.id)).toEqual(['fly']);
  });

  it('a pilot who has only flown a mission is returning, and is sent to Module 1', () => {
    const p = homePlan(input([], ['m1']));
    expect(p.firstRun).toBe(false);
    expect(p.rows[0].target).toEqual({ kind: 'lesson', id: 'a' });
  });

  it('the real curriculum: 15 modules, 10 missions', () => {
    const p = homePlan({
      lessons: LESSONS,
      missions: MISSIONS,
      training: { xp: 0, lessons: {} },
      missionProgress: { missions: {} },
      envName: () => undefined,
    });
    expect(p.rows[0].count).toBe('0 of 15');
    expect(p.rows[0].line).toBe(`Start here · Module 1, ${LESSONS[0].title}.`);
    expect(p.rows.find((r) => r.id === 'missions')!.count).toBe('0 of 10');
  });

  it('mission maps come in mission order, without repeats', () => {
    expect(missionMaps(M3, (id) => NAMES[id])).toEqual(['New York City', 'Forest']);
  });
});

describe('the drone facts', () => {
  it('come from the plugin: Pluto', () => {
    expect(homeDroneFacts(plutoDrone)).toEqual([
      { label: 'Mass', value: '50 g' },
      { label: 'Motors', value: '4 × 20,000 kv' },
      { label: 'Props', value: '55 mm, 2-blade' },
      { label: 'Battery', value: '1S · 300 mAh' },
    ]);
  });

  it('one handling line per drone, starting with its mass', () => {
    expect(handlingLine(plutoDrone)).toBe('50 g. Tilts 22° at full stick, tops out at 8 m/s.');
    expect(handlingLine(guruDrone)).toBe('1.5 kg. Tilts 32° at full stick, tops out at 14 m/s.');
    expect(handlingLine(racingDrone)).toBe('720 g. Tilts 45° at full stick, tops out at 17 m/s.');
  });
});

// ---- The screen -------------------------------------------------------------

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const d of [plutoDrone, guruDrone, racingDrone]) registerDrone(d);
  for (const e of [classroom2, droneAcademy]) registerEnvironment(e);
});

function settingsWith(done: string[] = []) {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      selectedDroneId: 'pluto',
      selectedEnvironmentId: 'classroom-2',
      training: {
        xp: 0,
        lessons: Object.fromEntries(done.map((id) => [id, { completed: true, stars: 3, bestScore: 1 }])),
      },
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 1200px'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  settingsWith();
  // The picker writes through the settings store; keep it in memory.
  useSettingsStore.setState({
    set: ((k: string, v: unknown) =>
      useSettingsStore.setState((s) => ({ settings: { ...s.settings, [k]: v } }))) as never,
  });
  useUiStore.setState({ section: 'home', previousSection: 'home' });
  useShellStore.setState({ input: 'pointer', legendDevice: 'keyboard', context: '', contextTag: '' });
  useAccountStore.setState({ status: 'signedOut', profile: null } as never);
  useTrainingStore.setState({ activeLessonId: null });
  useMissionStore.setState({ mission: null });
});

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const $ = (el: ParentNode, sel: string) => el.querySelector(sel) as HTMLElement;
const $$ = (el: ParentNode, sel: string) => [...el.querySelectorAll(sel)] as HTMLElement[];

describe('Home screen', () => {
  it('exactly one signal-filled element in the content, focused on arrival', () => {
    const el = mount(h(Home));
    const primaries = $$(el, '[data-primary]');
    expect(primaries).toHaveLength(1);
    expect($$(el, '.is-primary')).toHaveLength(1);
    expect(primaries[0].dataset.mode).toBe('training');
    expect(document.activeElement).toBe(primaries[0]);
  });

  it('shows the loadout drone and the arena tag; no setup strip (the top bar has it)', () => {
    const el = mount(h(Home));
    expect($(el, '.home__name').textContent).toBe('Pluto');
    expect($(el, '.home__count').textContent).toBe('Selected drone · 1 of 3');
    expect($(el, '.home__tag').textContent).toBe('Classroom · ceiling 3 m');
    expect($(el, '.home__handling p').textContent).toBe(handlingLine(plutoDrone));
    expect($(el, '.home__setup')).toBeNull();
    expect(el.textContent).not.toContain('Setup');
  });

  it('no slogans: the old hero copy is gone', () => {
    const el = mount(h(Home));
    expect(el.textContent).not.toMatch(/Take Off\?|Choose your mode/);
  });

  it('the Training row opens Module 1 on its intro card', () => {
    const el = mount(h(Home));
    act(() => $(el, '[data-mode="training"]').click());
    expect(useUiStore.getState().section).toBe('training');
    expect(useTrainingStore.getState().activeLessonId).toBe(LESSONS[0].id);
    expect(useTrainingStore.getState().phase).toBe('intro');
  });

  it('returning: Continue opens the next module', () => {
    settingsWith([LESSONS[0].id, LESSONS[1].id]);
    const el = mount(h(Home));
    const cont = $(el, '[data-mode="continue"]');
    expect(cont.dataset.primary).toBe('true');
    expect(cont.textContent).toContain(`Continue: Module 3 — ${LESSONS[2].title}`);
    expect($(el, '[data-mode="training"]').dataset.primary).toBeUndefined();
    act(() => cont.click());
    expect(useTrainingStore.getState().activeLessonId).toBe(LESSONS[2].id);
  });

  it('every module done: Continue opens the first mission briefing', () => {
    settingsWith(LESSONS.map((l) => l.id));
    const el = mount(h(Home));
    act(() => $(el, '[data-mode="continue"]').click());
    expect(useUiStore.getState().section).toBe('missions');
    expect(useMissionStore.getState().mission?.id).toBe(MISSIONS[0].id);
    expect(useMissionStore.getState().phase).toBe('briefing');
  });

  it('Free Flight and Missions rows open their sections', () => {
    const el = mount(h(Home));
    act(() => $(el, '[data-mode="fly"]').click());
    expect(useUiStore.getState().section).toBe('fly');
    act(() => $(el, '[data-mode="missions"]').click());
    expect(useUiStore.getState().section).toBe('missions');
  });

  it('Change drone writes the DRONE setting and restages the hero', () => {
    const el = mount(h(Home));
    const pick = $(el, '.loadout-chip__pick');
    expect(pick.getAttribute('aria-label')).toBe('Change drone: Pluto');
    act(() => pick.click());
    expect(pick.getAttribute('aria-expanded')).toBe('true');
    const list = $(el, '[role="listbox"]');
    expect($(list, '[aria-selected="true"]').textContent).toContain('Pluto');
    act(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    act(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(useSettingsStore.getState().settings.selectedDroneId).toBe('pluto-guru');
    expect($(el, '.home__name').textContent).toBe('Pluto Guru');
    expect($(el, '.home__count').textContent).toBe('Selected drone · 2 of 3');
    expect(document.activeElement).toBe(pick);
  });

  it('the badge: signed out it shows the local rank; signed in it is the way to Profile', () => {
    let el = mount(h(Home));
    expect($(el, 'div.home__badge')).not.toBeNull();
    act(() => root?.unmount());
    host?.remove();

    useAccountStore.setState({
      status: 'signedIn',
      profile: { name: 'Asha Kulkarni', level: 4, levelPoints: { current: 140, next: 500 } },
    } as never);
    el = mount(h(Home));
    const badge = $(el, 'button.home__badge');
    expect(badge.textContent).toContain('AK');
    expect(badge.textContent).toContain('Cadet · Rank 2 of 6');
    expect(badge.textContent).toContain('1,640 XP');
    expect(badge.textContent).toContain('360 XP to Pilot');
    expect($(el, '.home__heading').textContent).toBe('New pilot? Start with Training.');
    act(() => badge.click());
    expect(useUiStore.getState().section).toBe('profile');
  });

  it('the status bar reads "Home · New pilot  Start with Module 1 of 15"', () => {
    const el = mount(h('div', null, h(Home), h(StatusBar)));
    const where = $(el, '.statusbar__where');
    expect($(where, 'b').textContent).toBe('Home · New pilot');
    expect(where.textContent).toContain('Start with Module 1 of 15');
  });

  it('leaving Home clears the status context', () => {
    mount(h(Home));
    act(() => root?.unmount());
    root = undefined;
    expect(useShellStore.getState()).toMatchObject({ context: '', contextTag: '' });
  });
});
