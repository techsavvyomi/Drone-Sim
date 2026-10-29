// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LicenseLock, LicenseNotice } from '../src/renderer/app/LicenseScreens';
import { useAccountStore } from '../src/renderer/state/accountStore';
import type { LicenseStatus } from '../src/shared/backend/license';

// The license's lock screen and expiry warning, as the pilot sees them.

let root: Root;
let host: HTMLDivElement;

const status = (over: Partial<LicenseStatus>): LicenseStatus => ({
  state: 'active',
  type: 'TRIAL',
  expiresAt: '2026-11-02T10:00:00.000Z',
  daysLeft: 7,
  notice: null,
  offlineLeftMs: null,
  ...over,
});

function render(el: ReturnType<typeof h>) {
  act(() => root.render(el));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useAccountStore.setState({ license: null });
});

describe('LicenseLock', () => {
  it('shows the brief words for an expired license, with Check again and Sign out', () => {
    useAccountStore.setState({ license: status({ state: 'expired', daysLeft: 0 }) });
    render(h(LicenseLock));
    expect(host.textContent).toContain('License Expired');
    expect(host.textContent).toContain(
      'Your license has expired. Please activate a valid license to continue playing.',
    );
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Check again', 'Sign out']));
  });

  it('asks for the date and time to be corrected when the clock went back', () => {
    useAccountStore.setState({ license: status({ state: 'clock' }) });
    render(h(LicenseLock));
    expect(host.textContent).toContain('System Date and Time Incorrect');
    expect(host.textContent).toContain('Please check and correct your computer');
  });

  it('asks to connect to the internet when the offline time is used up', () => {
    useAccountStore.setState({ license: status({ state: 'verify', offlineLeftMs: 0 }) });
    render(h(LicenseLock));
    expect(host.textContent).toContain('Connect to the Internet');
    expect(host.textContent).toContain('connect to the internet so your license can be verified');
  });

  it('Check again asks the main process to check the license', async () => {
    const checkLicense = vi.fn(async () => undefined);
    useAccountStore.setState({ license: status({ state: 'unchecked' }), checkLicense });
    render(h(LicenseLock));
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!;
    await act(async () => btn.click());
    expect(checkLicense).toHaveBeenCalledOnce();
  });

  it('shows nothing while the license runs', () => {
    useAccountStore.setState({ license: status({}) });
    render(h(LicenseLock));
    expect(host.textContent).toBe('');
  });
});

describe('LicenseNotice', () => {
  it('warns with the days left and is closed with OK, for that threshold', async () => {
    const ackLicenseNotice = vi.fn(async () => undefined);
    useAccountStore.setState({ license: status({ notice: 7, daysLeft: 7 }), ackLicenseNotice });
    render(h(LicenseNotice));
    expect(host.textContent).toContain('License Expiring Soon');
    expect(host.textContent).toContain('Your license will expire in 7 days. Please renew your license.');
    const ok = [...host.querySelectorAll('button')].find((b) => b.textContent === 'OK')!;
    await act(async () => ok.click());
    expect(ackLicenseNotice).toHaveBeenCalledWith(7);
  });

  it('says tomorrow on the last day but one, and nothing with no notice due', () => {
    useAccountStore.setState({ license: status({ notice: 1, daysLeft: 1 }) });
    render(h(LicenseNotice));
    expect(host.textContent).toContain('License Expiring Tomorrow');
    useAccountStore.setState({ license: status({ notice: null }) });
    render(h(LicenseNotice));
    expect(host.textContent).toBe('');
  });
});
