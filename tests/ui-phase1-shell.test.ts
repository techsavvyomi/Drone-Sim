// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_FPS_FLAG, SHELL_MIN_HEIGHT, SHELL_MIN_WIDTH, shellZoom } from '../src/shared/shellZoom';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { forest } from '../src/renderer/plugins/environments/forest';
import { flightSchool } from '../src/renderer/plugins/environments/flightSchool';
import { arenaLine, droneBuild, droneLine, formatMass } from '../src/renderer/app/loadout';
import { NAV, navItems, openSection } from '../src/renderer/app/Sidebar';
import { IconArena, IconCeiling, IconDrone, IconTarget } from '../src/renderer/app/icons';
import { Placeholder } from '../src/renderer/app/Placeholder';
import { useUiStore } from '../src/renderer/state/uiStore';

// Phase 1 — the app shell, the parts the app-shell suite does not reach: the
// sidebar's table and how a page is opened, the loadout's one-line facts, the
// top bar's icons, the zoom constants the main process shares, and the section
// store the shell navigates by.

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
beforeEach(() => {
  useUiStore.setState({ section: 'home', previousSection: 'home', cameraMode: 'chase' });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe('sidebar table', () => {
  it('eight items numbered 1–8 in the decided order, no Studio', () => {
    expect(NAV.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(NAV.map((i) => i.label)).toEqual([
      'Home', 'Free Flight', 'Training', 'Missions', 'Hangar', 'Profile', 'Settings', 'About',
    ]);
    expect(NAV.some((i) => /studio/i.test(i.label))).toBe(false);
    expect(new Set(NAV.map((i) => i.id)).size).toBe(NAV.length);
  });

  it('Profile is only reachable with profiles on', () => {
    expect(navItems(true).map((i) => i.id)).toContain('profile');
    expect(navItems(false).map((i) => i.id)).not.toContain('profile');
    expect(navItems(false)).toHaveLength(7);
  });

  it('opening a page from the pointer does not move focus; from keys it does, next frame', () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    openSection('training', false);
    expect(useUiStore.getState().section).toBe('training');
    expect(raf).not.toHaveBeenCalled();
    openSection('missions', true);
    expect(useUiStore.getState().section).toBe('missions');
    expect(raf).toHaveBeenCalledTimes(1);
  });
});

describe('section store', () => {
  it('remembers where it came from, and Back goes there', () => {
    const ui = useUiStore.getState();
    ui.setSection('hangar');
    ui.setSection('profile');
    expect(useUiStore.getState().previousSection).toBe('hangar');
    useUiStore.getState().goBack();
    expect(useUiStore.getState().section).toBe('hangar');
  });

  it('opening the page already open changes nothing', () => {
    useUiStore.getState().setSection('home');
    expect(useUiStore.getState().previousSection).toBe('home');
  });

  it('C cycles chase → FPV → orbit → chase', () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      useUiStore.getState().cycleCameraMode();
      seen.push(useUiStore.getState().cameraMode);
    }
    expect(seen).toEqual(['fpv', 'orbit', 'chase']);
  });
});

describe('loadout lines', () => {
  it('a drone in one line: mass, frame, props — from the plugin data', () => {
    for (const d of [plutoDrone, guruDrone, racingDrone]) {
      expect(droneLine(d)).toBe(`${formatMass(d.mass)} · ${droneBuild(d)}`);
      expect(droneBuild(d)).toMatch(/^(Quad|Hex) · \d+ mm props$/);
    }
    expect(droneLine(plutoDrone).startsWith('50 g · ')).toBe(true);
  });

  it('an arena: indoor with its roof, or outdoor', () => {
    expect(arenaLine(forest)).toBe('Outdoor');
    expect(arenaLine(flightSchool)).toMatch(/^Indoor · [\d.]+ m roof$/);
  });
});

describe('top bar icons', () => {
  it('draw at the size asked, in currentColor', () => {
    const el = mount(
      h('div', null, [IconDrone, IconTarget, IconArena, IconCeiling].map((I, k) => h(I, { key: k, size: 20 }))),
    );
    const svgs = [...el.querySelectorAll('svg')];
    expect(svgs).toHaveLength(4);
    for (const s of svgs) {
      expect(s.getAttribute('width')).toBe('20');
      expect(s.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});

describe('placeholder page', () => {
  it('says what the section is and when it arrives', () => {
    const el = mount(h(Placeholder, { title: 'Drone Training', phase: 'Phase 6', blurb: 'Soon.' }));
    expect(el.querySelector('h1')!.textContent).toBe('Drone Training');
    expect(el.textContent).toContain('Arrives in Phase 6');
  });
});

describe('minimum window and zoom', () => {
  it('the brief’s 1100 × 720 minimum, shared with the main process', () => {
    expect([SHELL_MIN_WIDTH, SHELL_MIN_HEIGHT]).toEqual([1100, 720]);
    const main = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).toContain('shellZoom');
    expect(main).toContain('DEV_FPS_FLAG');
  });

  it('1366 × 768 at 150 % (910 × 512 CSS px) zooms by the tighter side; bad sizes zoom 1', () => {
    expect(shellZoom(910, 512)).toBeCloseTo(Math.min(910 / 1100, 512 / 720), 2);
    expect(shellZoom(1920, 1080)).toBe(1);
    expect(shellZoom(0, 720)).toBe(1);
    expect(shellZoom(Number.NaN, 720)).toBe(1);
  });

  it('the dev flag is spelled once', () => {
    expect(DEV_FPS_FLAG).toBe('--dev-fps');
  });
});
