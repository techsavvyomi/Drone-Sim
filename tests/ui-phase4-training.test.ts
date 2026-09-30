// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LESSONS } from '../src/renderer/training/lessons';
import {
  BAND_STEPS,
  bandStates,
  formatSeconds,
  tiersFor,
  timedTiers,
} from '../src/renderer/app/trainingFacts';
import { LessonThumb } from '../src/renderer/hud/LessonThumb';
import { isAirborne, newFlightClock, tickFlightClock } from '../src/renderer/training/flightClock';
import { KeyActions, KeyHints } from '../src/renderer/hud/KeyHints';
import { TrainingScreen } from '../src/renderer/app/TrainingScreen';
import { useTrainingStore } from '../src/renderer/state/trainingStore';

// Phase 4 — Pluto Flight School, the parts the training-screens suite does not
// render: every module's map thumbnail, the key caps under the sticks and the
// command buttons, the step band's order, the tier helpers, and which screen
// the Training section shows.

vi.mock('../src/renderer/training/TrainingViewport', () => ({
  TrainingViewport: () => h('div', { id: 'viewport' }),
}));
vi.mock('../src/renderer/app/LessonSelect', () => ({
  LessonSelect: () => h('div', { id: 'list' }),
}));

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useTrainingStore.getState().exitLesson();
});

describe('step band', () => {
  it('Learn → Demo → Fly → Done, and each step is ✓ once passed, ● while on it', () => {
    expect(BAND_STEPS.map((s) => s.label)).toEqual(['Learn', 'Demo', 'Fly', 'Done']);
    expect(bandStates('intro')).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(bandStates('practice')).toEqual(['done', 'done', 'now', 'todo']);
  });
});

describe('tiers and seconds', () => {
  it('every module: three tiers, one star is finishing, and the timed ones are the ones with a limit', () => {
    for (const l of LESSONS) {
      const tiers = tiersFor(l.stars);
      expect(tiers.map((t) => t.stars)).toEqual([1, 2, 3].slice(0, tiers.length));
      expect(tiers[0].within).toBeNull();
      const timed = timedTiers(tiers);
      expect(timed.every((t) => typeof t.within === 'number' && t.within > 0)).toBe(true);
      expect(timed.length).toBe(tiers.filter((t) => t.within !== null).length);
    }
  });

  it('seconds to one decimal', () => {
    expect(formatSeconds(12.44)).toBe('12.4 s');
    expect(formatSeconds(5)).toBe('5.0 s');
  });
});

describe('flight clock take-off', () => {
  it('only an armed drone off the ground has taken off', () => {
    expect(isAirborne(true, false)).toBe(true);
    expect(isAirborne(false, false)).toBe(false); // a stale "in the air" after the demo
    expect(isAirborne(true, true)).toBe(false);
  });

  it('a disarmed drone whose ground flag lags does not start the clock', () => {
    const c = newFlightClock();
    tickFlightClock(c, isAirborne(false, false), true, 0.5);
    tickFlightClock(c, isAirborne(false, true), true, 0.5);
    expect(c.state).toBe('waiting');
    expect(c.seconds).toBe(0);
    tickFlightClock(c, isAirborne(true, false), true, 0.5);
    expect(c.state).toBe('running');
  });
});

describe('module map thumbnails', () => {
  it.each(LESSONS.map((l) => [l.title, l] as const))('%s: the pad, its route and ring, all inside the frame', (_t, l) => {
    const el = mount(h(LessonThumb, { lesson: l }));
    const svg = el.querySelector('svg.lthumb')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const [, , w, hgt] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(svg.querySelector('.lthumb__pad')).not.toBeNull();
    const points = [...svg.querySelectorAll('.lthumb__point')];
    expect(points).toHaveLength(l.route?.length ?? 0);
    expect(!!svg.querySelector('.lthumb__ring')).toBe(!!l.guideRing);
    for (const c of [...svg.querySelectorAll('circle')]) {
      const x = Number(c.getAttribute('cx'));
      const y = Number(c.getAttribute('cy'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeLessThanOrEqual(hgt);
    }
  });
});

describe('key caps', () => {
  const lesson = LESSONS.find((l) => (l.keys ?? []).some((k) => k.code === 'KeyW') && (l.keys ?? []).some((k) => k.code === 'Enter'))!;

  it('stick keys sit under their own gimbal: W A S D left, arrows right', () => {
    const el = mount(h(KeyHints, { keys: lesson.keys!, demoKeys: [] }));
    const left = el.querySelector('.tr-keypad-left');
    expect(left).not.toBeNull();
    expect(left!.textContent).toContain('W');
    const right = el.querySelector('.tr-keypad-right');
    if (right) expect(right.textContent).not.toContain('W');
    // Caps never take focus: they stand for keys.
    for (const b of [...el.querySelectorAll('button')]) expect(b.tabIndex).toBe(-1);
  });

  it('a demonstrated key lights up; a cued one breathes, until it is pressed', () => {
    const el = mount(h(KeyHints, { keys: lesson.keys!, demoKeys: ['KeyW'], cue: ['KeyS'] }));
    const cap = (face: string) =>
      [...el.querySelectorAll('.tr-key')].find((b) => b.querySelector('kbd')!.textContent === face)!;
    expect(cap('W').className).toContain('on');
    expect(cap('S').className).toContain('cue');
    expect(cap('S').className).not.toContain('on');
  });

  it('commands (Arm, Take off) are the middle buttons, never under a stick', () => {
    const el = mount(h(KeyActions, { keys: lesson.keys!, demoKeys: [] }));
    const caps = [...el.querySelectorAll('.tr-key.action kbd')].map((k) => k.textContent);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(['W', 'A', 'S', 'D', '↑', '↓', '←', '→']).not.toContain(c);
  });

  it('a lesson with no command keys has no command row', () => {
    const el = mount(h(KeyActions, { keys: [{ code: 'KeyW', label: 'W', hint: 'Up' }], demoKeys: [] }));
    expect(el.querySelector('.tr-keys-actions')).toBeNull();
  });
});

describe('Training section', () => {
  it('shows the module list until a lesson starts, then the lesson', () => {
    const el = mount(h(TrainingScreen));
    expect(el.querySelector('#list')).not.toBeNull();
    act(() => useTrainingStore.setState({ activeLessonId: LESSONS[0].id }));
    expect(el.querySelector('#viewport')).not.toBeNull();
    expect(el.querySelector('#list')).toBeNull();
  });
});
