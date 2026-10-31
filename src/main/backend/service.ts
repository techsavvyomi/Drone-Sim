import {
  isRetryable,
  type ActivateUserRequest,
  type ApiAction,
  type ApiError,
  type ApiActions,
  type ApiResponse,
  type AuthResult,
  type CrashReport,
  type DeviceInfo,
  type GameplayEventInput,
  type GetUserDashboardRequest,
  type LoginUserRequest,
  type SignedLicense,
  type StartSessionRequest,
  type UsageStretch,
  type UserDashboard,
  type UserProfile,
} from '@shared/backend/contract';
import type { AccountInfo, AccountResult, TelemetryStatus } from '@shared/backend/ipc';
import { evaluateLicense, type LicenseStatus, type NoticeDay } from '@shared/backend/license';
import { randomBytes, randomUUID } from 'node:crypto';
import { Outbox, type EndSnapshot, type OutboxState } from './outbox';
import { hashKey, verifyKey } from './keyHash';
import {
  openSealedShadow,
  openSealedTime,
  openSealedUsage,
  sealShadow,
  sealTime,
  sealUsage,
  verifyLicense,
  type ShadowState,
} from './license';
import type { ShadowStore } from './shadow';
import type { LocalStore, StoredLicense } from './localStore';

// The main-process side of profiles and telemetry.
//
// It owns the one thing the renderer is never given: the auth token. The page
// asks to sign in, fly, and read its own dashboard; this attaches the token to
// each call. Tokens are kept per user (encrypted with the OS keychain when
// available) until that user's queued telemetry has been delivered, so signing
// out never strands a session that has not been uploaded yet; only then is the
// token revoked on the backend.
//
// With a `local` store (SQLite, see localStore.ts) it also works offline: a
// pilot who signed in online here once signs in again against the stored key
// hash, every flight is logged locally first, and the Profile page is answered
// from this computer. When the internet is back the app signs in to the backend
// with the stored (OS-encrypted) key and the queued flights upload.
//
// With `license` it also keeps each pilot's license (TRIAL / ANNUAL / LIFETIME)
// as the backend signed it, and works out offline whether it is running, about
// to run out, expired, or not to be trusted because the clock went back
// (src/shared/backend/license.ts). App closes itself on anything but running.
//
// While the window is shown it also counts the time on the app's own timer
// (never the computer's clock): against the license's offline budget, and as
// usage stretches kept in SQLite and reported to the backend when online.
// A sealed copy of that count and of the last time seen is also kept outside
// the database (`shadow`), so putting an old copy of the database back brings
// back no offline time; and a running total goes to the backend, which hands
// back the highest it has seen, so a put-back copy is found online too.

interface StoredAccount {
  token: string;
  /** Whether `token` is OS-encrypted (base64) or plain. */
  encrypted: boolean;
  profile: UserProfile;
}

export interface AccountFile {
  current: string | null;
  accounts: Record<string, StoredAccount>;
}

export interface TokenCodec {
  available: () => boolean;
  encrypt: (plain: string) => string;
  decrypt: (cipher: string) => string;
}

export interface BackendServiceDeps {
  configured: boolean;
  send: <A extends ApiAction>(
    action: A,
    payload: ApiActions[A]['request'],
    authToken?: string,
  ) => Promise<ApiResponse<ApiActions[A]['response']>>;
  loadAccounts: () => Promise<AccountFile | null>;
  saveAccounts: (file: AccountFile) => Promise<void>;
  loadOutbox: () => Promise<OutboxState | null>;
  saveOutbox: (state: OutboxState) => Promise<void>;
  codec: TokenCodec;
  /** This computer. Sent with every sign-in: a profile is signed in on one device at a time. */
  device: () => Promise<DeviceInfo>;
  /** Push a changed account to the renderer. */
  notify: (account: AccountInfo) => void;
  /** This computer's SQLite copy. Without it, everything needs the backend (as before). */
  local?: LocalStore;
  /** Whether the computer has a network at all. Unknown counts as online. */
  online?: () => boolean;
  /**
   * Licenses: the public key the backend's signatures are checked with, and
   * the clock (tests set it). Without it there is no license gate.
   */
  license?: { publicKey: string; now?: () => number };
  /** A timer that the computer's date cannot move (ms). Tests set it. */
  monotonic?: () => number;
  /** Where the copy kept outside the database lives (shadow.ts). */
  shadow?: ShadowStore;
}

/** The most one count may add: a computer asleep with the window open is not using it. */
const MAX_USAGE_STEP_MS = 2 * 60 * 1000;
/** Usage goes to the backend at most this often while online, and as a heartbeat at least this often. */
const USAGE_REPORT_MS = 5 * 60 * 1000;
const USAGE_HEARTBEAT_MS = 15 * 60 * 1000;
/** A running total this far below the backend's counts as a put-back database. */
const RESTORE_SLACK_MS = 5 * 60 * 1000;

/**
 * Whether a backend answer carries a whole profile for `userId`. One without
 * `levelPoints` once reached the pilot badge and took the whole window down
 * ("Something went wrong"), so an answer like that is logged and not stored.
 */
function isProfileOf(p: unknown, userId: string | undefined): p is UserProfile {
  const v = p as Partial<UserProfile> | null | undefined;
  return (
    !!v &&
    !!userId &&
    v.userId === userId &&
    typeof v.level === 'number' &&
    typeof v.levelPoints?.current === 'number' &&
    typeof v.levelPoints?.next === 'number' &&
    !!v.stats
  );
}

/** "Remember me on this computer" at sign-in. Unset counts as ticked. */
export interface RememberOpt {
  remember?: boolean;
}

const NOT_SIGNED_IN: ApiError = { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
const OFFLINE: ApiError = {
  success: false,
  code: 'NETWORK',
  message: 'Could not reach the backend',
};

function notAProfile(action: string, data: unknown): ApiError {
  const keys = data && typeof data === 'object' ? Object.keys(data).join(', ') : String(data);
  console.warn(`[backend] ${action} answered without a profile: {${keys}}`);
  return {
    success: false,
    code: 'SERVER_ERROR',
    message: 'The backend answered without a profile',
  };
}

export class BackendService {
  private file: AccountFile = { current: null, accounts: {} };
  private authInvalid = false;
  /** The backend's reason for refusing the token, shown on the sign-in screen. */
  private authReason: string | null = null;
  /** Backend ends applied so far: a profile asked for before the latest one is stale. */
  private endsApplied = 0;
  private historySynced = false;
  private reconnecting: Promise<ApiResponse<UserProfile>> | null = null;
  private revoking = false;
  /** This computer's id: a license signed for another computer is not trusted here. */
  private deviceId: string | null = null;
  /** Licenses as kept; the copy that counts when SQLite is unavailable. */
  private licenses: Record<string, StoredLicense> = {};
  private clockKey: string | null = null;
  private lastSeenMem: number | null = null;
  /** The last license status pushed to the renderer. */
  private licensePushed = '';
  /** Whether the game window is on screen: only then does time count. */
  private windowShown = false;
  private lastMono: number | null = null;
  /** The stretch of window time being counted now. */
  private stretch: (UsageStretch & { userId: string }) | null = null;
  private usageMem: Record<string, { issuedAt: string; usedMs: number }> = {};
  private lastUsageReport: number | null = null;
  private reportingUsage = false;
  /** The shadow copy as read once and kept since; null before the first read. */
  private shadowState: ShadowState | null = null;
  /** The database says a shadow copy was written, and none that checks out was found. */
  private shadowLost = false;
  private shadowDirty = false;
  readonly outbox: Outbox;

  constructor(private deps: BackendServiceDeps) {
    this.outbox = new Outbox({
      load: deps.loadOutbox,
      save: deps.saveOutbox,
      send: (action, payload, token) => deps.send(action, payload, token),
      tokenFor: (userId) => this.tokenFor(userId),
      onAuthInvalid: (userId, message) => {
        if (userId === this.file.current) {
          this.authInvalid = true;
          this.authReason = message;
          this.deps.notify(this.account());
        }
      },
      onSessionStarted: (key, sessionId) => this.withLocal((l) => l.setSessionId(key, sessionId)),
      onSessionDropped: (key) => this.withLocal((l) => l.markDropped(key)),
      onSessionEnded: (userId, result) => {
        this.endsApplied += 1;
        if (result?.sessionId)
          this.withLocal((l) => l.markSynced(result.sessionId, result.pointsEarned));
        const acct = this.file.accounts[userId];
        if (acct && isProfileOf(result?.profile, userId)) {
          acct.profile = result.profile;
          void this.persistAccounts();
        }
        if (userId === this.file.current) this.deps.notify(this.account());
        this.forgetIdleAccounts();
      },
    });
  }

  async init(): Promise<void> {
    const loaded = await this.deps.loadAccounts().catch(() => null);
    if (loaded && typeof loaded === 'object') {
      this.file = { current: loaded.current ?? null, accounts: loaded.accounts ?? {} };
    }
    await this.outbox.init();
    // Flights a previous run left open end as ABORTED here too, as the outbox ends them.
    this.withLocal((l) => l.abortOpen());
    this.requeueLostFlights();
    if (this.deps.license) {
      this.deviceId = (await this.deps.device().catch(() => null))?.deviceId ?? null;
      this.tickLicense();
    }
  }

  account(): AccountInfo {
    const current = this.file.current ? this.file.accounts[this.file.current] : undefined;
    const local = current && this.deps.local;
    const profile =
      current && local
        ? this.withLocal((l) => l.profile(this.file.current!, current.profile))
        : null;
    return {
      configured: this.deps.configured,
      profile: profile ?? current?.profile ?? null,
      needsSignIn: this.authInvalid,
      signInReason: this.authInvalid ? this.authReason : null,
      license: this.licenseStatus(),
    };
  }

  // `remember` stays here: it decides whether this computer keeps the key for
  // the email-only sign-in, and is never sent to the backend.
  async activate({
    remember = true,
    ...req
  }: Omit<ActivateUserRequest, keyof DeviceInfo> & RememberOpt): Promise<AccountResult> {
    if (this.offline()) return this.signInOffline(req.email, req.activationKey, OFFLINE);
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('activateUser', { ...req, ...device }), req, remember);
  }

  async login({
    remember = true,
    ...req
  }: Omit<LoginUserRequest, keyof DeviceInfo> & RememberOpt): Promise<AccountResult> {
    if (this.offline()) return this.signInOffline(req.email, req.activationKey, OFFLINE);
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('loginUser', { ...req, ...device }), req, remember);
  }

  /**
   * Whether `email` can sign in here with no key: it signed in on this computer
   * with "Remember me" ticked, and the OS can still decrypt what it kept.
   */
  hasSavedKey(email: string): boolean {
    return this.savedKey(email) !== null;
  }

  /**
   * Sign in with the key this computer kept for `email` (the user, 2026-10-16:
   * the key is typed once per computer, then the email is enough). Online it
   * is an ordinary login, so the one-computer-at-a-time check still runs; offline
   * the stored hash checks it as before.
   */
  async loginSaved(req: { email: string; signOutOtherDevices?: boolean }): Promise<AccountResult> {
    const key = this.savedKey(req.email);
    if (!key) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'No key is saved for this email on this computer. Type your key.',
      };
    }
    return this.login({ ...req, activationKey: key, remember: true });
  }

  private savedKey(email: string): string | null {
    if (!email || !this.deps.codec.available()) return null;
    const pilot = this.withLocal((l) => l.pilotByEmail(email));
    if (!pilot?.keyCipher) return null;
    try {
      return this.deps.codec.decrypt(pilot.keyCipher) || null;
    } catch {
      return null;
    }
  }

  /**
   * `forget`: "Forget me on this computer" also removes the pilot's offline
   * sign-in and flight log here, unless flights are still waiting to upload.
   */
  async signOut(opts: { forget?: boolean } = {}): Promise<void> {
    const userId = this.file.current;
    this.countUsage();
    this.stretch = null;
    if (opts.forget && userId) {
      this.withLocal((l) => {
        if (l.unsyncedCount(userId) === 0) l.forgetPilot(userId);
      });
    }
    this.file.current = null;
    this.authInvalid = false;
    this.authReason = null;
    this.forgetIdleAccounts();
    await this.persistAccounts();
    this.deps.notify(this.account());
  }

  /**
   * While the app is open, ask the backend every `everyMs` whether this computer
   * is still the one signed in. A profile taken over by another computer then
   * finds out within about `everyMs`, not at its next launch; App keeps a flight
   * in progress on screen and shows the sign-in form when it ends.
   */
  watchSignIn(everyMs: number): () => void {
    // A slow backend can take longer than `everyMs` to answer (up to the 30 s
    // timeout); one check at a time, so they do not pile up behind it.
    let checking = false;
    const timer = setInterval(() => {
      void this.flushRevokes();
      if (checking || !this.deps.configured || !this.file.current || this.authInvalid) return;
      checking = true;
      void this.refreshProfile().finally(() => {
        checking = false;
      });
    }, everyMs);
    return () => clearInterval(timer);
  }

  /** Re-read the signed-in user's profile from the backend. */
  async refreshProfile(): Promise<ApiResponse<UserProfile>> {
    const userId = this.file.current;
    if (!userId) return NOT_SIGNED_IN;
    // Signed in offline: there is no token to ask with yet.
    if (this.deps.local && !this.tokenFor(userId)) return this.reconnect();
    const applied = this.endsApplied;
    // The hop that carries Apps Script's answer back sometimes hangs, and has
    // answered with the health check instead; a read is safe to ask once more.
    let res = await this.deps.send('getUserProfile', { userId }, this.tokenFor(userId));
    const lost = (r: typeof res) =>
      r.success ? !isProfileOf(r.data, userId) : r.code === 'NETWORK' || r.code === 'SERVER_ERROR';
    if (lost(res)) res = await this.deps.send('getUserProfile', { userId }, this.tokenFor(userId));
    if (userId !== this.file.current)
      return { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
    this.handleAuthFailure(res);
    if (res.success && !isProfileOf(res.data, userId))
      return notAProfile('getUserProfile', res.data);
    if (res.success) {
      // The license rides along with the profile check; it is kept on its own.
      const { license, ...profile } = res.data;
      res = { success: true, data: profile };
      this.acceptLicense(userId, license);
      // An end applied while this was on its way already brought a newer profile.
      if (this.endsApplied === applied) this.file.accounts[userId].profile = profile;
      await this.persistAccounts();
      this.deps.notify(this.account());
      // The backend answered, so the network is back: queued flights go now.
      this.outbox.retryNow();
      if (!this.historySynced) void this.syncHistory();
      void this.reportUsage();
    }
    return res;
  }

  async dashboard(
    req: Omit<GetUserDashboardRequest, 'userId'>,
  ): Promise<ApiResponse<UserDashboard>> {
    const userId = this.file.current;
    if (!userId) return NOT_SIGNED_IN;
    // From this computer, at once and with or without internet. The backend's
    // history is copied in by `syncHistory`.
    if (this.deps.local) {
      const profile = this.account().profile;
      const local =
        profile && this.withLocal((l) => l.dashboard(userId, profile, req.recentLimit, req.days));
      if (local) return { success: true, data: local };
    }
    const res = await this.deps.send('getUserDashboard', { ...req, userId }, this.tokenFor(userId));
    this.handleAuthFailure(res);
    if (res.success && !isProfileOf(res.data?.profile, userId)) {
      return notAProfile('getUserDashboard', res.data);
    }
    if (res.success) {
      this.file.accounts[userId].profile = res.data.profile;
      await this.persistAccounts();
      // The top bar and pilot badge show the same level the dashboard does.
      this.deps.notify(this.account());
    }
    return res;
  }

  // ---- License -------------------------------------------------------------

  /** The signed-in pilot's license as it stands now, offline. Null with no license gate or nobody signed in. */
  licenseStatus(): LicenseStatus | null {
    const userId = this.file.current;
    if (!this.deps.license || !userId) return null;
    const stored = this.storedLicense(userId);
    const payload = this.trusted(userId, stored?.license);
    const notified =
      stored && payload && stored.notifiedFor === payload.expiresAt
        ? (stored.notifiedDay as NoticeDay | null)
        : null;
    const used = payload ? this.readUsage(userId) : null;
    return evaluateLicense({
      license: payload,
      now: this.now(),
      lastSeen: this.readLastSeen(),
      notified,
      usedMs: used && payload && used.issuedAt === payload.issuedAt ? used.usedMs : null,
    });
  }

  /**
   * The game window came on screen or went away (hidden, minimised, closed).
   * Time counts only while it is shown; going away ends the stretch.
   */
  setWindowShown(shown: boolean): void {
    this.countUsage();
    if (shown === this.windowShown) return;
    this.windowShown = shown;
    if (!shown) this.stretch = null;
    this.tickLicense();
  }

  /**
   * Every `everyMs` while the app is open: note the time, and push the license
   * status when it changes, so a warning comes up on the day it is due and an
   * expiry closes the app without a restart.
   */
  watchLicense(everyMs: number): () => void {
    const timer = setInterval(() => this.tickLicense(), everyMs);
    return () => clearInterval(timer);
  }

  /** The pilot closed the expiry warning for `day`: it does not come back for this expiry. */
  ackLicenseNotice(day: number): void {
    const userId = this.file.current;
    const expiresAt = this.licenseStatus()?.expiresAt;
    if (!userId || !expiresAt) return;
    const stored = this.storedLicense(userId);
    if (stored) this.licenses[userId] = { ...stored, notifiedFor: expiresAt, notifiedDay: day };
    this.withLocal((l) => l.setLicenseNotified(userId, expiresAt, day));
    this.tickLicense();
  }

  /**
   * "Check again" on the lock screen: online, fetch the license afresh (a
   * renewal, or the server's clock); either way look at the clock again.
   */
  async checkLicense(): Promise<AccountInfo> {
    if (this.file.current && this.deps.configured && !this.offline()) await this.refreshProfile();
    this.tickLicense();
    return this.account();
  }

  /** Note the time unless the clock has gone back, and push the status if it changed. */
  tickLicense(): void {
    this.countUsage();
    if (!this.deps.license) return;
    const status = this.licenseStatus();
    if (status?.state !== 'clock') {
      const now = this.now();
      const last = this.readLastSeen();
      if (last === null || now > last) this.writeLastSeen(now);
    }
    this.flushShadow();
    const pushed = JSON.stringify(status);
    if (pushed !== this.licensePushed) {
      this.licensePushed = pushed;
      this.deps.notify(this.account());
    }
  }

  // ---- Telemetry: all fire-and-forget into the outbox ---------------------

  startSession(req: Omit<StartSessionRequest, 'userId'>): boolean {
    const userId = this.file.current;
    if (!userId || !this.deps.configured) return false;
    this.withLocal((l) => l.startFlight(userId, { ...req, userId }));
    this.outbox.startSession(userId, { ...req, userId });
    return true;
  }

  checkpointSession(key: string, end: EndSnapshot): void {
    this.withLocal((l) => l.checkpointFlight(key, end));
    this.outbox.checkpoint(key, end);
  }

  endSession(key: string, end: EndSnapshot): void {
    this.withLocal((l) => l.endFlight(key, end));
    this.outbox.endSession(key, end);
    // The pilot badge and Profile show the new XP straight away.
    if (this.deps.local && this.file.current) this.deps.notify(this.account());
  }

  recordEvents(key: string | null, events: GameplayEventInput[]): void {
    const userId = this.file.current;
    if (!userId || !this.deps.configured) return;
    this.outbox.recordEvents(userId, key, events);
  }

  /** Queue a crash report, attributed to whoever is signed in. */
  recordCrash(report: CrashReport): void {
    if (!this.deps.configured) return;
    this.outbox.recordCrash(this.file.current, report);
  }

  /** The game window died mid-flight: close whatever it had open. */
  abortOpenSessions(reason: string): void {
    this.withLocal((l) => l.abortOpen());
    this.outbox.abortOpenSessions(reason);
  }

  device(): Promise<DeviceInfo> {
    return this.deps.device();
  }

  /**
   * "Save flights now": send what is queued without waiting out a backoff. A
   * pilot signed in offline is signed in to the backend first (refreshProfile).
   */
  async syncNow(): Promise<void> {
    if (!this.file.current || !this.deps.configured) return;
    this.outbox.retryNow();
    await this.refreshProfile();
    this.requeueLostFlights();
  }

  /** Nothing else would ever send a flight the queue lost, or clear its "not saved". */
  private requeueLostFlights(): void {
    for (const f of this.withLocal((l) => l.pendingFlights()) ?? []) {
      if (this.tokenFor(f.start.userId)) this.outbox.requeue(f.start, f.sessionId, f.end);
    }
  }

  telemetryStatus(): TelemetryStatus {
    const userId = this.file.current;
    const unsynced = userId ? this.withLocal((l) => l.unsyncedCount(userId)) : 0;
    return { ...this.outbox.status(), unsyncedFlights: unsynced ?? 0 };
  }

  // -------------------------------------------------------------------------

  /**
   * Send a sign-in, and send it once more if it got no answer. That is safe even
   * when the first one landed and only the reply was lost: the backend treats a
   * repeat activation by the key's owner as a login, and a login only issues
   * another token. Without it the first Activate on a slow backend failed and
   * the second (by then a login) succeeded.
   */
  private async sendSignIn<A extends 'activateUser' | 'loginUser'>(
    action: A,
    payload: ApiActions[A]['request'],
  ): Promise<ApiResponse<ApiActions[A]['response']>> {
    const first = await this.deps.send(action, payload);
    if (first.success || first.code !== 'NETWORK') return first;
    return this.deps.send(action, payload);
  }

  private async signIn(
    pending: Promise<ApiResponse<AuthResult>>,
    creds: { email: string; activationKey: string },
    remember: boolean,
  ): Promise<AccountResult> {
    const res = await pending;
    // No internet after all: a pilot known here signs in from this computer.
    if (!res.success && res.code === 'NETWORK')
      return this.signInOffline(creds.email, creds.activationKey, res);
    if (!res.success) return res;
    if (!isProfileOf(res.data?.profile, res.data?.userId)) return notAProfile('sign-in', res.data);
    const { userId, authToken, profile, existingUser, license } = res.data;
    this.storeToken(userId, authToken, profile);
    this.acceptLicense(userId, license);
    this.file.current = userId;
    this.authInvalid = false;
    this.authReason = null;
    this.historySynced = false;
    await this.persistAccounts();
    await this.rememberPilot(userId, profile, creds, remember);
    this.outbox.unblock(userId);
    this.deps.notify(this.account());
    void this.syncHistory();
    return {
      success: true,
      data: { profile: this.account().profile ?? profile, existingUser: !!existingUser },
    };
  }

  private storeToken(userId: string, authToken: string, profile: UserProfile): void {
    const encrypted = this.deps.codec.available();
    this.file.accounts[userId] = {
      token: encrypted ? this.deps.codec.encrypt(authToken) : authToken,
      encrypted,
      profile,
    };
  }

  /**
   * Keep what an offline sign-in checks against: the key's hash, and (with
   * `remember`) the key OS-encrypted, which the email-only sign-in and the
   * reconnect after an offline sign-in both send. Unticked, a key kept by an
   * earlier sign-in is dropped.
   */
  private async rememberPilot(
    userId: string,
    profile: UserProfile,
    creds: { email: string; activationKey: string },
    remember: boolean,
  ): Promise<void> {
    const local = this.deps.local;
    if (!local) return;
    try {
      const { salt, hash } = await hashKey(creds.activationKey);
      // Never stored in plain text: without the OS keychain the app asks again instead.
      let keyCipher: string | null = null;
      if (remember && this.deps.codec.available())
        keyCipher = this.deps.codec.encrypt(creds.activationKey.trim().toUpperCase());
      local.savePilot(
        {
          userId,
          email: profile.email || creds.email,
          name: profile.name,
          keySalt: salt,
          keyHash: hash,
          keyCipher,
        },
        profile,
      );
    } catch (e) {
      console.warn('[backend] could not keep the offline sign-in:', e);
    }
  }

  /**
   * Sign in against this computer's copy: the email must be one that signed in
   * online here, and the key must match its hash. Anyone else gets `unreachable`
   * (the "connect to the internet once" message).
   */
  private async signInOffline(
    email: string,
    activationKey: string,
    unreachable: ApiError,
  ): Promise<AccountResult> {
    const local = this.deps.local;
    const pilot = local ? this.withLocal((l) => l.pilotByEmail(email)) : null;
    if (!local || !pilot?.keyHash || !pilot.keySalt || !pilot.profile) return unreachable;
    if (!(await verifyKey(activationKey, pilot.keySalt, pilot.keyHash))) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Email and activation key do not match',
      };
    }
    const userId = pilot.userId;
    if (!this.file.accounts[userId]) {
      // Signed out offline, so the backend still has the token: take it back.
      const kept = this.withLocal((l) => l.takeRevoke(userId));
      this.file.accounts[userId] = {
        token: kept?.token ?? '',
        encrypted: kept?.encrypted ?? false,
        profile: pilot.profile,
      };
    }
    this.file.current = userId;
    this.authInvalid = false;
    this.authReason = null;
    this.historySynced = false;
    await this.persistAccounts();
    if (this.tokenFor(userId)) this.outbox.unblock(userId);
    this.deps.notify(this.account());
    const profile = this.account().profile ?? pilot.profile;
    return { success: true, data: { profile, existingUser: true } };
  }

  /**
   * Signed in offline and now online: sign in to the backend with the stored
   * key, so the queued flights can go. A profile taken over by another
   * computer meanwhile gets the sign-in screen, as it would have online.
   */
  private reconnect(): Promise<ApiResponse<UserProfile>> {
    this.reconnecting ??= this.doReconnect().finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  private async doReconnect(): Promise<ApiResponse<UserProfile>> {
    const userId = this.file.current;
    if (!userId || !this.deps.configured) return NOT_SIGNED_IN;
    if (this.offline()) return OFFLINE;
    const pilot = this.withLocal((l) => l.pilot(userId));
    let key: string | undefined;
    try {
      key = pilot?.keyCipher ? this.deps.codec.decrypt(pilot.keyCipher) : undefined;
    } catch {
      key = undefined;
    }
    if (!pilot || !key) {
      this.authInvalid = true;
      this.authReason = 'Sign in again to save your flights to your profile.';
      this.deps.notify(this.account());
      return { success: false, code: 'AUTH_INVALID', message: this.authReason };
    }
    const device = await this.deps.device();
    const res = await this.deps.send('loginUser', {
      email: pilot.email,
      activationKey: key,
      ...device,
    });
    if (userId !== this.file.current) return NOT_SIGNED_IN;
    if (!res.success) {
      if (isRetryable(res.code) || res.code === 'NOT_CONFIGURED') return res;
      this.authInvalid = true;
      this.authReason =
        res.code === 'SIGNED_IN_ELSEWHERE'
          ? `This profile is now signed in on ${res.deviceName ?? 'another computer'}. Sign in again to use it here.`
          : res.message;
      this.deps.notify(this.account());
      return res;
    }
    if (!isProfileOf(res.data?.profile, userId)) return notAProfile('loginUser', res.data);
    this.storeToken(userId, res.data.authToken, res.data.profile);
    this.acceptLicense(userId, res.data.license);
    await this.persistAccounts();
    this.outbox.unblock(userId);
    this.outbox.retryNow();
    this.deps.notify(this.account());
    void this.syncHistory();
    return { success: true, data: res.data.profile };
  }

  /** Copy the backend's latest 50 flights and its per-mission totals into this computer. */
  private async syncHistory(): Promise<void> {
    const local = this.deps.local;
    const userId = this.file.current;
    const token = userId ? this.tokenFor(userId) : undefined;
    if (!local || !userId || !token) return;
    const applied = this.endsApplied;
    const res = await this.deps.send(
      'getUserDashboard',
      { userId, recentLimit: 50, days: 1 },
      token,
    );
    if (userId !== this.file.current) return;
    this.handleAuthFailure(res);
    if (!res.success || !isProfileOf(res.data?.profile, userId)) return;
    this.withLocal((l) => l.importServer(userId, res.data));
    this.outbox.retryNow();
    if (this.endsApplied === applied) this.file.accounts[userId].profile = res.data.profile;
    this.historySynced = true;
    await this.persistAccounts();
    this.deps.notify(this.account());
  }

  /** Tell the backend about sign-outs made while it could not be reached. */
  private async flushRevokes(): Promise<void> {
    const local = this.deps.local;
    if (!local || this.revoking || !this.deps.configured || this.offline()) return;
    const pending = this.withLocal((l) => l.revokes()) ?? [];
    if (pending.length === 0) return;
    this.revoking = true;
    try {
      for (const r of pending) {
        let token: string | undefined;
        try {
          token = r.encrypted ? this.deps.codec.decrypt(r.token) : r.token;
        } catch {
          token = undefined;
        }
        const res = token ? await this.deps.send('signOut', {}, token) : null;
        // Delivered, or the backend no longer knows the token: either way, done.
        if (!res || res.success || !isRetryable(res.code))
          this.withLocal((l) => l.removeRevoke(r.token));
      }
    } finally {
      this.revoking = false;
    }
  }

  private now(): number {
    return this.deps.license?.now?.() ?? Date.now();
  }

  private storedLicense(userId: string): StoredLicense | null {
    return this.withLocal((l) => l.license(userId)) ?? this.licenses[userId] ?? null;
  }

  /** The license's contents if its signature is good and it is this pilot's, on this computer. */
  private trusted(userId: string, signed: SignedLicense | null | undefined) {
    const lic = this.deps.license;
    const payload = lic ? verifyLicense(signed, lic.publicKey) : null;
    if (!payload || payload.userId !== userId) return null;
    if (this.deviceId && payload.deviceId !== this.deviceId) return null;
    return payload;
  }

  /** Which check a refused license failed, for the log: a deploy without the key, the wrong key, or another pilot or computer. */
  private whyUntrusted(userId: string, signed: SignedLicense): string {
    if (!signed.signature) return 'unsigned: LICENSE_PRIVATE_KEY is not set on the backend';
    const payload = verifyLicense(signed, this.deps.license!.publicKey);
    if (!payload) return 'bad signature: the backend key does not match this app';
    if (payload.userId !== userId) return `for ${payload.userId}, not ${userId}`;
    return `for computer ${payload.deviceId || '(none)'}, not ${this.deviceId}`;
  }

  /** A license from the backend: kept when it checks out. An unsigned or foreign one is ignored. */
  private acceptLicense(userId: string, signed: SignedLicense | null | undefined): void {
    if (!this.deps.license || !signed) return;
    const payload = this.trusted(userId, signed);
    if (!payload) {
      console.warn(
        `[license] the backend sent a license that does not check out (${this.whyUntrusted(userId, signed)}); kept the old one`,
      );
      return;
    }
    const kept = this.storedLicense(userId);
    this.licenses[userId] = {
      license: signed,
      notifiedFor: kept?.notifiedFor ?? null,
      notifiedDay: kept?.notifiedDay ?? null,
    };
    this.withLocal((l) => l.saveLicense(userId, signed));
    // A freshly signed license brings a fresh offline budget: its count starts at 0.
    // Checked in online, a lost shadow copy no longer matters.
    this.shadowLost = false;
    if (this.readUsage(userId)?.issuedAt !== payload.issuedAt)
      this.writeUsage(userId, { issuedAt: payload.issuedAt, usedMs: 0 });
    // Below the backend's highest running total: this database was put back.
    const floor = (payload.usageFloorMin ?? 0) * 60_000;
    const total = this.readTotal(userId);
    if (floor > 0 && total < floor - RESTORE_SLACK_MS) {
      console.warn(
        `[license] usage total ${Math.round(total / 60_000)} min is below the backend's ${payload.usageFloorMin}: local data was put back`,
      );
      this.withLocal((l) => l.setRestorePending(userId, true));
    }
    if (total < floor) this.writeTotal(userId, floor);
    // The server's clock, just read: a clock that ran ahead and was put right
    // stops counting as moved back.
    this.writeLastSeen(Date.parse(payload.issuedAt));
    this.tickLicense();
  }

  private mono(): number {
    return this.deps.monotonic?.() ?? performance.now();
  }

  /**
   * Add the window time since the last count: to the offline budget's count of
   * the license in force, and to the current usage stretch. Called every
   * license tick and whenever the window comes or goes.
   */
  private countUsage(): void {
    const mono = this.mono();
    const step =
      this.lastMono === null ? 0 : Math.min(Math.max(0, mono - this.lastMono), MAX_USAGE_STEP_MS);
    this.lastMono = mono;
    const userId = this.file.current;
    if (!this.windowShown || !userId) {
      this.stretch = null;
      return;
    }
    const payload = this.deps.license
      ? this.trusted(userId, this.storedLicense(userId)?.license)
      : null;
    const used = payload ? this.readUsage(userId) : null;
    // Only a count that is this license's own grows; a missing one stays spent.
    if (step > 0 && payload && used?.issuedAt === payload.issuedAt)
      this.writeUsage(userId, { issuedAt: used.issuedAt, usedMs: used.usedMs + step });
    if (step > 0) this.writeTotal(userId, this.readTotal(userId) + step);

    const at = new Date(this.now()).toISOString();
    if (!this.stretch || this.stretch.userId !== userId) {
      this.stretch = {
        id: randomUUID(),
        userId,
        startedAt: at,
        endedAt: at,
        minutes: 0,
        offline: this.offline(),
      };
    }
    this.stretch.minutes = Math.round((this.stretch.minutes + step / 60_000) * 1000) / 1000;
    this.stretch.endedAt = at;
    const { userId: owner, ...stretch } = this.stretch;
    this.withLocal((l) => l.saveUsage(owner, stretch));
  }

  /**
   * Send the window time the backend has not seen, with this computer's clock
   * for its rollback check. At most every few minutes; and with nothing new, a
   * heartbeat now and then so the sheet shows the app online.
   */
  private async reportUsage(): Promise<void> {
    const userId = this.file.current;
    const token = userId ? this.tokenFor(userId) : undefined;
    if (!userId || !token || this.reportingUsage || !this.deps.local || this.offline()) return;
    const mono = this.mono();
    const since = this.lastUsageReport === null ? Infinity : mono - this.lastUsageReport;
    const usage = this.withLocal((l) => l.unsentUsage(userId)) ?? [];
    if (since < USAGE_REPORT_MS || (usage.length === 0 && since < USAGE_HEARTBEAT_MS)) return;
    this.reportingUsage = true;
    // A failed try waits its turn too: a backend older than usage reports
    // refuses every one, and would otherwise be asked on every profile check.
    this.lastUsageReport = mono;
    const restored = !!this.withLocal((l) => l.restorePending(userId));
    try {
      const res = await this.deps.send(
        'reportUsage',
        {
          userId,
          clientTime: new Date(this.now()).toISOString(),
          usage,
          totalMinutes: Math.round((this.readTotal(userId) / 60_000) * 100) / 100,
          restored,
        },
        token,
      );
      if (res.success) {
        this.withLocal((l) => l.markUsageSent(usage));
        if (restored) this.withLocal((l) => l.setRestorePending(userId, false));
      }
    } finally {
      this.reportingUsage = false;
    }
  }

  /**
   * The offline budget's count: the database's, unless the shadow copy has seen
   * a newer license (the database was put back: its license is stale, so its
   * budget counts as spent) or a higher count for the same one. A lost shadow
   * copy is a spent budget too.
   */
  private readUsage(userId: string): { issuedAt: string; usedMs: number } | null {
    const secret = this.clockSecret();
    const record = secret ? this.withLocal((l) => l.usageRecord(userId)) : null;
    const sealed = secret ? openSealedUsage(secret, userId, record ?? null) : null;
    const own = this.deps.local ? sealed : (this.usageMem[userId] ?? null);
    const shadow = this.shadow();
    if (!shadow) return own;
    if (this.shadowLost) return null;
    const kept = shadow.users[userId];
    if (!kept) return own;
    if (!own || Date.parse(kept.issuedAt) > Date.parse(own.issuedAt))
      return { issuedAt: kept.issuedAt, usedMs: kept.usedMs };
    if (kept.issuedAt === own.issuedAt)
      return { issuedAt: own.issuedAt, usedMs: Math.max(own.usedMs, kept.usedMs) };
    return own;
  }

  private writeUsage(userId: string, c: { issuedAt: string; usedMs: number }): void {
    this.usageMem[userId] = c;
    const secret = this.clockSecret();
    if (secret) this.withLocal((l) => l.saveUsageRecord(userId, sealUsage(secret, userId, c)));
    const shadow = this.shadow();
    if (shadow) {
      const kept = shadow.users[userId];
      shadow.users[userId] = { totalMs: kept?.totalMs ?? 0, ...c };
      this.shadowDirty = true;
    }
  }

  /** The running total of window time, all licenses: the higher of the database's and the shadow's. */
  private readTotal(userId: string): number {
    const secret = this.clockSecret();
    const record = secret ? this.withLocal((l) => l.totalRecord(userId)) : null;
    const own = secret ? (openSealedUsage(secret, userId, record ?? null)?.usedMs ?? 0) : 0;
    return Math.max(own, this.shadow()?.users[userId]?.totalMs ?? 0);
  }

  private writeTotal(userId: string, totalMs: number): void {
    const secret = this.clockSecret();
    if (secret)
      this.withLocal((l) =>
        l.saveTotalRecord(
          userId,
          sealUsage(secret, userId, { issuedAt: 'total', usedMs: totalMs }),
        ),
      );
    const shadow = this.shadow();
    if (shadow) {
      const kept = shadow.users[userId];
      shadow.users[userId] = { issuedAt: kept?.issuedAt ?? '', usedMs: kept?.usedMs ?? 0, totalMs };
      this.shadowDirty = true;
    }
  }

  /** The shadow copy, read once. Null without a shadow store or a seal secret. */
  private shadow(): ShadowState | null {
    const store = this.deps.shadow;
    if (this.shadowState || !store) return this.shadowState;
    const secret = this.clockSecret();
    if (!secret) return null;
    let raw: string | null;
    try {
      raw = store.read();
    } catch {
      raw = null;
    }
    const opened = openSealedShadow(secret, raw);
    // Written before but gone or edited now: deleted to go with a put-back database.
    if (!opened && this.withLocal((l) => l.shadowWritten())) {
      console.warn('[license] the license state kept outside the database is missing or edited');
      this.shadowLost = true;
    }
    this.shadowState = opened ?? { lastSeen: null, users: {} };
    return this.shadowState;
  }

  /** Write the shadow copy if it changed. A failure is logged; the next tick tries again. */
  private flushShadow(): void {
    const store = this.deps.shadow;
    const secret = this.clockSecret();
    if (!store || !secret || !this.shadowDirty || !this.shadowState) return;
    try {
      store.write(sealShadow(secret, this.shadowState));
      this.shadowDirty = false;
      this.withLocal((l) => l.markShadowWritten());
    } catch (e) {
      console.warn('[license] could not keep the license state outside the database:', e);
    }
  }

  /** The seal's secret: made once, kept OS-encrypted when the OS can. */
  private clockSecret(): string | null {
    if (this.clockKey) return this.clockKey;
    if (!this.deps.local) return null;
    const { codec } = this.deps;
    const kept = this.withLocal((l) => l.clockSecret());
    try {
      if (kept?.startsWith('enc:')) this.clockKey = codec.decrypt(kept.slice(4));
      else if (kept?.startsWith('plain:')) this.clockKey = kept.slice(6);
    } catch {
      this.clockKey = null;
    }
    if (!this.clockKey) {
      // None yet, or the OS can no longer read it: a new one. The old last-seen
      // time is lost with it and the license's server time stands in.
      const fresh = randomBytes(32).toString('base64');
      const stored = codec.available() ? `enc:${codec.encrypt(fresh)}` : `plain:${fresh}`;
      this.withLocal((l) => l.saveClockSecret(stored));
      this.clockKey = fresh;
    }
    return this.clockKey;
  }

  /** The last time seen: the later of the database's and the shadow copy's. */
  private readLastSeen(): number | null {
    const secret = this.clockSecret();
    const record = secret ? this.withLocal((l) => l.clockRecord()) : null;
    const sealed = secret ? openSealedTime(secret, record ?? null) : null;
    const own = sealed ?? this.lastSeenMem;
    const kept = this.shadow()?.lastSeen ?? null;
    return own === null ? kept : kept === null ? own : Math.max(own, kept);
  }

  private writeLastSeen(t: number): void {
    if (!Number.isFinite(t)) return;
    this.lastSeenMem = t;
    const secret = this.clockSecret();
    if (secret) this.withLocal((l) => l.saveClockRecord(sealTime(secret, t)));
    const shadow = this.shadow();
    if (shadow) {
      shadow.lastSeen = t;
      this.shadowDirty = true;
    }
  }

  private offline(): boolean {
    return !!this.deps.local && !!this.deps.online && !this.deps.online();
  }

  /** The local copy must never break signing in or flying: a failure there is logged and skipped. */
  private withLocal<T>(fn: (local: LocalStore) => T): T | undefined {
    const local = this.deps.local;
    if (!local) return undefined;
    try {
      return fn(local);
    } catch (e) {
      console.warn('[local] ', e);
      return undefined;
    }
  }

  private tokenFor(userId: string): string | undefined {
    const acct = this.file.accounts[userId];
    if (!acct || !acct.token) return undefined;
    try {
      return acct.encrypted ? this.deps.codec.decrypt(acct.token) : acct.token;
    } catch {
      return undefined;
    }
  }

  private handleAuthFailure(res: ApiResponse<unknown>): void {
    if (!res.success && (res.code === 'AUTH_INVALID' || res.code === 'USER_INACTIVE')) {
      this.authInvalid = true;
      this.authReason = res.message;
      this.deps.notify(this.account());
    }
  }

  /**
   * Drop stored tokens of signed-out users once nothing of theirs is queued, and
   * revoke each on the backend so the sheet shows the computer signed out. The
   * revoke is best effort: offline, the token stays ACTIVE there, and the next
   * computer to sign in is asked to sign it out.
   */
  private forgetIdleAccounts(): void {
    let changed = false;
    for (const userId of Object.keys(this.file.accounts)) {
      if (userId !== this.file.current && !this.outbox.hasPendingFor(userId)) {
        const acct = this.file.accounts[userId];
        const token = this.tokenFor(userId);
        if (token && this.deps.configured) {
          // Kept until the backend has it, so a sign-out made offline still reaches the sheet.
          if (acct.token)
            this.withLocal((l) =>
              l.addRevoke({ userId, token: acct.token, encrypted: acct.encrypted }),
            );
          void this.deps
            .send('signOut', {}, token)
            .then((res) => {
              if (res.success || !isRetryable(res.code))
                this.withLocal((l) => l.removeRevoke(acct.token));
            })
            .catch(() => undefined);
        }
        delete this.file.accounts[userId];
        changed = true;
      }
    }
    if (changed) void this.persistAccounts();
  }

  private persistAccounts(): Promise<void> {
    return this.deps.saveAccounts(this.file).catch(() => undefined);
  }
}
