// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAMEPAD, DEFAULT_SETTINGS, type GamepadAction } from '@shared/types';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { classroom2 } from '../src/renderer/plugins/environments/classroom2';
import { droneAcademy } from '../src/renderer/plugins/environments/droneAcademy';
import { registerDrone, registerEnvironment } from '../src/renderer/plugins/registry';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useShellStore } from '../src/renderer/state/shellStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { Hangar } from '../src/renderer/app/Hangar';
import { turnFor } from '../src/renderer/app/HangarScene';
import { TopBar } from '../src/renderer/app/TopBar';
import { Sidebar } from '../src/renderer/app/Sidebar';
import { attachMenuGamepad } from '../src/renderer/input/menuGamepad';
import { attachGamepad, setActionHandler, setGamepadConfig } from '../src/renderer/input/gamepad';
import { chaseReport, PULL_IN_NOTICE } from '../src/renderer/scene/cameraReport';
import { FlightHud } from '../src/renderer/hud/FlightHud';
import { CrashCard, PauseCard } from '../src/renderer/hud/FlightCards';
import { declsFor, stylesheet } from './helpers/css';

// The parts of the seven PDFs that were built but had no test: the Hangar
// turntable's ❚❚ Pause and reduced motion, LB / RB in the Hangar, the < 1200 px
// shell, the cockpit's safe zone, the chase camera's pull-in chip, and a
// gamepad on the pause and crash cards.

// The turntable is a WebGL canvas; jsdom has none. The stand-in shows what the
// Hangar hands it, which is the part under test; `turnFor` (what the canvas does
// with it each frame) is the real one.
vi.mock('../src/renderer/app/HangarScene', async (original) => ({
  ...(await original<typeof import('../src/renderer/app/HangarScene')>()),
  HangarScene: ({ spec, paused }: { spec: { id: string }; paused: boolean }) =>
    h('div', { 'data-scene': spec.id, 'data-paused': String(paused) }),
}));
vi.mock('../src/renderer/audio/sfx', () => ({
  playClick: () => {},
  playSuccess: () => {},
  playStar: () => {},
  playRankUp: () => {},
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
const $ = (el: ParentNode, sel: string) => el.querySelector<HTMLElement>(sel)!;
const $$ = (el: ParentNode, sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
const buttonNamed = (el: ParentNode, text: string) =>
  $$(el, 'button').find((b) => b.textContent?.trim().startsWith(text))!;

let reduce = false;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const d of [plutoDrone, guruDrone, racingDrone]) registerDrone(d);
  for (const e of [classroom2, droneAcademy]) registerEnvironment(e);
});
beforeEach(() => {
  reduce = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? reduce : q.includes('min-width: 1200px'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      hud: { ...DEFAULT_SETTINGS.hud },
      selectedDroneId: 'pluto',
      selectedEnvironmentId: 'classroom2',
    },
  });
  useUiStore.setState({ section: 'hangar', cameraMode: 'chase', panelOpen: false, hudPanelOpen: false });
  useFlightStore.setState({ paused: false, crashed: false, exitAsk: false, armed: false, onGround: true });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
  chaseReport.pulledIn = 0;
  chaseReport.distance = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- (a) Hangar turntable: ❚❚ Pause and reduced motion ----------------------

describe('Hangar turntable', () => {
  it('turns by default; ❚❚ Pause stops it and says Turn; pressing again turns it', () => {
    const el = mount(h(Hangar));
    expect($(el, '[data-scene]').dataset.paused).toBe('false');
    const btn = $(el, '.hangar__pause');
    expect(btn.textContent).toBe('Pause');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    act(() => btn.click());
    expect($(el, '[data-scene]').dataset.paused).toBe('true');
    expect(btn.textContent).toBe('Turn');
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    act(() => btn.click());
    expect($(el, '[data-scene]').dataset.paused).toBe('false');
    expect(btn.textContent).toBe('Pause');
  });

  it('starts paused when the system asks for reduced motion', () => {
    reduce = true;
    const el = mount(h(Hangar));
    expect($(el, '[data-scene]').dataset.paused).toBe('true');
    expect($(el, '.hangar__pause').textContent).toBe('Turn');
    expect($(el, '.hangar__pause').getAttribute('aria-pressed')).toBe('true');
  });

  it('a paused turntable stays paused while stepping to the next drone', () => {
    const el = mount(h(Hangar));
    act(() => $(el, '.hangar__pause').click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
    });
    expect($(el, '[data-scene]').dataset.scene).toBe('pluto-guru');
    expect($(el, '[data-scene]').dataset.paused).toBe('true');
  });

  it('the canvas turns nothing while paused, one turn in about 18 s otherwise', () => {
    expect(turnFor(1 / 60, true)).toBe(0);
    expect(turnFor(5, true)).toBe(0);
    const perSecond = turnFor(1, false);
    expect(perSecond).toBeGreaterThan(0);
    expect((2 * Math.PI) / perSecond).toBeGreaterThan(15);
    expect((2 * Math.PI) / perSecond).toBeLessThan(20);
    expect(turnFor(0.5, false)).toBeCloseTo(perSecond / 2, 10);
  });
});

// ---- A standard-mapping gamepad, driven frame by frame ---------------------

const pad = { buttons: [] as boolean[], axes: [0, 0, 0, 0] };
// Every rAF loop in the app (the menu pad and the flight pad) runs each frame,
// in the order they were attached — the order a real frame runs them in.
let frames: { id: number; cb: FrameRequestCallback }[] = [];
let nextFrame = 0;
let now = 0;
function usePad(): void {
  pad.buttons = Array(17).fill(false);
  pad.axes = [0, 0, 0, 0];
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    nextFrame += 1;
    frames.push({ id: nextFrame, cb });
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter((f) => f.id !== id);
  });
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => [
      {
        index: 0,
        id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
        mapping: 'standard',
        buttons: pad.buttons.map((pressed) => ({ pressed })),
        axes: pad.axes,
      },
    ],
  });
}
/** Run one poll `ms` after the last. */
function tick(ms = 16): void {
  now += ms;
  const due = frames;
  frames = [];
  act(() => {
    for (const f of due) f.cb(now);
  });
}
/** Press button `i` for one poll, then release it for one. */
function tap(i: number): void {
  pad.buttons[i] = true;
  tick();
  pad.buttons[i] = false;
  tick();
}
const START = 9;
const LB = 4;
const RB = 5;
const A = 0;
const B = 1;
const UP = 12;
const DOWN = 13;
const LEFT = 14;
const RIGHT = 15;

// ---- (b) LB / RB step the Hangar's drones -----------------------------------

describe('Hangar on a gamepad', () => {
  it('RB steps to the next drone and LB back, wrapping, like E and Q', () => {
    usePad();
    const el = mount(h(Hangar));
    const detach = attachMenuGamepad(() => true);
    const viewed = () =>
      $(el, '[aria-pressed="true"].hangar__drone .hangar__drone-name').textContent ?? '';

    tap(RB);
    expect(viewed()).toBe('Pluto Guru');
    tap(RB);
    expect(viewed()).toBe('Racing Drone');
    tap(RB);
    expect(viewed()).toBe('Pluto');
    tap(LB);
    expect(viewed()).toBe('Racing Drone');
    expect(useShellStore.getState().context).toBe('Drone 3 of 3 · Racing Drone');
    // Viewing is not the loadout.
    expect(useSettingsStore.getState().settings.selectedDroneId).toBe('pluto');
    detach();
  });

  it('one press is one step: a held shoulder button does not repeat', () => {
    usePad();
    const el = mount(h(Hangar));
    const detach = attachMenuGamepad(() => true);
    pad.buttons[RB] = true;
    for (let i = 0; i < 40; i += 1) tick(50);
    expect($(el, '[aria-pressed="true"].hangar__drone').textContent).toContain('Pluto Guru');
    detach();
  });

  it('off a menu page (a flight, a card) LB / RB are not Q / E', () => {
    usePad();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.code);
    window.addEventListener('keydown', spy);
    const detach = attachMenuGamepad(() => false, () => true);
    tap(LB);
    tap(RB);
    expect(seen).toEqual([]);
    detach();
    window.removeEventListener('keydown', spy);
  });
});

// ---- (c) The shell below 1200 px --------------------------------------------

describe('shell below 1200 px', () => {
  const css = stylesheet('shell.css');
  const COMPACT = '(max-width: 1199.98px)';

  it('the switch sits at 1200 CSS px: 1199 is compact, 1200 is wide', () => {
    const compact = css.filter((r) => r.media === COMPACT);
    expect(compact.length).toBeGreaterThan(0);
    // No other width breakpoint the shell could disagree with.
    const widths = new Set(css.map((r) => r.media).filter((m) => m.includes('width')));
    expect([...widths]).toEqual([COMPACT]);
    const max = parseFloat(/max-width: ([\d.]+)px/.exec(COMPACT)![1]);
    expect(1199).toBeLessThanOrEqual(max);
    expect(1200).toBeGreaterThan(max);
  });

  it('wide: top bar 72, sidebar 240, padding 40 / 48', () => {
    const app = declsFor(css, '.app');
    expect(app['--shell-top-h']).toBe('72px');
    expect(app['--shell-nav-w']).toBe('240px');
    expect(app['--shell-pad']).toBe('40px 48px');
    // The grid really is sized by the variables the compact rule changes.
    expect(app['grid-template-columns']).toMatch(/^var\(--shell-nav-w\) /);
    expect(app['grid-template-rows']).toMatch(/^var\(--shell-top-h\) /);
  });

  it('compact: top bar 64, sidebar 208, padding 28', () => {
    const app = declsFor(css, '.app', COMPACT);
    expect(app['--shell-top-h']).toBe('64px');
    expect(app['--shell-nav-w']).toBe('208px');
    expect(app['--shell-pad']).toBe('28px');
  });

  it('compact drops the tagline and the NEXT FLIGHT label, and only there', () => {
    for (const sel of ['.topbar__tagline', '.topbar__next', '.loadout-chip__key']) {
      expect(declsFor(css, sel, COMPACT).display).toBe('none');
      expect(declsFor(css, sel).display).not.toBe('none');
    }
  });

  it('those rules hit what the top bar renders: the tagline and the label exist', () => {
    const el = mount(h(TopBar));
    expect($(el, '.topbar__tagline').textContent).toBe('Flight Simulator by Drona Aviation');
    expect($(el, '.topbar__next').textContent).toBe('Next flight');
    // The brand name itself stays.
    expect($(el, '.topbar__name').textContent).toBe('PlutoSim');
  });

  it('the 208 px sidebar keeps its labels — never icon-only', () => {
    for (const sel of ['.sidenav', '.sidenav__item', '.sidenav__label']) {
      expect(declsFor(css, sel, COMPACT).display).toBeUndefined();
    }
    expect(declsFor(css, '.sidenav__label').display).not.toBe('none');
    const el = mount(h(Sidebar));
    const labels = $$(el, '.sidenav__label').map((l) => l.textContent);
    expect(labels).toContain('Home');
    expect(labels).toContain('Hangar');
    expect(labels.every((l) => (l ?? '').length > 0)).toBe(true);
  });
});

// ---- (d) The cockpit's safe zone --------------------------------------------

describe('cockpit safe zone (1280 × 720)', () => {
  const css = stylesheet('cockpit.css');
  const INSET = 36;
  const CORNER = 48;
  const inset = parseFloat(declsFor(css, '.cockpit')['--ck-inset']);

  /** A side offset in px, 'centre' for 50 %, or undefined when not set. */
  function offset(v: string | undefined): number | 'centre' | undefined {
    if (v === undefined) return undefined;
    if (v === '50%') return 'centre';
    if (v === 'var(--ck-inset)') return inset;
    const calc = /^calc\(var\(--ck-inset\) \+ (\d+(?:\.\d+)?)px\)$/.exec(v);
    if (calc) return inset + Number(calc[1]);
    if (/^\d+(\.\d+)?px$/.test(v)) return parseFloat(v);
    throw new Error(`unexpected offset ${v}`);
  }

  /** Every rule for the element's classes, merged in order (base, then modifier). */
  function anchorOf(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of Array.from(el.classList)) Object.assign(out, declsFor(css, `.${c}`));
    return out;
  }

  it('the inset is 36 px', () => {
    expect(inset).toBe(INSET);
  });

  it('every plate on the canvas sits ≥ 36 px from the edges and clear of the corners', () => {
    // FPV so the crosshair is there too; full HUD, nothing folded.
    useUiStore.setState({ section: 'fly', cameraMode: 'fpv' });
    const el = mount(h(FlightHud));
    const parts = $$(el, '.cockpit > *');
    const names = parts.map((p) => p.className);
    // The whole cluster is here: camera, heading, context, both side plates,
    // sticks, key bar.
    for (const want of ['ck-top-left', 'ck-top-centre', 'ck-context', 'ck-left', 'ck-right', 'ck-keybar']) {
      expect(names.some((n) => n.split(' ').includes(want))).toBe(true);
    }
    expect(names.filter((n) => n.includes('ck-stick'))).toHaveLength(2);

    for (const part of parts) {
      const a = anchorOf(part);
      // The crosshair marks the centre of the screen; it is not a plate.
      if (part.classList.contains('ck-crosshair')) {
        expect([a.top, a.left]).toEqual(['50%', '50%']);
        continue;
      }
      expect(a.position, part.className).toBe('absolute');
      const sides = {
        top: offset(a.top),
        bottom: offset(a.bottom),
        left: offset(a.left),
        right: offset(a.right),
      };
      const px = Object.values(sides).filter((v): v is number => typeof v === 'number');
      expect(px.length, `${part.className} is anchored`).toBeGreaterThan(0);
      for (const v of px) expect(v, part.className).toBeGreaterThanOrEqual(INSET);
      // Anchored to two edges = in a corner: its nearest point stays more than
      // 48 px from the screen's corner point.
      const x = typeof sides.left === 'number' ? sides.left : sides.right;
      const y = typeof sides.top === 'number' ? sides.top : sides.bottom;
      if (typeof x === 'number' && typeof y === 'number') {
        expect(Math.hypot(x, y), part.className).toBeGreaterThanOrEqual(CORNER);
      }
    }
  });

  it('the quiet bar sits on the bottom edge at the inset, centred', () => {
    const q = declsFor(css, '.ck-quiet');
    expect(q.position).toBe('absolute');
    expect(offset(q.bottom)).toBe(INSET);
    expect(q.left).toBe('50%');
    expect(q.height).toBe('36px');
  });

  it('the sticks sit further in (48 px) than the edge plates, so they clear the corners', () => {
    expect(offset(declsFor(css, '.ck-stick--left').left)).toBe(CORNER);
    expect(offset(declsFor(css, '.ck-stick--right').right)).toBe(CORNER);
    expect(offset(declsFor(css, '.ck-stick').bottom)).toBe(INSET);
  });
});

// ---- (e) The chase camera's pull-in report and chip -------------------------

describe('chase camera pulled in', () => {
  it('the report starts clear, and the notice threshold is a real graze', () => {
    expect(chaseReport).toEqual({ pulledIn: 0, distance: 0 });
    expect(PULL_IN_NOTICE).toBeGreaterThan(0);
    expect(PULL_IN_NOTICE).toBeLessThan(1);
  });

  function hudWith(pulledIn: number, distance: number, camera: 'chase' | 'fpv' | 'orbit' = 'chase') {
    vi.useFakeTimers();
    useUiStore.setState({ section: 'fly', cameraMode: camera });
    const el = mount(h(FlightHud));
    chaseReport.pulledIn = pulledIn;
    chaseReport.distance = distance;
    // The HUD re-reads at 10 Hz.
    act(() => vi.advanceTimersByTime(150));
    return el;
  }

  it('held in past the notice: "Chase pulled in to 0.6 m" as a status line under the camera chip', () => {
    const el = hudWith(1.4, 0.62);
    const chip = $(el, '.ck-pulled');
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('role')).toBe('status');
    expect(chip.textContent).toBe('Chase pulled in to 0.6 m · something behind');
    expect(chip.closest('.ck-top-left')).not.toBeNull();
  });

  it('a graze under the notice shows nothing', () => {
    const el = hudWith(PULL_IN_NOTICE - 0.01, 2);
    expect(el.querySelector('.ck-pulled')).toBeNull();
  });

  it('only the chase camera reports it', () => {
    expect(hudWith(1.4, 0.6, 'fpv').querySelector('.ck-pulled')).toBeNull();
    act(() => root?.unmount());
    root = undefined;
    expect(hudWith(1.4, 0.6, 'orbit').querySelector('.ck-pulled')).toBeNull();
  });

  it('the chip goes when the camera is let out again', () => {
    const el = hudWith(1.4, 0.6);
    expect(el.querySelector('.ck-pulled')).not.toBeNull();
    chaseReport.pulledIn = 0;
    act(() => vi.advanceTimersByTime(150));
    expect(el.querySelector('.ck-pulled')).toBeNull();
  });
});

// ---- (f) A gamepad on the pause and crash cards -----------------------------

describe('gamepad on the flight cards', () => {
  const focused = () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '';

  it('pause card: D-pad ↓ ↑ step the buttons, wrapping; A presses the focused one', () => {
    usePad();
    const onSettings = vi.fn();
    useFlightStore.setState({ paused: true });
    mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 192 },
        onRestart: () => {},
        onSettings,
        onExit: () => {},
      }),
    );
    const detach = attachMenuGamepad(() => false, () => true);
    expect(focused()).toMatch(/^Resume/);
    tap(DOWN);
    expect(focused()).toBe('Restart');
    tap(DOWN);
    expect(focused()).toBe('Settings');
    tap(UP);
    expect(focused()).toBe('Restart');
    tap(UP);
    tap(UP);
    expect(focused()).toBe('Exit');
    tap(DOWN);
    expect(focused()).toMatch(/^Resume/);
    tap(DOWN);
    tap(DOWN);
    tap(A);
    expect(onSettings).toHaveBeenCalledTimes(1);
    detach();
  });

  it('A on Resume resumes; B is Esc (App resumes a paused flight on it)', () => {
    usePad();
    useFlightStore.setState({ paused: true });
    mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 12 },
        onRestart: () => {},
        onExit: () => {},
      }),
    );
    const detach = attachMenuGamepad(() => false, () => true);
    const escapes: string[] = [];
    const spy = (e: KeyboardEvent) => escapes.push(e.key);
    window.addEventListener('keydown', spy);
    tap(B);
    expect(escapes).toEqual(['Escape']);
    window.removeEventListener('keydown', spy);

    tap(A);
    expect(useFlightStore.getState().paused).toBe(false);
    detach();
  });

  it('a held D-pad repeats after 400 ms, then every 140 ms', () => {
    usePad();
    useFlightStore.setState({ paused: true });
    mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 12 },
        onRestart: () => {},
        onSettings: () => {},
        onExit: () => {},
      }),
    );
    const detach = attachMenuGamepad(() => false, () => true);
    pad.buttons[DOWN] = true;
    tick();
    expect(focused()).toBe('Restart');
    tick(300);
    expect(focused()).toBe('Restart');
    tick(120);
    expect(focused()).toBe('Settings');
    tick(150);
    expect(focused()).toBe('Exit');
    detach();
  });

  it('crash card: D-pad ← → move along its row; A on Pause menu pauses', () => {
    usePad();
    useFlightStore.setState({ crashed: true, crashSpeed: 2.4, crashAt: { altitude: 1.2 } } as never);
    mount(h(CrashCard, { context: 'Free Flight · Classroom', when: '3:12', onReset: () => {} }));
    const detach = attachMenuGamepad(() => false, () => true);
    expect(focused()).toMatch(/^Reset to start pad/);
    tap(LEFT);
    expect(focused()).toBe('Pause menu');
    tap(RIGHT);
    expect(focused()).toMatch(/^Reset to start pad/);
    tap(RIGHT);
    expect(focused()).toBe('Pause menu');
    tap(A);
    expect(useFlightStore.getState().paused).toBe(true);
    detach();
  });

  it('crash card: A on Reset to start pad resets', () => {
    usePad();
    const onReset = vi.fn();
    useFlightStore.setState({ crashed: true, crashSpeed: 1, crashAt: { altitude: 0.5 } } as never);
    mount(h(CrashCard, { context: 'Free Flight · Classroom', when: '0:40', onReset }));
    const detach = attachMenuGamepad(() => false, () => true);
    tap(A);
    expect(onReset).toHaveBeenCalledTimes(1);
    detach();
  });

  it('the exit question: → from Keep flying reaches Exit', () => {
    usePad();
    const onExit = vi.fn();
    useFlightStore.setState({ paused: true, exitAsk: true });
    mount(
      h(PauseCard, {
        context: { kind: 'mission', num: 1, name: 'Precision Delivery', usedSec: 72, limitSec: 480 },
        onRestart: () => {},
        onExit,
      }),
    );
    const detach = attachMenuGamepad(() => false, () => true);
    expect(focused()).toMatch(/^Keep flying/);
    tap(RIGHT);
    expect(focused()).toBe('Exit');
    tap(A);
    expect(onExit).toHaveBeenCalledTimes(1);
    detach();
  });

  it('the keyboard ← → do the same on the crash card', () => {
    useFlightStore.setState({ crashed: true, crashSpeed: 1, crashAt: { altitude: 0.5 } } as never);
    const el = mount(h(CrashCard, { context: 'Free Flight', when: '0:40', onReset: () => {} }));
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(buttonNamed(el, 'Pause menu'));
  });

  it('with no card and no menu the pad does nothing here', () => {
    usePad();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', spy);
    const detach = attachMenuGamepad(() => false, () => false);
    tap(DOWN);
    tap(B);
    tap(LB);
    expect(seen).toEqual([]);
    detach();
    window.removeEventListener('keydown', spy);
  });
  // Found flying it live (2026-09-30): the flight pad reads the same buttons.
  // A on the pause card's Resume unpaused the flight, then the flight loop saw
  // that same A as a fresh press — take-off / land — and the drone landed.
  it('A on Resume does not also reach the flight as take-off / land; A works again after', () => {
    usePad();
    const actions: GamepadAction[] = [];
    setGamepadConfig({ ...DEFAULT_GAMEPAD, enabled: true });
    setActionHandler((a) => {
      // The flight's own rule: a paused flight answers only camera and reset.
      if (useFlightStore.getState().paused && a !== 'cameraCycle' && a !== 'reset') return;
      actions.push(a);
    });
    useFlightStore.setState({ paused: true, armed: true, onGround: false });
    mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 30 },
        onRestart: () => {},
        onExit: () => {},
      }),
    );
    // Menu pad first, flight pad second: the order that lost the press.
    const detachMenu = attachMenuGamepad(() => false, () => useFlightStore.getState().paused);
    const detachFlight = attachGamepad();
    tick();

    tap(A);
    expect(useFlightStore.getState().paused).toBe(false);
    expect(actions).toEqual([]);

    tap(A);
    expect(actions).toEqual(['takeoffLand']);
    detachFlight();
    detachMenu();
    setActionHandler(() => {});
  });

  it('Start and RB keep their flight actions on a paused card (reset, camera)', () => {
    usePad();
    const actions: GamepadAction[] = [];
    setGamepadConfig({ ...DEFAULT_GAMEPAD, enabled: true });
    setActionHandler((a) => actions.push(a));
    useFlightStore.setState({ paused: true });
    mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 30 },
        onRestart: () => {},
        onExit: () => {},
      }),
    );
    const detachMenu = attachMenuGamepad(() => false, () => true);
    const detachFlight = attachGamepad();
    tick();
    tap(RB);
    tap(START);
    expect(actions).toEqual(['cameraCycle', 'reset']);
    detachFlight();
    detachMenu();
    setActionHandler(() => {});
  });
});
