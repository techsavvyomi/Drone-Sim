import type { CrashKind, CrashReport, DeviceInfo } from '@shared/backend/contract';

// Turning errors into crash reports: what is kept, what is scrubbed, and how a
// crash loop is kept from flooding the queue.
//
// Free of Electron so it can be tested; crash/index.ts feeds it.

export interface CrashInput {
  kind: CrashKind;
  message: string;
  stack?: string;
  fatal: boolean;
  context?: Record<string, unknown>;
  occurredAt?: string;
}

export interface CrashEnvironment {
  appVersion: string;
  platform: string;
  osVersion: string;
  electronVersion: string;
  /** Replaced with `~` wherever it appears: it usually contains the user's name. */
  homeDir: string;
}

/** The same fault reported again within this window is dropped. */
const REPEAT_WINDOW_MS = 60_000;
/** Most reports one run of the app sends, whatever happens. */
const MAX_PER_RUN = 50;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove what identifies the person rather than the fault: their home folder
 * (in both slash styles, since Windows stacks mix them) and the dev server's
 * origin, which differs per machine.
 */
export function scrub(text: string, env: Pick<CrashEnvironment, 'homeDir'>): string {
  let out = text;
  const home = env.homeDir.replace(/[\\/]+$/, '');
  if (home.length > 1) {
    for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
      out = out.replace(new RegExp(escapeRegExp(variant), 'gi'), '~');
    }
  }
  return out
    .replace(/file:\/\/\/?/g, '')
    .replace(/https?:\/\/(localhost|127\.0\.0\.1):\d+\//g, 'app://');
}

/** Anything thrown, as a message and a stack. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Error', stack: err.stack };
  }
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) ?? String(err) };
  } catch {
    return { message: String(err) };
  }
}

export interface CrashCollectorDeps {
  env: CrashEnvironment;
  device: () => Promise<DeviceInfo>;
  now?: () => number;
}

/**
 * Collects crash reports and hands them to a sink once one is attached.
 *
 * Reports raised before the backend is ready (a crash during startup) are held
 * and delivered on `attach`.
 */
export class CrashCollector {
  private sink: ((report: CrashReport) => void) | null = null;
  private pending: CrashReport[] = [];
  private lastSeen = new Map<string, number>();
  private sent = 0;
  private readonly now: () => number;

  constructor(private deps: CrashCollectorDeps) {
    this.now = deps.now ?? Date.now;
  }

  attach(sink: (report: CrashReport) => void): void {
    this.sink = sink;
    const held = this.pending;
    this.pending = [];
    held.forEach((r) => sink(r));
  }

  /** Returns the report, or null when it was throttled. */
  async capture(input: CrashInput): Promise<CrashReport | null> {
    const firstLine = input.message.split('\n')[0].slice(0, 200);
    const key = `${input.kind}|${firstLine}`;
    const at = this.now();
    const previous = this.lastSeen.get(key);
    if (previous !== undefined && at - previous < REPEAT_WINDOW_MS) return null;
    if (this.sent >= MAX_PER_RUN) return null;
    this.lastSeen.set(key, at);
    this.sent += 1;

    let device: DeviceInfo | undefined;
    try {
      device = await this.deps.device();
    } catch {
      device = undefined;
    }

    const { env } = this.deps;
    const report: CrashReport = {
      kind: input.kind,
      message: scrub(input.message, env).slice(0, 1000) || input.kind,
      stack: input.stack ? scrub(input.stack, env).slice(0, 8000) : undefined,
      fatal: input.fatal,
      occurredAt: input.occurredAt ?? new Date(at).toISOString(),
      appVersion: env.appVersion,
      platform: env.platform,
      osVersion: env.osVersion,
      electronVersion: env.electronVersion,
      deviceId: device?.deviceId,
      deviceName: device?.deviceName,
      context: input.context,
    };
    if (this.sink) this.sink(report);
    else this.pending.push(report);
    return report;
  }
}
