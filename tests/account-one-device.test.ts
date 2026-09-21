import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService, type AccountFile, type BackendServiceDeps } from '../src/main/backend/service';

// A profile is signed in on one computer at a time. The backend enforces it
// (tests/backend-api.test.ts, "one device at a time"); this is the app's side:
// the confirmation reaches the backend, signing out tells it, and a computer
// signed out from another one finds out while it is still open.

const PROFILE = {
  userId: 'USR-000001',
  email: 'omkar@example.com',
  level: 1,
  levelPoints: { current: 0, next: 500 },
  stats: {},
};
const SIGNED_IN: AccountFile = {
  current: 'USR-000001',
  accounts: { 'USR-000001': { token: 'tok', encrypted: false, profile: PROFILE as never } },
};
const MOVED = {
  success: false as const,
  code: 'AUTH_INVALID' as const,
  message: 'This profile is now signed in on Home Mac (macOS). Sign in again to use it here.',
};
const CHECK_MS = 120_000;

async function service(send: BackendServiceDeps['send'], accounts: AccountFile | null = SIGNED_IN) {
  const notify = vi.fn();
  const svc = new BackendService({
    configured: true,
    send,
    loadAccounts: async () => structuredClone(accounts),
    saveAccounts: async () => {},
    loadOutbox: async () => null,
    saveOutbox: async () => {},
    codec: { available: () => false, encrypt: (s) => s, decrypt: (s) => s },
    device: async () => ({ deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' }),
    notify,
  });
  await svc.init();
  return { svc, notify };
}

const calls = (send: ReturnType<typeof vi.fn>, action: string) =>
  send.mock.calls.filter((c) => c[0] === action);

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe('sign in on one device at a time', () => {
  it('sends "Sign out of all devices" with the sign-in', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: { userId: 'USR-000001', authToken: 'new', profile: PROFILE },
    });
    const { svc } = await service(send, null);
    await svc.login({
      email: 'omkar@example.com',
      activationKey: 'PLUTO-SIM-AAAA-AAAA',
      signOutOtherDevices: true,
    });
    expect(send).toHaveBeenCalledWith(
      'loginUser',
      expect.objectContaining({ signOutOtherDevices: true, deviceId: 'device-aaaaaaaaaaaaaaaa' }),
    );
  });

  it('revokes the token on the backend when signing out', async () => {
    const send = vi.fn().mockResolvedValue({ success: true, data: { signedOut: true } });
    const { svc } = await service(send);
    await svc.signOut();
    expect(send).toHaveBeenCalledWith('signOut', {}, 'tok');
    expect(svc.account().profile).toBeNull();
  });

  it('checks while open, and asks for sign-in with the reason once signed out elsewhere', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: PROFILE })
      .mockResolvedValueOnce(MOVED);
    const { svc, notify } = await service(send);
    stop = svc.watchSignIn(CHECK_MS);

    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(calls(send, 'getUserProfile')).toHaveLength(1);
    expect(svc.account().needsSignIn).toBe(false);

    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(svc.account()).toMatchObject({ needsSignIn: true, signInReason: MOVED.message });
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ needsSignIn: true }));

    // Nothing more to ask until someone signs in again.
    await vi.advanceTimersByTimeAsync(CHECK_MS * 3);
    expect(calls(send, 'getUserProfile')).toHaveLength(2);
  });

  it('asks once more when the answer is lost, and then learns it was signed out', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: false, code: 'NETWORK', message: 'no answer' })
      .mockResolvedValueOnce(MOVED);
    const { svc } = await service(send);
    await svc.refreshProfile();
    expect(calls(send, 'getUserProfile')).toHaveLength(2);
    expect(svc.account().needsSignIn).toBe(true);
  });

  it('does not sign anyone out for a lost connection', async () => {
    const send = vi.fn().mockResolvedValue({ success: false, code: 'NETWORK', message: 'offline' });
    const { svc } = await service(send);
    stop = svc.watchSignIn(CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHECK_MS * 2);
    // Each check asks twice before giving up.
    expect(calls(send, 'getUserProfile')).toHaveLength(4);
    expect(svc.account().needsSignIn).toBe(false);
  });

  it('waits for a slow answer rather than piling checks up behind it', async () => {
    const send = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: PROFILE }), 50_000)),
    );
    const { svc } = await service(send as never);
    stop = svc.watchSignIn(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls(send, 'getUserProfile')).toHaveLength(1);
    // The first answers at 80 s; the tick at 90 s sends the next.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls(send, 'getUserProfile')).toHaveLength(2);
  });

  it('never stores an answer that is not a whole profile', async () => {
    // What a health check looks like; a profile shaped like it crashed the badge.
    const send = vi.fn().mockResolvedValue({ success: true, data: { service: 'plutosim-api', apiVersion: 1 } });
    const { svc, notify } = await service(send);
    const res = await svc.refreshProfile();
    expect(calls(send, 'getUserProfile')).toHaveLength(2);
    expect(res).toMatchObject({ success: false, code: 'SERVER_ERROR' });
    expect(svc.account().profile).toEqual(PROFILE);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not check while signed out', async () => {
    const send = vi.fn();
    const { svc } = await service(send, null);
    stop = svc.watchSignIn(CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHECK_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });
});
