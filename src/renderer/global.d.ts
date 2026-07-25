import type { IpcApi } from '@shared/ipc-contract';

// The preload exposes `window.api`; declare it for the renderer's type system.
declare global {
  interface Window {
    api: IpcApi;
  }
}

export {};
