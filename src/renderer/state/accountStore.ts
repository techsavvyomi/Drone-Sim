import { create } from 'zustand';
import type { UserProfile } from '@shared/backend/contract';
import type { AccountInfo, AccountResult } from '@shared/backend/ipc';
import { UserService } from '../services/userService';
import { usePilotStore } from './pilotStore';

// Who is flying.
//
// Mirrors the main process's account: whether profiles are on in this build,
// the signed-in user's last known profile, and whether the backend has refused
// their token. The main process pushes every change, including the refreshed
// profile after a session's result has been counted, so screens just read this.

const DEFAULT_CALLSIGN = usePilotStore.getState().callsign;

export type AccountStatus = 'loading' | 'disabled' | 'signedOut' | 'signedIn';

interface AccountState {
  status: AccountStatus;
  profile: UserProfile | null;
  needsSignIn: boolean;
  init: () => () => void;
  activate: (name: string, email: string, key: string) => Promise<AccountResult>;
  login: (email: string, key: string) => Promise<AccountResult>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

function statusOf(info: AccountInfo): AccountStatus {
  if (!info.configured) return 'disabled';
  return info.profile ? 'signedIn' : 'signedOut';
}

export const useAccountStore = create<AccountState>((set) => {
  const apply = (info: AccountInfo) => {
    set({ status: statusOf(info), profile: info.profile, needsSignIn: info.needsSignIn });
    // The pilot badge and nav card show who is signed in.
    usePilotStore.getState().setCallsign(info.profile?.name ?? DEFAULT_CALLSIGN);
  };

  return {
    status: 'loading',
    profile: null,
    needsSignIn: false,

    init: () => {
      const off = UserService.onAccountChanged(apply);
      void UserService.account()
        .then((info) => {
          apply(info);
          // Pick up points earned on another device, or while offline last time.
          if (info.configured && info.profile) void UserService.refreshProfile();
        })
        .catch(() => set({ status: 'disabled' }));
      return off;
    },

    activate: (name, email, key) => UserService.activate(name, email, key),
    login: (email, key) => UserService.login(email, key),
    signOut: () => UserService.signOut(),
    refresh: async () => {
      await UserService.refreshProfile();
    },
  };
});
