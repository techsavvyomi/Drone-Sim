import type {
  ActivateUserRequest,
  ApiAction,
  ApiError,
  ApiActions,
  ApiResponse,
  AuthResult,
  CrashReport,
  DeviceInfo,
  GameplayEventInput,
  GetUserDashboardRequest,
  LoginUserRequest,
  StartSessionRequest,
  UserDashboard,
  UserProfile,
} from '@shared/backend/contract';
import type { AccountInfo, AccountResult, TelemetryStatus } from '@shared/backend/ipc';
import { Outbox, type EndSnapshot, type OutboxState } from './outbox';

// The main-process side of profiles and telemetry.
//
// It owns the one thing the renderer is never given: the auth token. The page
// asks to sign in, fly, and read its own dashboard; this attaches the token to
// each call. Tokens are kept per user (encrypted with the OS keychain when
// available) until that user's queued telemetry has been delivered, so signing
// out never strands a session that has not been uploaded yet; only then is the
// token revoked on the backend.

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

function notAProfile(action: string, data: unknown): ApiError {
  const keys = data && typeof data === 'object' ? Object.keys(data).join(', ') : String(data);
  console.warn(`[backend] ${action} answered without a profile: {${keys}}`);
  return { success: false, code: 'SERVER_ERROR', message: 'The backend answered without a profile' };
}

export class BackendService {
  private file: AccountFile = { current: null, accounts: {} };
  private authInvalid = false;
  /** The backend's reason for refusing the token, shown on the sign-in screen. */
  private authReason: string | null = null;
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
      onSessionEnded: (userId, result) => {
        const acct = this.file.accounts[userId];
        if (acct && isProfileOf(result?.profile, userId)) {
          acct.profile = result.profile;
          void this.persistAccounts();
          if (userId === this.file.current) this.deps.notify(this.account());
        }
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
  }

  account(): AccountInfo {
    const current = this.file.current ? this.file.accounts[this.file.current] : undefined;
    return {
      configured: this.deps.configured,
      profile: current?.profile ?? null,
      needsSignIn: this.authInvalid,
      signInReason: this.authInvalid ? this.authReason : null,
    };
  }

  async activate(req: Omit<ActivateUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('activateUser', { ...req, ...device }));
  }

  async login(req: Omit<LoginUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    const device = await this.deps.device();
    return this.signIn(this.sendSignIn('loginUser', { ...req, ...device }));
  }

  async signOut(): Promise<void> {
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
    if (!userId) return { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
    // The hop that carries Apps Script's answer back sometimes hangs, and has
    // answered with the health check instead; a read is safe to ask once more.
    let res = await this.deps.send('getUserProfile', { userId }, this.tokenFor(userId));
    const lost = (r: typeof res) =>
      r.success ? !isProfileOf(r.data, userId) : r.code === 'NETWORK' || r.code === 'SERVER_ERROR';
    if (lost(res)) res = await this.deps.send('getUserProfile', { userId }, this.tokenFor(userId));
    if (userId !== this.file.current) return { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
    this.handleAuthFailure(res);
    if (res.success && !isProfileOf(res.data, userId)) return notAProfile('getUserProfile', res.data);
    if (res.success) {
      this.file.accounts[userId].profile = res.data;
      await this.persistAccounts();
      this.deps.notify(this.account());
    }
    return res;
  }

  async dashboard(req: Omit<GetUserDashboardRequest, 'userId'>): Promise<ApiResponse<UserDashboard>> {
    const userId = this.file.current;
    if (!userId) return { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
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
    this.outbox.startSession(userId, { ...req, userId });
    return true;
  }

  checkpointSession(key: string, end: EndSnapshot): void {
    this.outbox.checkpoint(key, end);
  }

  endSession(key: string, end: EndSnapshot): void {
    this.outbox.endSession(key, end);
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
    this.outbox.abortOpenSessions(reason);
  }

  device(): Promise<DeviceInfo> {
    return this.deps.device();
  }

  telemetryStatus(): TelemetryStatus {
    return this.outbox.status();
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

  private async signIn(pending: Promise<ApiResponse<AuthResult>>): Promise<AccountResult> {
    const res = await pending;
    if (!res.success) return res;
    if (!isProfileOf(res.data?.profile, res.data?.userId)) return notAProfile('sign-in', res.data);
    const { userId, authToken, profile, existingUser } = res.data;
    const encrypted = this.deps.codec.available();
    this.file.accounts[userId] = {
      token: encrypted ? this.deps.codec.encrypt(authToken) : authToken,
      encrypted,
      profile,
    };
    this.file.current = userId;
    this.authInvalid = false;
    this.authReason = null;
    await this.persistAccounts();
    this.outbox.unblock(userId);
    this.deps.notify(this.account());
    return { success: true, data: { profile, existingUser: !!existingUser } };
  }

  private tokenFor(userId: string): string | undefined {
    const acct = this.file.accounts[userId];
    if (!acct) return undefined;
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
        const token = this.tokenFor(userId);
        if (token && this.deps.configured) void this.deps.send('signOut', {}, token).catch(() => undefined);
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
