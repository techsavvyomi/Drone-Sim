// Single source of truth for the main <-> renderer IPC surface.
// Channel names live here; the preload exposes a typed `window.api` matching
// `IpcApi`, and the main process registers handlers for each channel.

import type { AppSettings, AppInfo } from './types';
import type {
  ActivateUserRequest,
  ApiResponse,
  DeviceInfo,
  GetUserDashboardRequest,
  LoginUserRequest,
  UserDashboard,
  UserProfile,
} from './backend/contract';
import type {
  AccountInfo,
  AccountResult,
  EventInput,
  SessionEnd,
  SessionStart,
  TelemetryStatus,
} from './backend/ipc';

export const IPC = {
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  appInfo: 'app:info',
  accountGet: 'account:get',
  accountActivate: 'account:activate',
  accountLogin: 'account:login',
  accountSignOut: 'account:sign-out',
  accountRefresh: 'account:refresh',
  accountDashboard: 'account:dashboard',
  /** main -> renderer: the signed-in account or its profile changed. */
  accountChanged: 'account:changed',
  telemetryStart: 'telemetry:start',
  telemetryCheckpoint: 'telemetry:checkpoint',
  telemetryEnd: 'telemetry:end',
  telemetryEvents: 'telemetry:events',
  telemetryStatus: 'telemetry:status',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** The narrow, whitelisted API surface exposed to the renderer. */
export interface IpcApi {
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  appInfo(): Promise<AppInfo>;
  /** User profiles. The auth token stays in the main process. */
  account: {
    get(): Promise<AccountInfo>;
    /** The device fields are added by the main process. */
    activate(req: Omit<ActivateUserRequest, keyof DeviceInfo>): Promise<AccountResult>;
    login(req: Omit<LoginUserRequest, keyof DeviceInfo>): Promise<AccountResult>;
    signOut(): Promise<void>;
    refreshProfile(): Promise<ApiResponse<UserProfile>>;
    dashboard(req: Omit<GetUserDashboardRequest, 'userId'>): Promise<ApiResponse<UserDashboard>>;
    /** Subscribe to account changes. Returns an unsubscribe function. */
    onChanged(listener: (account: AccountInfo) => void): () => void;
  };
  /** Session and event telemetry. Fire-and-forget; queued in the main process. */
  telemetry: {
    startSession(req: SessionStart): void;
    checkpoint(clientSessionKey: string, end: SessionEnd): void;
    endSession(clientSessionKey: string, end: SessionEnd): void;
    recordEvents(clientSessionKey: string | null, events: EventInput[]): void;
    status(): Promise<TelemetryStatus>;
  };
}
