import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '../src/shared/backend/ipc';
import { useAccountStore } from '../src/renderer/state/accountStore';
import { useUiStore } from '../src/renderer/state/uiStore';

// Signing out from Profile and back in (online or offline) used to land on
// Profile again: the app kept the page the last pilot left from. A sign-in now
// opens on Home; a profile update while signed in leaves the page alone.

const PROFILE = { userId: 'USR-000005', name: 'Devendra Mishra', email: 'd@example.com' };
const info = (signedIn: boolean, needsSignIn = false): AccountInfo =>
  ({
    configured: true,
    profile: signedIn ? PROFILE : null,
    needsSignIn,
    signInReason: null,
  }) as AccountInfo;

let push: (a: AccountInfo) => void = () => {};
let off: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      account: {
        get: vi.fn(async () => info(false)),
        refreshProfile: vi.fn(async () => ({ success: true })),
        onChanged: (fn: (a: AccountInfo) => void) => {
          push = fn;
          return () => {};
        },
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  useAccountStore.setState({
    status: 'loading',
    profile: null,
    needsSignIn: false,
    verifying: false,
  });
  useUiStore.setState({ section: 'home' });
});

afterEach(() => {
  off?.();
  vi.unstubAllGlobals();
});

describe('after a sign-in', () => {
  it('opens Home, not the page the pilot signed out from', async () => {
    off = useAccountStore.getState().init();
    await Promise.resolve();
    await Promise.resolve();
    expect(useAccountStore.getState().status).toBe('signedOut');
    useUiStore.setState({ section: 'profile' });
    push(info(true));
    expect(useUiStore.getState().section).toBe('home');
  });

  it('also after signing in again when the profile was taken over', async () => {
    off = useAccountStore.getState().init();
    await Promise.resolve();
    push(info(true));
    useUiStore.setState({ section: 'profile' });
    push(info(true, true));
    push(info(true));
    expect(useUiStore.getState().section).toBe('home');
  });

  it('leaves the page alone when the profile only changes', async () => {
    off = useAccountStore.getState().init();
    await Promise.resolve();
    push(info(true));
    useUiStore.setState({ section: 'profile' });
    push(info(true));
    expect(useUiStore.getState().section).toBe('profile');
  });
});
