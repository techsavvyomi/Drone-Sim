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
  type StartSessionRequest,
  type UserDashboard,
  type UserProfile,
} from '@shared/backend/contract';
import type { AccountInfo, AccountResult, TelemetryStatus } from '@shared/backend/ipc';
import { Outbox, type EndSnapshot, type OutboxState } from './outbox';
import { hashKey, verifyKey } from './keyHash';
import type { LocalStore } from './localStore';

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
}

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
    };
  }

  async activate(req: Omit<ActivateUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    if (this.offline()) return this.signInOffline(req.email, req.activationKey, OFFLINE);
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('activateUser', { ...req, ...device }), req);
  }

  async login(req: Omit<LoginUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    if (this.offline()) return this.signInOffline(req.email, req.activationKey, OFFLINE);
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('loginUser', { ...req, ...device }), req);
  }

  /**
   * `forget`: "Forget me on this computer" also removes the pilot's offline
   * sign-in and flight log here, unless flights are still waiting to upload.
   */
  async signOut(opts: { forget?: boolean } = {}): Promise<void> {
    const userId = this.file.current;
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
      // An end applied while this was on its way already brought a newer profile.
      if (this.endsApplied === applied) this.file.accounts[userId].profile = res.data;
      await this.persistAccounts();
      this.deps.notify(this.account());
      // The backend answered, so the network is back: queued flights go now.
      this.outbox.retryNow();
      if (!this.historySynced) void this.syncHistory();
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
  ): Promise<AccountResult> {
    const res = await pending;
    // No internet after all: a pilot known here signs in from this computer.
    if (!res.success && res.code === 'NETWORK')
      return this.signInOffline(creds.email, creds.activationKey, res);
    if (!res.success) return res;
    if (!isProfileOf(res.data?.profile, res.data?.userId)) return notAProfile('sign-in', res.data);
    const { userId, authToken, profile, existingUser } = res.data;
    this.storeToken(userId, authToken, profile);
    this.file.current = userId;
    this.authInvalid = false;
    this.authReason = null;
    this.historySynced = false;
    await this.persistAccounts();
    await this.rememberPilot(userId, profile, creds);
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

  /** Keep what an offline sign-in checks against: the key's hash, and the key OS-encrypted. */
  private async rememberPilot(
    userId: string,
    profile: UserProfile,
    creds: { email: string; activationKey: string },
  ): Promise<void> {
    const local = this.deps.local;
    if (!local) return;
    try {
      const { salt, hash } = await hashKey(creds.activationKey);
      // Never stored in plain text: without the OS keychain the app asks again instead.
      let keyCipher: string | null = null;
      if (this.deps.codec.available())
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
