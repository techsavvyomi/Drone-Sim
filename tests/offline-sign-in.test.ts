import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from '../src/main/backend/service';
import { LocalStore } from '../src/main/backend/localStore';
import type { UserProfile } from '../src/shared/backend/contract';

// Sign in once online, then with no internet: on the computer that signed in,
// the same email and key sign in again, the flights are logged and shown, and
// when the internet comes back the app signs in to the backend by itself.

const KEY = 'PLUTO-SIM-ABCD-EFGH';
const EMAIL = 'asha@example.com';
const PROFILE: UserProfile = {
  userId: 'USR-000001',
  name: 'Asha',
  email: EMAIL,
  level: 1,
  levelPoints: { current: 0, next: 500 },
  status: 'ACTIVE',
  registeredAt: '2026-10-01T00:00:00.000Z',
  lastActiveAt: '2026-10-01T00:00:00.000Z',
  device: null,
  stats: {
    totalPoints: 0,
    totalFlights: 0,
    totalFlightTimeSec: 0,
    trainingFlights: 0,
    missionFlights: 0,
    freeFlights: 0,
    missionsCompleted: 0,
    trainingCompleted: 0,
    freeFlightTimeSec: 0,
    crashCount: 0,
    averageScore: 0,
  },
};
const AUTH = {
  success: true as const,
  data: { userId: PROFILE.userId, authToken: 'tok-1', profile: PROFILE },
};
const DASH = {
  success: true as const,
  data: {
    profile: PROFILE,
    recentSessions: [],
    daily: [],
    missions: [],
    training: { completed: 0, total: 0, modules: [] },
    drones: [],
    missionCompletionRate: 0,
  },
};
const NO_NET = {
  success: false as const,
  code: 'NETWORK' as const,
  message: 'Could not reach the backend',
};

let online = true;
let local: LocalStore;
let send: ReturnType<typeof vi.fn>;
let svc: BackendService;

/** A backend that answers like Apps Script while `online`, and not at all otherwise. */
function backend(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (action: string) => {
    if (!online) return NO_NET;
    if (action in overrides) return overrides[action];
    if (action === 'loginUser' || action === 'activateUser') return AUTH;
    if (action === 'getUserDashboard') return DASH;
    if (action === 'getUserProfile') return { success: true, data: PROFILE };
    if (action === 'signOut') return { success: true, data: { signedOut: true } };
    if (action === 'startSession') return { success: true, data: { sessionId: 'SES-1' } };
    if (action === 'endSession')
      return { success: true, data: { sessionId: 'SES-1', pointsEarned: 0, profile: PROFILE } };
    return { success: true, data: {} };
  });
}

async function boot(sendImpl = backend()) {
  send = sendImpl;
  svc = new BackendService({
    configured: true,
    send: send as never,
    loadAccounts: async () => local.loadAccountFile(),
    saveAccounts: async (file) => local.saveAccountFile(file),
    loadOutbox: async () => null,
    saveOutbox: async () => {},
    // A stand-in for the OS keychain: reversible, and visibly not plain text.
    codec: {
      available: () => true,
      encrypt: (s) => `enc:${s}`,
      decrypt: (s) => s.replace(/^enc:/, ''),
    },
    device: async () => ({ deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' }),
    notify: () => {},
    local,
    online: () => online,
  });
  await svc.init();
  return svc;
}

const calls = (action: string) => send.mock.calls.filter((c) => c[0] === action);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  online = true;
  local = LocalStore.open(':memory:');
});

afterEach(() => {
  local.close();
});

describe('offline sign-in', () => {
  it('needs the internet the first time, with the usual message', async () => {
    online = false;
    await boot();
    const res = await svc.login({ email: EMAIL, activationKey: KEY });
    expect(res).toMatchObject({ success: false, code: 'NETWORK' });
    expect(svc.account().profile).toBeNull();
  });

  it('keeps the key as a hash and OS-encrypted, never in plain text', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    const pilot = local.pilotByEmail(EMAIL)!;
    expect(pilot.keyHash).toBeTruthy();
    expect(pilot.keyHash).not.toContain('ABCD');
    expect(pilot.keyCipher).toBe(`enc:${KEY}`);
  });

  it('does not store the key at all when the OS cannot encrypt it', async () => {
    await boot();
    // @ts-expect-error reach into the deps for this one case
    svc.deps.codec.available = () => false;
    await svc.login({ email: EMAIL, activationKey: KEY });
    expect(local.pilotByEmail(EMAIL)!.keyCipher).toBeNull();
    expect(local.pilotByEmail(EMAIL)!.keyHash).toBeTruthy();
  });

  it('signs out and back in with no internet, on this computer', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    await svc.signOut();
    expect(svc.account().profile).toBeNull();
    const res = await svc.login({ email: EMAIL, activationKey: KEY.toLowerCase() });
    expect(res.success).toBe(true);
    expect(svc.account().profile?.userId).toBe(PROFILE.userId);
  });

  it('refuses a wrong key offline', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    await svc.signOut();
    const res = await svc.login({ email: EMAIL, activationKey: 'PLUTO-SIM-ZZZZ-ZZZZ' });
    expect(res).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' });
  });

  it('survives a restart: the sign-in and the key live in SQLite', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut();
    online = false;
    await boot();
    expect((await svc.login({ email: EMAIL, activationKey: KEY })).success).toBe(true);
  });

  it('a signed-out token the backend never heard about is taken back on the next sign-in', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    await svc.signOut();
    expect(local.revokes()).toHaveLength(1);
    await svc.login({ email: EMAIL, activationKey: KEY });
    expect(local.revokes()).toHaveLength(0);
    online = true;
    await svc.refreshProfile();
    // The old token still works: no new sign-in was needed.
    expect(calls('loginUser')).toHaveLength(1);
  });
});

describe('back online', () => {
  async function signedInOfflineWithoutToken() {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut(); // online: the token is revoked on the backend
    await flush();
    expect(local.revokes()).toHaveLength(0);
    online = false;
    await svc.login({ email: EMAIL, activationKey: KEY });
  }

  it('signs in to the backend with the stored key and uploads the queued flights', async () => {
    await signedInOfflineWithoutToken();
    svc.startSession({
      flightType: 'FREE_FLIGHT',
      droneId: 'DRONE-001',
      inputMode: 'KEYBOARD',
      startTime: new Date().toISOString(),
      clientSessionKey: 'k1',
    });
    svc.endSession('k1', {
      endTime: new Date().toISOString(),
      duration: 300,
      flightTime: 240,
      result: 'SUCCESS',
      score: 0,
      crashCount: 0,
      attempts: 1,
    });
    expect(svc.account().profile?.stats.totalFlights).toBe(1);
    expect(svc.telemetryStatus().unsyncedFlights).toBe(1);

    online = true;
    const res = await svc.refreshProfile();
    expect(res.success).toBe(true);
    expect(calls('loginUser').at(-1)?.[1]).toMatchObject({ email: EMAIL, activationKey: KEY });
    expect(calls('loginUser').at(-1)?.[1]).not.toHaveProperty('signOutOtherDevices');
    await svc.outbox.flush();
    expect(calls('startSession')).toHaveLength(1);
    expect(calls('endSession')).toHaveLength(1);
    expect(svc.telemetryStatus().unsyncedFlights).toBe(0);
  });

  it('sends the pilot to the sign-in screen when another computer has the profile', async () => {
    await signedInOfflineWithoutToken();
    send.mockImplementation(async (action: string) =>
      action === 'loginUser'
        ? {
            success: false,
            code: 'SIGNED_IN_ELSEWHERE',
            message: 'x',
            deviceName: 'Home Mac (macOS)',
          }
        : NO_NET,
    );
    online = true;
    await svc.refreshProfile();
    expect(svc.account()).toMatchObject({ needsSignIn: true });
    expect(svc.account().signInReason).toContain('Home Mac (macOS)');
  });

  it('does nothing while still offline', async () => {
    await signedInOfflineWithoutToken();
    const before = calls('loginUser').length;
    await svc.refreshProfile();
    expect(calls('loginUser')).toHaveLength(before);
    expect(svc.account().needsSignIn).toBe(false);
  });
});

describe('upload after the network returns', () => {
  it('sends flights flown offline as soon as the backend answers, not after the backoff', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    svc.startSession({
      flightType: 'MISSION',
      missionId: 'MISSION-010',
      droneId: 'DRONE-002',
      inputMode: 'KEYBOARD',
      startTime: new Date(Date.now() - 300_000).toISOString(),
      clientSessionKey: 'k9',
    });
    svc.endSession('k9', {
      endTime: new Date().toISOString(),
      duration: 290,
      flightTime: 280,
      result: 'SUCCESS',
      score: 6,
      stars: 3,
      crashCount: 0,
      attempts: 1,
    });
    // Tried offline a few times: the next try is now minutes away.
    for (let i = 0; i < 6; i++) await svc.outbox.flush();
    // The end only goes once a start has been accepted.
    expect(calls('endSession')).toHaveLength(0);
    expect(svc.telemetryStatus().unsyncedFlights).toBe(1);

    online = true;
    // What the app's `online` event (or the 30 s check) does.
    await svc.refreshProfile();
    await flush();
    // Nothing else nudges the queue here: only `retryNow` can have sent it.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('endSession')).toHaveLength(1);
    expect(svc.telemetryStatus().unsyncedFlights).toBe(0);
  });
});

describe('the profile and sign-out', () => {
  it('answers the Profile page from this computer, offline too', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    svc.startSession({
      flightType: 'TRAINING',
      trainingId: 'TRAINING-001',
      droneId: 'DRONE-001',
      inputMode: 'KEYBOARD',
      startTime: new Date(Date.now() - 120_000).toISOString(),
      clientSessionKey: 'k2',
    });
    svc.endSession('k2', {
      endTime: new Date().toISOString(),
      duration: 110,
      flightTime: 90,
      result: 'SUCCESS',
      score: 90,
      stars: 3,
      crashCount: 0,
      attempts: 1,
    });
    const res = await svc.dashboard({ recentLimit: 50 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.recentSessions[0]).toMatchObject({
      trainingName: 'Arm & Take Off',
      result: 'SUCCESS',
      pointsEarned: 105,
    });
    expect(res.data.profile.stats.totalPoints).toBe(105);
    expect(res.data.training.modules[0]).toMatchObject({ completed: true, bestStars: 3 });
  });

  it('"Forget me" keeps everything while flights are still waiting to upload', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    online = false;
    svc.startSession({
      flightType: 'FREE_FLIGHT',
      droneId: 'DRONE-001',
      inputMode: 'KEYBOARD',
      startTime: new Date().toISOString(),
      clientSessionKey: 'k3',
    });
    svc.endSession('k3', {
      endTime: new Date().toISOString(),
      duration: 60,
      flightTime: 60,
      result: 'SUCCESS',
      score: 0,
      crashCount: 0,
      attempts: 1,
    });
    await svc.signOut({ forget: true });
    expect(local.pilotByEmail(EMAIL)).not.toBeNull();
  });

  it('"Forget me" removes the offline sign-in once everything is uploaded', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut({ forget: true });
    expect(local.pilotByEmail(EMAIL)).toBeNull();
    online = false;
    expect(await svc.login({ email: EMAIL, activationKey: KEY })).toMatchObject({
      code: 'NETWORK',
    });
  });

  it('takes over the old account.json sign-in shape unchanged', async () => {
    local.saveAccountFile({
      current: PROFILE.userId,
      accounts: { [PROFILE.userId]: { token: 'enc:tok-0', encrypted: true, profile: PROFILE } },
    });
    await boot();
    expect(svc.account().profile?.userId).toBe(PROFILE.userId);
    await svc.refreshProfile();
    expect(calls('getUserProfile').at(-1)?.[2]).toBe('tok-0');
  });
});
