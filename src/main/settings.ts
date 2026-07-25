import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type AppSettings } from '@shared/types';

// Phase 0 persistence: a single JSON file in the OS-appropriate userData dir.
// Relational storage (better-sqlite3) is introduced in Phase 4 for scores and
// replays; settings stay as a simple document either way.

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Merge over defaults so newly-added fields are always populated.
    return { ...DEFAULT_SETTINGS, ...parsed, version: SETTINGS_VERSION };
  } catch {
    // Missing/corrupt file -> fall back to defaults (do not crash the app).
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...settings, version: SETTINGS_VERSION };
  await fs.writeFile(settingsFile(), JSON.stringify(merged, null, 2), 'utf-8');
}
