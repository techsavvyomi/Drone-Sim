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
  /** `remember`: "Remember me on this computer", so the next sign-in here needs only the email. */
  activate(
    name: string,
    email: string,
    activationKey: string,
    signOutOtherDevices = false,
    remember = true,
  ): Promise<AccountResult> {
    return profileBackend().account.activate({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      activationKey: normaliseActivationKey(activationKey),
      signOutOtherDevices,
      remember,
    });
  },

  login(
    email: string,
    activationKey: string,
    signOutOtherDevices = false,
    remember = true,
  ): Promise<AccountResult> {
    return profileBackend().account.login({
      email: email.trim().toLowerCase(),
      activationKey: normaliseActivationKey(activationKey),
      signOutOtherDevices,
      remember,
    });
  },

  hasSavedKey(email: string): Promise<boolean> {
    return profileBackend().account.hasSavedKey(email.trim().toLowerCase());
  },

  /** Sign in with the key this computer kept: the email alone. */
  loginSaved(email: string, signOutOtherDevices = false): Promise<AccountResult> {
    return profileBackend().account.loginSaved({
      email: email.trim().toLowerCase(),
      signOutOtherDevices,
    });
  },

  signOut(forget = false): Promise<void> {
    return profileBackend().account.signOut({ forget });
  },

  refreshProfile(): Promise<ApiResponse<UserProfile>> {
    return profileBackend().account.refreshProfile();
  },

  dashboard(opts: { recentLimit?: number; days?: number } = {}): Promise<ApiResponse<UserDashboard>> {
    return profileBackend().account.dashboard(opts);
  },

  ackLicenseNotice(day: number): Promise<void> {
    return profileBackend().account.ackLicenseNotice(day);
  },

  checkLicense(): Promise<AccountInfo> {
    return profileBackend().account.checkLicense();
  },

  onAccountChanged(listener: (account: AccountInfo) => void): () => void {
    return profileBackend().account.onChanged(listener);
  },
};
