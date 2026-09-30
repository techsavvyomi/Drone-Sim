// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, HUD_WIDGETS, HUD_WIDGET_LABELS } from '@shared/types';
import {
  CEILING_NEAR,
  GUST_LEVELS,
  QUIET_AFTER,
  WAKE_CODES,
  batteryFacts,
  clock,
  compassPoint,
  crashLine,
  crashTip,
  escapeStep,
  exitAsk,
  fixed,
  voltsText,
  flightModeLine,
  gustLevel,
  headingDeg,
  headingText,
  hudCount,
  isQuiet,
  minutesLeft,
  motorsFacts,
  nearCeiling,
  pauseLines,
  ribbonTicks,
  usedMah,
  windFacts,
} from '../src/renderer/hud/cockpitFacts';
import { mergeHud, useSettingsStore } from '../src/renderer/state/settingsStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { useSimStore } from '../src/renderer/state/simStore';
import { attachKeyboard } from '../src/renderer/input/controls';
import { TelemetryBuffer } from '../src/renderer/sim/telemetryBuffer';
import { CrashCard, PauseCard } from '../src/renderer/hud/FlightCards';
import { HudPanel } from '../src/renderer/hud/HudPanel';
import { FlightHud } from '../src/renderer/hud/FlightHud';

// Phase 6 — the Free Flight cockpit against the Phase 6 brief: heading and wind,
// the battery plate, quiet in flight and what brings an instrument back, the one
// pause card and its exit question, the crash card, the HUD panel, the side
// columns and Esc. Every figure is the game's own.

vi.mock('../src/renderer/audio/sfx', () => ({
  playClick: () => {},
  playSuccess: () => {},
  playStar: () => {},
  playRankUp: () => {},
}));

const RAD = Math.PI / 180;

// ---- Heading and wind ----------------------------------------------------------

describe('heading', () => {
  it('reads 000, never 360, and turns clockwise with a right yaw', () => {
    expect(headingDeg(0)).toBe(0);
    expect(headingDeg(0.3 * RAD)).toBe(0); // 359.7° rounds to 000
    expect(headingDeg(-0.3 * RAD)).toBe(0);
    expect(headingDeg(-49 * RAD)).toBe(49);
    expect(headingDeg(90 * RAD)).toBe(270);
    for (let d = -720; d <= 720; d += 0.25) {
      const hdg = headingDeg(d * RAD);
      expect(hdg).toBeGreaterThanOrEqual(0);
      expect(hdg).toBeLessThan(360);
    }
    expect(headingText(49)).toBe('049');
    expect(headingText(360)).toBe('000');
  });

  it('compass points and the ribbon ticks around the heading', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(225)).toBe('SW');
    const ticks = ribbonTicks(49);
    expect(ticks.every((t) => t.at >= -1 && t.at <= 1)).toBe(true);
    const labels = ticks.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(['N', '030', '060', 'E']);
    // Across north the labels wrap, never 360.
    expect(ribbonTicks(5).map((t) => t.label).filter(Boolean)).toEqual(['330', 'N', '030', '060']);
  });

  it('wind names where it comes FROM (the sim stores where it blows to)', () => {
    const w = windFacts({ speed: 2, directionDeg: 225, gustiness: 0.3 }, 0);
    expect(w.fromDeg).toBe(45);
    expect(w.line).toBe('2 m/s from NE · gust light');
    expect(windFacts({ speed: 0, directionDeg: 90, gustiness: 0 }, 0).line).toBe('Calm');
    expect(windFacts({ speed: 3.5, directionDeg: 0, gustiness: 0 }, 0).line).toBe(
      '3.5 m/s from S · gust none',
    );
    // The arrow is drawn relative to the nose.
    expect(windFacts({ speed: 2, directionDeg: 90, gustiness: 0 }, 90).arrowDeg).toBe(0);
  });

  it('gust buttons round-trip through the nearest level', () => {
    for (const [k, v] of Object.entries(GUST_LEVELS)) expect(gustLevel(v)).toBe(k);
    expect(gustLevel(0.05)).toBe('off');
    expect(gustLevel(0.6)).toBe('strong');
  });
});

// ---- Aircraft ---------------------------------------------------------------------

describe('motors, mode, battery', () => {
  it('flight modes are the game three, named with what they do', () => {
    expect(flightModeLine('altitude-hold')).toBe('Alt Hold · holds height');
    expect(flightModeLine('stabilize')).toBe('Stabilize · self-level');
    expect(flightModeLine('acro')).toBe('Acro · no self-level');
  });

  it('motors state carries a word for every tone', () => {
    expect(motorsFacts({ armed: true, crashed: false, auto: 'manual' })).toEqual({
      tone: 'armed',
      word: 'Armed',
    });
    expect(motorsFacts({ armed: false, crashed: false, auto: 'manual' }).word).toBe('Disarmed');
    expect(motorsFacts({ armed: false, crashed: true, auto: 'manual' }).tone).toBe('fail');
    expect(motorsFacts({ armed: true, crashed: false, auto: 'takeoff' }).word).toBe(
      'Armed · taking off',
    );
  });

  it('minutes left: the average drain since the pack was full, not before 20 s', () => {
    expect(minutesLeft(1, 0.99, 10)).toBeNull();
    expect(minutesLeft(1, 1, 60)).toBeNull();
    // 10 % in 60 s → 0.9 left at 0.1/min = 9 min.
    expect(minutesLeft(1, 0.9, 60)).toBeCloseTo(9, 5);
  });

  it('battery: percent, volts, ~n MIN LEFT; under 20 % it turns LAND SOON and must show', () => {
    const base = { voltage: 4, minutesLeft: 6.2, warning: false, critical: false, empty: false };
    const ok = batteryFacts({ ...base, soc: 0.78 });
    expect(ok).toMatchObject({ pct: 78, volts: '4.00 V', tone: 'neutral', note: '~6 min left', warn: false });
    const low = batteryFacts({ ...base, soc: 0.16, voltage: 3.44 });
    expect(low).toMatchObject({ pct: 16, tone: 'caution', note: 'Land soon', warn: true });
    expect(batteryFacts({ ...base, soc: 0.5, warning: true }).tone).toBe('caution');
    expect(batteryFacts({ ...base, soc: 0.05, critical: true }).note).toBe('Critical · landing');
    expect(batteryFacts({ ...base, soc: 0, empty: true }).note).toBe('Empty · press R');
    expect(batteryFacts({ ...base, soc: 0.9, minutesLeft: null }).note).toBe('');
  });

  it('near the ceiling is within 0.5 m of it', () => {
    expect(CEILING_NEAR).toBe(0.5);
    expect(nearCeiling(2.49, 3)).toBe(false);
    expect(nearCeiling(2.5, 3)).toBe(true);
    expect(nearCeiling(3.2, 3)).toBe(true);
  });

  it('numbers never read "-0.0", and a silent pack reads — V', () => {
    expect(fixed(-0.04, 1)).toBe('0.0');
    expect(fixed(-0.4, 1)).toBe('-0.4');
    expect(fixed(-0.001, 2)).toBe('0.00');
    expect(voltsText(0)).toBe('— V');
    expect(voltsText(3.44)).toBe('3.44 V');
  });

  it('used mAh from the pack capacity', () => {
    expect(usedMah(300, 0.56)).toBe(132);
    expect(usedMah(300, 1)).toBe(0);
  });
});

// ---- Quiet in flight -----------------------------------------------------------

describe('quiet in flight', () => {
  const q = { enabled: true, armed: true, airborne: true, covered: false, sinceWake: QUIET_AFTER };
  it('only while armed and flying, with nothing open, after 3 s', () => {
    expect(isQuiet(q)).toBe(true);
    expect(isQuiet({ ...q, sinceWake: 2.9 })).toBe(false);
    expect(isQuiet({ ...q, enabled: false })).toBe(false);
    expect(isQuiet({ ...q, armed: false })).toBe(false);
    expect(isQuiet({ ...q, airborne: false })).toBe(false);
    expect(isQuiet({ ...q, covered: true })).toBe(false);
  });
  it('mouse, H, T, C and Esc wake it; flying keys do not', () => {
    for (const k of ['KeyH', 'KeyT', 'KeyC', 'Escape']) expect(WAKE_CODES.has(k)).toBe(true);
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'Space', 'Enter'])
      expect(WAKE_CODES.has(k)).toBe(false);
  });
});

// ---- Crash, pause, Esc ---------------------------------------------------------

describe('crash and pause lines', () => {
  it('crash line: when, how high, how fast', () => {
    expect(crashLine({ when: '3:12', altitude: 1.2, speed: 2.4 })).toBe(
      'At 3:12, 1.2 m up, flying at 2.4 m/s.',
    );
    expect(crashLine({ when: '0:08', altitude: 0.05, speed: 0.1 })).toBe('At 0:08, on the ground.');
  });

  it('crash tip: about 1 m at 2.4 m/s; slow crashes get the landing tip', () => {
    expect(crashTip(2.4)).toBe(
      'Ease off about 1 m before an obstacle. At 2.4 m/s the drone needs that long to stop.',
    );
    expect(crashTip(6)).toMatch(/about 2.5 m/);
    expect(crashTip(0.6)).toMatch(/ease the throttle down/);
  });

  it('one pause card: only the context line and the one line change', () => {
    expect(pauseLines({ kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 192 })).toEqual({
      context: 'Free Flight · Classroom · Pluto',
      line: '3:12 flown. The drone holds its position while paused. Nothing is lost.',
    });
    expect(
      pauseLines({ kind: 'lesson', num: 2, title: 'Land', step: 'Fly step', flightSec: 12 }).line,
    ).toBe('12.0 s on the flight clock. The timer is paused and resumes where it stopped.');
    expect(
      pauseLines({ kind: 'mission', num: 1, name: 'Precision', usedSec: 72, limitSec: 480 }),
    ).toEqual({
      context: 'Mission 1 · Precision',
      line: '1:12 used of 8:00. The mission clock is paused and resumes where it stopped.',
    });
    expect(exitAsk('mission').title).toBe('Exit the mission?');
    expect(exitAsk('lesson').body).toBe(
      "You'll go back to the module list. This attempt ends and won't count.",
    );
    expect(clock(0)).toBe('0:00');
  });

  it('Esc pauses every flight and never ends one; off a flight it steps back', () => {
    const none = { paused: false, lesson: null, mission: null };
    expect(escapeStep({ ...none, section: 'fly' })).toBe('pause');
    expect(escapeStep({ ...none, section: 'fly', paused: true })).toBe('pause');
    const lesson = (phase: string, autoAdvance = false) => ({
      ...none,
      section: 'training',
      lesson: { phase, autoAdvance },
    });
    expect(escapeStep(lesson('practice'))).toBe('pause');
    expect(escapeStep({ ...lesson('practice'), paused: true })).toBe('pause');
    expect(escapeStep(lesson('intro'))).toBe('exitLesson');
    expect(escapeStep(lesson('demo'))).toBe('exitLesson');
    expect(escapeStep(lesson('reward', true))).toBe('cancelAdvance');
    expect(escapeStep(lesson('reward', false))).toBe('exitLesson');
    const mission = (phase: string) => ({ ...none, section: 'missions', mission: { phase } });
    expect(escapeStep(mission('flying'))).toBe('pause');
    expect(escapeStep(mission('briefing'))).toBe('exitMission');
    expect(escapeStep(mission('complete'))).toBe('exitMission');
    expect(escapeStep({ ...none, section: 'missions' })).toBe('back');
    expect(escapeStep({ ...none, section: 'settings' })).toBe('back');
    expect(escapeStep({ ...none, section: 'home' })).toBe('none');
  });
});

// ---- HUD widgets ---------------------------------------------------------------

describe('HUD widgets', () => {
  it('the panel lists every widget the settings hold, each with a place', () => {
    expect(HUD_WIDGETS.map((w) => w.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.hud).sort());
    expect(HUD_WIDGETS.every((w) => w.label && w.where)).toBe(true);
    expect(HUD_WIDGET_LABELS.quiet).toBe('Quiet in flight');
    expect(hudCount(DEFAULT_SETTINGS.hud)).toEqual({ on: 13, total: 13 });
    expect(hudCount({ ...DEFAULT_SETTINGS.hud, horizon: false, keyBar: false }).on).toBe(11);
  });

  it('an old saved HUD keeps its choices, drops removed widgets and gains the new ones', () => {
    const old = {
      altitudeTape: true,
      horizon: false,
      instruments: true,
      compass: false,
      status: true,
      battery: true,
      throttle: true,
      cameraInfo: true,
      tiles: true,
      sticks: false,
      groundMarker: true,
    };
    const hud = mergeHud(old);
    expect(hud.horizon).toBe(false);
    expect(hud.compass).toBe(false);
    expect(hud.sticks).toBe(false);
    expect(hud.quiet).toBe(true);
    expect(hud.crosshair).toBe(true);
    expect(Object.keys(hud).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.hud).sort());
    expect(mergeHud(undefined)).toEqual(DEFAULT_SETTINGS.hud);
  });
});

// ---- Stores, keys, buffer --------------------------------------------------------

describe('side columns and keys', () => {
  beforeEach(() => {
    useUiStore.setState({ section: 'fly', panelOpen: false, hudPanelOpen: false });
    useFlightStore.setState({ paused: false, crashed: false, exitAsk: false });
  });

  it('only one of the dock and the HUD panel is open at a time', () => {
    const ui = useUiStore.getState();
    ui.togglePanel();
    expect(useUiStore.getState()).toMatchObject({ panelOpen: true, hudPanelOpen: false });
    ui.toggleHudPanel();
    expect(useUiStore.getState()).toMatchObject({ panelOpen: false, hudPanelOpen: true });
    ui.closePanels();
    expect(useUiStore.getState()).toMatchObject({ panelOpen: false, hudPanelOpen: false });
  });

  it('T opens the dock and H the HUD panel, in Free Flight only', () => {
    const detach = attachKeyboard();
    const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    key('KeyT');
    expect(useUiStore.getState().panelOpen).toBe(true);
    key('KeyH');
    expect(useUiStore.getState()).toMatchObject({ panelOpen: false, hudPanelOpen: true });
    key('KeyH');
    useUiStore.setState({ section: 'training' });
    key('KeyT');
    key('KeyH');
    expect(useUiStore.getState()).toMatchObject({ panelOpen: false, hudPanelOpen: false });
    detach();
  });

  it('pausing drops a pending exit question', () => {
    useFlightStore.setState({ paused: true, exitAsk: true });
    useFlightStore.getState().togglePause();
    expect(useFlightStore.getState()).toMatchObject({ paused: false, exitAsk: false });
  });

  it('a crash stamps its clock and height for the crash card', () => {
    useSimStore.setState({ flightTime: 192, altitude: 1.2 });
    useFlightStore.getState().crash(2.4);
    expect(useFlightStore.getState().crashAt).toEqual({ flightTime: 192, altitude: 1.2 });
    useFlightStore.getState().clearCrash();
    expect(useFlightStore.getState().crashAt).toBeNull();
  });

  it('a trace window holds only the last seconds, oldest first', () => {
    const b = new TelemetryBuffer([{ key: 'v', label: 'v' }]);
    for (let t = 0; t <= 10; t += 0.5) b.push(t, { v: t * 2 });
    const [x, y] = b.window('v', 6);
    expect(x[0]).toBe(4);
    expect(x[x.length - 1]).toBe(10);
    expect(y[0]).toBe(8);
  });
});

// ---- Components -----------------------------------------------------------------

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
  (window as unknown as { api: unknown }).api = { saveSettings: vi.fn(async () => {}) };
});

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, hud: { ...DEFAULT_SETTINGS.hud } } });
  useFlightStore.setState({ paused: false, crashed: false, exitAsk: false, armed: false, onGround: true });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const buttons = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
const press = (el: HTMLElement, text: string) =>
  act(() =>
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.trim().startsWith(text))!
      .click(),
  );

describe('pause card', () => {
  it('Free Flight: Resume focused, Restart, Settings, Exit — and Exit leaves at once', () => {
    const onExit = vi.fn();
    useFlightStore.setState({ paused: true });
    const el = mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Classroom', drone: 'Pluto', flownSec: 192 },
        onRestart: () => {},
        onSettings: () => {},
        onExit,
      }),
    );
    expect(el.textContent).toContain('Free Flight · Classroom · Pluto');
    expect(el.textContent).toContain('3:12 flown.');
    expect(buttons(el)).toEqual(['Resume Esc', 'Restart', 'Settings', 'Exit']);
    expect(document.activeElement?.textContent).toBe('Resume Esc');
    press(el, 'Exit');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a mission: no Settings, and Exit asks first with Keep flying focused', () => {
    const onExit = vi.fn();
    useFlightStore.setState({ paused: true });
    const el = mount(
      h(PauseCard, {
        context: { kind: 'mission', num: 1, name: 'Precision', usedSec: 72, limitSec: 480 },
        onRestart: () => {},
        onExit,
      }),
    );
    expect(buttons(el)).not.toContain('Settings');
    press(el, 'Exit');
    expect(onExit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Exit the mission?');
    expect(document.activeElement?.textContent).toBe('Keep flying Esc');
    press(el, 'Keep flying');
    expect(useFlightStore.getState().paused).toBe(false);
  });

  it('the question\'s Exit leaves; P resumes', () => {
    const onExit = vi.fn();
    useFlightStore.setState({ paused: true });
    const el = mount(
      h(PauseCard, {
        context: { kind: 'lesson', num: 2, title: 'Land', step: 'Fly step', flightSec: 3 },
        onRestart: () => {},
        onExit,
      }),
    );
    press(el, 'Exit');
    expect(el.textContent).toContain('Exit the module?');
    press(el, 'Exit');
    expect(onExit).toHaveBeenCalledTimes(1);
    act(() => useFlightStore.setState({ exitAsk: false }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
    });
    expect(useFlightStore.getState().paused).toBe(false);
  });
});

describe('crash card', () => {
  it('says what, when, how high and fast, one tip, and focuses Reset to start pad', () => {
    useSimStore.setState({ flightTime: 192, altitude: 1.2 });
    useFlightStore.getState().crash(2.4);
    const onReset = vi.fn();
    const el = mount(h(CrashCard, { context: 'Free Flight · Classroom · Pluto', when: '3:12', onReset }));
    expect(el.textContent).toContain('Drone crashed');
    expect(el.textContent).toContain('At 3:12, 1.2 m up, flying at 2.4 m/s.');
    expect(el.textContent).toContain('Ease off about 1 m');
    expect(buttons(el)).toEqual(['Pause menu', 'Reset to start pad R']);
    expect(document.activeElement?.textContent).toBe('Reset to start pad R');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    useFlightStore.getState().clearCrash();
  });
});

describe('HUD panel', () => {
  it('counts, toggles and resets the widgets, and carries the key list', () => {
    const el = mount(h(HudPanel));
    expect(el.textContent).toContain('HUD widgets · 13 of 13 on');
    const sw = el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Attitude indicator"]')!;
    act(() => sw.click());
    expect(useSettingsStore.getState().settings.hud.horizon).toBe(false);
    expect(el.textContent).toContain('12 of 13 on');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    press(el, 'Reset to default');
    expect(useSettingsStore.getState().settings.hud.horizon).toBe(true);
    expect(el.textContent).toContain('Keys · Flight');
    expect(el.textContent).toContain('Telemetry');
  });
});

describe('cockpit', () => {
  it('full cluster on the pad: camera chip, heading, wind, context, motors, mode, battery, keys', () => {
    useSimStore.setState({ yaw: -49 * RAD, batterySoc: 0.78, batteryVoltage: 4, flightTime: 193 });
    const el = mount(h(FlightHud));
    const text = el.textContent ?? '';
    expect(text).toContain('Cam');
    expect(text).toContain('049');
    expect(text).toContain('Free Flight · ');
    expect(text).toContain('3:13');
    expect(text).toContain('Disarmed');
    expect(text).toContain('Alt Hold · holds height');
    expect(text).toContain('78%');
    expect(text).toContain('Telemetry');
    expect(el.querySelector('.ck-quiet')).toBeNull();
    // Chase camera: no crosshair.
    expect(el.querySelector('.ck-crosshair')).toBeNull();
  });

  it('goes quiet after 3 s of armed flight; low battery brings its plate back', () => {
    vi.useFakeTimers();
    useSimStore.setState({ batterySoc: 0.78, batteryVoltage: 4, altitude: 1.3 });
    useFlightStore.setState({ armed: true, onGround: false });
    const el = mount(h(FlightHud));
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    const bar = el.querySelector('.ck-quiet');
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain('Batt');
    expect(el.querySelector('.ck-right')).toBeNull();
    act(() => {
      useSimStore.setState({ batterySoc: 0.16 });
      vi.advanceTimersByTime(200);
    });
    expect(el.querySelector('.ck-right')?.textContent).toContain('Land soon');
    expect(el.querySelector('.ck-quiet')!.textContent).not.toContain('Batt');
    // The mouse wakes it.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
      vi.advanceTimersByTime(200);
    });
    expect(el.querySelector('.ck-quiet')).toBeNull();
  });

  it('crosshair in FPV only, and hidden widgets stay hidden', () => {
    useUiStore.setState({ cameraMode: 'fpv' });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, hud: { ...DEFAULT_SETTINGS.hud, compass: false, keyBar: false } },
    });
    const el = mount(h(FlightHud));
    expect(el.querySelector('.ck-crosshair')).not.toBeNull();
    expect(el.querySelector('.ck-ribbon')).toBeNull();
    expect(el.querySelector('.ck-keybar')).toBeNull();
    useUiStore.setState({ cameraMode: 'chase' });
  });
});
