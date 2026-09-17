// The profile & analytics API contract.
//
// This file is the part of the prototype that is meant to outlive it. The
// storage behind it is Google Sheets through an Apps Script web app today and
// is expected to be Firebase later; the simulator only ever speaks these types,
// so swapping the backend is a change to the transport, not to the game.
//
// Every request is `{ action, payload, authToken? }` over HTTPS as JSON, and
// every response is an `ApiResponse`. The Apps Script implementation lives in
// `backend/apps-script/` and its documentation in `backend/README.md`; the two
// must agree with what is written here.
//
// Rules the server enforces rather than trusts:
//   - identity comes from `authToken`, never from a `userId` in the payload;
//   - points, totals, levels and activation status are computed server-side;
//   - drone, mission and training ids are checked against the catalog sheets;
//   - a session can only be ended or annotated by the user who started it.

export const API_VERSION = 1;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type FlightType = 'TRAINING' | 'MISSION' | 'FREE_FLIGHT';
export const FLIGHT_TYPES: readonly FlightType[] = ['TRAINING', 'MISSION', 'FREE_FLIGHT'];

export type SessionResult = 'SUCCESS' | 'FAILED' | 'ABORTED';
export const SESSION_RESULTS: readonly SessionResult[] = ['SUCCESS', 'FAILED', 'ABORTED'];

export type InputMode = 'KEYBOARD' | 'GAMEPAD' | 'RC_TRANSMITTER';

export type UserStatus = 'ACTIVE' | 'INACTIVE';
export type KeyStatus = 'AVAILABLE' | 'ACTIVATED' | 'DISABLED';

/**
 * Gameplay events the simulator emits. The server accepts any UPPER_SNAKE name
 * so a new event never needs a backend deploy; these are the ones in use.
 */
export type GameplayEventType =
  | 'MISSION_STARTED'
  | 'MISSION_COMPLETED'
  | 'MISSION_FAILED'
  | 'MISSION_RESTARTED'
  | 'CHECKPOINT_REACHED'
  | 'ZONE_REACHED'
  | 'PACKAGE_COLLECTED'
  | 'PACKAGE_DELIVERED'
  | 'TARGET_DETECTED'
  | 'TRAINING_STARTED'
  | 'TRAINING_DEMO_STARTED'
  | 'TRAINING_ATTEMPT_STARTED'
  | 'TRAINING_ATTEMPT_FAILED'
  | 'TRAINING_COMPLETED'
  | 'FREE_FLIGHT_STARTED'
  | 'FREE_FLIGHT_ENDED'
  | 'DRONE_ARMED'
  | 'DRONE_TOOK_OFF'
  | 'DRONE_LANDED'
  | 'DRONE_CRASHED'
  | 'DRONE_RESET'
  | 'BATTERY_LOW'
  | 'DRONE_CHANGED'
  | 'CONTROLLER_CONNECTED'
  | 'CONTROLLER_DISCONNECTED'
  | 'SESSION_RECOVERED';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  /** The transport could not reach the backend at all. Retryable. */
  | 'NETWORK'
  /** No backend URL is configured in this build. */
  | 'NOT_CONFIGURED'
  /** Malformed or out-of-range input. Not retryable. */
  | 'VALIDATION'
  | 'KEY_NOT_FOUND'
  | 'KEY_ALREADY_USED'
  | 'KEY_DISABLED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  /** The profile is bound to a different computer. An admin must release it. */
  | 'DEVICE_MISMATCH'
  | 'USER_INACTIVE'
  /** Missing, unknown or revoked auth token. The client must sign in again. */
  | 'AUTH_INVALID'
  | 'NOT_FOUND'
  /** The session belongs to another user. */
  | 'FORBIDDEN'
  | 'UNKNOWN_ACTION'
  /** Anything the server did not anticipate. Retryable. */
  | 'SERVER_ERROR';

export interface ApiError {
  success: false;
  code: ApiErrorCode;
  message: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Errors worth retrying later; everything else is a definitive answer. */
export function isRetryable(code: ApiErrorCode): boolean {
  return code === 'NETWORK' || code === 'SERVER_ERROR';
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface UserStats {
  totalPoints: number;
  totalFlights: number;
  /** Seconds spent airborne under the pilot's own control, across all sessions. */
  totalFlightTimeSec: number;
  trainingFlights: number;
  missionFlights: number;
  freeFlights: number;
  missionsCompleted: number;
  trainingCompleted: number;
  freeFlightTimeSec: number;
  crashCount: number;
  /** Mean score of scored sessions, 0 when there are none. */
  averageScore: number;
}

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  level: number;
  /** Points needed for the next level, for a progress bar. */
  levelPoints: { current: number; next: number };
  status: UserStatus;
  registeredAt: string;
  lastActiveAt: string;
  /** The computer this profile is locked to, or null before the first sign-in. */
  device: { name: string; boundAt: string } | null;
  stats: UserStats;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The computer a sign-in comes from. A profile is bound to the first one and
 * refused on any other (DEVICE_MISMATCH) until an admin releases it.
 */
export interface DeviceInfo {
  /** Stable random id for this installation. */
  deviceId: string;
  /** Human-readable, shown to the admin and in the error: "Omkar-MacBook (macOS)". */
  deviceName: string;
}

export interface ActivateUserRequest extends DeviceInfo {
  name: string;
  email: string;
  activationKey: string;
}

export interface LoginUserRequest extends DeviceInfo {
  email: string;
  activationKey: string;
}

/** What activation and login both hand back. */
export interface AuthResult {
  userId: string;
  /** Opaque bearer token for every later call. Stored hashed server-side. */
  authToken: string;
  profile: UserProfile;
  /** True when activation found the key already bound to this same email. */
  existingUser?: boolean;
}

export interface GetUserProfileRequest {
  userId: string;
}

export interface StartSessionRequest {
  userId: string;
  flightType: FlightType;
  /** Catalog id, e.g. MISSION-001. Required for MISSION. */
  missionId?: string;
  /** Catalog id, e.g. TRAINING-004. Required for TRAINING. */
  trainingId?: string;
  /** Catalog id, e.g. DRONE-001. */
  droneId: string;
  inputMode: InputMode;
  /** ISO time the session began on the client (it may be uploaded later). */
  startTime: string;
  /**
   * Client-generated UUID. Retrying a start with the same key returns the same
   * session instead of opening a second one.
   */
  clientSessionKey: string;
  appVersion?: string;
}

export interface StartSessionResult {
  sessionId: string;
  /** True when this key had already opened a session. */
  duplicate?: boolean;
}

export interface EndSessionRequest {
  sessionId: string;
  endTime: string;
  /** Session length in seconds, excluding pauses. */
  duration: number;
  /** Seconds airborne under the pilot's control. Never more than `duration`. */
  flightTime: number;
  result: SessionResult;
  /** Mission points or training score. Clamped server-side to the catalog max. */
  score: number;
  /** 0-3, for training and missions. */
  stars?: number;
  crashCount: number;
  /** Non-crash contacts with obstacles. */
  collisionCount?: number;
  attempts: number;
  distance?: number;
  maxAltitude?: number;
  /** Percentage of the pack used, 0-100. */
  batteryUsed?: number;
  inputMode?: InputMode;
  /** Mission objectives completed / available, when the mission has them. */
  objectivesCompleted?: number;
  objectivesTotal?: number;
  /** Why the last attempt failed, when it did (crash, timeout, ...). */
  failReason?: string;
  /**
   * Ignored. Points are computed by the server from the result, score and stars
   * so a client cannot award itself any. Accepted only so older clients that
   * send it are not rejected.
   */
  pointsEarned?: number;
}

export interface EndSessionResult {
  sessionId: string;
  pointsEarned: number;
  profile: UserProfile;
  /** True when the session had already been ended; stats were not re-applied. */
  duplicate?: boolean;
}

export interface GameplayEventInput {
  eventType: GameplayEventType | string;
  eventData?: Record<string, unknown>;
  /** ISO client time the event happened. */
  timestamp: string;
}

export interface RecordEventRequest extends GameplayEventInput {
  /** May be omitted for app-level events (controller plugged in on the menu). */
  sessionId?: string;
}

export interface RecordEventsRequest {
  sessionId?: string;
  events: GameplayEventInput[];
}

export interface RecordEventsResult {
  eventIds: string[];
}

export interface SessionSummary {
  sessionId: string;
  date: string;
  startTime: string;
  flightType: FlightType;
  missionId: string;
  missionName: string;
  trainingId: string;
  trainingName: string;
  droneId: string;
  droneName: string;
  duration: number;
  flightTime: number;
  score: number;
  stars: number;
  pointsEarned: number;
  result: SessionResult | 'IN_PROGRESS';
  crashCount: number;
}

export interface DailyActivity {
  /** YYYY-MM-DD in the spreadsheet's time zone. */
  date: string;
  sessions: number;
  points: number;
  flightTimeSec: number;
}

export interface MissionBreakdown {
  missionId: string;
  missionName: string;
  attempts: number;
  sessions: number;
  completed: number;
  bestScore: number;
}

export interface TrainingBreakdown {
  trainingId: string;
  trainingName: string;
  order: number;
  sessions: number;
  completed: boolean;
  bestStars: number;
}

export interface DroneUsage {
  droneId: string;
  droneName: string;
  sessions: number;
  flightTimeSec: number;
  crashes: number;
}

export interface GetUserDashboardRequest {
  userId: string;
  /** How many recent sessions to return (default 10, max 50). */
  recentLimit?: number;
  /** How many days of history for the time series (default 30, max 180). */
  days?: number;
}

export interface UserDashboard {
  profile: UserProfile;
  recentSessions: SessionSummary[];
  daily: DailyActivity[];
  missions: MissionBreakdown[];
  training: { completed: number; total: number; modules: TrainingBreakdown[] };
  drones: DroneUsage[];
  missionCompletionRate: number;
}

// ---------------------------------------------------------------------------
// Crash reports
// ---------------------------------------------------------------------------

export type CrashKind =
  /** Uncaught exception in the Electron main process. */
  | 'MAIN_EXCEPTION'
  | 'MAIN_REJECTION'
  /** Uncaught exception in the game window's JavaScript. */
  | 'RENDERER_EXCEPTION'
  | 'RENDERER_REJECTION'
  /** A React screen threw while rendering. */
  | 'RENDER_ERROR'
  /** The game window's process died (crash, out of memory, killed). */
  | 'RENDERER_GONE'
  /** The GPU or another helper process died. */
  | 'CHILD_PROCESS_GONE'
  /** The 3D view lost its WebGL context (driver reset, GPU memory). */
  | 'WEBGL_CONTEXT_LOST'
  /** A native crash; Electron wrote a minidump, reported on the next launch. */
  | 'NATIVE_CRASH';

export const CRASH_KINDS: readonly CrashKind[] = [
  'MAIN_EXCEPTION',
  'MAIN_REJECTION',
  'RENDERER_EXCEPTION',
  'RENDERER_REJECTION',
  'RENDER_ERROR',
  'RENDERER_GONE',
  'CHILD_PROCESS_GONE',
  'WEBGL_CONTEXT_LOST',
  'NATIVE_CRASH',
];

export interface CrashReport {
  kind: CrashKind;
  /** First line of the error, at most 1000 characters. */
  message: string;
  /** Stack trace with user paths removed, at most 8000 characters. */
  stack?: string;
  /** Whether the app (or its window) went down, rather than recovering. */
  fatal: boolean;
  occurredAt: string;
  appVersion: string;
  platform: string;
  osVersion: string;
  electronVersion: string;
  deviceId?: string;
  deviceName?: string;
  /**
   * What the pilot was doing: screen, mission or lesson, drone, map, graphics
   * preset, frame rate, uptime, memory. Small and JSON-serialisable.
   */
  context?: Record<string, unknown>;
}

export interface ReportCrashesRequest {
  /** At most 20 per request. */
  reports: CrashReport[];
}

export interface ReportCrashesResult {
  reportIds: string[];
}

/** Every action, its request and its success payload. */
export interface ApiActions {
  activateUser: { request: ActivateUserRequest; response: AuthResult };
  loginUser: { request: LoginUserRequest; response: AuthResult };
  getUserProfile: { request: GetUserProfileRequest; response: UserProfile };
  getUserDashboard: { request: GetUserDashboardRequest; response: UserDashboard };
  startSession: { request: StartSessionRequest; response: StartSessionResult };
  endSession: { request: EndSessionRequest; response: EndSessionResult };
  recordEvent: { request: RecordEventRequest; response: RecordEventsResult };
  recordEvents: { request: RecordEventsRequest; response: RecordEventsResult };
  /** Works signed out too: a crash on the sign-in screen still matters. */
  reportCrashes: { request: ReportCrashesRequest; response: ReportCrashesResult };
}

export type ApiAction = keyof ApiActions;

/** The wire format of a request body. */
export interface ApiRequestBody<A extends ApiAction = ApiAction> {
  apiVersion: number;
  action: A;
  payload: ApiActions[A]['request'];
  authToken?: string;
}
