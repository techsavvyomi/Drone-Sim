import type {
  ActivateUserRequest,
  ApiAction,
  ApiActions,
  ApiResponse,
  AuthResult,
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
// out never strands a session that has not been uploaded yet.

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
  /** This computer. Sent with every sign-in: a profile is locked to one device. */
  device: () => Promise<DeviceInfo>;
  /** Push a changed account to the renderer. */
  notify: (account: AccountInfo) => void;
}

export class BackendService {
  private file: AccountFile = { current: null, accounts: {} };
  private authInvalid = false;
  readonly outbox: Outbox;

  constructor(private deps: BackendServiceDeps) {
    this.outbox = new Outbox({
      load: deps.loadOutbox,
      save: deps.saveOutbox,
      send: (action, payload, token) => deps.send(action, payload, token),
      tokenFor: (userId) => this.tokenFor(userId),
      onAuthInvalid: (userId) => {
        if (userId === this.file.current) {
          this.authInvalid = true;
          this.deps.notify(this.account());
        }
      },
      onSessionEnded: (userId, result) => {
        const acct = this.file.accounts[userId];
        if (acct) {
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
    };
  }

  async activate(req: Omit<ActivateUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    const device = await this.deps.device();
    return this.signIn(this.deps.send('activateUser', { ...req, ...device }));
  }

  async login(req: Omit<LoginUserRequest, keyof DeviceInfo>): Promise<AccountResult> {
    const device = await this.deps.device();
    return this.signIn(this.deps.send('loginUser', { ...req, ...device }));
  }

  async signOut(): Promise<void> {
    this.file.current = null;
    this.authInvalid = false;
    this.forgetIdleAccounts();
    await this.persistAccounts();
    this.deps.notify(this.account());
  }

  /** Re-read the signed-in user's profile from the backend. */
  async refreshProfile(): Promise<ApiResponse<UserProfile>> {
    const userId = this.file.current;
    if (!userId) return { success: false, code: 'AUTH_INVALID', message: 'Not signed in' };
    const res = await this.deps.send('getUserProfile', { userId }, this.tokenFor(userId));
    this.handleAuthFailure(res);
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

  telemetryStatus(): TelemetryStatus {
    return this.outbox.status();
  }

  // -------------------------------------------------------------------------

  private async signIn(pending: Promise<ApiResponse<AuthResult>>): Promise<AccountResult> {
    const res = await pending;
    if (!res.success) return res;
    const { userId, authToken, profile, existingUser } = res.data;
    const encrypted = this.deps.codec.available();
    this.file.accounts[userId] = {
      token: encrypted ? this.deps.codec.encrypt(authToken) : authToken,
      encrypted,
      profile,
    };
    this.file.current = userId;
    this.authInvalid = false;
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
      this.deps.notify(this.account());
    }
  }

  /** Drop stored tokens of signed-out users once nothing of theirs is queued. */
  private forgetIdleAccounts(): void {
    let changed = false;
    for (const userId of Object.keys(this.file.accounts)) {
      if (userId !== this.file.current && !this.outbox.hasPendingFor(userId)) {
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
