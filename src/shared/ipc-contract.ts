// Single source of truth for the main <-> renderer IPC surface.
// Channel names live here; the preload exposes a typed `window.api` matching
// `IpcApi`, and the main process registers handlers for each channel.

import type { AppSettings, AppInfo } from './types';

export const IPC = {
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  appInfo: 'app:info',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** The narrow, whitelisted API surface exposed to the renderer. */
export interface IpcApi {
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  appInfo(): Promise<AppInfo>;
}
