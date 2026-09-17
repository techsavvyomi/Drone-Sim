import type { IpcApi } from '@shared/ipc-contract';

// The one seam between the simulator and whatever stores profiles and
// analytics.
//
// Today it is the Electron main process, which queues and forwards to Google
// Apps Script. The services in this folder are the only code that calls it, and
// the rest of the renderer only calls the services, so moving to Firebase (or
// to any HTTP API) changes what sits behind this function and nothing that
// uses it.

export type ProfileBackend = Pick<IpcApi, 'account' | 'telemetry'>;

export function profileBackend(): ProfileBackend {
  return window.api;
}
