import { createVerify } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadBackend, TEST_LICENSE_KEYS, type Backend } from './helpers/appsScript';

// Licenses on the Apps Script side: what a key buys, when it runs out, and the
// signed copy the app checks offline.

let be: Backend;
const DEVICE = { deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  be = loadBackend();
  be.fn.setupDatabase();
});

function keyRow(key: string) {
  return be.ss.sheet('ActivationKeys').objects().find((r) => r['Activation Key'] === key)!;
}

function setKeyCell(key: string, column: string, value: unknown) {
  const s = be.ss.sheet('ActivationKeys');
  const headers = s.data[0] as string[];
  const row = s.data.findIndex((r, i) => i > 0 && r[headers.indexOf('Activation Key')] === key);
  s.data[row][headers.indexOf(column)] = value;
}

function activate(key: string, email = 'asha@example.com') {
  return be.call('activateUser', { ...DEVICE, name: 'Asha', email, activationKey: key });
}

function verified(license: { payload: string; signature: string }) {
  const ok = createVerify('RSA-SHA256')
    .update(license.payload, 'utf8')
    .verify(TEST_LICENSE_KEYS.publicKey, license.signature, 'base64');
  return ok ? JSON.parse(license.payload) : null;
}

describe('license on activation', () => {
  it('keeps a key issued before licenses lifetime', () => {
    const [key] = be.fn.generateActivationKeys(1);
    setKeyCell(key, 'License Type', '');
    const res = activate(key);
    expect(res.success).toBe(true);
    const lic = verified(res.data.license);
    expect(lic).toMatchObject({ type: 'LIFETIME', expiresAt: null, status: 'ACTIVE', deviceId: DEVICE.deviceId });
    expect(lic.userId).toBe(res.data.userId);
    expect(keyRow(key)['Expiry Date']).toBe('');
  });

  it('starts a trial at the first activation, on the server clock', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    expect(keyRow(key)).toMatchObject({ 'License Type': 'TRIAL', Duration: '7 days' });
    const before = Date.now();
    const lic = verified(activate(key).data.license);
    expect(lic.type).toBe('TRIAL');
    const expires = Date.parse(lic.expiresAt);
    const activated = Date.parse(lic.activatedAt);
    expect(expires - activated).toBe(7 * DAY);
    expect(activated).toBeGreaterThanOrEqual(before);
    // A Date from the script's own realm, so not `instanceof` this one's.
    expect(Object.prototype.toString.call(keyRow(key)['Expiry Date'])).toBe('[object Date]');
  });

  it('gives an annual key exactly one calendar year, and six months for 6m', () => {
    const [year] = be.fn.generateActivationKeys(1, '', '1y');
    const lic = verified(activate(year).data.license);
    const a = new Date(lic.activatedAt);
    const e = new Date(lic.expiresAt);
    expect(e.getUTCFullYear()).toBe(a.getUTCFullYear() + 1);
    expect(e.getUTCMonth()).toBe(a.getUTCMonth());
    expect(e.getUTCHours()).toBe(a.getUTCHours());

    const [half] = be.fn.generateActivationKeys(1, '', '6m');
    const six = verified(activate(half, 'ravi@example.com').data.license);
    const months =
      (new Date(six.expiresAt).getUTCFullYear() - new Date(six.activatedAt).getUTCFullYear()) * 12 +
      new Date(six.expiresAt).getUTCMonth() -
      new Date(six.activatedAt).getUTCMonth();
    expect(months).toBe(6);
    expect(six.type).toBe('ANNUAL');
  });

  it('gives a one-hour trial exactly 60 minutes, and renews by an hour', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '1h');
    expect(keyRow(key)).toMatchObject({ 'License Type': 'TRIAL', Duration: '1 hour' });
    const lic = verified(activate(key).data.license);
    const first = Date.parse(lic.expiresAt);
    expect(first - Date.parse(lic.activatedAt)).toBe(60 * 60 * 1000);
    expect((be.fn.renewActivationKey(key) as Date).getTime()).toBe(first + 60 * 60 * 1000);
  });

  it('gives a one-day trial exactly 24 hours', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '1d');
    expect(keyRow(key)).toMatchObject({ 'License Type': 'TRIAL', Duration: '1 day' });
    const lic = verified(activate(key).data.license);
    expect(Date.parse(lic.expiresAt) - Date.parse(lic.activatedAt)).toBe(DAY);
  });

  it('refuses a timed key whose duration cannot be read, and leaves it unused', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '14d');
    setKeyCell(key, 'Duration', 'two weeks');
    const res = activate(key);
    expect(res).toMatchObject({ success: false, code: 'KEY_DISABLED' });
    expect(keyRow(key).Status).toBe('AVAILABLE');
  });

  it('rejects an unknown plan name', () => {
    expect(() => be.fn.generateActivationKeys(1, '', '2w')).toThrow(/Unknown license/);
  });
});

describe('expiry and renewal', () => {
  function expired() {
    const [key] = be.fn.generateActivationKeys(1, '', '30d');
    const res = activate(key);
    setKeyCell(key, 'Expiry Date', new Date(Date.now() - DAY));
    be.fn.resetTableCache_();
    return { key, token: res.data.authToken as string, userId: res.data.userId as string };
  }

  it('refuses sign-in and re-activation once the key has expired', () => {
    const { key } = expired();
    const login = be.call('loginUser', { ...DEVICE, email: 'asha@example.com', activationKey: key });
    expect(login).toMatchObject({ success: false, code: 'LICENSE_EXPIRED' });
    expect(typeof login.expiresAt).toBe('string');
    expect(activate(key)).toMatchObject({ success: false, code: 'LICENSE_EXPIRED' });
  });

  it('still answers the profile check, with the expired license, so the app can close', () => {
    const { token, userId } = expired();
    const res = be.call('getUserProfile', { userId }, token);
    expect(res.success).toBe(true);
    expect(verified(res.data.license)).toMatchObject({ status: 'EXPIRED' });
  });

  it('renews the same key from now when it has run out, and it signs in again', () => {
    const { key } = expired();
    const before = Date.now();
    const expiry: Date = be.fn.renewActivationKey(key);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    const login = be.call('loginUser', { ...DEVICE, email: 'asha@example.com', activationKey: key });
    expect(login.success).toBe(true);
    expect(verified(login.data.license)).toMatchObject({ status: 'ACTIVE', expiresAt: expiry.toISOString() });
  });

  it('renews a key that has not run out from its expiry, not from today', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    const first = Date.parse(verified(activate(key).data.license).expiresAt);
    const renewed: Date = be.fn.renewActivationKey(key);
    expect(renewed.getTime()).toBe(first + 7 * DAY);
  });

  it('will not renew a lifetime key', () => {
    const [key] = be.fn.generateActivationKeys(1);
    expect(() => be.fn.renewActivationKey(key)).toThrow(/lifetime/);
  });
});

describe('signature', () => {
  it('breaks when the payload is edited', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    const { license } = activate(key).data;
    const edited = license.payload.replace(/"expiresAt":"[^"]+"/, '"expiresAt":"2099-01-01T00:00:00.000Z"');
    expect(edited).not.toBe(license.payload);
    expect(verified({ payload: edited, signature: license.signature })).toBeNull();
  });

  it('goes out unsigned without LICENSE_PRIVATE_KEY, and setup says so', () => {
    be = loadBackend({ properties: {} });
    expect(be.fn.setupDatabase()).toMatch(/LICENSE_PRIVATE_KEY is not set/);
    const [key] = be.fn.generateActivationKeys(1);
    expect(activate(key).data.license.signature).toBe('');
  });
});
