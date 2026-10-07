import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, PROFILE_REV } from '../src/shared/types';
import { detectKind, readChannel } from '../src/renderer/input/gamepad';
import { useSettingsStore } from '../src/renderer/state/settingsStore';

const id = 'InterLinkDX (Vendor: 1781 Product: 0e5a)';
const saveSettings = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.stubGlobal('window', { api: { saveSettings } });
  useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  saveSettings.mockClear();
});

describe('InterLink controller', () => {
  it('recognises a radio with many switch buttons even with standard mapping', () => {
    expect(
      detectKind({
        id,
        mapping: 'standard',
        axes: new Array(8).fill(0),
        buttons: new Array(24).fill({ pressed: false }),
      }),
    ).toBe('rc');
  });

  it('repairs a saved gamepad throttle without losing custom axes or bindings', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const axes = {
      yaw: { axis: 0, invert: false },
      throttle: { axis: 1, invert: false, cal: { lo: -0.8, mid: 0, hi: 0.8 } },
      roll: { axis: 3, invert: false },
      pitch: { axis: 4, invert: false },
    };
    const bindings = { arm: { t: 'b' as const, i: 1 }, takeoffLand: { t: 'b' as const, i: 0 } };
    settings.gamepad.devices[id] = { id, kind: 'standard', rev: PROFILE_REV, axes, bindings };
    useSettingsStore.setState({ settings });
    useSettingsStore.getState().adoptDevice(id, id, 'rc', 24);
    const cfg = useSettingsStore.getState().settings.gamepad;
    expect(cfg.axes).toEqual({ ...axes, throttle: { ...axes.throttle, unipolar: true } });
    expect(cfg.bindings).toEqual(bindings);
    expect(cfg.devices[id].kind).toBe('rc');
    expect(saveSettings).toHaveBeenCalledOnce();
    // A radio responds throughout the travel, even inside a gamepad deadzone.
    expect(readChannel('throttle', cfg, [0, 0.04, 0, 0, 0])).toBeCloseTo(0.05);
    expect(readChannel('throttle', cfg, [0, -0.8, 0, 0, 0])).toBe(-1);
    expect(readChannel('throttle', cfg, [0, 0.8, 0, 0, 0])).toBe(1);
  });

  it('does not rewrite an unchanged Xbox profile', () => {
    useSettingsStore.getState().adoptDevice('xbox', 'Xbox Controller', 'standard', 16);
    const cfg = useSettingsStore.getState().settings.gamepad;
    saveSettings.mockClear();
    useSettingsStore.getState().adoptDevice('xbox', 'Xbox Controller', 'standard', 16);
    expect(useSettingsStore.getState().settings.gamepad.axes).toEqual(cfg.axes);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
