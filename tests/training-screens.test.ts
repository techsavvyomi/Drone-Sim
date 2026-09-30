// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type LessonProgress } from '@shared/types';
import { LESSONS, getLesson } from '../src/renderer/training/lessons';
import { demoLength } from '../src/renderer/training/lessons/types';
import {
  BLOCKS,
  FINISH_TIER_TEXT,
  bandStates,
  blockOf,
  blockSummaries,
  chipWindow,
  demoClockText,
  formatClock,
  gapLine,
  learnMeta,
  listSummary,
  moduleRows,
  onTimeLine,
  openingBlock,
  personalBestLine,
  registerFor,
  resultTiers,
  rowStatusText,
  stepHeading,
  tiersFor,
  yourBestText,
} from '../src/renderer/app/trainingFacts';
import {
  BOX_MARGIN_M,
  BOX_MIN_HALF_M,
  insideBox,
  lessonBox,
  newFlightClock,
  resetFlightClock,
  tickFlightClock,
} from '../src/renderer/training/flightClock';
import { clockStatus, flyLine } from '../src/renderer/app/trainingFacts';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useShellStore } from '../src/renderer/state/shellStore';
import { useTrainingStore, AUTO_ADVANCE_SEC } from '../src/renderer/state/trainingStore';
import { LessonSelect } from '../src/renderer/app/LessonSelect';
import { TrainingHud } from '../src/renderer/hud/TrainingHud';

// Phase 4 — Pluto Flight School against the Phase 4 brief: the block rail and
// module rows, the step band, the Learn card's keys, the Fly bar's star times,
// and the result card's tiers, gap line, personal best and auto-advance. Every
// figure is the game's own; nothing here scores.

// No audio, WebGL or canvas in jsdom, and none of it is what is under test.
vi.mock('../src/renderer/audio/sfx', () => ({
  playClick: () => {},
  playSuccess: () => {},
  playStar: () => {},
  playRankUp: () => {},
  playCollect: () => {},
  playFail: () => {},
  playWhoosh: () => {},
}));
vi.mock('../src/renderer/hud/LessonMap', () => ({ LessonMap: () => null }));
vi.mock('../src/renderer/hud/StickIndicator', () => ({ StickIndicator: () => null }));
vi.mock('../src/renderer/hud/FlightCards', () => ({ PauseCard: () => null, CrashCard: () => null }));

const arm = getLesson('arm-takeoff')!;
const land = getLesson('land-disarm')!;
const done = (ids: string[], extra: Partial<LessonProgress> = {}) =>
  Object.fromEntries(
    ids.map((id) => [id, { completed: true, stars: 2, bestScore: 2 / 3, ...extra }]),
  ) as Record<string, LessonProgress>;
const firstN = (n: number) => LESSONS.slice(0, n).map((l) => l.id);

// ---- Blocks and rows --------------------------------------------------------

describe('module list facts', () => {
  it('four blocks cover modules 1–15 once each, in the PDF split', () => {
    expect(BLOCKS.map((b) => [b.from, b.to])).toEqual([
      [1, 4],
      [5, 8],
      [9, 12],
      [13, 15],
    ]);
    expect(BLOCKS.map((b) => b.name)).toEqual([
      'Ground Handling',
      'Attitude',
      'Circuits',
      'Navigation',
    ]);
    expect(BLOCKS[BLOCKS.length - 1].to).toBe(LESSONS.length);
    expect(blockOf(4).name).toBe('Ground Handling');
    expect(blockOf(13).name).toBe('Navigation');
  });

  it('first run: Module 1 is next, every other row is locked and names what unlocks it', () => {
    const rows = moduleRows(LESSONS, {});
    expect(rows[0].status).toBe('next');
    expect(rowStatusText(rows[0])).toBe('Start');
    expect(rows.slice(1).every((r) => r.status === 'locked')).toBe(true);
    expect(rowStatusText(rows[1])).toBe('After Module 1');
    expect(rows[0].goal).toBe(LESSONS[0].subtitle);
  });

  it('rows carry stars and the best time from the local record', () => {
    const rows = moduleRows(LESSONS, done(['arm-takeoff'], { stars: 3, bestTimeSec: 12.4 }));
    expect(rows[0].status).toBe('done');
    expect(rowStatusText(rows[0])).toBe('Completed');
    expect(rows[0].stars).toBe(3);
    expect(rows[0].bestTimeSec).toBe(12.4);
    expect(rows[1].status).toBe('next');
    expect(rows[1].bestTimeSec).toBeNull();
  });

  it('block lines: done and stars, or locked behind the block before', () => {
    const blocks = blockSummaries(moduleRows(LESSONS, done(firstN(3))));
    expect(blocks[0].line).toBe('3 of 4 done · ★ 6 of 12');
    expect(blocks[0].locked).toBe(false);
    expect(blocks[1].line).toBe('Locked · finish Ground Handling');
    expect(blocks[3].line).toBe('Locked · finish Circuits');
    const open = blockSummaries(moduleRows(LESSONS, done(firstN(4))));
    expect(open[1].locked).toBe(false);
    expect(open[1].line).toBe('0 of 4 done · ★ 0 of 12');
  });

  it('the summary under the rail, first run / returning / all flown', () => {
    expect(listSummary(moduleRows(LESSONS, {})).nextLine).toBe('Start with Module 1');
    const back = listSummary(moduleRows(LESSONS, done(firstN(3))));
    expect(back.line).toBe('3 of 15 modules · ★ 6 of 45');
    expect(back.nextLine).toBe(`Next: Module 4, ${LESSONS[3].title}`);
    expect(listSummary(moduleRows(LESSONS, done(firstN(15)))).nextLine).toBe('Every module flown');
  });

  it('opens on the block holding the next module', () => {
    expect(openingBlock(moduleRows(LESSONS, {}))).toBe(0);
    expect(openingBlock(moduleRows(LESSONS, done(firstN(4))))).toBe(1);
    expect(openingBlock(moduleRows(LESSONS, done(firstN(15))))).toBe(3);
  });
});

// ---- Star tiers -------------------------------------------------------------

describe('star tiers', () => {
  it("every rule's `within` is the time its own test compares against", () => {
    // Display-only field beside the scoring code: this is what keeps them one number.
    let timed = 0;
    for (const lesson of LESSONS) {
      for (const rule of lesson.stars) {
        const m = /timeSec\s*<=\s*([\w.]+(?:\s*\*\s*[\d.]+)?)/.exec(rule.test.toString());
        if (!m) {
          expect(rule.within, `${lesson.id} ${rule.stars}★ sets no time`).toBeUndefined();
          continue;
        }
        timed++;
        expect(rule.within, `${lesson.id} ${rule.stars}★`).toBeTypeOf('number');
        const n = Number(m[1]);
        if (Number.isFinite(n)) expect(rule.within).toBe(n);
      }
    }
    expect(timed).toBeGreaterThan(15);
  });

  it('the navigation routes compute theirs from the same figure the test uses', () => {
    for (const id of ['nav-ab', 'nav-abc', 'nav-abcd']) {
      const [three, two] = getLesson(id)!.stars;
      expect(two.within).toBeCloseTo((three.within as number) * 1.8, 6);
    }
  });

  it('three tiers, one star first: finishing, then the lesson’s own rungs', () => {
    const tiers = tiersFor(arm.stars);
    expect(tiers.map((t) => t.stars)).toEqual([1, 2, 3]);
    expect(tiers[0]).toEqual({ stars: 1, text: FINISH_TIER_TEXT, within: null });
    expect(tiers[1].within).toBe(30);
    expect(tiers[2].within).toBe(16);
  });

  it('the Fly line says which star time is still open', () => {
    const tiers = tiersFor(arm.stars);
    expect(onTimeLine(tiers, 5)).toBe('On time for 3 stars · 3 stars by 16.0 s');
    expect(onTimeLine(tiers, 16)).toBe('On time for 3 stars · 3 stars by 16.0 s');
    expect(onTimeLine(tiers, 20)).toBe('On time for 2 stars · 2 stars by 30.0 s');
    expect(onTimeLine(tiers, 31)).toBe('Past every star time · finishing still earns 1 star');
    // Land & Disarm sets no attempt time: its "in 2s" is the motors, not the clock.
    expect(onTimeLine(tiersFor(land.stars), 50)).toBe(`3 stars: ${land.stars[0].text}`);
  });

  it('result rows: earned below, your result, and how far over above', () => {
    const rows = resultTiers(tiersFor(arm.stars), 2, 20);
    expect(rows.map((r) => [r.stars, r.state, r.note])).toEqual([
      [1, 'earned', 'Earned'],
      [2, 'result', 'Your result'],
      [3, 'missed', '4.0 s over'],
    ]);
    // Inside the time but not three stars: something other than the clock.
    expect(resultTiers(tiersFor(arm.stars), 2, 10)[2].note).toBe('Not reached');
  });

  it('one gap line naming what the next star takes', () => {
    const tiers = tiersFor(arm.stars);
    expect(gapLine(tiers, 2, 20)).toBe(
      '20.0 s — 3 stars needs 16.0 s or less. Fly it 4.0 s faster.',
    );
    expect(gapLine(tiers, 2, 10)).toBe(`3 stars needs: ${arm.stars[0].text}.`);
    expect(gapLine(tiers, 3, 10)).toBe('Every star earned. Replay it to beat your time.');
  });

  it('personal best: first pass, faster, slower', () => {
    expect(personalBestLine(null, 12.4)).toEqual({
      isNew: true,
      text: 'First time flown. Best time 12.4 s.',
    });
    expect(personalBestLine(15, 12.4)).toEqual({
      isNew: true,
      text: 'New personal best. 12.4 s, down from 15.0 s.',
    });
    expect(personalBestLine(10.2, 12.4).isNew).toBe(false);
    expect(yourBestText(undefined)).toBeNull();
    expect(yourBestText({ completed: true, stars: 2, bestScore: 1, bestTimeSec: 10.2 })).toBe(
      'Your best: 10.2 s · 2 of 3',
    );
    expect(yourBestText({ completed: true, stars: 2, bestScore: 1 })).toBe('Your best: 2 of 3');
  });
});

// ---- Band, demo, fly --------------------------------------------------------

describe('step band and strips', () => {
  it('✓ done, ● current, numbers to come; Done is ticked once reached', () => {
    expect(bandStates('intro')).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(bandStates('practice')).toEqual(['done', 'done', 'now', 'todo']);
    expect(bandStates('reward')).toEqual(['done', 'done', 'done', 'done']);
  });

  it('classroom for Learn and Done, cockpit for Demo and Fly', () => {
    expect(registerFor('intro')).toBe('classroom');
    expect(registerFor('demo')).toBe('cockpit');
    expect(registerFor('practice')).toBe('cockpit');
    expect(registerFor('reward')).toBe('classroom');
  });

  it('demo clock runs against the same length the Director ends a pass at', () => {
    expect(demoLength(arm.demo)).toBeCloseTo(arm.demo[arm.demo.length - 1].at + 1.6, 6);
    const total = formatClock(Math.round(demoLength(arm.demo)));
    expect(demoClockText(arm, 5)).toBe(`0:05 / ${total}`);
    expect(demoClockText(arm, 999)).toBe(`${total} / ${total}`);
    expect(formatClock(75)).toBe('1:15');
  });

  it('a long step row shows a window around the live chip', () => {
    expect(chipWindow(3, 1)).toEqual([0, 3]);
    expect(chipWindow(8, 0)).toEqual([0, 4]);
    expect(chipWindow(8, 5)).toEqual([4, 8]);
    expect(chipWindow(8, 99)).toEqual([4, 8]);
  });

  it('step heading clamps the all-done cursor to the last step', () => {
    expect(stepHeading(['Arm', 'Take off', 'Hover'], 0)).toBe('Step 1 of 3 · Arm');
    expect(stepHeading(['Arm', 'Take off', 'Hover'], 3)).toBe('Step 3 of 3 · Hover');
    expect(stepHeading([], 0)).toBeNull();
  });

  it('Learn meta line uses the lesson’s own duration only when it has one', () => {
    expect(learnMeta(1, 15, arm)).toBe('Module 1 of 15 · Ground Handling · about 15 seconds');
    const pitch = getLesson('pitch')!;
    expect(learnMeta(5, 15, pitch)).toBe('Module 5 of 15 · Attitude');
  });
});

// ---- Store ------------------------------------------------------------------

function settingsWith(lessons: Record<string, LessonProgress> = {}) {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, training: { xp: 0, lessons } },
    set: ((k: string, v: unknown) =>
      useSettingsStore.setState((s) => ({ settings: { ...s.settings, [k]: v } }))) as never,
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  settingsWith();
  useShellStore.setState({ context: '', contextTag: '' });
  useTrainingStore.getState().exitLesson();
});

describe('trainingStore results', () => {
  it('keeps the fastest time and remembers the best before this go', () => {
    const t = useTrainingStore.getState();
    t.start('arm-takeoff');
    t.completeLesson('arm-takeoff', 2, 2 / 3, 20);
    let s = useTrainingStore.getState();
    expect(s.lastBestBefore).toBeNull();
    expect(useSettingsStore.getState().settings.training.lessons['arm-takeoff'].bestTimeSec).toBe(
      20,
    );

    s.start('arm-takeoff');
    s.completeLesson('arm-takeoff', 3, 1, 14);
    s = useTrainingStore.getState();
    expect(s.lastBestBefore).toBe(20);
    expect(useSettingsStore.getState().settings.training.lessons['arm-takeoff'].bestTimeSec).toBe(
      14,
    );

    s.start('arm-takeoff');
    s.completeLesson('arm-takeoff', 2, 2 / 3, 25);
    expect(useSettingsStore.getState().settings.training.lessons['arm-takeoff'].bestTimeSec).toBe(
      14,
    );
    expect(useSettingsStore.getState().settings.training.lessons['arm-takeoff'].stars).toBe(3);
  });

  it('a result starts the countdown; Cancel stops it; a new lesson resets it', () => {
    const t = useTrainingStore.getState();
    t.start('arm-takeoff');
    t.completeLesson('arm-takeoff', 1, 1 / 3, 40);
    expect(useTrainingStore.getState().autoAdvance).toBe(true);
    expect(useTrainingStore.getState().advanceIn).toBe(AUTO_ADVANCE_SEC);
    expect(AUTO_ADVANCE_SEC).toBe(10);
    useTrainingStore.getState().cancelAutoAdvance();
    expect(useTrainingStore.getState().autoAdvance).toBe(false);
    useTrainingStore.getState().start('land-disarm');
    expect(useTrainingStore.getState().autoAdvance).toBe(false);
  });
});

// ---- Screens ----------------------------------------------------------------

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
const key = (code: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
  });

describe('module list screen', () => {
  it('first run: one primary row, Module 1, focused; the rest locked', () => {
    const el = mount(h(LessonSelect));
    const primary = $$(el, '[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0].dataset.lesson).toBe(LESSONS[0].id);
    expect(document.activeElement).toBe(primary[0]);
    const rows = $$(el, '.tlist__row');
    expect(rows).toHaveLength(4);
    expect(rows[1].getAttribute('aria-disabled')).toBe('true');
    expect(rows[1].textContent).toContain('After Module 1');
    expect(useShellStore.getState().context).toBe(`Module 1 of 15 · ${LESSONS[0].title}`);
  });

  it('a locked row does nothing; the whole next row opens the lesson', () => {
    const el = mount(h(LessonSelect));
    act(() => $$(el, '.tlist__row')[1].click());
    expect(useTrainingStore.getState().activeLessonId).toBeNull();
    act(() => $$(el, '.tlist__row')[0].click());
    expect(useTrainingStore.getState().activeLessonId).toBe(LESSONS[0].id);
    expect(useTrainingStore.getState().phase).toBe('intro');
  });

  it('a locked block can still be opened and read', () => {
    const el = mount(h(LessonSelect));
    const blocks = $$(el, '.tlist__block');
    expect(blocks).toHaveLength(4);
    expect(blocks[1].textContent).toContain('Locked · finish Ground Handling');
    act(() => blocks[1].click());
    expect($(el, '.tlist__table h2').textContent).toBe('Attitude');
    expect($$(el, '.tlist__row')[0].textContent).toContain(LESSONS[4].title);
  });

  it('returning: opens on the next block, with best time and stars', () => {
    settingsWith(done(firstN(4), { stars: 3, bestTimeSec: 11 }));
    const el = mount(h(LessonSelect));
    expect($(el, '.tlist__table h2').textContent).toBe('Attitude');
    expect($(el, '[data-primary]').dataset.lesson).toBe(LESSONS[4].id);
    act(() => $$(el, '.tlist__block')[0].click());
    expect($$(el, '.tlist__row')[0].textContent).toContain('11.0 s');
    expect($$(el, '.tlist__row')[0].textContent).toContain('3 of 3');
    expect($(el, '.tlist__sum').textContent).toContain('4 of 15 modules · ★ 12 of 45');
  });
});

describe('lesson HUD', () => {
  it('Learn: band, keys strip, Watch demonstration focused; S skips, Enter watches', () => {
    useTrainingStore.getState().start('arm-takeoff');
    const el = mount(h(TrainingHud));
    expect($(el, '.tband').dataset.register).toBe('classroom');
    expect($(el, '.tband__step.is-now').textContent).toContain('Learn');
    expect($(el, '.tlearn__flow').textContent).toContain('ENTER');
    expect(document.activeElement?.textContent).toContain('Watch demonstration');
    expect($$(el, '.tlearn__tier')).toHaveLength(3);

    (document.activeElement as HTMLElement).blur();
    key('Enter');
    expect(useTrainingStore.getState().phase).toBe('demo');

    act(() => useTrainingStore.getState().setPhase('intro'));
    key('KeyS');
    expect(useTrainingStore.getState().phase).toBe('practice');
  });

  it('Fly: before lift-off the clock waits and says so', () => {
    useTrainingStore.getState().start('arm-takeoff');
    act(() => useTrainingStore.getState().setPhase('practice'));
    const el = mount(h(TrainingHud));
    expect($(el, '.tbar__clock').textContent).toBe('0.0 s');
    expect($(el, '.tbar__line').textContent).toBe('Timer starts when you take off');
    act(() => useTrainingStore.getState().setFlightClock(7.2, 'paused'));
    expect($(el, '.tbar__status').textContent).toContain('Outside the box · paused');
    expect($(el, '.tbar').className).toContain('is-paused');
  });

  it('Fly: step heading, star times on the bar, the band in cockpit', () => {
    useTrainingStore.getState().start('arm-takeoff');
    act(() => useTrainingStore.getState().setPhase('practice'));
    act(() => useTrainingStore.getState().setFlightClock(5, 'running'));
    const el = mount(h(TrainingHud));
    expect($(el, '.tband').dataset.register).toBe('cockpit');
    expect($(el, '.tfly__step').textContent).toBe('Step 1 of 3 · Arm');
    expect($(el, '.tbar__line').textContent).toBe('On time for 3 stars · 3 stars by 16.0 s');
    expect($$(el, '.tbar__mark').map((m) => m.textContent)).toEqual(['30.0 s', '16.0 s']);
    expect($(el, '.tbar__status').textContent).toContain('In box · timing');
    expect($(el, '.tband__right').textContent).toContain('Pause');
  });

  it('Done: stars, tiers, gap line, countdown with Cancel', () => {
    useTrainingStore.getState().start('arm-takeoff');
    act(() => useTrainingStore.getState().completeLesson('arm-takeoff', 2, 2 / 3, 20));
    const el = mount(h(TrainingHud));
    expect($(el, '.tresult__title').textContent).toContain('2 of 3 stars');
    expect($$(el, '.tresult__tier').map((t) => t.className.split('is-')[1])).toEqual([
      'earned',
      'result',
      'missed',
    ]);
    expect($(el, '.tresult__gap').textContent).toContain('Fly it 4.0 s faster');
    expect($(el, '.tresult__pb').textContent).toBe('First time flown. Best time 20.0 s.');
    expect($(el, '.tresult__count').textContent).toContain('Next module in 10 s');
    expect($(el, '.tband__right').textContent).toContain('Stop auto-advance');
    expect(document.activeElement?.textContent).toContain('Next: Module 2');

    const cancel = $$(el, '.tresult__count button')[0];
    act(() => cancel.click());
    expect(useTrainingStore.getState().autoAdvance).toBe(false);
    expect($(el, '.tresult__count')).toBeNull();
    expect($(el, '.tband__right').textContent).toContain('Module list');
  });
});

// ---- Flight clock and box ---------------------------------------------------

describe('flight clock (from take-off, paused outside the box)', () => {
  it('an on-the-spot module gets the minimum box around the pad', () => {
    const b = lessonBox(arm);
    expect(b).toEqual({
      minX: -BOX_MIN_HALF_M,
      maxX: BOX_MIN_HALF_M,
      minZ: -BOX_MIN_HALF_M,
      maxZ: BOX_MIN_HALF_M,
    });
  });

  it('a route module’s box reaches every checkpoint with the margin to spare', () => {
    for (const lesson of LESSONS) {
      const b = lessonBox(lesson);
      for (const c of lesson.route ?? []) {
        expect(c.at[0] - b.minX, `${lesson.id} ${c.label}`).toBeGreaterThanOrEqual(BOX_MARGIN_M);
        expect(b.maxX - c.at[0]).toBeGreaterThanOrEqual(BOX_MARGIN_M);
        expect(c.at[2] - b.minZ).toBeGreaterThanOrEqual(BOX_MARGIN_M);
        expect(b.maxZ - c.at[2]).toBeGreaterThanOrEqual(BOX_MARGIN_M);
      }
      const ring = lesson.guideRing?.radius;
      if (ring) expect(b.maxX).toBeGreaterThanOrEqual(ring + BOX_MARGIN_M);
    }
    const pitch = lessonBox(getLesson('pitch')!);
    expect(insideBox(pitch, 0, 0)).toBe(true);
    expect(insideBox(pitch, 0, pitch.minZ - 0.1)).toBe(false);
  });

  it('waits on the ground, runs in the box, pauses outside, keeps running after a landing', () => {
    const c = newFlightClock();
    tickFlightClock(c, false, true, 3); // arming on the pad
    expect(c).toEqual({ state: 'waiting', seconds: 0 });
    tickFlightClock(c, true, true, 2); // lifted off
    expect(c).toEqual({ state: 'running', seconds: 2 });
    tickFlightClock(c, true, false, 5); // flown out of the box
    expect(c).toEqual({ state: 'paused', seconds: 2 });
    tickFlightClock(c, true, true, 1); // back in
    tickFlightClock(c, false, true, 1.5); // landed at the end: still the flight
    expect(c).toEqual({ state: 'running', seconds: 4.5 });
    resetFlightClock(c);
    expect(c).toEqual({ state: 'waiting', seconds: 0 });
  });

  it('the bar line and chip follow the clock', () => {
    const tiers = tiersFor(arm.stars);
    expect(flyLine(tiers, 'waiting', 0)).toBe('Timer starts when you take off');
    expect(flyLine(tiers, 'running', 5)).toBe('On time for 3 stars · 3 stars by 16.0 s');
    expect(clockStatus('waiting', false, false).text).toBe('Not armed');
    expect(clockStatus('waiting', true, false).text).toBe('Armed · on the pad');
    expect(clockStatus('running', true, false)).toEqual({
      tone: 'armed',
      icon: 'dot',
      text: 'In box · timing',
    });
    expect(clockStatus('paused', true, false).tone).toBe('caution');
    expect(clockStatus('running', true, true).text).toBe('Crashed');
  });
});
