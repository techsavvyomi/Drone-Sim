// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type MissionProgress } from '@shared/types';
import { MISSIONS, getMission } from '../src/renderer/missions';
import { LIMITS } from '../src/renderer/missions/limits';
import type { Mission, MissionResult } from '../src/renderer/missions/types';
import {
  MISSION_BLOCKS,
  bestTimeText,
  briefHeader,
  clock,
  countLine,
  directionText,
  failHeadline,
  failWhere,
  hudStarLine,
  latestLog,
  missReasons,
  missionBlockOf,
  missionBlockSummaries,
  missionGapLine,
  missionListSummary,
  missionResultTiers,
  missionRows,
  missionTiers,
  objectiveLabel,
  objectiveRows,
  openingMissionBlock,
  plural,
  rowStatusText,
  targetLabel,
  timeLeft,
  type AttemptFacts,
} from '../src/renderer/app/missionFacts';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useShellStore } from '../src/renderer/state/shellStore';
import { useMissionStore } from '../src/renderer/state/missionStore';
import { MissionScreen } from '../src/renderer/app/MissionScreen';
import { MissionHud } from '../src/renderer/hud/MissionHud';

// Phase 5 — Pluto Field Ops against the Phase 5 brief: one limits table, the
// block rail and rows, the briefing, the HUD's clock and star line, the result
// card's objective rows and tiers, and the failure card. Every figure is the
// game's own; nothing here scores — the rubric tests are the missions' own.

vi.mock('../src/renderer/audio/sfx', () => ({
  playClick: () => {},
  playSuccess: () => {},
  playStar: () => {},
  playRankUp: () => {},
  playCollect: () => {},
  playFail: () => {},
  playWhoosh: () => {},
}));
// No WebGL or canvas in jsdom, and none of it is what is under test.
vi.mock('../src/renderer/missions/MissionViewport', () => ({ MissionViewport: () => null }));
vi.mock('../src/renderer/hud/MissionCityMap', () => ({
  MissionCityMap: () => h('div', { className: 'ms-citymap' }),
}));
vi.mock('../src/renderer/hud/MissionMap', () => ({
  MissionMap: () => h('div', { className: 'ms-map' }),
}));
vi.mock('../src/renderer/hud/PauseOverlay', () => ({ PauseOverlay: () => null }));

const m1 = getMission('precision-delivery')!;
const m3 = getMission('multi-point-delivery')!;

function settingsWith(missions: MissionProgress['missions'] = {}) {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, missions: { missions } },
    set: ((k: string, v: unknown) =>
      useSettingsStore.setState((s) => ({ settings: { ...s.settings, [k]: v } }))) as never,
  });
}

const done = (n: number, stars = 3, bestTimeSec = 200) =>
  Object.fromEntries(
    MISSIONS.slice(0, n).map((m) => [
      m.id,
      { completed: true, stars, bestPoints: 5, bestTimeSec },
    ]),
  );

/** A finish with everything but the given fields perfect. */
function finish(m: Mission, over: Partial<MissionResult> = {}): MissionResult {
  const max = useMissionStore.getState().maxPoints || 0;
  const points = over.maxPoints ?? max;
  return {
    points,
    maxPoints: points,
    timeSec: 60,
    collisions: 0,
    delivered: true,
    landed: !m.endsAtDrop,
    ...over,
  };
}

beforeEach(() => {
  settingsWith();
  useShellStore.setState({ context: '', contextTag: '' });
  useMissionStore.getState().exit();
});

// ---- One time limit -------------------------------------------------------------

describe('limits table', () => {
  it('every mission reads its limit and par from missions/limits.ts', () => {
    expect(Object.keys(LIMITS).sort()).toEqual(MISSIONS.map((m) => m.id).sort());
    for (const m of MISSIONS) {
      const l = LIMITS[m.id as keyof typeof LIMITS];
      expect(m.timeLimitSec, m.id).toBe(l.limitSec);
      expect(m.parTimeSec, m.id).toBe(l.parSec);
      expect(l.parSec, m.id).toBeLessThan(l.limitSec);
    }
  });

  it('the timed rung carries `within` = par, and its own test agrees', () => {
    for (const m of MISSIONS) {
      const timed = m.ranks.filter((r) => r.within !== undefined);
      expect(timed.map((r) => r.stars), m.id).toEqual([3]);
      const top = timed[0];
      expect(top.within, m.id).toBe(m.parTimeSec);
      const max = 100;
      const base = { points: max, maxPoints: max, collisions: 0, delivered: true, landed: true };
      expect(top.test({ ...base, timeSec: m.parTimeSec }), m.id).toBe(true);
      expect(top.test({ ...base, timeSec: m.parTimeSec + 0.5 }), m.id).toBe(false);
    }
  });

  it('the same limit everywhere: list, briefing header, tiers and HUD clock', () => {
    const text = clock(m1.timeLimitSec);
    expect(text).toBe('8:00');
    expect(briefHeader(m1, 10, 'New York').sub).toContain(`time limit ${text}`);
    expect(missionTiers(m1)[0].within).toBe(m1.timeLimitSec);
    expect(timeLeft(m1.timeLimitSec, 0).text).toBe(text);
  });
});

// ---- The list ---------------------------------------------------------------------

describe('mission list facts', () => {
  it('four blocks by map cover missions 1–10 once each', () => {
    const covered = MISSION_BLOCKS.flatMap((b) =>
      Array.from({ length: b.to - b.from + 1 }, (_, i) => b.from + i),
    );
    expect(covered).toEqual(MISSIONS.map((m) => m.order));
    const envs = (name: string) =>
      new Set(MISSIONS.filter((m) => missionBlockOf(m.order).name === name).map((m) => m.envId));
    expect([...envs('Construction Site')]).toEqual(['construction-site']);
    expect([...envs('Supermarket')]).toEqual(['supermarket']);
    expect(
      MISSIONS.filter((m) => missionBlockOf(m.order).name === 'Forest at Night').every(
        (m) => m.envId === 'forest' && m.kind === 'tracking',
      ),
    ).toBe(true);
  });

  it('one pluraliser for every count', () => {
    expect(plural(1, 'delivery', 'deliveries')).toBe('1 delivery');
    expect(plural(2, 'delivery', 'deliveries')).toBe('2 deliveries');
    const byId = (id: string) => countLine(getMission(id)!);
    expect(byId('precision-delivery')).toBe('1 delivery');
    expect(byId('multi-point-delivery')).toBe('3 deliveries');
    expect(byId('search-rescue')).toBe('1 search area');
    expect(byId('forest-fire')).toBe('1 fire');
    expect(byId('night-tracking')).toBe('1 sighting');
    expect(byId('night-shift-inspection')).toBe('3 zones');
    expect(byId('supermarket-delivery')).toBe('5 boxes');
  });

  it('rows, status words and summaries follow the unlock rule', () => {
    const first = missionRows(MISSIONS, {});
    expect(first.map((r) => r.status)).toEqual(['next', ...Array(9).fill('locked')]);
    expect(rowStatusText(first[1])).toBe('After Mission 1');
    expect(missionListSummary(first).nextLine).toBe(`Start with Mission 1, ${m1.name}`);

    const rows = missionRows(MISSIONS, done(2, 2));
    expect(rows.slice(0, 3).map((r) => r.status)).toEqual(['done', 'done', 'next']);
    expect(rowStatusText(rows[0])).toBe('Completed');
    const s = missionListSummary(rows);
    expect(s.line).toBe('2 of 10 missions · ★ 4 of 30');
    expect(s.nextLine).toBe(`Next: Mission 3, ${m3.name}`);
    const blocks = missionBlockSummaries(rows);
    expect(blocks[0].line).toBe('2 of 4 done · ★ 4 of 12');
    expect(blocks[1].line).toBe('Locked · finish City & Forest');
    expect(openingMissionBlock(rows)).toBe(0);
    expect(openingMissionBlock(missionRows(MISSIONS, done(4)))).toBe(1);
  });
});

// ---- HUD ------------------------------------------------------------------------------

describe('HUD facts', () => {
  it('the clock counts down and turns caution in the last 30 s', () => {
    expect(timeLeft(180, 72)).toMatchObject({ text: '1:48', caution: false });
    expect(timeLeft(180, 150)).toMatchObject({ text: '0:30', caution: true });
    expect(timeLeft(180, 179.2).text).toBe('0:01');
    expect(timeLeft(180, 200).text).toBe('0:00');
  });

  it('the star line names the best rung still in reach', () => {
    const max = 15;
    expect(hudStarLine(m1, max, 60, 0)).toBe(
      '3 stars if you finish in the next 4:00 · 1:00 used of 8:00',
    );
    // One collision takes the top rung; the next sets no time of its own.
    expect(hudStarLine(m1, max, 60, 1)).toBe(
      '2 stars if you finish within the limit · 1:00 used of 8:00',
    );
    // Past par, still clean: two stars.
    expect(hudStarLine(m1, max, 320, 0)).toMatch(/^2 stars/);
    // Two collisions: one star, timed by the limit.
    expect(hudStarLine(m1, max, 320, 2)).toBe(
      '1 star if you finish in the next 2:40 · 5:20 used of 8:00',
    );
  });

  it('objective label, direction and target', () => {
    expect(objectiveLabel(m1, 0)).toBe('Objective · 1 delivery');
    expect(objectiveLabel(m3, 1)).toBe('Objective 2 of 3 · 3 deliveries');
    expect(directionText((18 * Math.PI) / 180, 111.4)).toBe('111 m · 18° right');
    expect(directionText(-0.5, 40)).toBe('40 m · 29° left');
    expect(directionText(0.02, 40)).toBe('40 m · ahead');
    expect(directionText(3, 1500)).toBe('1.5 km · behind');
    expect(targetLabel(m1, 'toPickup', 0, {})).toBe(m1.zones.pickup.label);
    const ring = m1.route.find((c) => c.leg === 'toDrop')!;
    expect(targetLabel(m1, 'carrying', 0, {})).toBe(`Ring ${ring.label}`);
    expect(targetLabel(m1, 'returning', 0, {})).toBe(m1.zones.base.label);
  });

  it('the log keeps radio lines and banners with their times', () => {
    const s = useMissionStore.getState();
    s.start(m1);
    s.beginFlight();
    s.setElapsed(12);
    s.playRadio('a', 'Package on board.', 5);
    s.setElapsed(41);
    s.showBanner({ kind: 'warn', title: 'RETURN TO MISSION AREA', sub: 'Turn back' }, 3);
    const log = useMissionStore.getState().log;
    expect(log.map((l) => [l.at, l.kind, l.text])).toEqual([
      [12, 'radio', 'Package on board.'],
      [41, 'warn', 'RETURN TO MISSION AREA. Turn back'],
    ]);
    expect(latestLog(log, 1).map((l) => l.at)).toEqual([41]);
    // A restart wipes it with the attempt.
    s.restart();
    expect(useMissionStore.getState().log).toEqual([]);
  });

  it('records when deliveries, the landing and collisions happened (display only)', () => {
    const s = useMissionStore.getState();
    s.start(m3);
    s.beginFlight();
    s.setElapsed(94);
    s.setCollisions(1);
    s.setCollisions(1);
    s.setElapsed(120);
    s.takeDelivery('A');
    s.setElapsed(300);
    s.takeZone('base', 'SAFE LANDING');
    const st = useMissionStore.getState();
    expect(st.collisionAt).toEqual([94]);
    expect(st.deliveredAt).toEqual([120]);
    expect(st.landedAt).toBe(300);
    s.setElapsed(310);
    s.fail('crash');
    expect(useMissionStore.getState().endedAt).toEqual({ sec: 310, altitude: 0 });
  });
});

// ---- Result and failure -----------------------------------------------------------------

const facts = (over: Partial<AttemptFacts> = {}): AttemptFacts => ({
  delivered: true,
  landed: true,
  deliveredCount: 1,
  deliveredAt: [201],
  landedAt: 281,
  checkpoints: m1.route.length,
  collisions: 0,
  collisionAt: [],
  ...over,
});

describe('result facts', () => {
  it('objective rows carry their own tick and the measured value', () => {
    const rows = objectiveRows(m1, facts({ collisions: 1, collisionAt: [94] }));
    expect(rows.map((r) => [r.label, r.ok, r.value])).toEqual([
      ['Deliver the package', true, 'Delivered at 3:21'],
      ['Fly the checkpoints', true, `${m1.route.length} of ${m1.route.length}`],
      [`Land at the ${m1.zones.base.label.toLowerCase()}`, true, 'Landed at 4:41'],
      ['No collisions', false, '1 collision · first at 1:34'],
    ]);
    const failed = objectiveRows(
      m3,
      facts({ delivered: false, landed: false, deliveredCount: 1, checkpoints: 0 }),
    );
    expect(failed[0]).toEqual({
      label: 'Deliver all 3 packages',
      ok: false,
      value: 'Not done · 1 of 3 deliveries',
    });
    expect(failed.find((r) => r.label.startsWith('Land'))?.value).toBe('Not landed');
  });

  it('a mission that ends at the drop has no landing row; a survey says what it did', () => {
    const fire = getMission('forest-fire')!;
    expect(objectiveRows(fire, facts()).some((r) => r.label.startsWith('Land'))).toBe(false);
    expect(objectiveRows(fire, facts())[0].value).toBe('Fire out at 3:21');
    const tiger = getMission('night-tracking')!;
    expect(objectiveRows(tiger, facts())[0].label).toBe('Log the sighting');
  });

  it('tier rows: earned, your result, and what the missed rung needed', () => {
    const r: MissionResult = {
      points: 15,
      maxPoints: 15,
      timeSec: 321,
      collisions: 1,
      delivered: true,
      landed: true,
    };
    const tiers = missionResultTiers(m1, 2, r);
    expect(tiers.map((t) => [t.stars, t.state, t.note])).toEqual([
      [1, 'earned', 'Earned'],
      [2, 'result', 'Your result'],
      [3, 'missed', '0:21 over · 1 collision'],
    ]);
    expect(missReasons(m1.ranks.find((x) => x.stars === 3)!, { ...r, collisions: 0 }, 480)).toEqual(
      ['0:21 over'],
    );
    expect(
      missReasons(m1.ranks.find((x) => x.stars === 3)!, { ...r, timeSec: 200, points: 13 }, 480),
    ).toEqual(['1 collision', '2 points short']);
    expect(missionGapLine(m1, 2, 321)).toBe(
      `5:21 — 3 stars needs ${m1.ranks[0].text.charAt(0).toLowerCase()}${m1.ranks[0].text.slice(1)}.`,
    );
    expect(missionGapLine(m1, 3, 200)).toBe('Every star earned. Replay it to beat your time.');
  });

  it('best time, failure heading and where', () => {
    expect(bestTimeText(null, 200)).toEqual({ value: '3:20', isNew: true });
    expect(bestTimeText(190, 200)).toEqual({ value: '3:10', isNew: false });
    expect(bestTimeText(250, 200)).toEqual({ value: '3:20', isNew: true });
    expect(failHeadline('crash')).toBe('Drone crashed');
    expect(failHeadline('timeout')).toBe('Out of time');
    expect(failWhere('crash', { sec: 94, altitude: 3.62 }, 480)).toBe('At 1:34, 3.6 m up.');
    expect(failWhere('timeout', { sec: 480, altitude: 9 }, 480)).toBe(
      'The clock ran out at 8:00.',
    );
  });

  it('finish remembers the best before it, and still records the best', () => {
    settingsWith({ [m1.id]: { completed: true, stars: 2, bestPoints: 14, bestTimeSec: 290 } });
    const s = useMissionStore.getState();
    s.start(m1);
    s.beginFlight();
    s.finish(finish(m1, { maxPoints: 15, timeSec: 250 }));
    const st = useMissionStore.getState();
    expect(st.bestBefore).toEqual({ timeSec: 290, stars: 2, points: 14 });
    expect(st.result?.stars).toBe(3);
    const saved = useSettingsStore.getState().settings.missions.missions[m1.id];
    expect(saved).toMatchObject({ stars: 3, bestTimeSec: 250, bestPoints: 15 });
  });
});

// ---- Screens ---------------------------------------------------------------------------------

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
});

const $ = (el: ParentNode, sel: string) => el.querySelector(sel) as HTMLElement;
const $$ = (el: ParentNode, sel: string) => [...el.querySelectorAll(sel)] as HTMLElement[];

describe('mission list screen', () => {
  it('first run: Mission 1 is the one primary row and takes focus; the rest are locked', () => {
    const el = mount(h(MissionScreen));
    const primary = $$(el, '[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0].dataset.mission).toBe(m1.id);
    expect(document.activeElement).toBe(primary[0]);
    const rows = $$(el, '.tlist__row');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('8:00');
    expect(rows[0].textContent).toContain('1 delivery');
    expect(rows[1].getAttribute('aria-disabled')).toBe('true');
    expect(rows[1].textContent).toContain('After Mission 1');
    expect(useShellStore.getState().context).toBe(`Mission 1 of 10 · ${m1.name}`);
  });

  it('a locked row does nothing; the next row opens the briefing', () => {
    const el = mount(h(MissionScreen));
    act(() => $$(el, '.tlist__row')[1].click());
    expect(useMissionStore.getState().mission).toBeNull();
    act(() => $$(el, '.tlist__row')[0].click());
    expect(useMissionStore.getState().mission?.id).toBe(m1.id);
    expect(useMissionStore.getState().phase).toBe('briefing');
  });

  it('returning: opens on the block with the next mission, stars and best shown', () => {
    settingsWith(done(4, 3, 200));
    const el = mount(h(MissionScreen));
    expect($(el, '.tlist__table h2').textContent).toBe('Forest at Night');
    act(() => $$(el, '.tlist__block')[0].click());
    expect($$(el, '.tlist__row')[0].textContent).toContain('Best 3:20');
    expect($$(el, '.tlist__row')[0].textContent).toContain('3 of 3');
    expect($(el, '.tlist__sum').textContent).toContain('4 of 10 missions · ★ 12 of 30');
  });
});

describe('mission HUD cards', () => {
  it('briefing: header band, objectives, stars, map card; Launch focused', () => {
    useMissionStore.getState().start(m1);
    const el = mount(h(MissionHud));
    expect($(el, '.mband').textContent).toContain(`Mission 1 of 10 · ${m1.name}`);
    expect($(el, '.mband').textContent).toContain('time limit 8:00');
    expect($$(el, '.mbrief__objs li')).toHaveLength(m1.objectives.length);
    expect($$(el, '.mbrief__steps li')).toHaveLength(m1.flow.length);
    expect($$(el, '.mbrief__tier')).toHaveLength(3);
    expect($(el, '.mbrief__limit b').textContent).toBe('8:00');
    expect(document.activeElement?.textContent).toContain('Launch mission');
  });

  it('flying: objective band with time left, star marks and the strip', () => {
    const s = useMissionStore.getState();
    s.start(m1);
    s.beginFlight();
    s.setElapsed(72);
    const el = mount(h(MissionHud));
    expect($(el, '.mobj__clock').textContent).toContain('6:48');
    expect($$(el, '.mobj__mark').map((m) => m.textContent)).toEqual(['8:00', '5:00']);
    expect($(el, '.mobj__line').textContent).toContain('3 stars if you finish in the next 3:48');
    expect($(el, '.mstrip').textContent).toContain('Points');
    expect($(el, '.mradio').textContent).toContain('Radio · latest');
  });

  it('result: tiers, objective rows, Next focused', () => {
    settingsWith();
    const s = useMissionStore.getState();
    s.start(m1);
    s.beginFlight();
    s.setElapsed(201);
    s.takeZone('drop', 'DELIVERY');
    s.finish(finish(m1, { maxPoints: 15, points: 15, timeSec: 321, collisions: 1 }));
    const el = mount(h(MissionHud));
    expect($(el, '.tresult__title').textContent).toContain('2 of 3 stars');
    expect($$(el, '.tresult__tier').map((t) => t.className.split('is-')[1])).toEqual([
      'earned',
      'result',
      'missed',
    ]);
    expect($(el, '.mresult__obj').textContent).toContain('Delivered at 3:21');
    expect(document.activeElement?.textContent).toContain('Next: Mission 2');
  });

  it('failure: what happened, where, the fix; Try again focused', () => {
    const s = useMissionStore.getState();
    s.start(m1);
    s.beginFlight();
    s.setElapsed(94);
    s.fail('crash');
    const el = mount(h(MissionHud));
    expect($(el, '.mresult__fail-title').textContent).toContain('Drone crashed');
    expect($(el, '.mresult__where').textContent).toBe('At 1:34, 0.0 m up.');
    expect($(el, '.mresult__x')).toBeTruthy();
    expect($(el, '.mresult__obj').textContent).toContain('Not done');
    expect(document.activeElement?.textContent).toBe('Try again');
  });
});
