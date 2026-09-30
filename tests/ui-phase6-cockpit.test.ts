// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, HUD_WIDGETS } from '@shared/types';
import { registerDrone } from '../src/renderer/plugins/registry';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { TelemetryPanel } from '../src/renderer/app/TelemetryPanel';
import { SettingsPanel } from '../src/renderer/app/SettingsPanel';
import { FlightHud } from '../src/renderer/hud/FlightHud';
import { PauseCard } from '../src/renderer/hud/FlightCards';
import { FLIGHT_MODES, HUD_HZ, KEY_GROUPS, LOW_SOC, MOTOR_LABELS } from '../src/renderer/hud/cockpitFacts';
import {
  attitudeBuffer,
  gyroBuffer,
  motorBuffer,
  powerBuffer,
  startTelemetryFeed,
} from '../src/renderer/state/telemetryFeed';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useSimStore } from '../src/renderer/state/simStore';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { usePhysicsStore } from '../src/renderer/state/physicsStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { useWorldStore } from '../src/renderer/state/worldStore';
import { CALM_WIND } from '../src/renderer/sim/dynamics/environment';

// Phase 6 — the Free Flight cockpit, the parts the cockpit suite does not drive:
// the telemetry dock's three tabs and every PHYSICS control, the feed behind
// the graphs, the camera menu by keyboard, the key bar's buttons, the cards'
// arrow keys, and Settings showing the same key list and HUD widgets.

vi.mock('../src/renderer/audio/sfx', () => ({ playClick: () => {} }));
// uPlot needs a real canvas; the traces themselves are tested through the buffer.
vi.mock('../src/renderer/ui/TelemetryChart', () => ({
  TelemetryChart: ({ title }: { title: string }) => h('div', { className: 'trace' }, title),
}));
vi.mock('../src/renderer/hud/SupportDebugWidget', () => ({ SupportDebugWidget: () => null }));
vi.mock('../src/renderer/app/GamepadSetup', () => ({ GamepadSetup: () => null }));

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const byText = (root: ParentNode, sel: string, text: string) =>
  [...root.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text) as HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { api: unknown }).api = { saveSettings: vi.fn(async () => {}) };
  registerDrone(plutoDrone);
});
beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, selectedDroneId: plutoDrone.id, hud: { ...DEFAULT_SETTINGS.hud } },
  });
  usePhysicsStore.setState({ wind: { ...CALM_WIND }, groundEffectEnabled: true, batteryEnabled: true });
  useUiStore.setState({ section: 'fly', panelOpen: false, hudPanelOpen: false, cameraMode: 'chase' });
  useFlightStore.setState({ paused: false, crashed: false, exitAsk: false, armed: false, onGround: true });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
});

describe('cockpit constants', () => {
  it('10 Hz, 20 % battery, the game three modes, four motors in sim order', () => {
    expect(HUD_HZ).toBe(10);
    expect(LOW_SOC).toBe(0.2);
    expect(Object.keys(FLIGHT_MODES).sort()).toEqual(['acro', 'altitude-hold', 'stabilize']);
    expect(MOTOR_LABELS).toEqual(['M1 FR', 'M2 FL', 'M3 BR', 'M4 BL']);
  });
});

describe('telemetry dock', () => {
  it('DATA: flight, IMU, power, motors from the sim; used mAh from the pack', () => {
    useSimStore.setState({
      altitude: 1.35,
      groundSpeed: 0.6,
      flightTime: 193,
      batterySoc: 0.9,
      batteryVoltage: 4,
      batteryCurrent: 2.3,
      motors: [0.67, 0.67, 0.63, 0.6],
    });
    const el = mount(h(TelemetryPanel));
    const t = el.textContent!;
    for (const s of ['Telemetry · 10 Hz', 'Flight', 'IMU', 'Power', 'Motors', '1.35 m', '0.6 m/s', '3:13', '4.00 V', '2.3 A'])
      expect(t).toContain(s);
    expect(t).toContain(`${Math.round(plutoDrone.battery.capacityMah * 0.1)} mAh`);
    expect([...el.querySelectorAll('.tdock-motors li')].map((li) => li.textContent)).toEqual([
      'M1 FR67%', 'M2 FL67%', 'M3 BR63%', 'M4 BL60%',
    ]);
  });

  it('tabs: one selected at a time; GRAPHS shows the four traces', () => {
    const el = mount(h(TelemetryPanel));
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs.map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    click(tabs[1]);
    expect([...el.querySelectorAll('.trace')].map((d) => d.textContent)).toEqual([
      'Gyro · yaw rate', 'Attitude · roll', 'Motor output · mean', 'Battery',
    ]);
  });

  it('PHYSICS: wind ± 1, turn by 45°, gust levels, effects, time of day, recharge', () => {
    const el = mount(h(TelemetryPanel));
    click(byText(el, '[role="tab"]', 'Physics'));
    const btn = (text: string) => byText(el, 'button', text);
    click(btn('+ 1'));
    click(btn('+ 1'));
    click(btn('− 1'));
    expect(usePhysicsStore.getState().wind.speed).toBe(1);
    click(btn('Turn ›'));
    expect(usePhysicsStore.getState().wind.directionDeg).toBe(45);
    click(btn('‹ Turn'));
    click(btn('‹ Turn'));
    expect(usePhysicsStore.getState().wind.directionDeg).toBe(315);
    click(btn('Strong'));
    expect(usePhysicsStore.getState().wind.gustiness).toBe(0.7);
    // Ground effect's row: its Off button.
    const row = [...el.querySelectorAll('.tdock-row')].find((r) => r.textContent!.startsWith('Ground effect'))!;
    click(byText(row, 'button', 'Off'));
    expect(usePhysicsStore.getState().groundEffectEnabled).toBe(false);
    click(btn('Night'));
    expect(useWorldStore.getState().timeOfDay).toBe('night');
    const token = useFlightStore.getState().rechargeToken;
    click(btn('Recharge to 100%'));
    expect(useFlightStore.getState().rechargeToken).toBe(token + 1);
  });

  it('T CLOSE closes it', () => {
    useUiStore.setState({ panelOpen: true });
    const el = mount(h(TelemetryPanel));
    click(el.querySelector('.tdock__close'));
    expect(useUiStore.getState().panelOpen).toBe(false);
  });
});

describe('telemetry feed', () => {
  it('feeds each trace per sim frame, in degrees, with the motor mean; stops when unsubscribed', () => {
    const stop = startTelemetryFeed();
    const frame = (yawRate: number) =>
      useSimStore.getState().setTelemetry({
        ...useSimStore.getState(),
        position: [0, 1, 0],
        gyro: [0, yawRate, 0],
        roll: Math.PI / 18,
        motors: [0.2, 0.4, 0.6, 0.8],
        batteryVoltage: 3.9,
      });
    frame(1);
    frame(1);
    const [, yaw] = gyroBuffer.window('z', 60);
    expect(yaw.at(-1)).toBeCloseTo(180 / Math.PI, 4);
    expect(attitudeBuffer.window('roll', 60)[1].at(-1)).toBeCloseTo(10, 4);
    expect(motorBuffer.window('mean', 60)[1].at(-1)).toBeCloseTo(0.5, 6);
    expect(powerBuffer.window('v', 60)[1].at(-1)).toBeCloseTo(3.9, 5);
    stop();
    const n = gyroBuffer.window('z', 60)[0].length;
    frame(2);
    expect(gyroBuffer.window('z', 60)[0].length).toBe(n);
  });
});

describe('camera chip and key bar', () => {
  it('the chip opens on the current camera, arrows move, a pick switches it and closes', () => {
    const el = mount(h(FlightHud));
    click(el.querySelector('.ck-chip'));
    const items = [...el.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[];
    expect(items.map((i) => i.querySelector('b')!.textContent)).toEqual(['FPV', 'Chase', 'Orbit']);
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(items[1]);
    act(() => items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(items[2]);
    click(items[0]);
    expect(useUiStore.getState().cameraMode).toBe('fpv');
    expect(el.querySelector('.ck-menu')).toBeNull();
  });

  it('Esc closes the menu without pausing the flight', () => {
    const el = mount(h(FlightHud));
    click(el.querySelector('.ck-chip'));
    const menu = el.querySelector('.ck-menu')!;
    act(() => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(el.querySelector('.ck-menu')).toBeNull();
    expect(useFlightStore.getState().paused).toBe(false);
  });

  it('the key bar buttons do what their keys do', () => {
    const el = mount(h(FlightHud));
    const bar = el.querySelector('.ck-keybar')!;
    click(byText(bar, 'button', 'TTelemetry'));
    expect(useUiStore.getState().panelOpen).toBe(true);
    click(byText(bar, 'button', 'HHUD'));
    expect(useUiStore.getState()).toMatchObject({ panelOpen: false, hudPanelOpen: true });
    click(byText(bar, 'button', 'EscPause'));
    expect(useFlightStore.getState().paused).toBe(true);
  });
});

describe('quiet in flight after a pause', () => {
  it('resuming shows the full HUD for 3 s before it folds again', () => {
    vi.useFakeTimers();
    useSimStore.setState({ batterySoc: 0.8, batteryVoltage: 4, altitude: 2 });
    useFlightStore.setState({ armed: true, onGround: false, paused: false });
    const el = mount(h(FlightHud));
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(el.querySelector('.ck-quiet')).not.toBeNull();
    act(() => {
      useFlightStore.setState({ paused: true });
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      useFlightStore.setState({ paused: false });
      vi.advanceTimersByTime(1000);
    });
    expect(el.querySelector('.ck-quiet')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(el.querySelector('.ck-quiet')).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('pause card keyboard', () => {
  it('↓ and ↑ move between the buttons and wrap; focus never leaves the card', () => {
    useFlightStore.setState({ paused: true });
    const el = mount(
      h(PauseCard, {
        context: { kind: 'free', arena: 'Forest', drone: 'Pluto', flownSec: 10 },
        onRestart: () => {},
        onSettings: () => {},
        onExit: () => {},
      }),
    );
    const card = el.querySelector('.fcard')!;
    const buttons = [...card.querySelectorAll('button')];
    const key = (k: string) => act(() => card.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    key('ArrowUp');
    key('ArrowUp');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    key('Tab');
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('Settings shows the same keys and HUD widgets', () => {
  it('Controls lists the cockpit key list, T, H and pause included', () => {
    const el = mount(h(SettingsPanel));
    click(byText(el, '[role="tab"]', 'Controls'));
    const rows = [...el.querySelectorAll('.settings__key')].map((r) => [r.querySelector('kbd')!.textContent, r.querySelector('span')!.textContent]);
    expect(rows).toEqual(KEY_GROUPS.flatMap((g) => g.rows.map(([k, d]) => [k, d])));
    const keys = rows.map((r) => r[0]);
    for (const k of ['T', 'H', 'C', 'M', 'R', 'Enter', 'Space', 'Esc / P']) expect(keys).toContain(k);
  });

  it('Interface lists every HUD widget and a switch writes the setting', () => {
    const el = mount(h(SettingsPanel));
    click(byText(el, '[role="tab"]', 'Interface'));
    const labels = [...el.querySelectorAll('.settings__widgets .ds-check__label')].map((s) => s.textContent);
    expect(labels).toEqual(HUD_WIDGETS.map((w) => w.label));
    click(el.querySelector('.settings__widgets [role="checkbox"]'));
    expect(useSettingsStore.getState().settings.hud[HUD_WIDGETS[0].key]).toBe(false);
  });
});
