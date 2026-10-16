import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from '../src/main/backend/service';
import { LocalStore } from '../src/main/backend/localStore';
import type { UserProfile } from '../src/shared/backend/contract';

// The key is typed once per computer: after a sign-in with "Remember me" ticked
// the same computer signs in with the email alone (the user, 2026-10-16).

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

beforeEach(() => {
  online = true;
  local = LocalStore.open(':memory:');
});

afterEach(() => {
  local.close();
});

describe('email-only sign-in with a saved key', () => {
  it('a remembered pilot signs in with the email alone, as an ordinary login', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut();
    expect(svc.hasSavedKey(EMAIL)).toBe(true);

    const res = await svc.loginSaved({ email: EMAIL });

    expect(res).toMatchObject({ success: true });
    expect(svc.account().profile?.email).toBe(EMAIL);
    // The kept key goes to the backend, so its one-computer check still runs.
    expect(calls('loginUser').at(-1)![1]).toMatchObject({ email: EMAIL, activationKey: KEY });
  });

  it('works offline too, against the stored hash', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut();
    online = false;

    expect(await svc.loginSaved({ email: EMAIL })).toMatchObject({ success: true });
  });

  it('Remember me unticked keeps no key, so the key is asked for', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY, remember: false });

    expect(local.pilotByEmail(EMAIL)!.keyCipher).toBeNull();
    expect(svc.hasSavedKey(EMAIL)).toBe(false);
    expect(await svc.loginSaved({ email: EMAIL })).toMatchObject({
      success: false,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('unticking later drops a key kept by an earlier sign-in', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut();
    await svc.login({ email: EMAIL, activationKey: KEY, remember: false });

    expect(svc.hasSavedKey(EMAIL)).toBe(false);
  });

  it('remember is never sent to the backend', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY, remember: false });

    expect(calls('loginUser')[0][1]).not.toHaveProperty('remember');
  });

  it('Forget me on this computer removes the saved key', async () => {
    await boot();
    await svc.login({ email: EMAIL, activationKey: KEY });
    await svc.signOut({ forget: true });

    expect(svc.hasSavedKey(EMAIL)).toBe(false);
  });

  it('an email never signed in here has no saved key', async () => {
    await boot();
    expect(svc.hasSavedKey('ravi@example.com')).toBe(false);
  });
});
