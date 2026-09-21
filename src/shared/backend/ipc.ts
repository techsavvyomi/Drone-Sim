import type {
  ApiError,
  ApiResponse,
  EndSessionRequest,
  GameplayEventInput,
  StartSessionRequest,
  UserProfile,
} from './contract';

// Shapes that cross the Electron IPC boundary for profiles and telemetry.
// The auth token never does: the main process attaches it.

export interface AccountInfo {
  /** False when this build has no backend URL; profiles are then switched off. */
  configured: boolean;
  /** The signed-in user's last known profile, or null when signed out. */
  profile: UserProfile | null;
  /** The backend refused the stored token; the user must sign in again. */
  needsSignIn: boolean;
  /** Why, when the backend said: e.g. the profile is now signed in on another computer. */
  signInReason: string | null;
}

export type AccountResult =
  | { success: true; data: { profile: UserProfile; existingUser: boolean } }
  | ApiError;

export interface TelemetryStatus {
  pending: number;
  lastError: string | null;
  authBlocked: string[];
}

export type SessionStart = Omit<StartSessionRequest, 'userId'>;
export type SessionEnd = Omit<EndSessionRequest, 'sessionId'>;
export type EventInput = GameplayEventInput;

export type { ApiResponse };
