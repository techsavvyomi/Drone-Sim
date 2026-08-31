import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Settings persistence, in the main process. A single JSON document in the OS
// user-data directory, merged over the current defaults on the way in and out.
//
// `electron` is stubbed so `app.getPath('userData')` lands in a temp directory;
// everything else here is the real file system, so a corrupt file is genuinely
// corrupt rather than a mocked rejection.

let userData = '';

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));

const { loadSettings, saveSettings } = await import('../src/main/settings');
const { DEFAULT_SETTINGS, SETTINGS_VERSION } = await import('../src/shared/types');

const file = () => path.join(userData, 'settings.json');

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dronesim-settings-'));
});

describe('loading', () => {
  it('TC-008 a fresh install with no file starts on defaults', async () => {
    const s = await loadSettings();

    expect(s.graphics).toBe(DEFAULT_SETTINGS.graphics);
    expect(s.physics).toBe(DEFAULT_SETTINGS.physics);
    expect(s.selectedDroneId).toBe('pluto');
    expect(s.selectedEnvironmentId).toBe('drone-academy');
  });

  it('TC-008 every HUD widget is on by default', async () => {
    const s = await loadSettings();

    expect(Object.values(s.hud).every(Boolean)).toBe(true);
  });

  it('TC-004 a damaged file falls back to defaults instead of throwing', async () => {
    await fs.writeFile(file(), 'broken', 'utf-8');

    const s = await loadSettings();

    expect(s.graphics).toBe(DEFAULT_SETTINGS.graphics);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('TC-004 a half-written file falls back too', async () => {
    await fs.writeFile(file(), '{"graphics":"high",', 'utf-8');

    const s = await loadSettings();

    expect(s.graphics).toBe(DEFAULT_SETTINGS.graphics);
  });

  it('TC-005 a profile from an older build gains the newly added keys', async () => {
    // A document saved before the HUD widgets and the training record existed.
    await fs.writeFile(file(), JSON.stringify({ graphics: 'high', volume: 0.2 }), 'utf-8');

    const s = await loadSettings();

    // What it did have is kept...
    expect(s.graphics).toBe('high');
    expect(s.volume).toBe(0.2);
    // ...and what it never had is filled in rather than left undefined.
    expect(s.hud).toBeDefined();
    expect(s.training).toBeDefined();
    expect(s.gamepad).toBeDefined();
  });
});

describe('saving', () => {
  it('TC-003 what is saved is what comes back', async () => {
    const next = { ...DEFAULT_SETTINGS, graphics: 'low' as const, volume: 0.15, cameraZoom: 2.4 };

    await saveSettings(next);
    const back = await loadSettings();

    expect(back.graphics).toBe('low');
    expect(back.volume).toBe(0.15);
    expect(back.cameraZoom).toBe(2.4);
  });

  it('TC-003 hidden HUD widgets stay hidden across a restart', async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      hud: { ...DEFAULT_SETTINGS.hud, compass: false, sticks: false },
    };

    await saveSettings(next);
    const back = await loadSettings();

    expect(back.hud.compass).toBe(false);
    expect(back.hud.sticks).toBe(false);
    expect(back.hud.horizon).toBe(true);
  });

  it('TC-003 the written file is readable JSON, not a blob', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS });

    const raw = await fs.readFile(file(), 'utf-8');

    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('\n');
  });

  it('TC-005 the version is stamped on every save', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, version: 0 });

    const back = await loadSettings();

    expect(back.version).toBe(SETTINGS_VERSION);
  });
});
