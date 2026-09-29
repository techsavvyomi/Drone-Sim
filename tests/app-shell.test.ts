// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import { shellZoom } from '../src/shared/shellZoom';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { classroom2 } from '../src/renderer/plugins/environments/classroom2';
import { droneAcademy } from '../src/renderer/plugins/environments/droneAcademy';
import { registerDrone, registerEnvironment } from '../src/renderer/plugins/registry';
import { ceilingFor, droneFacts, formatMass, formatMetres } from '../src/renderer/app/loadout';
import {
  attachMenuNav,
  escapeToSidebar,
  moveFocus,
  pickNearest,
  type Box,
} from '../src/renderer/input/menuNav';
import { directionOf } from '../src/renderer/input/menuGamepad';
import { devFpsEnabled, useShellStore } from '../src/renderer/state/shellStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { useAccountStore } from '../src/renderer/state/accountStore';
import { Sidebar } from '../src/renderer/app/Sidebar';
import { TopBar } from '../src/renderer/app/TopBar';
import { StatusBar } from '../src/renderer/app/StatusBar';
import { Hangar } from '../src/renderer/app/Hangar';
import { LoadoutChip } from '../src/renderer/app/LoadoutChip';

// The Phase 1 app shell: top bar, sidebar, status bar, Hangar, and the
// keyboard / gamepad paths through them, against the Phase 1 brief.

// The turntable is a WebGL canvas; jsdom has no WebGL, and nothing here is about it.
vi.mock('../src/renderer/app/HangarScene', () => ({ HangarScene: () => null }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const d of [plutoDrone, guruDrone, racingDrone]) registerDrone(d);
  for (const e of [classroom2, droneAcademy]) registerEnvironment(e);
});

let wide = true;
beforeEach(() => {
  wide = true;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 1200px') ? wide : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      selectedDroneId: 'pluto',
      selectedEnvironmentId: 'classroom-2',
    },
  });
  useUiStore.setState({ section: 'home', previousSection: 'home' });
  useShellStore.setState({ input: 'pointer', legendDevice: 'keyboard', context: '' });
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
function key(target: EventTarget, k: string, code = k, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe('zoom for screens under 1100 × 720', () => {
  it.each([
    [1440, 900, 1],
    [1100, 720, 1],
    [1280, 720, 1],
    [910, 512, 0.711], // 1366 × 768 at 150 %: height is the tighter side
    [1000, 720, 0.909],
    [0, 0, 1],
  ])('%i × %i → %f', (w, hgt, z) => {
    expect(shellZoom(w, hgt)).toBe(z);
  });
});

describe('the ceiling read-out', () => {
  it('the Classroom roof caps a 20 m Pluto at 3 m, and says so', () => {
    expect(ceilingFor(plutoDrone, classroom2)).toEqual({ metres: 2.97, cappedBy: 'Classroom' });
    expect(formatMetres(2.97)).toBe('3 m');
  });

  it('outdoors the drone’s own limit holds when it is lower', () => {
    expect(ceilingFor(plutoDrone, droneAcademy)).toEqual({ metres: 20, cappedBy: null });
  });

  it('a drone that out-climbs the arena is capped by it', () => {
    expect(ceilingFor(racingDrone, droneAcademy)).toEqual({
      metres: 30,
      cappedBy: 'Drone Academy',
    });
  });

  it('formats metres and mass', () => {
    expect(formatMetres(2.5)).toBe('2.5 m');
    expect(formatMetres(20)).toBe('20 m');
    expect(formatMass(0.05)).toBe('50 g');
    expect(formatMass(1.5)).toBe('1.5 kg');
  });
});

describe('Hangar spec card', () => {
  it('reads only real plugin data for the Pluto', () => {
    expect(Object.fromEntries(droneFacts(plutoDrone).map((f) => [f.label, f.value]))).toEqual({
      Mass: '50 g',
      Frame: 'Quad · 4 motors',
      Props: '55 mm',
      Battery: '1S · 300 mAh',
      'Top speed': '8 m/s',
      Ceiling: '20 m',
      Wheelbase: '160 mm',
    });
  });
});

describe('spatial navigation', () => {
  const box = (left: number, top: number, w = 100, hgt = 40): Box => ({
    left,
    top,
    right: left + w,
    bottom: top + hgt,
  });
  const from = box(0, 100);

  it('prefers the same row over a nearer diagonal', () => {
    const cands = [
      { item: 'row', box: box(300, 100) },
      { item: 'diagonal', box: box(120, 180) },
    ];
    expect(pickNearest(from, cands, 'right')).toBe('row');
  });

  it('only looks the way it is asked', () => {
    const cands = [{ item: 'left-of', box: box(-200, 100) }];
    expect(pickNearest(from, cands, 'right')).toBeNull();
    expect(pickNearest(from, cands, 'left')).toBe('left-of');
  });

  it('down takes the nearest below', () => {
    const cands = [
      { item: 'far', box: box(0, 400) },
      { item: 'near', box: box(0, 160) },
      { item: 'above', box: box(0, 20) },
    ];
    expect(pickNearest(from, cands, 'down')).toBe('near');
    expect(pickNearest(from, cands, 'up')).toBe('above');
  });
});

/** A shell in the DOM with laid-out boxes (jsdom has no layout). */
function shellDom() {
  document.body.innerHTML = `
    <header data-nav-region="topbar"><button id="chip">Drone</button></header>
    <nav data-nav-region="sidebar">
      <button data-nav-item id="home" tabindex="-1">Home</button>
      <button data-nav-item id="training" aria-current="page" tabindex="0">Training</button>
      <button data-nav-item id="missions" tabindex="-1">Missions</button>
    </nav>
    <main data-nav-region="content">
      <button id="a">A</button>
      <button id="b" data-primary>B</button>
      <input id="name" type="text" />
    </main>`;
  const place: Record<string, Box> = {
    chip: { left: 900, top: 10, right: 1000, bottom: 50 },
    home: { left: 10, top: 100, right: 200, bottom: 140 },
    training: { left: 10, top: 150, right: 200, bottom: 190 },
    missions: { left: 10, top: 200, right: 200, bottom: 240 },
    a: { left: 300, top: 100, right: 400, bottom: 140 },
    b: { left: 300, top: 200, right: 400, bottom: 240 },
    name: { left: 300, top: 300, right: 500, bottom: 340 },
  };
  for (const [id, b] of Object.entries(place)) {
    const el = document.getElementById(id)!;
    el.getBoundingClientRect = () =>
      ({ ...b, width: b.right - b.left, height: b.bottom - b.top }) as DOMRect;
  }
  return (id: string) => document.getElementById(id)!;
}

describe('menu navigation', () => {
  it('entering the sidebar lands on the active item, not the nearest one', () => {
    const el = shellDom();
    el('a').focus();
    moveFocus('left');
    expect(document.activeElement).toBe(el('training'));
  });

  it('entering content returns to the element last focused there', () => {
    const el = shellDom();
    const detach = attachMenuNav({ isMenu: () => true, jump: () => {} });
    el('b').focus(); // remembered
    el('home').focus();
    moveFocus('right'); // nearest is A, but B was the last one used
    expect(document.activeElement).toBe(el('b'));
    detach();
  });

  it('with nothing focused, the page’s primary action is where it starts', () => {
    const el = shellDom();
    (document.activeElement as HTMLElement | null)?.blur();
    moveFocus('down');
    expect(document.activeElement).toBe(el('b'));
  });

  it('Esc from content or the top bar goes to the active sidebar item', () => {
    const el = shellDom();
    el('a').focus();
    expect(escapeToSidebar()).toBe(true);
    expect(document.activeElement).toBe(el('training'));
    el('chip').focus();
    expect(escapeToSidebar()).toBe(true);
    // Already in the sidebar: the caller's usual Esc (back) runs instead.
    expect(escapeToSidebar()).toBe(false);
  });

  it('1–9 jump on a menu page, but not while typing or in flight', () => {
    const el = shellDom();
    const jump = vi.fn();
    let menu = true;
    const detach = attachMenuNav({ isMenu: () => menu, jump });
    el('a').focus();
    key(window, '4', 'Digit4');
    expect(jump).toHaveBeenLastCalledWith(4);
    el('name').focus();
    key(window, '5', 'Digit5');
    expect(jump).toHaveBeenCalledTimes(1);
    el('a').focus();
    menu = false;
    key(window, '6', 'Digit6');
    expect(jump).toHaveBeenCalledTimes(1);
    detach();
  });

  it('arrows move the focus on a menu page and leave flight views alone', () => {
    const el = shellDom();
    let menu = true;
    const detach = attachMenuNav({ isMenu: () => menu, jump: () => {} });
    el('a').focus();
    key(window, 'ArrowDown');
    expect(document.activeElement).toBe(el('b'));
    menu = false;
    key(window, 'ArrowUp');
    expect(document.activeElement).toBe(el('b'));
    detach();
  });

  it('tracks the last device: keys switch hover off, the pointer switches it on', () => {
    shellDom();
    const detach = attachMenuNav({ isMenu: () => true, jump: () => {} });
    key(window, 'a', 'KeyA');
    expect(document.documentElement.dataset.input).toBe('keyboard');
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(document.documentElement.dataset.input).toBe('pointer');
    expect(useShellStore.getState().legendDevice).toBe('keyboard');
    act(() => useShellStore.getState().setInput('gamepad'));
    expect(useShellStore.getState().legendDevice).toBe('gamepad');
    detach();
  });
});

describe('gamepad in the menus', () => {
  const pad = (pressed: number[] = [], axes: number[] = [0, 0]) => ({
    buttons: Array.from(
      { length: 16 },
      (_, i) => ({ pressed: pressed.includes(i) }) as GamepadButton,
    ),
    axes,
  });

  it('reads the D-pad', () => {
    expect(directionOf(pad([12]))).toBe('up');
    expect(directionOf(pad([15]))).toBe('right');
  });

  it('reads the left stick past 0.6, on its stronger axis', () => {
    expect(directionOf(pad([], [0.3, 0.2]))).toBeNull();
    expect(directionOf(pad([], [0.8, 0.3]))).toBe('right');
    expect(directionOf(pad([], [0.2, -0.9]))).toBe('up');
  });
});

describe('the dev FPS flag', () => {
  it('shows only with --dev-fps (the page sees ?devFps=1)', () => {
    expect(devFpsEnabled('?devFps=1')).toBe(true);
    expect(devFpsEnabled('')).toBe(false);
    expect(devFpsEnabled('?devFps=0')).toBe(false);
  });
});

describe('Sidebar', () => {
  it('numbers eight items, no Studio, and hides Profile without a signed-in profile', () => {
    useAccountStore.setState({ status: 'signedOut' });
    const el = mount(h(Sidebar));
    expect($$(el, '[data-nav-item]').map((b) => b.textContent)).toEqual([
      '1Home●',
      '2Free Flight',
      '3Training',
      '4Missions',
      '5Hangar',
      '7Settings',
      '8About',
    ]);
  });

  it('puts the divider above the second group, whether or not Profile is shown', () => {
    const start = (el: HTMLElement) => $(el, '.sidenav__group-start [data-nav-item]').textContent;
    useAccountStore.setState({ status: 'signedIn' });
    let el = mount(h(Sidebar));
    expect(start(el)).toBe('6Profile');
    act(() => root?.unmount());
    useAccountStore.setState({ status: 'signedOut' });
    el = mount(h(Sidebar));
    expect(start(el)).toBe('7Settings');
    expect($$(el, '.sidenav__group-start')).toHaveLength(1);
  });

  it('marks exactly one item active, and it is the one Tab stop', () => {
    useUiStore.setState({ section: 'missions' });
    const el = mount(h(Sidebar));
    const items = $$(el, '[data-nav-item]');
    const active = items.filter((b) => b.getAttribute('aria-current') === 'page');
    expect(active.map((b) => b.textContent)).toEqual(['4Missions●']);
    expect(items.filter((b) => b.tabIndex === 0)).toEqual(active);
  });

  it('Enter opens the page and moves focus to its primary action', () => {
    const el = mount(h(Sidebar));
    const content = document.createElement('main');
    content.dataset.navRegion = 'content';
    content.innerHTML = '<button>Other</button><button data-primary>Go</button>';
    document.body.appendChild(content);
    const hangar = $$(el, '[data-nav-item]').find((b) => b.textContent?.includes('Hangar'))!;
    act(() => hangar.click()); // a keyboard click: detail 0
    expect(useUiStore.getState().section).toBe('hangar');
    expect(document.activeElement?.textContent).toBe('Go');
  });
});

describe('LoadoutChip', () => {
  const options = [
    { id: 'pluto', name: 'Pluto', meta: '50 g' },
    { id: 'pluto-guru', name: 'Pluto Guru', meta: '1.5 kg' },
  ];

  function strip(onSelect = vi.fn()) {
    const el = mount(
      h(
        'div',
        { 'data-loadout': true },
        h(LoadoutChip, {
          icon: null,
          label: 'Drone',
          value: 'pluto',
          options,
          onSelect,
          blurb: 'b',
        }),
        h('button', { 'data-loadout-stop': true, id: 'fly' }, 'Fly'),
      ),
    );
    return { el, chip: $(el, '.loadout-chip__button'), onSelect };
  }

  it('names its key in the aria-label, so the compact layout can hide it', () => {
    const { chip } = strip();
    expect(chip.getAttribute('aria-label')).toBe('Drone: Pluto');
  });

  it('opens on the current value: ✓ and selected', () => {
    const { el, chip } = strip();
    act(() => chip.click());
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
    const opts = $$(el, '[role="option"]');
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect($(opts[0], '[data-icon="check"]')).not.toBeNull();
  });

  it('↓ Enter picks and returns focus to the chip', () => {
    const { el, chip, onSelect } = strip();
    act(() => chip.click());
    key($(el, '[role="listbox"]'), 'ArrowDown');
    key($(el, '[role="listbox"]'), 'Enter');
    expect(onSelect).toHaveBeenCalledWith('pluto-guru');
    expect(document.activeElement).toBe(chip);
  });

  it('→ closes and moves to the neighbouring stop (Fly)', () => {
    const { el, chip } = strip();
    act(() => chip.click());
    key($(el, '[role="listbox"]'), 'ArrowRight');
    expect($(el, '[role="listbox"]')).toBeNull();
    expect(document.activeElement?.id).toBe('fly');
  });

  it('Esc closes back to the chip without reaching the page behind', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const { el, chip } = strip();
    act(() => chip.click());
    key($(el, '[role="listbox"]'), 'Escape');
    window.removeEventListener('keydown', behind);
    expect(document.activeElement).toBe(chip);
    expect(behind).not.toHaveBeenCalled();
  });
});

describe('TopBar', () => {
  it('shows DRONE › ARENA › CEILING and Fly, with the arena capping the ceiling', () => {
    const el = mount(h(TopBar));
    const chips = $$(el, '.loadout-chip__button');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Drone: Pluto',
      'Arena: Classroom',
      'Ceiling: 3 m, set by Classroom',
    ]);
    expect(el.textContent).toContain('Next flight');
  });

  it('Fly opens Free Flight', () => {
    const el = mount(h(TopBar));
    const fly = $$(el, 'button').find((b) => b.textContent === 'Fly')!;
    act(() => fly.click());
    expect(useUiStore.getState().section).toBe('fly');
  });

  it('the drone menu gives the mass once, beside the name', () => {
    const el = mount(h(TopBar));
    act(() => $(el, '.loadout-chip__button').click());
    const pluto = $$(el, '[role="option"]')[0];
    expect($(pluto, '.loadout-menu__meta').textContent?.trim()).toBe('50 g');
    expect($(pluto, '.loadout-menu__detail').textContent).toBe('Quad · 55 mm props');
  });

  it('picking a drone writes the loadout', () => {
    const el = mount(h(TopBar));
    act(() => $(el, '.loadout-chip__button').click());
    const guru = $$(el, '[role="option"]').find((o) => o.textContent?.includes('Pluto Guru'))!;
    act(() => guru.click());
    expect(useSettingsStore.getState().settings.selectedDroneId).toBe('pluto-guru');
  });
});

describe('StatusBar', () => {
  it('names the page and warns that the arena caps the ceiling', () => {
    useUiStore.setState({ section: 'hangar' });
    const el = mount(h(StatusBar));
    expect($(el, '.statusbar__where b').textContent).toBe('Hangar');
    expect($(el, '.statusbar__note').textContent).toBe('Classroom caps the ceiling at 3 m');
    expect($(el, '.statusbar__note [data-icon="warning"]')).not.toBeNull();
  });

  it('has no FPS read-out without the dev flag', () => {
    const el = mount(h(StatusBar));
    expect(el.textContent).not.toContain('FPS');
  });

  it('wide: keycap and pad glyph; compact: the last-used device only', () => {
    let el = mount(h(StatusBar));
    expect($$(el, '.ds-legend kbd').map((k) => k.textContent)).toEqual([
      '↑↓←→',
      'L',
      'Enter',
      'A',
      'Esc',
      'B',
    ]);
    act(() => root!.unmount());
    wide = false;
    act(() => useShellStore.getState().setInput('gamepad'));
    el = mount(h(StatusBar));
    expect($$(el, '.ds-legend kbd').map((k) => k.textContent)).toEqual(['L', 'A', 'B']);
  });
});

describe('Hangar', () => {
  it('opens on the loadout drone, marked as set for the next flight', () => {
    const el = mount(h(Hangar));
    const viewed = $(el, '[aria-pressed="true"]');
    expect(viewed.textContent).toContain('Pluto');
    expect(el.textContent).toContain('Set for next flight');
    expect($$(el, 'button').some((b) => b.textContent === 'Use for next flight')).toBe(false);
    expect(useShellStore.getState().context).toBe('Drone 1 of 3 · Pluto');
  });

  it('viewing is not the loadout: E steps on, Use for next flight writes it', () => {
    const el = mount(h(Hangar));
    key(window, 'e', 'KeyE');
    expect($(el, '[aria-pressed="true"]').textContent).toContain('Pluto Guru');
    expect(useSettingsStore.getState().settings.selectedDroneId).toBe('pluto');
    const use = $$(el, 'button').find((b) => b.textContent === 'Use for next flight')!;
    expect(use.hasAttribute('data-primary')).toBe(true);
    act(() => use.click());
    expect(useSettingsStore.getState().settings.selectedDroneId).toBe('pluto-guru');
    expect(el.textContent).toContain('Set for next flight');
  });

  it('Q wraps from the first drone to the last', () => {
    const el = mount(h(Hangar));
    key(window, 'q', 'KeyQ');
    expect($(el, '[aria-pressed="true"]').textContent).toContain('Racing Drone');
    expect(useShellStore.getState().context).toBe('Drone 3 of 3 · Racing Drone');
  });

  it('the spec card is the plugin data', () => {
    const el = mount(h(Hangar));
    const facts = $$(el, '.hangar__fact').map((f) => f.textContent);
    expect(facts).toContain('Mass50 g');
    expect(facts).toContain('Battery1S · 300 mAh');
  });
});
