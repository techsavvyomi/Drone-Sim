import type {
  ApiResponse,
  UserDashboard,
  UserProfile,
} from '@shared/backend/contract';
import type { AccountInfo, AccountResult } from '@shared/backend/ipc';
import { profileBackend } from './backend';

// UserService: activation, sign-in, and the signed-in user's own profile.

/** Keys are typed from paper; forgive case, spaces and missing dashes. */
export function normaliseActivationKey(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('PLUTOSIM') ? compact.slice(8) : compact;
  if (body.length !== 8) return raw.trim().toUpperCase();
  return `PLUTO-SIM-${body.slice(0, 4)}-${body.slice(4)}`;
}

export const UserService = {
  account(): Promise<AccountInfo> {
    return profileBackend().account.get();
  },

  /** `signOutOtherDevices` after SIGNED_IN_ELSEWHERE, once the pilot has confirmed. */
  activate(
    name: string,
    email: string,
    activationKey: string,
    signOutOtherDevices = false,
  ): Promise<AccountResult> {
    return profileBackend().account.activate({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      activationKey: normaliseActivationKey(activationKey),
      signOutOtherDevices,
    });
  },

  login(email: string, activationKey: string, signOutOtherDevices = false): Promise<AccountResult> {
    return profileBackend().account.login({
      email: email.trim().toLowerCase(),
      activationKey: normaliseActivationKey(activationKey),
      signOutOtherDevices,
    });
  },

  signOut(): Promise<void> {
    return profileBackend().account.signOut();
  },

  refreshProfile(): Promise<ApiResponse<UserProfile>> {
    return profileBackend().account.refreshProfile();
  },

  dashboard(opts: { recentLimit?: number; days?: number } = {}): Promise<ApiResponse<UserDashboard>> {
    return profileBackend().account.dashboard(opts);
  },

  onAccountChanged(listener: (account: AccountInfo) => void): () => void {
    return profileBackend().account.onChanged(listener);
  },
};
