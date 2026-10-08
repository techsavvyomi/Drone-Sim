// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RATE_PROFILE,
  DEFAULT_RATES,
  DEFAULT_SETTINGS,
  RATE_PRESETS,
  sanitizeRates,
  type RateProfile,
} from '@shared/types';
import {
  FlightController,
  SIM_ACRO_RATES,
  throttleCurve,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { DEG2RAD } from '../src/renderer/sim/mathx';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { RatesTab, chartRange, presetValue } from '../src/renderer/app/RatesTab';
import { useSettingsStore } from '../src/renderer/state/settingsStore';

// Settings → Rates (2026-10-08): per-axis Actual rates and a throttle curve the
// pilot tunes, flown in Acro.

const state: ControlState = {
  rotation: [0, 0, 0, 1],
  angvelWorld: [0, 0, 0],
  velocityWorld: [0, 0, 0],
  position: [0, 5, 0],
  inertia: [0.001, 0.002, 0.001],
  mass: guruDrone.mass,
  maxPerMotor: guruDrone.motors[0].maxThrustN,
  groundEffect: 1,
  onGround: false,
  contactState: 'AIRBORNE',
};

const profile = (over: Partial<RateProfile> = {}): RateProfile => ({
  ...DEFAULT_RATE_PROFILE,
  ...over,
});

describe('defaults', () => {
  it('are 100 / 620 / 0.20 on every axis with a straight throttle, matching the controller', () => {
    for (const a of ['roll', 'pitch', 'yaw'] as const) {
      expect(DEFAULT_RATE_PROFILE[a]).toEqual({ center: 100, max: 620, expo: 0.2 });
    }
    expect(SIM_ACRO_RATES).toEqual({ kind: 'actual', centerDps: 100, maxDps: 620, expo: 0.2 });
    expect(DEFAULT_SETTINGS.rates).toEqual(DEFAULT_RATES);
    expect(RATE_PRESETS[0].profile).toBe(DEFAULT_RATE_PROFILE);
  });
});

describe('throttleCurve', () => {
  it('is the stick unchanged at midpoint 0, expo 0', () => {
    for (const t of [0, 0.1, 0.33, 0.5, 0.9, 1]) expect(throttleCurve(t, 0, 0)).toBeCloseTo(t, 12);
  });

  it('keeps both ends and the midpoint, and stays monotonic', () => {
    for (const [mid, expo] of [
      [0.5, 1],
      [0.3, 0.4],
      [0, 0.1],
      [1, 0.7],
    ]) {
      expect(throttleCurve(0, mid, expo)).toBeCloseTo(0, 12);
      expect(throttleCurve(1, mid, expo)).toBeCloseTo(1, 12);
      expect(throttleCurve(mid, mid, expo)).toBeCloseTo(mid, 12);
      let last = -1;
      for (let i = 0; i <= 100; i++) {
        const v = throttleCurve(i / 100, mid, expo);
        expect(v).toBeGreaterThanOrEqual(last - 1e-12);
        last = v;
      }
    }
  });

  it('flattens about the midpoint with expo (Betaflight thr_expo)', () => {
    // mid 0.5, expo 1: 0.5 + d·(d/0.5)² — a tenth off mid moves 0.004, not 0.1.
    expect(throttleCurve(0.6, 0.5, 1)).toBeCloseTo(0.504, 12);
    expect(throttleCurve(0.4, 0.5, 1)).toBeCloseTo(0.496, 12);
  });
});

describe('the flight controller flies the profile', () => {
  it('each axis on its own curve, in Acro', () => {
    const fc = new FlightController(guruDrone);
    fc.setRates(
      profile({
        roll: { center: 100, max: 300, expo: 0 },
        pitch: { center: 100, max: 500, expo: 0 },
        yaw: { center: 50, max: 200, expo: 0 },
      }),
    );
    fc.update({ roll: 1, pitch: 1, yaw: 1, throttle: 0.5 }, 'acro', state, 0.004);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(300, 6);
    expect(-fc.rateSp.pitch / DEG2RAD).toBeCloseTo(500, 6);
    expect(-fc.rateSp.yaw / DEG2RAD).toBeCloseTo(200, 6);
  });

  it('leaves Stabilize on its angle loop and linear yaw', () => {
    const a = new FlightController(guruDrone);
    const b = new FlightController(guruDrone);
    b.setRates(profile({ yaw: { center: 10, max: 2000, expo: 1 } }));
    a.update({ roll: 0.5, pitch: 0, yaw: 1, throttle: 0.5 }, 'stabilize', state, 0.004);
    b.update({ roll: 0.5, pitch: 0, yaw: 1, throttle: 0.5 }, 'stabilize', state, 0.004);
    expect(b.rateSp).toEqual(a.rateSp);
  });

  it('bends the radio Acro throttle with the throttle curve', () => {
    const thrust = (p: RateProfile) => {
      const fc = new FlightController(guruDrone);
      fc.setRates(p);
      fc.update(
        { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
        'acro',
        state,
        0.004,
        undefined,
        true,
        false,
        1,
        true,
        true,
      );
      const o = fc.update(
        { roll: 0, pitch: 0, yaw: 0, throttle: 0.6 },
        'acro',
        state,
        0.004,
        undefined,
        false,
        false,
        1,
        true,
        true,
      );
      return o.motorThrusts.reduce((s, m) => s + m, 0);
    };
    const straight = thrust(profile());
    const bent = thrust(profile({ throttleMid: 0.5, throttleExpo: 1 }));
    expect(bent).toBeLessThan(straight);
  });
});

describe('sanitizeRates', () => {
  it('fills what is missing and clamps what is out of range', () => {
    expect(sanitizeRates(undefined)).toEqual(DEFAULT_RATES);
    const r = sanitizeRates({
      profile: { roll: { center: -5, max: 99999, expo: 3 }, throttleMid: 2 },
      linkRollPitch: 'yes',
      saved: [{ name: '  Mine ', profile: {} }, { name: '' }, null],
    });
    expect(r.profile.roll).toEqual({ center: 10, max: 2000, expo: 1 });
    expect(r.profile.pitch).toEqual(DEFAULT_RATE_PROFILE.pitch);
    expect(r.profile.throttleMid).toBe(1);
    expect(r.linkRollPitch).toBe(false);
    expect(r.saved).toEqual([{ name: 'Mine', profile: DEFAULT_RATE_PROFILE }]);
  });
});

describe('presetValue and chartRange', () => {
  it('names a built-in, a saved preset, or custom', () => {
    expect(presetValue(DEFAULT_RATE_PROFILE, [])).toBe('default');
    expect(presetValue(RATE_PRESETS[1].profile, [])).toBe('beginner');
    const mine = profile({ roll: { center: 111, max: 620, expo: 0.2 } });
    expect(presetValue(mine, [])).toBe('custom');
    expect(presetValue(mine, [{ name: 'Mine', profile: mine }])).toBe('saved:Mine');
  });

  it('is ±750 like the reference, wider in 250 steps for faster rates', () => {
    expect(chartRange(DEFAULT_RATE_PROFILE)).toBe(750);
    expect(chartRange(profile({ yaw: { center: 100, max: 1100, expo: 0 } }))).toBe(1250);
  });
});

// ---- The page ----------------------------------------------------------------

let root: Root | undefined;
let host: HTMLElement | undefined;
const save = vi.fn(async () => {});
const rates = () => useSettingsStore.getState().settings.rates;
const $$ = (sel: string) => [...host!.querySelectorAll<HTMLElement>(sel)];
const button = (text: string) => $$('button').find((b) => b.textContent?.trim() === text)!;
const click = (el: Element) => act(() => (el as HTMLElement).click());
const input = (label: string) =>
  host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function type(el: HTMLInputElement, value: string, key = 'Enter') {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  save.mockClear();
  (window as unknown as { api: unknown }).api = { saveSettings: save };
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, rates: DEFAULT_RATES } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(h(RatesTab)));
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = '';
});

describe('Settings → Rates', () => {
  it('shows the three axes with their values, the graph, and the Default preset', () => {
    expect(input('Roll Center °/s').value).toBe('100');
    expect(input('Pitch Max °/s').value).toBe('620');
    expect(input('Yaw Expo').value).toBe('0.20');
    expect($$('.rates__line')).toHaveLength(3);
    expect(host!.querySelector('.ds-select__button')!.textContent).toContain('Default');
    expect(host!.textContent).toContain('Actual');
  });

  it('a typed value is saved, clamped, and turns the preset to Custom', () => {
    type(input('Roll Max °/s'), '800');
    expect(rates().profile.roll.max).toBe(800);
    expect(rates().profile.pitch.max).toBe(620);
    expect(save).toHaveBeenCalled();
    expect(host!.querySelector('.ds-select__button')!.textContent).toContain('Custom');
    type(input('Yaw Expo'), '5');
    expect(rates().profile.yaw.expo).toBe(1);
  });

  it('▲ ▼ step a value', () => {
    click(host!.querySelector('button[aria-label="Increase Roll Center °/s"]')!);
    expect(rates().profile.roll.center).toBe(110);
    click(host!.querySelector('button[aria-label="Decrease Yaw Expo"]')!);
    expect(rates().profile.yaw.expo).toBe(0.19);
  });

  it('Link Roll & Pitch copies roll to pitch and keeps them together', () => {
    type(input('Roll Max °/s'), '700');
    click($$('[role="checkbox"]').find((c) => c.textContent?.includes('Link Roll'))!);
    expect(rates().linkRollPitch).toBe(true);
    expect(rates().profile.pitch).toEqual(rates().profile.roll);
    type(input('Pitch Center °/s'), '150');
    expect(rates().profile.roll.center).toBe(150);
  });

  it('Save as preset adds it to the dropdown, and Presets can delete it', () => {
    type(input('Roll Max °/s'), '700');
    click(button('Save as preset'));
    const name = host!.querySelector<HTMLInputElement>('.rates__save input')!;
    type(name, 'Smooth');
    expect(rates().saved).toEqual([{ name: 'Smooth', profile: rates().profile }]);
    expect(host!.querySelector('.ds-select__button')!.textContent).toContain('Smooth');
    click(button('Presets'));
    click(button('Delete'));
    expect(rates().saved).toEqual([]);
  });

  it('picking a built-in preset applies it', () => {
    click(host!.querySelector('.ds-select__button')!);
    click($$('[role="option"]').find((o) => o.textContent?.includes('Beginner'))!);
    expect(rates().profile).toEqual(RATE_PRESETS.find((p) => p.id === 'beginner')!.profile);
  });

  it('the throttle sliders write the curve, and Reset to defaults puts it all back', () => {
    const mid = $$('.ds-slider').find((s) => s.querySelector('label')?.textContent === 'Midpoint')!;
    const range = mid.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(range, '0.4');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rates().profile.throttleMid).toBe(0.4);
    click(button('Reset to defaults'));
    expect(rates().profile).toEqual(DEFAULT_RATE_PROFILE);
  });
});
