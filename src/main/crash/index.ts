import { app, BrowserWindow, crashReporter, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC } from '@shared/ipc-contract';
import type { CrashInput } from './crashReports';
import { CrashCollector, describeError } from './crashReports';
import type { BackendService } from '../backend/service';

// Crash reporting: every way the simulator can go down, turned into a report on
// the telemetry queue.
//
//   main process     uncaught exceptions and unhandled rejections
//   game window      JS errors, rejections, React render errors, WebGL context
//                    loss (reported by the renderer over IPC), and the window's
//                    process dying outright (render-process-gone)
//   GPU / helpers    child-process-gone
//   native crashes   Electron's crash reporter writes a minidump; it cannot be
//                    uploaded to a spreadsheet, so it stays on disk and the
//                    next launch reports that it happened
//
// Reports go through the same on-disk outbox as flight sessions, so one raised
// just before the app dies is still delivered on the next launch.

/** Reloads allowed within RELOAD_WINDOW_MS before the app stops trying. */
const MAX_RELOADS = 3;
const RELOAD_WINDOW_MS = 2 * 60 * 1000;
/** Minidumps older than this are not worth reporting on first sight. */
const DUMP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CrashReporting {
  /** Start delivering reports, and handle the game window dying. */
  attach(backend: BackendService): void;
}

/**
 * Install as early as possible, before `app.whenReady`: the native crash
 * reporter must start before any other process does, and a startup exception
 * should be caught too.
 */
export function installCrashReporting(): CrashReporting {
  // Minidumps only, kept locally. There is no endpoint that accepts them yet.
  crashReporter.start({ uploadToServer: false, compress: true });

  let backend: BackendService | null = null;
  /** What the game window last said it was doing, for reports it cannot send. */
  let rendererContext: Record<string, unknown> = {};

  const collector = new CrashCollector({
    env: {
      appVersion: app.getVersion(),
      platform: process.platform,
      osVersion: `${os.type()} ${os.release()}`,
      electronVersion: process.versions.electron ?? '',
      homeDir: os.homedir(),
    },
    device: () => (backend ? backend.device() : Promise.reject(new Error('backend not ready'))),
  });

  const capture = (input: CrashInput) => {
    void collector.capture(input).catch((e) => console.error('[crash] could not record a report', e));
  };

  process.on('uncaughtException', (err) => {
    console.error('[main] uncaught exception', err);
    capture({ kind: 'MAIN_EXCEPTION', ...describeError(err), fatal: false, context: mainContext() });
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandled rejection', reason);
    capture({ kind: 'MAIN_REJECTION', ...describeError(reason), fatal: false, context: mainContext() });
  });

  ipcMain.on(IPC.crashReport, (_e, input: CrashInput) => {
    if (!input || typeof input.message !== 'string') return;
    capture({ ...input, context: { ...rendererContext, ...(input.context ?? {}) } });
  });
  ipcMain.on(IPC.crashContext, (_e, context: Record<string, unknown>) => {
    if (context && typeof context === 'object') rendererContext = context;
  });

  const reloads: number[] = [];

  return {
    attach(service) {
      backend = service;
      collector.attach((report) => service.recordCrash(report));

      app.on('render-process-gone', (_event, contents, details) => {
        if (details.reason === 'clean-exit') return;
        capture({
          kind: 'RENDERER_GONE',
          message: `Game window process ${details.reason} (exit code ${details.exitCode})`,
          fatal: true,
          context: { ...rendererContext, reason: details.reason, exitCode: details.exitCode },
        });
        // Whatever the window had open ended here.
        service.abortOpenSessions(`window ${details.reason}`);
        recover(contents);
      });

      app.on('child-process-gone', (_event, details) => {
        if (details.reason === 'clean-exit') return;
        capture({
          kind: 'CHILD_PROCESS_GONE',
          message: `${details.type} process ${details.reason} (exit code ${details.exitCode})`,
          fatal: details.type === 'GPU',
          context: {
            ...rendererContext,
            processType: details.type,
            serviceName: details.serviceName,
            reason: details.reason,
            exitCode: details.exitCode,
          },
        });
      });

      void reportNewMinidumps(capture);
    },
  };

  function mainContext(): Record<string, unknown> {
    return {
      ...rendererContext,
      process: 'main',
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  }

  /** Bring the window back, unless it keeps dying. */
  function recover(contents: Electron.WebContents): void {
    const now = Date.now();
    while (reloads.length && now - reloads[0] > RELOAD_WINDOW_MS) reloads.shift();
    if (contents.isDestroyed()) return;
    if (reloads.length >= MAX_RELOADS) {
      const win = BrowserWindow.fromWebContents(contents);
      const options = {
        type: 'error' as const,
        title: 'PlutoSim',
        message: 'The simulator keeps crashing.',
        detail: 'A crash report has been sent. Try lowering the graphics preset, or restart the app.',
      };
      void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
      return;
    }
    reloads.push(now);
    setTimeout(() => {
      if (!contents.isDestroyed()) contents.reload();
    }, 800);
  }
}

/** Report native crashes (minidumps) not reported by an earlier launch. */
async function reportNewMinidumps(capture: (input: CrashInput) => void): Promise<void> {
  try {
    const dir = app.getPath('crashDumps');
    const stateFile = path.join(app.getPath('userData'), 'crash-dumps-reported.json');
    let reported: string[] = [];
    try {
      reported = JSON.parse(await fs.readFile(stateFile, 'utf-8')).dumps ?? [];
    } catch {
      reported = [];
    }

    const dumps = await findDumps(dir);
    const fresh = dumps.filter((d) => !reported.includes(d.name) && Date.now() - d.mtimeMs < DUMP_MAX_AGE_MS);
    for (const dump of fresh) {
      capture({
        kind: 'NATIVE_CRASH',
        message: `Native crash (minidump ${dump.name}, ${Math.round(dump.size / 1024)} KB)`,
        fatal: true,
        occurredAt: new Date(dump.mtimeMs).toISOString(),
        context: { minidump: dump.name, sizeKb: Math.round(dump.size / 1024) },
      });
    }
    if (fresh.length > 0) {
      const names = [...reported, ...fresh.map((d) => d.name)].slice(-200);
      await fs.writeFile(stateFile, JSON.stringify({ dumps: names }), 'utf-8');
    }
  } catch (e) {
    console.warn('[crash] could not scan minidumps', e);
  }
}

async function findDumps(dir: string, depth = 0): Promise<{ name: string; size: number; mtimeMs: number }[]> {
  if (depth > 3) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; size: number; mtimeMs: number }[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findDumps(full, depth + 1)));
    } else if (entry.name.endsWith('.dmp')) {
      const stat = await fs.stat(full);
      out.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return out;
}
