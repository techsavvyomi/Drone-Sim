import { create } from 'zustand';
import {
  axesForKind,
  DEFAULT_BINDINGS,
  DEFAULT_GAMEPAD,
  DEFAULT_SETTINGS,
  DEFAULT_TRAINING,
  PROFILE_REV,
  type AppSettings,
  type GamepadKind,
  type GamepadSettings,
  type HudWidgets,
} from '@shared/types';
import { activeDeviceKey, setDeviceHandler, setGamepadConfig } from '../input/gamepad';
import { usePilotStore } from './pilotStore';

// Renderer-side mirror of persisted settings. Hydrated from the main process on
// boot; every mutation writes back through IPC so changes survive a restart.

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Toggle a single HUD widget's visibility. */
  setHud: (widget: keyof HudWidgets, visible: boolean) => void;
  /** Patch the gamepad config; the input module is kept in sync automatically. */
  setGamepad: (patch: Partial<GamepadSettings>) => void;
  /** A controller was detected: restore its mapping, or build one for it. */
  adoptDevice: (key: string, id: string, kind: GamepadKind, buttonCount: number) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,

  hydrate: async () => {
    const loaded = await window.api.loadSettings();
    // Merge nested defaults so settings saved before a widget existed still
    // get a value for it.
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // The Ultra preset was removed; a profile saved while it was selected
      // would otherwise leave `graphics` on a value no preset table has an
      // entry for, which reads as an undefined quality config at boot.
      graphics:
        (loaded.graphics as string) === 'ultra'
          ? 'high'
          : (loaded.graphics ?? DEFAULT_SETTINGS.graphics),
      hud: { ...DEFAULT_SETTINGS.hud, ...(loaded.hud ?? {}) },
      gamepad: {
        ...DEFAULT_GAMEPAD,
        ...(loaded.gamepad ?? {}),
        // Nested one more level: a config saved before a channel existed must
        // still end up with an axis for it.
        axes: { ...DEFAULT_GAMEPAD.axes, ...(loaded.gamepad?.axes ?? {}) },
        bindings: { ...DEFAULT_GAMEPAD.bindings, ...(loaded.gamepad?.bindings ?? {}) },
        devices: loaded.gamepad?.devices ?? {},
      },
      training: {
        ...DEFAULT_TRAINING,
        ...(loaded.training ?? {}),
        lessons: { ...(loaded.training?.lessons ?? {}) },
      },
    };
    set({ settings, hydrated: true });
    setGamepadConfig(settings.gamepad);
    // Seed the pilot badge from the persisted lifetime XP.
    usePilotStore.getState().syncFromTotal(settings.training.xp);
  },

  setHud: (widget, visible) => {
    const current = get().settings;
    const next: AppSettings = { ...current, hud: { ...current.hud, [widget]: visible } };
    set({ settings: next });
    void window.api.saveSettings(next);
  },

  setGamepad: (patch) => {
    const current = get().settings;
    const gamepad: GamepadSettings = { ...current.gamepad, ...patch };

    // Mirror mapping edits into the active device's remembered profile, so
    // unplugging and replugging (or swapping controllers and back) restores
    // what the pilot configured rather than resetting to the detected default.
    const key = activeDeviceKey();
    const existing = key ? gamepad.devices[key] : undefined;
    if (key && existing && (patch.axes || patch.bindings)) {
      gamepad.devices = {
        ...gamepad.devices,
        [key]: { ...existing, axes: gamepad.axes, bindings: gamepad.bindings },
      };
    }

    const next: AppSettings = { ...current, gamepad };
    set({ settings: next });
    setGamepadConfig(gamepad);
    void window.api.saveSettings(next);
  },

  adoptDevice: (key, id, kind, buttonCount) => {
    const current = get().settings;
    const saved = current.gamepad.devices[key];
    // Profiles seeded by an older generation of defaults are rebuilt, not
    // restored — see PROFILE_REV for why that matters for throttle.
    const known = saved && saved.rev === PROFILE_REV ? saved : undefined;
    // Known device: restore it. New device: seed from the detected layout —
    // this is what makes a controller work correctly the first time it is
    // plugged in, since radios and gamepads use different axis orders.
    const profile = known ?? {
      id,
      kind,
      rev: PROFILE_REV,
      axes: axesForKind(kind),
      // DEFAULT_BINDINGS is an Xbox face-button layout (A / X / Y / LB / RB /
      // Start). On a radio those indices are arbitrary — a Pocket enumerates 24
      // buttons that stay unpressed until the pilot maps switches to them in
      // EdgeTX — so seeding them would fill the list with entries that silently
      // never fire. Radios start empty and get bound to real switches instead.
      bindings: kind === 'standard' && buttonCount > 0 ? { ...DEFAULT_BINDINGS } : {},
    };

    const gamepad: GamepadSettings = {
      ...current.gamepad,
      axes: profile.axes,
      bindings: profile.bindings,
      devices: { ...current.gamepad.devices, [key]: profile },
    };
    const next: AppSettings = { ...current, gamepad };
    set({ settings: next });
    setGamepadConfig(gamepad);
    if (!known) void window.api.saveSettings(next);
  },

  set: (key, value) => {
    const next = { ...get().settings, [key]: value };
    set({ settings: next });
    // Fire-and-forget persistence; ordering is preserved by the IPC channel.
    void window.api.saveSettings(next);
  },
}));

// The input module must not import this store (that would be a cycle), so the
// dependency is inverted: it calls whatever is registered here.
setDeviceHandler((key, id, kind, buttons) =>
  useSettingsStore.getState().adoptDevice(key, id, kind, buttons),
);
