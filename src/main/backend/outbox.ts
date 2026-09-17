import { randomUUID } from 'node:crypto';
import {
  isRetryable,
  type ApiAction,
  type ApiActions,
  type ApiResponse,
  type CrashReport,
  type EndSessionRequest,
  type EndSessionResult,
  type GameplayEventInput,
  type StartSessionRequest,
} from '@shared/backend/contract';

// The telemetry outbox: every session and event the simulator records goes
// through here on its way to the backend.
//
// Why a queue rather than a call: the simulator is used in classrooms with
// patchy Wi-Fi, an Apps Script request takes one to three seconds, and a pilot
// can quit mid-flight. So writes are persisted to disk first and sent in order
// in the background:
//
//   - The client never waits on the network to fly.
//   - A session's start, events and end are sent in order. Its server id
//     (SES-…) only exists once the start has been accepted, so later items
//     refer to the session by the client's own key and are resolved at send
//     time.
//   - Starts are idempotent on `clientSessionKey` and ends are applied once
//     server-side, so a retry after a lost response cannot double-count.
//   - An open session is checkpointed. If the app dies before it ends, the next
//     launch closes it as ABORTED with the last checkpoint's numbers.
//   - Items belong to the user who created them and are sent with that user's
//     token, so signing out or switching accounts cannot misattribute them.
//   - Crash reports need no user: with nobody signed in they go anonymously.

export type EndSnapshot = Omit<EndSessionRequest, 'sessionId'>;

type Item =
  | { id: string; userId: string; kind: 'start'; key: string; payload: StartSessionRequest; tries: number }
  | { id: string; userId: string; kind: 'end'; key: string; payload: EndSnapshot; tries: number }
  | {
      id: string;
      userId: string;
      kind: 'events';
      key: string | null;
      payload: GameplayEventInput[];
      tries: number;
    }
  | {
      id: string;
      /** The pilot signed in when it happened, or null. */
      userId: string | null;
      kind: 'crashes';
      key: null;
      payload: CrashReport[];
      tries: number;
    };

export interface OutboxState {
  items: Item[];
  /** clientSessionKey -> server session id, for sessions with queued items. */
  sessionIds: Record<string, string>;
  /** Sessions started but not ended, with their latest checkpoint. */
  open: Record<string, { userId: string; end: EndSnapshot }>;
}

export interface OutboxStatus {
  pending: number;
  lastError: string | null;
  /** Users whose token was refused; their items wait for a new sign-in. */
  authBlocked: string[];
}

export interface OutboxDeps {
  load: () => Promise<OutboxState | null>;
  save: (state: OutboxState) => Promise<void>;
  send: <A extends ApiAction>(
    action: A,
    payload: ApiActions[A]['request'],
    authToken?: string,
  ) => Promise<ApiResponse<ApiActions[A]['response']>>;
  tokenFor: (userId: string) => string | undefined;
  onAuthInvalid?: (userId: string) => void;
  onSessionEnded?: (userId: string, result: EndSessionResult) => void;
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => Date;
}

/** Most events one request carries. The server accepts 100. */
const EVENT_BATCH = 50;
/** Most crash reports one request carries; the server's limit. */
const CRASH_BATCH = 20;
/** A crash loop offline must not grow the queue without bound. */
const MAX_QUEUED_CRASHES = 100;
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 5 * 60 * 1000;
/** Enqueues are coalesced for this long, so a burst of events is one request. */
const FLUSH_DEBOUNCE_MS = 1500;
const MAX_SERVER_ERROR_TRIES = 8;

export class Outbox {
  private state: OutboxState = { items: [], sessionIds: {}, open: {} };
  private flushing: Promise<void> | null = null;
  private timer: unknown = null;
  private failures = 0;
  private lastError: string | null = null;
  private blocked = new Set<string>();
  /** The item on the wire. Never merged into: its body is already serialised. */
  private sending: Item | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => Date;

  constructor(private deps: OutboxDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = deps.now ?? (() => new Date());
  }

  /** Load the queue from disk and close sessions the last run left open. */
  async init(): Promise<void> {
    const loaded = await this.deps.load();
    if (loaded) {
      this.state = {
        items: Array.isArray(loaded.items) ? loaded.items : [],
        sessionIds: loaded.sessionIds ?? {},
        open: loaded.open ?? {},
      };
    }
    if (Object.keys(this.state.open).length > 0) {
      this.abortOpenSessions('app closed');
      await this.persist();
    }
    this.schedule(0);
  }

  /**
   * End every open session as ABORTED with its last checkpoint. For sessions a
   * previous run left open, and for the game window crashing mid-flight.
   */
  abortOpenSessions(reason: string): void {
    const at = this.now().toISOString();
    for (const [key, { userId, end }] of Object.entries(this.state.open)) {
      this.push({
        id: randomUUID(),
        userId,
        kind: 'events',
        key,
        payload: [{ eventType: 'SESSION_RECOVERED', eventData: { reason }, timestamp: at }],
        tries: 0,
      });
      this.push({ id: randomUUID(), userId, kind: 'end', key, payload: { ...end, result: 'ABORTED' }, tries: 0 });
    }
    this.state.open = {};
    void this.persist();
    this.kick();
  }

  recordCrash(userId: string | null, report: CrashReport): void {
    const queued = this.state.items.filter((i) => i.kind === 'crashes').reduce((n, i) => n + i.payload.length, 0);
    if (queued >= MAX_QUEUED_CRASHES) return;
    const last = this.state.items[this.state.items.length - 1];
    if (
      last &&
      last.kind === 'crashes' &&
      last !== this.sending &&
      last.userId === userId &&
      last.tries === 0 &&
      last.payload.length < CRASH_BATCH
    ) {
      last.payload.push(report);
    } else {
      this.push({ id: randomUUID(), userId, kind: 'crashes', key: null, payload: [report], tries: 0 });
    }
    // Written straight away: the process that reported it may be about to go.
    void this.persist();
    this.kick();
  }

  status(): OutboxStatus {
    return { pending: this.state.items.length, lastError: this.lastError, authBlocked: [...this.blocked] };
  }

  hasPendingFor(userId: string): boolean {
    return (
      this.state.items.some((i) => i.userId === userId) ||
      Object.values(this.state.open).some((o) => o.userId === userId)
    );
  }

  startSession(userId: string, payload: StartSessionRequest): void {
    const key = payload.clientSessionKey;
    this.push({ id: randomUUID(), userId, kind: 'start', key, payload, tries: 0 });
    this.state.open[key] = {
      userId,
      end: {
        endTime: payload.startTime,
        duration: 0,
        flightTime: 0,
        result: 'ABORTED',
        score: 0,
        crashCount: 0,
        attempts: 0,
      },
    };
    void this.persist();
    this.kick();
  }

  /** The latest numbers for an open session, used if the app dies before it ends. */
  checkpoint(key: string, end: EndSnapshot): void {
    const open = this.state.open[key];
    if (!open) return;
    open.end = end;
    void this.persist();
  }

  endSession(key: string, end: EndSnapshot): void {
    const open = this.state.open[key];
    if (!open) return;
    delete this.state.open[key];
    this.push({ id: randomUUID(), userId: open.userId, kind: 'end', key, payload: end, tries: 0 });
    void this.persist();
    this.kick();
  }

  recordEvents(userId: string, key: string | null, events: GameplayEventInput[]): void {
    if (events.length === 0) return;
    const last = this.state.items[this.state.items.length - 1];
    if (
      last &&
      last.kind === 'events' &&
      last !== this.sending &&
      last.userId === userId &&
      last.key === key &&
      last.tries === 0 &&
      last.payload.length + events.length <= EVENT_BATCH
    ) {
      last.payload.push(...events);
    } else {
      for (let i = 0; i < events.length; i += EVENT_BATCH) {
        this.push({ id: randomUUID(), userId, kind: 'events', key, payload: events.slice(i, i + EVENT_BATCH), tries: 0 });
      }
    }
    void this.persist();
    this.kick();
  }

  /** A user signed in again: their held items can go. */
  unblock(userId: string): void {
    if (this.blocked.delete(userId)) this.schedule(0);
  }

  /** Send everything that can be sent now. Resolves when the pass is over. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  // -------------------------------------------------------------------------

  private push(item: Item): void {
    this.state.items.push(item);
  }

  /** Flush soon, unless a retry backoff is already pending: going offline must
   *  not turn every recorded event into another failed request. */
  private kick(): void {
    if (this.failures > 0 && this.timer !== null) return;
    this.schedule(FLUSH_DEBOUNCE_MS);
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private persist(): Promise<void> {
    // Serialised so an older snapshot can never land on disk after a newer one.
    const snapshot = JSON.parse(JSON.stringify(this.state)) as OutboxState;
    this.saveChain = this.saveChain.then(() => this.deps.save(snapshot)).catch(() => undefined);
    return this.saveChain;
  }

  private async run(): Promise<void> {
    let index = 0;
    while (index < this.state.items.length) {
      const item = this.state.items[index];
      const token =
        item.userId === null || this.blocked.has(item.userId) ? undefined : this.deps.tokenFor(item.userId);
      // A crash report is sent whether or not its pilot can still sign in.
      if (!token && item.kind !== 'crashes') {
        // Held until this user signs in again. Their later items stay behind it,
        // so one session's start, events and end never go out of order.
        index += 1;
        continue;
      }

      let sessionId: string | undefined;
      if (item.kind !== 'start' && item.key !== null) {
        sessionId = this.state.sessionIds[item.key];
        if (!sessionId) {
          const startQueued = this.state.items.some((i) => i.kind === 'start' && i.key === item.key);
          if (startQueued) {
            index += 1;
            continue;
          }
          // The start was rejected outright, so there is no session to attach to.
          this.remove(item);
          continue;
        }
      }

      this.sending = item;
      const res = await this.sendItem(item, token, sessionId).finally(() => {
        this.sending = null;
      });

      if (res.success) {
        if (item.kind === 'start') {
          this.state.sessionIds[item.key] = (res.data as { sessionId: string }).sessionId;
        }
        if (item.kind === 'end') {
          this.deps.onSessionEnded?.(item.userId, res.data as EndSessionResult);
        }
        this.failures = 0;
        this.lastError = null;
        this.remove(item);
        continue;
      }

      // A server error that keeps coming back for one item is a bug in that item,
      // not an outage; it must not hold up everything queued behind it forever.
      if (res.code === 'SERVER_ERROR' && item.tries + 1 >= MAX_SERVER_ERROR_TRIES) {
        console.warn(`[telemetry] dropped ${item.kind} after repeated server errors: ${res.message}`);
        this.lastError = res.message;
        this.remove(item);
        continue;
      }

      if (isRetryable(res.code)) {
        item.tries += 1;
        this.failures += 1;
        this.lastError = res.message;
        await this.persist();
        const delay = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(this.failures - 1, 10));
        this.schedule(delay);
        return;
      }

      if (res.code === 'NOT_CONFIGURED') {
        this.lastError = res.message;
        return;
      }

      if ((res.code === 'AUTH_INVALID' || res.code === 'USER_INACTIVE') && item.userId !== null) {
        this.blocked.add(item.userId);
        this.lastError = res.message;
        this.deps.onAuthInvalid?.(item.userId);
        index += 1;
        continue;
      }

      // A definitive refusal (validation, not found, forbidden). Retrying would
      // get the same answer forever and block everything queued behind it.
      console.warn(`[telemetry] dropped ${item.kind} for ${item.userId}: ${res.code} ${res.message}`);
      this.lastError = res.message;
      this.remove(item);
    }
    this.pruneSessionIds();
    await this.persist();
  }

  private sendItem(item: Item, token: string | undefined, sessionId: string | undefined): Promise<ApiResponse<unknown>> {
    switch (item.kind) {
      case 'start':
        return this.deps.send('startSession', item.payload, token);
      case 'end':
        return this.deps.send('endSession', { ...item.payload, sessionId: sessionId! }, token);
      case 'events':
        return this.deps.send('recordEvents', { sessionId, events: item.payload }, token);
      case 'crashes':
        return this.deps.send('reportCrashes', { reports: item.payload }, token);
    }
  }

  private remove(item: Item): void {
    const i = this.state.items.indexOf(item);
    if (i >= 0) this.state.items.splice(i, 1);
    void this.persist();
  }

  private pruneSessionIds(): void {
    const live = new Set<string>();
    for (const i of this.state.items) if (i.key) live.add(i.key);
    for (const key of Object.keys(this.state.open)) live.add(key);
    for (const key of Object.keys(this.state.sessionIds)) {
      if (!live.has(key)) delete this.state.sessionIds[key];
    }
  }
}
