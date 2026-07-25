import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcApi } from '@shared/ipc-contract';
import type { AppSettings } from '@shared/types';

// The only surface the renderer can touch. contextIsolation is on, so this is
// exposed as `window.api` without leaking Node/Electron internals.
const api: IpcApi = {
  loadSettings: () => ipcRenderer.invoke(IPC.settingsLoad),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
};

contextBridge.exposeInMainWorld('api', api);
