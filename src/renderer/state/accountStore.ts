import { create } from 'zustand';
import type { UserProfile } from '@shared/backend/contract';
import type { AccountInfo, AccountResult } from '@shared/backend/ipc';
import type { LicenseStatus } from '@shared/backend/license';
import { UserService } from '../services/userService';
import { usePilotStore } from './pilotStore';
import { syncProgress } from './progressSync';
import { useUiStore } from './uiStore';

// Who is flying.
//
// Mirrors the main process's account: whether profiles are on in this build,
// the signed-in user's last known profile, and whether the backend has refused
// their token. The main process pushes every change, including the refreshed
// profile after a session's result has been counted, so screens just read this.

const DEFAULT_CALLSIGN = usePilotStore.getState().callsign;

/**
 * How long a launch keeps asking the backend whether this computer is still the
 * one signed in. The menu must not open on a profile another computer has
 * taken, so an answer that is lost (each ask already tries twice, 10 s apiece)
 * is asked again until this runs out. With no connection at all the asks fail
 * at once and the menu opens straight away; a later answer still signs out.
 */
export const VERIFY_LIMIT_MS = 60_000;

export type AccountStatus = 'loading' | 'disabled' | 'signedOut' | 'signedIn';

interface AccountState {
  status: AccountStatus;
  profile: UserProfile | null;
  needsSignIn: boolean;
  /** Why the backend signed this computer out, when it said. */
  signInReason: string | null;
  /**
   * At launch, asking the backend whether this computer is still the one
   * signed in. App holds the loading screen meanwhile, so a profile taken over
   * by another computer goes straight to the sign-in form, never the menu.
   */
  verifying: boolean;
  /** The signed-in pilot's license, worked out offline in the main process. */
  license: LicenseStatus | null;
  init: () => () => void;
  activate: (
    name: string,
    email: string,
    key: string,
    signOutOtherDevices?: boolean,
    remember?: boolean,
  ) => Promise<AccountResult>;
  login: (
    email: string,
    key: string,
    signOutOtherDevices?: boolean,
    remember?: boolean,
  ) => Promise<AccountResult>;
  /** Email-only sign-in with the key this computer kept. */
  loginSaved: (email: string, signOutOtherDevices?: boolean) => Promise<AccountResult>;
  hasSavedKey: (email: string) => Promise<boolean>;
  /** `forget`: also remove this pilot's offline sign-in and flight log here. */
  signOut: (forget?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  ackLicenseNotice: (day: number) => Promise<void>;
  checkLicense: () => Promise<void>;
}

function statusOf(info: AccountInfo): AccountStatus {
  if (!info.configured) return 'disabled';
  return info.profile ? 'signedIn' : 'signedOut';
}

export const useAccountStore = create<AccountState>((set, get) => {
  const apply = (info: AccountInfo) => {
    const before = get();
    const wasOut =
      before.status === 'signedOut' || (before.status === 'signedIn' && before.needsSignIn);
    const nowIn = statusOf(info) === 'signedIn' && !info.needsSignIn;
    // A sign-in opens on Home, not on whatever page the last pilot signed out from.
    if (wasOut && nowIn) {
      useUiStore.getState().setSection('home');
      void syncProgress();
    }
    set({
      status: statusOf(info),
      profile: info.profile,
      needsSignIn: info.needsSignIn,
      signInReason: info.signInReason ?? null,
      license: info.license ?? null,
    });
    // The pilot badge and nav card show who is signed in.
    usePilotStore.getState().setCallsign(info.profile?.name ?? DEFAULT_CALLSIGN);
  };

  return {
    status: 'loading',
    profile: null,
    needsSignIn: false,
    signInReason: null,
    verifying: false,
    license: null,

    init: () => {
      const off = UserService.onAccountChanged(apply);
      void UserService.account()
        .then((info) => {
          const verify = info.configured && !!info.profile;
          // Set with the account, so no frame shows the menu before the check.
          set({ verifying: verify });
          apply(info);
          if (!verify) return;
          // Also picks up points earned on another device, or while offline last time.
          const started = Date.now();
          const ask = async (): Promise<void> => {
            const res = await UserService.refreshProfile().catch(() => null);
            const lost =
              !res || (!res.success && (res.code === 'NETWORK' || res.code === 'SERVER_ERROR'));
            const online = typeof navigator === 'undefined' || navigator.onLine !== false;
            if (lost && online && Date.now() - started < VERIFY_LIMIT_MS) {
              await new Promise((r) => setTimeout(r, 1000));
              return ask();
            }
          };
          const done = () => set({ verifying: false });
          const limit = setTimeout(done, VERIFY_LIMIT_MS);
          void ask().then(() => {
            clearTimeout(limit);
            done();
            void syncProgress();
          });
        })
        .catch(() => set({ status: 'disabled' }));

      // A computer that was offline when another took its profile finds out as
      // soon as it is back, not at the next 30 s check.
      const onOnline = () => {
        const { status, needsSignIn } = useAccountStore.getState();
        if (status === 'signedIn' && !needsSignIn) {
          void UserService.refreshProfile().catch(() => undefined);
          void syncProgress();
        }
      };
      window.addEventListener('online', onOnline);
      return () => {
        off();
        window.removeEventListener('online', onOnline);
      };
    },

    activate: (name, email, key, signOutOtherDevices, remember) =>
      UserService.activate(name, email, key, signOutOtherDevices, remember),
    login: (email, key, signOutOtherDevices, remember) =>
      UserService.login(email, key, signOutOtherDevices, remember),
    loginSaved: (email, signOutOtherDevices) => UserService.loginSaved(email, signOutOtherDevices),
    hasSavedKey: (email) => UserService.hasSavedKey(email),
    signOut: (forget) => UserService.signOut(forget),
    refresh: async () => {
      await UserService.refreshProfile();
    },
    ackLicenseNotice: (day) => UserService.ackLicenseNotice(day),
    checkLicense: async () => {
      apply(await UserService.checkLicense());
    },
  };
});
