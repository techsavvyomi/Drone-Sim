import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcApi } from '@shared/ipc-contract';
import type { AppSettings } from '@shared/types';
import type { AccountInfo } from '@shared/backend/ipc';

// The only surface the renderer can touch. contextIsolation is on, so this is
// exposed as `window.api` without leaking Node/Electron internals.
const api: IpcApi = {
  loadSettings: () => ipcRenderer.invoke(IPC.settingsLoad),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  quit: () => ipcRenderer.invoke(IPC.appQuit),
  account: {
    get: () => ipcRenderer.invoke(IPC.accountGet),
    activate: (req) => ipcRenderer.invoke(IPC.accountActivate, req),
    login: (req) => ipcRenderer.invoke(IPC.accountLogin, req),
    hasSavedKey: (email) => ipcRenderer.invoke(IPC.accountHasSavedKey, email),
    loginSaved: (req) => ipcRenderer.invoke(IPC.accountLoginSaved, req),
    signOut: (opts) => ipcRenderer.invoke(IPC.accountSignOut, opts),
    refreshProfile: () => ipcRenderer.invoke(IPC.accountRefresh),
    dashboard: (req) => ipcRenderer.invoke(IPC.accountDashboard, req),
    onChanged: (listener) => {
      const handler = (_e: unknown, account: AccountInfo) => listener(account);
      ipcRenderer.on(IPC.accountChanged, handler);
      return () => ipcRenderer.removeListener(IPC.accountChanged, handler);
    },
  },
  crash: {
    report: (input) => ipcRenderer.send(IPC.crashReport, input),
    setContext: (context) => ipcRenderer.send(IPC.crashContext, context),
  },
  telemetry: {
    startSession: (req) => ipcRenderer.send(IPC.telemetryStart, req),
    checkpoint: (key, end) => ipcRenderer.send(IPC.telemetryCheckpoint, key, end),
    endSession: (key, end) => ipcRenderer.send(IPC.telemetryEnd, key, end),
    recordEvents: (key, events) => ipcRenderer.send(IPC.telemetryEvents, key, events),
    status: () => ipcRenderer.invoke(IPC.telemetryStatus),
    syncNow: () => ipcRenderer.invoke(IPC.telemetrySyncNow),
  },
};

contextBridge.exposeInMainWorld('api', api);
