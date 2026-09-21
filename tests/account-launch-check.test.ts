import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERIFY_LIMIT_MS, useAccountStore } from '../src/renderer/state/accountStore';

// A profile taken over by another computer while this one was closed must open
// on the sign-in form, not flash the menu first. At launch the store asks the
// backend and App holds the loading screen until it answers, or for
// VERIFY_LIMIT_MS when it does not (offline).

const PROFILE = { userId: 'USR-000006', name: 'MILIND', email: 'patilmilind6454@gmail.com' };

type Api = { account: Record<string, ReturnType<typeof vi.fn>> };
const api = () => (globalThis as unknown as { window: { api: Api } }).window.api;

function signedInOnDisk(refresh: () => Promise<unknown>) {
  api().account.get = vi.fn(async () => ({
    configured: true,
    profile: PROFILE,
    needsSignIn: false,
    signInReason: null,
  }));
  api().account.refreshProfile = vi.fn(refresh);
}

let off: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  useAccountStore.setState({ status: 'loading', profile: null, needsSignIn: false, verifying: false });
});

afterEach(() => {
  off?.();
  off = undefined;
  vi.useRealTimers();
});

describe('launch sign-in check', () => {
  it('holds the loading screen until the backend answers', async () => {
    let answer!: (v: unknown) => void;
    signedInOnDisk(() => new Promise((resolve) => (answer = resolve)));
    off = useAccountStore.getState().init();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAccountStore.getState()).toMatchObject({ status: 'signedIn', verifying: true });

    answer({ success: false, code: 'AUTH_INVALID', message: 'moved' });
    await vi.advanceTimersByTimeAsync(0);
    expect(useAccountStore.getState().verifying).toBe(false);
  });

  it('opens anyway after the limit when there is no answer', async () => {
    signedInOnDisk(() => new Promise(() => {}));
    off = useAccountStore.getState().init();
    await vi.advanceTimersByTimeAsync(VERIFY_LIMIT_MS - 1);
    expect(useAccountStore.getState().verifying).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(useAccountStore.getState().verifying).toBe(false);
  });

  it('asks again when the answer is lost, and opens only on a real one', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ success: false, code: 'NETWORK', message: 'no answer' })
      .mockResolvedValueOnce({ success: false, code: 'AUTH_INVALID', message: 'moved' });
    signedInOnDisk(refresh);
    off = useAccountStore.getState().init();
    await vi.advanceTimersByTimeAsync(500);
    expect(useAccountStore.getState().verifying).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useAccountStore.getState().verifying).toBe(false);
  });

  it('does not wait for anything when nobody is signed in', async () => {
    api().account.get = vi.fn(async () => ({
      configured: true,
      profile: null,
      needsSignIn: false,
      signInReason: null,
    }));
    off = useAccountStore.getState().init();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAccountStore.getState()).toMatchObject({ status: 'signedOut', verifying: false });
    expect(api().account.refreshProfile).not.toHaveBeenCalled();
  });
});
