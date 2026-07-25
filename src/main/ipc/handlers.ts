import { app, ipcMain } from 'electron';
import { IPC } from '@shared/ipc-contract';
import type { AppInfo, AppSettings } from '@shared/types';
import { loadSettings, saveSettings } from '../settings';

// Registers all main-process IPC handlers. Every channel here has a matching
// entry in the IPC contract and a typed wrapper in the preload.
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.settingsLoad, (): Promise<AppSettings> => loadSettings());

  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings): Promise<void> =>
    saveSettings(settings),
  );

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  }));
}
