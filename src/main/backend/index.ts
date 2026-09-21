import { app, BrowserWindow, ipcMain, net, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC } from '@shared/ipc-contract';
import type {
  ActivateUserRequest,
  DeviceInfo,
  GameplayEventInput,
  GetUserDashboardRequest,
  LoginUserRequest,
} from '@shared/backend/contract';
import type { SessionEnd, SessionStart } from '@shared/backend/ipc';
import { backendUrl } from './config';
import { BackendService, type AccountFile } from './service';
import { sendRequest } from './transport';
import type { OutboxState } from './outbox';

// Electron wiring for the profile & telemetry backend: files on disk, the OS
// keychain, and the IPC channels. The logic is in service.ts and outbox.ts.

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  // Write-then-rename, so a crash mid-write cannot leave half a queue behind.
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), 'utf-8');
  await fs.rename(tmp, file);
}

// Activation and sign-in hold the backend's script lock and write several sheet
// rows; on the Apps Script prototype that measured 10-30 s, past the default
// 30 s abort. Someone is watching a button spin, so they get far longer.
const SIGN_IN_ACTIONS = new Set<string>(['activateUser', 'loginUser']);
const SIGN_IN_TIMEOUT_MS = 90_000;

// A profile is signed in on one computer at a time. A computer signed out from
// another one finds out within this, plus the answer's 2-5 s, while it is open:
// under a minute, as asked. Each check is one getUserProfile call, which reads
// the sheet and writes at most hourly: ~120 an hour per open app.
const SIGN_IN_CHECK_MS = 30_000;

// The sign-in check is a light read the script answers in 1-3 s. Measured on
// 2026-09-21, the hop that carries Apps Script's answer back
// (script.googleusercontent.com) hung for the full 30 s on about one call in
// seven while the script itself had finished; a short timeout and the service's
// one retry get the answer instead of waiting on a dead connection.
const PROFILE_CHECK_TIMEOUT_MS = 10_000;

function timeoutFor(action: string): number | undefined {
  if (SIGN_IN_ACTIONS.has(action)) return SIGN_IN_TIMEOUT_MS;
  if (action === 'getUserProfile') return PROFILE_CHECK_TIMEOUT_MS;
  return undefined;
}

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/**
 * This installation's identity: a random id created on first launch and kept in
 * the user-data folder, which survives app updates and reinstalls. It is not a
 * hardware fingerprint, so copying the folder to another machine carries it
 * along; for a prototype that is the right trade against locking people out
 * when a network adapter changes.
 */
function deviceIdentity(file: string): () => Promise<DeviceInfo> {
  let cached: Promise<DeviceInfo> | null = null;
  return () => {
    cached ??= (async () => {
      const stored = await readJson<{ deviceId?: string }>(file);
      let deviceId = stored?.deviceId;
      if (!deviceId || !/^[A-Za-z0-9-]{16,128}$/.test(deviceId)) {
        deviceId = randomUUID();
        await writeJson(file, { deviceId });
      }
      const platform = PLATFORM_NAMES[process.platform] ?? process.platform;
      return { deviceId, deviceName: `${os.hostname().replace(/\.local$/, '')} (${platform})`.slice(0, 80) };
    })();
    return cached;
  };
}

export async function registerBackend(): Promise<BackendService> {
  const dir = app.getPath('userData');
  const accountsFile = path.join(dir, 'account.json');
  const outboxFile = path.join(dir, 'telemetry-outbox.json');
  const deviceFile = path.join(dir, 'device.json');
  const url = backendUrl();

  const service = new BackendService({
    configured: !!url,
    send: (action, payload, token) =>
      // Chromium's network stack, not Node's fetch: on 2026-09-21 Node's hung on
      // the hop that carries Apps Script's answer back for most calls, while the
      // script had answered in 1-3 s.
      sendRequest(
        { url, timeoutMs: timeoutFor(action), fetchImpl: (input, init) => net.fetch(input as string, init) },
        action,
        payload,
        token,
      ),
    loadAccounts: () => readJson<AccountFile>(accountsFile),
    saveAccounts: (file) => writeJson(accountsFile, file),
    loadOutbox: () => readJson<OutboxState>(outboxFile),
    saveOutbox: (state) => writeJson(outboxFile, state),
    codec: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
    },
    device: deviceIdentity(deviceFile),
    notify: (account) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.accountChanged, account);
      }
    },
  });

  // Handlers go in before the (async) load so an early renderer call waits on
  // `ready` instead of finding no handler.
  const ready = service.init();
  void ready.then(() => service.watchSignIn(SIGN_IN_CHECK_MS));

  ipcMain.handle(IPC.accountGet, async () => {
    await ready;
    return service.account();
  });
  ipcMain.handle(IPC.accountActivate, async (_e, req: Omit<ActivateUserRequest, keyof DeviceInfo>) => {
    await ready;
    return service.activate(req);
  });
  ipcMain.handle(IPC.accountLogin, async (_e, req: Omit<LoginUserRequest, keyof DeviceInfo>) => {
    await ready;
    return service.login(req);
  });
  ipcMain.handle(IPC.accountSignOut, async () => {
    await ready;
    return service.signOut();
  });
  ipcMain.handle(IPC.accountRefresh, async () => {
    await ready;
    return service.refreshProfile();
  });
  ipcMain.handle(IPC.accountDashboard, async (_e, req: Omit<GetUserDashboardRequest, 'userId'>) => {
    await ready;
    return service.dashboard(req ?? {});
  });

  // Telemetry is one-way `send`, not `invoke`: the simulator never waits on it,
  // and messages on one channel pipe arrive in the order they were sent, so a
  // session's start always reaches the outbox before its events and end.
  ipcMain.on(IPC.telemetryStart, (_e, req: SessionStart) => {
    void ready.then(() => service.startSession(req));
  });
  ipcMain.on(IPC.telemetryCheckpoint, (_e, key: string, end: SessionEnd) => {
    void ready.then(() => service.checkpointSession(key, end));
  });
  ipcMain.on(IPC.telemetryEnd, (_e, key: string, end: SessionEnd) => {
    void ready.then(() => service.endSession(key, end));
  });
  ipcMain.on(IPC.telemetryEvents, (_e, key: string | null, events: GameplayEventInput[]) => {
    void ready.then(() => service.recordEvents(key, events));
  });
  ipcMain.handle(IPC.telemetryStatus, async () => {
    await ready;
    return service.telemetryStatus();
  });

  // One last attempt to deliver what is queued before the app goes. Anything
  // that does not make it stays on disk for the next launch.
  app.on('before-quit', () => {
    void service.outbox.flush();
  });

  return service;
}
