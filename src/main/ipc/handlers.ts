import { app, ipcMain, shell } from 'electron';
import { IPC } from '@shared/ipc-contract';
import type { AppInfo, AppSettings } from '@shared/types';
import { loadSettings, saveSettings } from '../settings';
import { registerBackend } from '../backend';
import type { BackendService } from '../backend/service';

// The renderer may only send the user to Drona Aviation's own site or support
// mail. Checked here, not in the renderer, so a compromised page cannot use this
// channel to launch arbitrary URLs or local files.
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'mailto:') return url.pathname === 'support@plutodrones.com';
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'www.dronaaviation.com' || url.hostname === 'dronaaviation.com')
  );
}

// Registers all main-process IPC handlers. Every channel here has a matching
// entry in the IPC contract and a typed wrapper in the preload.
export function registerIpcHandlers(): Promise<BackendService> {
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

  ipcMain.handle(IPC.openExternal, async (_event, url: unknown): Promise<void> => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) await shell.openExternal(url);
  });

  return registerBackend();
}
