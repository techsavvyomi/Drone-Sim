import { DatabaseSync } from 'node:sqlite';
import type {
  EndSessionRequest,
  SignedLicense,
  UsageStretch,
  FlightType,
  MissionBreakdown,
  SessionResult,
  SessionSummary,
  StartSessionRequest,
  TrainingBreakdown,
  UserDashboard,
  UserProfile,
} from '@shared/backend/contract';
import { CATALOG, levelFor, maxScoreOf, nameOf, pointsFor } from '@shared/backend/scoring';
import type { AccountFile } from './service';

// This computer's own copy of the profile: who may sign in here, and every
// flight flown here.
//
// One SQLite file in the user-data folder, opened by the main process only.
// It is what lets a pilot who signed in online once sign in again, fly, and see
// their whole profile with no internet. The Google Sheet stays the authority:
// every flight still goes to it through the outbox, and its numbers replace the
// ones worked out here as soon as it answers.
//
// Tables:
//   meta     key/value: schema version, the signed-in user
//   accounts the old account.json, row for row: a user with a backend token
//   pilots   who has signed in online here: email, the activation key's scrypt
//            hash (offline check) and its OS-encrypted copy (silent reconnect),
//            and the last profile and dashboard the backend sent
//   flights  every flight: flown here, or copied from the backend's history
//   revokes  tokens of signed-out users the backend has not been told about yet
//   licenses each pilot's license as the backend signed it, and the expiry
//            warning already shown for it. The clock check's last-seen time
//            and its sealing secret are in meta (see license.ts), and so is
//            each pilot's sealed offline-budget count (license_used:<userId>),
//            running total (usage_total:<userId>) and whether a restored backup
//            is still to be reported (restore_pending:<userId>)
//   usage    stretches of the window being open, until the backend has them

const SCHEMA_VERSION = 1;

/** Where a flight stands against the backend. */
export type FlightState =
  /** Started, not ended. */
  | 'open'
  /** Ended here; the backend has not applied it yet, so its points are worked out here. */
  | 'pending'
  /** The backend applied it: its numbers are in the backend's profile. */
  | 'synced'
  /** The backend refused it for good. Kept in the history, never in the totals. */
  | 'dropped'
  /** Copied from the backend's history; flown on this or another computer. */
  | 'server';

export interface Pilot {
  userId: string;
  email: string;
  name: string;
  keySalt: string | null;
  keyHash: string | null;
  /** The activation key, OS-encrypted (base64). Null when the OS could not encrypt it. */
  keyCipher: string | null;
  /** Last profile from the backend. */
  profile: UserProfile | null;
}

export interface PilotCredentials {
  userId: string;
  email: string;
  name: string;
  keySalt: string;
  keyHash: string;
  keyCipher: string | null;
}

export interface StoredLicense {
  license: SignedLicense;
  /** The expiry the shown warning was for; a renewed license starts the warnings again. */
  notifiedFor: string | null;
  notifiedDay: number | null;
}

export interface StoredRevoke {
  userId: string;
  token: string;
  encrypted: boolean;
}

interface FlightRow {
  id: string;
  user_id: string;
  session_id: string | null;
  state: FlightState;
  flight_type: FlightType;
  mission_id: string | null;
  training_id: string | null;
  drone_id: string | null;
  input_mode: string | null;
  start_time: string;
  end_time: string | null;
  duration: number;
  flight_time: number;
  result: SessionResult | 'IN_PROGRESS';
  score: number;
  stars: number;
  crash_count: number;
  attempts: number;
  points: number;
  score_percent: number | null;
  acked_at: string | null;
}

type ServerBreakdown = Pick<UserDashboard, 'missions' | 'training'> & { at: string };

const json = <T>(text: unknown): T | null => {
  if (typeof text !== 'string' || !text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** YYYY-MM-DD on this computer's clock. */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The backend's best time, beaten by any of these flights. 0 = none. */
function fastest(flights: readonly FlightRow[], best = 0): number {
  return flights.reduce(
    (t, f) => (f.flight_time > 0 && (t === 0 || f.flight_time < t) ? f.flight_time : t),
    best,
  );
}

export class LocalStore {
  private constructor(private db: DatabaseSync) {}

  /** Open (or create) the database at `file`; `:memory:` for tests. */
  static open(file: string): LocalStore {
    const db = new DatabaseSync(file);
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    const store = new LocalStore(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        encrypted INTEGER NOT NULL,
        profile TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pilots (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        key_salt TEXT,
        key_hash TEXT,
        key_cipher TEXT,
        profile TEXT,
        breakdown TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flights (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        state TEXT NOT NULL,
        flight_type TEXT NOT NULL,
        mission_id TEXT,
        training_id TEXT,
        drone_id TEXT,
        input_mode TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration REAL NOT NULL DEFAULT 0,
        flight_time REAL NOT NULL DEFAULT 0,
        result TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        stars INTEGER NOT NULL DEFAULT 0,
        crash_count INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        score_percent REAL,
        acked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS flights_user ON flights (user_id, start_time);
      CREATE INDEX IF NOT EXISTS flights_session ON flights (session_id);
      CREATE TABLE IF NOT EXISTS revokes (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        encrypted INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS licenses (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        signature TEXT NOT NULL,
        notified_for TEXT,
        notified_day INTEGER
      );
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        minutes REAL NOT NULL,
        offline INTEGER NOT NULL,
        sent_minutes REAL
      );
      CREATE INDEX IF NOT EXISTS usage_user ON usage (user_id);
    `);
    this.setMeta('schema_version', String(SCHEMA_VERSION));
  }

  private meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    else this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- Accounts: who is signed in, and the backend tokens ------------------

  /** Null until the first save (or import), so the old account.json can be read once. */
  loadAccountFile(): AccountFile | null {
    if (this.meta('accounts_saved') === null) return null;
    const file: AccountFile = { current: this.meta('current_user'), accounts: {} };
    const rows = this.db
      .prepare('SELECT user_id, token, encrypted, profile FROM accounts')
      .all() as {
      user_id: string;
      token: string;
      encrypted: number;
      profile: string;
    }[];
    for (const r of rows) {
      const profile = json<UserProfile>(r.profile);
      if (profile) file.accounts[r.user_id] = { token: r.token, encrypted: !!r.encrypted, profile };
    }
    return file;
  }

  saveAccountFile(file: AccountFile): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM accounts').run();
      const insert = this.db.prepare(
        'INSERT INTO accounts (user_id, token, encrypted, profile) VALUES (?, ?, ?, ?)',
      );
      for (const [userId, a] of Object.entries(file.accounts)) {
        insert.run(userId, a.token, a.encrypted ? 1 : 0, JSON.stringify(a.profile));
        // The profile a later offline sign-in starts from.
        this.db
          .prepare('UPDATE pilots SET profile = ?, name = ?, updated_at = ? WHERE user_id = ?')
          .run(JSON.stringify(a.profile), a.profile.name ?? '', new Date().toISOString(), userId);
      }
      this.setMeta('current_user', file.current);
      this.setMeta('accounts_saved', '1');
    });
  }

  // ---- Licenses ------------------------------------------------------------

  /** The pilot's signed license, and which expiry warning (for which expiry) was shown. */
  license(userId: string): StoredLicense | null {
    const row = this.db
      .prepare('SELECT payload, signature, notified_for, notified_day FROM licenses WHERE user_id = ?')
      .get(userId) as
      | { payload: string; signature: string; notified_for: string | null; notified_day: number | null }
      | undefined;
    if (!row) return null;
    return {
      license: { payload: row.payload, signature: row.signature },
      notifiedFor: row.notified_for,
      notifiedDay: row.notified_day,
    };
  }

  /** Keep the latest license; the warning already shown stays with it. */
  saveLicense(userId: string, license: SignedLicense): void {
    this.db
      .prepare(
        `INSERT INTO licenses (user_id, payload, signature) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload, signature = excluded.signature`,
      )
      .run(userId, license.payload, license.signature);
  }

  setLicenseNotified(userId: string, expiresAt: string, day: number): void {
    this.db
      .prepare('UPDATE licenses SET notified_for = ?, notified_day = ? WHERE user_id = ?')
      .run(expiresAt, day, userId);
  }

  /** The sealed last-seen time (license.ts sealTime), for every pilot on this computer. */
  clockRecord(): string | null {
    return this.meta('clock_last_seen');
  }

  saveClockRecord(record: string): void {
    this.setMeta('clock_last_seen', record);
  }

  /** The pilot's sealed offline-budget count (license.ts sealUsage). */
  usageRecord(userId: string): string | null {
    return this.meta(`license_used:${userId}`);
  }

  saveUsageRecord(userId: string, record: string): void {
    this.setMeta(`license_used:${userId}`, record);
  }

  /** The pilot's sealed running total of window time, all licenses. */
  totalRecord(userId: string): string | null {
    return this.meta(`usage_total:${userId}`);
  }

  saveTotalRecord(userId: string, record: string): void {
    this.setMeta(`usage_total:${userId}`, record);
  }

  /** A restored backup was found and the backend has not been told yet. */
  restorePending(userId: string): boolean {
    return this.meta(`restore_pending:${userId}`) === '1';
  }

  setRestorePending(userId: string, pending: boolean): void {
    this.setMeta(`restore_pending:${userId}`, pending ? '1' : null);
  }

  /** Whether the shadow copy (shadow.ts) has ever been written: then it must be there. */
  shadowWritten(): boolean {
    return this.meta('shadow_written') === '1';
  }

  markShadowWritten(): void {
    this.setMeta('shadow_written', '1');
  }

  // ---- Usage: window time for the backend's Usage sheet --------------------

  saveUsage(userId: string, u: UsageStretch): void {
    this.db
      .prepare(
        `INSERT INTO usage (id, user_id, started_at, ended_at, minutes, offline) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET ended_at = excluded.ended_at, minutes = excluded.minutes`,
      )
      .run(u.id, userId, u.startedAt, u.endedAt, u.minutes, u.offline ? 1 : 0);
  }

  /** Stretches the backend has not seen, or has seen shorter, oldest first. */
  unsentUsage(userId: string, limit = 200): UsageStretch[] {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, ended_at, minutes, offline FROM usage
         WHERE user_id = ? AND (sent_minutes IS NULL OR minutes > sent_minutes)
         ORDER BY started_at LIMIT ?`,
      )
      .all(userId, limit) as {
      id: string;
      started_at: string;
      ended_at: string;
      minutes: number;
      offline: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      minutes: r.minutes,
      offline: !!r.offline,
    }));
  }

  markUsageSent(sent: UsageStretch[]): void {
    this.tx(() => {
      const mark = this.db.prepare('UPDATE usage SET sent_minutes = ? WHERE id = ?');
      for (const u of sent) mark.run(u.minutes, u.id);
    });
  }

  /** The seal's secret, OS-encrypted when the OS can. */
  clockSecret(): string | null {
    return this.meta('clock_secret');
  }

  saveClockSecret(secret: string): void {
    this.setMeta('clock_secret', secret);
  }

  // ---- Pilots: offline sign-in ----------------------------------------------

  pilotByEmail(email: string): Pilot | null {
    const row = this.db
      .prepare('SELECT * FROM pilots WHERE email = ?')
      .get(email.trim().toLowerCase());
    return row ? this.toPilot(row as Record<string, unknown>) : null;
  }

  pilot(userId: string): Pilot | null {
    const row = this.db.prepare('SELECT * FROM pilots WHERE user_id = ?').get(userId);
    return row ? this.toPilot(row as Record<string, unknown>) : null;
  }

  private toPilot(r: Record<string, unknown>): Pilot {
    return {
      userId: String(r.user_id),
      email: String(r.email),
      name: String(r.name),
      keySalt: (r.key_salt as string | null) ?? null,
      keyHash: (r.key_hash as string | null) ?? null,
      keyCipher: (r.key_cipher as string | null) ?? null,
      profile: json<UserProfile>(r.profile),
    };
  }

  /** After an online sign-in: remember who may sign in here offline. */
  savePilot(c: PilotCredentials, profile: UserProfile): void {
    const email = c.email.trim().toLowerCase();
    this.tx(() => {
      // An email moved to another user id (an admin re-issued it) takes its row with it.
      this.db.prepare('DELETE FROM pilots WHERE email = ? AND user_id <> ?').run(email, c.userId);
      this.db
        .prepare(
          `INSERT INTO pilots (user_id, email, name, key_salt, key_hash, key_cipher, profile, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET
             email = excluded.email, name = excluded.name, key_salt = excluded.key_salt,
             key_hash = excluded.key_hash, key_cipher = excluded.key_cipher,
             profile = excluded.profile, updated_at = excluded.updated_at`,
        )
        .run(
          c.userId,
          email,
          c.name,
          c.keySalt,
          c.keyHash,
          c.keyCipher,
          JSON.stringify(profile),
          new Date().toISOString(),
        );
    });
  }

  /** A pilot known from the old account.json: signed in, but no key to check offline yet. */
  ensurePilot(profile: UserProfile): void {
    if (!profile.email || this.pilot(profile.userId) || this.pilotByEmail(profile.email)) return;
    this.db
      .prepare(
        'INSERT INTO pilots (user_id, email, name, profile, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        profile.userId,
        profile.email.trim().toLowerCase(),
        profile.name ?? '',
        JSON.stringify(profile),
        new Date().toISOString(),
      );
  }

  /** "Forget me on this computer": the pilot and every flight of theirs. */
  forgetPilot(userId: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM flights WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM pilots WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM licenses WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM usage WHERE user_id = ?').run(userId);
      this.setMeta(`license_used:${userId}`, null);
      this.setMeta(`usage_total:${userId}`, null);
      this.setMeta(`restore_pending:${userId}`, null);
    });
  }

  // ---- Revokes: sign-outs the backend has not heard about -------------------

  addRevoke(r: StoredRevoke): void {
    this.db
      .prepare('INSERT OR REPLACE INTO revokes (token, user_id, encrypted) VALUES (?, ?, ?)')
      .run(r.token, r.userId, r.encrypted ? 1 : 0);
  }

  revokes(): StoredRevoke[] {
    const rows = this.db.prepare('SELECT token, user_id, encrypted FROM revokes').all() as {
      token: string;
      user_id: string;
      encrypted: number;
    }[];
    return rows.map((r) => ({ token: r.token, userId: r.user_id, encrypted: !!r.encrypted }));
  }

  removeRevoke(token: string): void {
    this.db.prepare('DELETE FROM revokes WHERE token = ?').run(token);
  }

  /** The user signed in again before the backend heard: their token is still good. */
  takeRevoke(userId: string): StoredRevoke | null {
    const r = this.revokes().find((x) => x.userId === userId) ?? null;
    if (r) this.removeRevoke(r.token);
    return r;
  }

  // ---- Flights ----------------------------------------------------------------

  startFlight(userId: string, req: StartSessionRequest): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO flights
           (id, user_id, state, flight_type, mission_id, training_id, drone_id, input_mode, start_time, result)
         VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
      )
      .run(
        req.clientSessionKey,
        userId,
        req.flightType,
        req.missionId ?? null,
        req.trainingId ?? null,
        req.droneId ?? null,
        req.inputMode ?? null,
        req.startTime,
      );
  }

  /** The latest numbers of an open flight, kept for an ABORTED end if the app dies. */
  checkpointFlight(key: string, end: Omit<EndSessionRequest, 'sessionId'>): void {
    this.db
      .prepare(
        `UPDATE flights SET end_time = ?, duration = ?, flight_time = ?, score = ?, stars = ?,
           crash_count = ?, attempts = ?
         WHERE id = ? AND state = 'open'`,
      )
      .run(
        end.endTime,
        end.duration,
        end.flightTime,
        end.score,
        end.stars ?? 0,
        end.crashCount,
        end.attempts,
        key,
      );
  }

  /** The flight ended: its result, and the points the backend will give it. */
  endFlight(key: string, end: Omit<EndSessionRequest, 'sessionId'>): void {
    const row = this.db
      .prepare("SELECT * FROM flights WHERE id = ? AND state = 'open'")
      .get(key) as FlightRow | undefined;
    if (!row) return;
    this.finish(row, end);
  }

  /** Close every open flight as ABORTED with its last checkpoint (the app or window died). */
  abortOpen(): void {
    const rows = this.db
      .prepare("SELECT * FROM flights WHERE state = 'open'")
      .all() as unknown as FlightRow[];
    for (const row of rows) {
      this.finish(row, {
        endTime: row.end_time ?? row.start_time,
        duration: row.duration,
        flightTime: row.flight_time,
        result: 'ABORTED',
        score: row.score,
        stars: row.stars,
        crashCount: row.crash_count,
        attempts: row.attempts,
      });
    }
  }

  /** `endSession_`'s arithmetic, so the numbers match what the backend will store. */
  private finish(row: FlightRow, end: Omit<EndSessionRequest, 'sessionId'>): void {
    let duration = Math.max(0, end.duration || 0);
    const start = time(row.start_time);
    const stop = time(end.endTime);
    if (start && stop >= start) duration = Math.min(duration, (stop - start) / 1000 + 60);
    duration = Math.round(duration);
    const flightTime = Math.round(Math.min(Math.max(0, end.flightTime || 0), duration));
    const maxScore = maxScoreOf(row.flight_type, row.mission_id ?? undefined);
    const score = maxScore > 0 ? Math.min(Math.max(0, end.score || 0), maxScore) : 0;
    const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : null;
    const stars = Math.max(0, Math.min(3, Math.round(end.stars ?? 0)));
    const isRepeat =
      end.result === 'SUCCESS' && row.flight_type !== 'FREE_FLIGHT' && this.completedBefore(row);
    const points = pointsFor({
      flightType: row.flight_type,
      result: end.result,
      score,
      stars,
      flightTime,
      isRepeat,
    });
    this.db
      .prepare(
        `UPDATE flights SET state = 'pending', end_time = ?, duration = ?, flight_time = ?, result = ?,
           score = ?, stars = ?, crash_count = ?, attempts = ?, points = ?, score_percent = ?
         WHERE id = ?`,
      )
      .run(
        end.endTime,
        duration,
        flightTime,
        end.result,
        Math.round(score * 100) / 100,
        row.flight_type === 'FREE_FLIGHT' ? 0 : stars,
        Math.max(0, end.crashCount || 0),
        Math.max(0, end.attempts || 0),
        points,
        scorePercent,
        row.id,
      );
  }

  /** Whether this mission or lesson was completed before: a repeat pays a quarter. */
  private completedBefore(row: FlightRow): boolean {
    const column = row.flight_type === 'MISSION' ? 'mission_id' : 'training_id';
    const id = row.flight_type === 'MISSION' ? row.mission_id : row.training_id;
    if (!id) return false;
    const done = this.db
      .prepare(
        `SELECT 1 FROM flights WHERE user_id = ? AND id <> ? AND flight_type = ? AND ${column} = ?
           AND result = 'SUCCESS' LIMIT 1`,
      )
      .get(row.user_id, row.id, row.flight_type, id);
    if (done) return true;
    const breakdown = this.breakdown(row.user_id);
    if (row.flight_type === 'MISSION')
      return !!breakdown?.missions.some((m) => m.missionId === id && m.completed > 0);
    return !!breakdown?.training.modules.some((m) => m.trainingId === id && m.completed);
  }

  /** The backend accepted the start: its session id, so its history is not copied in twice. */
  setSessionId(key: string, sessionId: string): void {
    this.db.prepare('UPDATE flights SET session_id = ? WHERE id = ?').run(sessionId, key);
    // The same session may already have been copied in from the backend's history.
    this.db.prepare("DELETE FROM flights WHERE session_id = ? AND state = 'server'").run(sessionId);
  }

  /** The backend applied the end: from now on its profile carries this flight. */
  markSynced(sessionId: string, pointsEarned: number): void {
    this.db
      .prepare(
        `UPDATE flights SET state = 'synced', points = ?, acked_at = ?
         WHERE session_id = ? AND state IN ('pending', 'open')`,
      )
      .run(Math.round(pointsEarned || 0), new Date().toISOString(), sessionId);
  }

  /** The backend refused the flight for good. */
  markDropped(key: string): void {
    this.db
      .prepare("UPDATE flights SET state = 'dropped' WHERE id = ? AND state <> 'synced'")
      .run(key);
  }

  /** Flights the backend does not have yet: still open, or ended and waiting to upload. */
  unsyncedCount(userId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM flights WHERE user_id = ? AND state IN ('open', 'pending')",
      )
      .get(userId) as { n: number };
    return Number(row.n);
  }

  /**
   * Copy the backend's latest history in, with its per-mission and per-lesson
   * totals (which count flights older than the history it sends).
   */
  importServer(userId: string, dash: UserDashboard): void {
    this.tx(() => {
      const known = this.db.prepare(
        'SELECT 1 FROM flights WHERE session_id = ? AND state <> ? LIMIT 1',
      );
      const upsert = this.db.prepare(
        `INSERT OR REPLACE INTO flights
           (id, user_id, session_id, state, flight_type, mission_id, training_id, drone_id, start_time,
            duration, flight_time, result, score, stars, crash_count, points)
         VALUES (?, ?, ?, 'server', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of dash.recentSessions) {
        if (!s.sessionId || known.get(s.sessionId, 'server')) continue;
        upsert.run(
          `srv:${s.sessionId}`,
          userId,
          s.sessionId,
          s.flightType,
          s.missionId || null,
          s.trainingId || null,
          s.droneId || null,
          s.startTime,
          s.duration || 0,
          s.flightTime || 0,
          s.result,
          s.score || 0,
          s.stars || 0,
          s.crashCount || 0,
          s.pointsEarned || 0,
        );
      }
      const breakdown: ServerBreakdown = {
        missions: dash.missions,
        training: dash.training,
        at: new Date().toISOString(),
      };
      this.db
        .prepare('UPDATE pilots SET breakdown = ? WHERE user_id = ?')
        .run(JSON.stringify(breakdown), userId);
    });
  }

  private breakdown(userId: string): ServerBreakdown | null {
    const row = this.db.prepare('SELECT breakdown FROM pilots WHERE user_id = ?').get(userId) as
      { breakdown: string | null } | undefined;
    return json<ServerBreakdown>(row?.breakdown);
  }

  private flights(userId: string): FlightRow[] {
    return this.db
      .prepare('SELECT * FROM flights WHERE user_id = ? ORDER BY start_time DESC')
      .all(userId) as unknown as FlightRow[];
  }

  // ---- What the Profile page shows ---------------------------------------------

  /**
   * The backend's last profile plus every flight it has not applied yet, added
   * the way `endSession_` adds them. The backend's own number replaces this the
   * next time it answers.
   */
  profile(userId: string, base: UserProfile): UserProfile {
    const pending = this.flights(userId)
      .filter((f) => f.state === 'pending')
      .reverse();
    if (pending.length === 0) return base;
    const stats = { ...base.stats };
    for (const f of pending) {
      stats.totalPoints += f.points;
      stats.totalFlights += 1;
      stats.totalFlightTimeSec += f.flight_time;
      stats.crashCount += f.crash_count;
      if (f.flight_type === 'TRAINING') {
        stats.trainingFlights += 1;
        if (f.result === 'SUCCESS') stats.trainingCompleted += 1;
      } else if (f.flight_type === 'MISSION') {
        stats.missionFlights += 1;
        if (f.result === 'SUCCESS') stats.missionsCompleted += 1;
      } else {
        stats.freeFlights += 1;
        stats.freeFlightTimeSec += f.flight_time;
      }
    }
    const lvl = levelFor(stats.totalPoints);
    return {
      ...base,
      level: lvl.level,
      levelPoints: { current: lvl.current, next: lvl.next },
      lastActiveAt: pending[pending.length - 1].end_time ?? base.lastActiveAt,
      stats,
    };
  }

  /** `getUserDashboard_`'s answer, from this computer's flights and the backend's last totals. */
  dashboard(userId: string, profile: UserProfile, recentLimit = 10, days = 30): UserDashboard {
    const all = this.flights(userId);
    const finished = all.filter((f) => f.result !== 'IN_PROGRESS');
    const base = this.breakdown(userId);
    // On top of the backend's totals: what it has not counted yet.
    const extra = base
      ? finished.filter(
          (f) => f.state === 'pending' || (f.state === 'synced' && (f.acked_at ?? '') > base.at),
        )
      : finished.filter((f) => f.state !== 'dropped');

    // The backend's lists, plus anything in the game its catalog sheet does not
    // have yet (the live sheet has lagged behind before).
    const baseMissions = base?.missions ?? [];
    const missions: MissionBreakdown[] = [
      ...baseMissions,
      ...CATALOG.missions
        .filter((m) => !baseMissions.some((b) => b.missionId === m.id))
        .map(
          (m): MissionBreakdown => ({
            missionId: m.id as string,
            missionName: m.name as string,
            attempts: 0,
            sessions: 0,
            completed: 0,
            bestScore: 0,
          }),
        ),
    ].map((m) => {
      const mine = extra.filter((f) => f.flight_type === 'MISSION' && f.mission_id === m.missionId);
      const done = mine.filter((f) => f.result === 'SUCCESS');
      return {
        ...m,
        sessions: m.sessions + mine.length,
        attempts: m.attempts + mine.reduce((s, f) => s + f.attempts, 0),
        completed: m.completed + done.length,
        bestScore: mine.reduce((s, f) => Math.max(s, f.score), m.bestScore),
        bestStars: done.reduce((s, f) => Math.max(s, f.stars), m.bestStars ?? 0),
        bestTimeSec: fastest(done, m.bestTimeSec),
      };
    });

    const baseModules = base?.training.modules ?? [];
    const modules: TrainingBreakdown[] = [
      ...baseModules,
      ...CATALOG.training
        .filter((t) => !baseModules.some((b) => b.trainingId === t.id))
        .map(
          (t): TrainingBreakdown => ({
            trainingId: t.id as string,
            trainingName: t.name as string,
            order: t.order as number,
            sessions: 0,
            completed: false,
            bestStars: 0,
          }),
        ),
    ]
      .sort((a, b) => a.order - b.order)
      .map((t) => {
        const mine = extra.filter(
          (f) => f.flight_type === 'TRAINING' && f.training_id === t.trainingId,
        );
        const done = mine.filter((f) => f.result === 'SUCCESS');
        return {
          ...t,
          sessions: t.sessions + mine.length,
          completed: t.completed || done.length > 0,
          bestStars: done.reduce((s, f) => Math.max(s, f.stars), t.bestStars),
          bestTimeSec: fastest(done, t.bestTimeSec),
        };
      });

    const daily: UserDashboard['daily'] = [];
    const byDay: Record<string, UserDashboard['daily'][number]> = {};
    const today = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(new Date(today - i * 86_400_000));
      byDay[key] = { date: key, sessions: 0, points: 0, flightTimeSec: 0 };
      daily.push(byDay[key]);
    }
    const drones: Record<string, UserDashboard['drones'][number]> = {};
    for (const f of finished) {
      const entry = byDay[dayKey(new Date(time(f.start_time)))];
      if (entry) {
        entry.sessions += 1;
        entry.points += f.points;
        entry.flightTimeSec += f.flight_time;
      }
      const id = f.drone_id ?? '';
      drones[id] ??= {
        droneId: id,
        droneName: nameOf('drones', id),
        sessions: 0,
        flightTimeSec: 0,
        crashes: 0,
      };
      drones[id].sessions += 1;
      drones[id].flightTimeSec += f.flight_time;
      drones[id].crashes += f.crash_count;
    }

    const missionFlights = finished.filter((f) => f.flight_type === 'MISSION');
    const missionWins = missionFlights.filter((f) => f.result === 'SUCCESS').length;

    return {
      profile,
      recentSessions: all.slice(0, Math.max(1, Math.min(50, recentLimit))).map(summary),
      daily,
      missions,
      training: {
        completed: modules.filter((m) => m.completed).length,
        total: modules.length,
        modules,
      },
      drones: Object.values(drones).sort((a, b) => b.flightTimeSec - a.flightTimeSec),
      missionCompletionRate:
        missionFlights.length > 0
          ? Math.round((missionWins / missionFlights.length) * 1000) / 10
          : 0,
    };
  }
}

function summary(f: FlightRow): SessionSummary {
  return {
    sessionId: f.session_id ?? f.id,
    date: dayKey(new Date(time(f.start_time))),
    startTime: f.start_time,
    flightType: f.flight_type,
    missionId: f.mission_id ?? '',
    missionName: nameOf('missions', f.mission_id ?? undefined),
    trainingId: f.training_id ?? '',
    trainingName: nameOf('training', f.training_id ?? undefined),
    droneId: f.drone_id ?? '',
    droneName: nameOf('drones', f.drone_id ?? undefined),
    duration: f.duration,
    flightTime: f.flight_time,
    score: f.score,
    stars: f.stars,
    pointsEarned: f.points,
    result: f.result,
    crashCount: f.crash_count,
  };
}
