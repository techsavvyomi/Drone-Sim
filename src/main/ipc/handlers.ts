import { app, ipcMain, shell } from 'electron';
import { IPC } from '@shared/ipc-contract';
import type { AppInfo, AppSettings } from '@shared/types';
import { loadSettings, saveSettings } from '../settings';
import { registerBackend } from '../backend';
import type { BackendService } from '../backend/service';
import { isAllowedExternalUrl } from '../externalLinks';

declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

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
    commit: typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown',
    builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '',
    packaged: app.isPackaged,
    osVersion: process.getSystemVersion(),
    arch: process.arch,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  ipcMain.handle(IPC.openExternal, async (_event, url: unknown): Promise<boolean> => {
    if (!isAllowedExternalUrl(url)) return false;
    await shell.openExternal(url as string);
    return true;
  });

  return registerBackend();
}
