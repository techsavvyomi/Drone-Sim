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

const IST = (5 * 60 + 30) * 60 * 1000;

/** 23:59:59 IST on the last day of `days` days that start on `start`'s IST day. */
function endOfIstDay(start: number, days: number) {
  const ist = new Date(start + IST);
  const day1 = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return day1 + days * DAY - IST - 1000;
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
    // The activation day is day 1; the 7th day runs to 23:59:59 India time.
    expect(expires).toBe(endOfIstDay(activated, 7));
    expect(new Date(expires + IST).toISOString().slice(11, 19)).toBe('23:59:59');
    expect(activated).toBeGreaterThanOrEqual(before);
    // A Date from the script's own realm, so not `instanceof` this one's.
    expect(Object.prototype.toString.call(keyRow(key)['Expiry Date'])).toBe('[object Date]');
  });

  it('gives an annual key exactly one calendar year, and six months for 6m', () => {
    const [year] = be.fn.generateActivationKeys(1, '', '1y');
    const lic = verified(activate(year).data.license);
    const a = new Date(lic.activatedAt);
    const e = new Date(lic.expiresAt);
    // A year from the activation day, ending the day before at 23:59:59 IST.
    const aIst = new Date(a.getTime() + IST);
    const eIst = new Date(e.getTime() + 1000 + IST);
    expect(eIst.getUTCFullYear()).toBe(aIst.getUTCFullYear() + 1);
    expect(eIst.getUTCMonth()).toBe(aIst.getUTCMonth());
    expect(eIst.getUTCDate()).toBe(aIst.getUTCDate());
    expect(eIst.toISOString().slice(11, 19)).toBe('00:00:00');

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

  it('gives a one-day trial the rest of its activation day, India time', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '1d');
    expect(keyRow(key)).toMatchObject({ 'License Type': 'TRIAL', Duration: '1 day' });
    const lic = verified(activate(key).data.license);
    expect(Date.parse(lic.expiresAt)).toBe(endOfIstDay(Date.parse(lic.activatedAt), 1));
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
    expect(expiry.getTime()).toBe(endOfIstDay(before, 30));
    const login = be.call('loginUser', { ...DEVICE, email: 'asha@example.com', activationKey: key });
    expect(login.success).toBe(true);
    expect(verified(login.data.license)).toMatchObject({ status: 'ACTIVE', expiresAt: expiry.toISOString() });
  });

  it('renews a key that has not run out from its expiry, not from today', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    const first = Date.parse(verified(activate(key).data.license).expiresAt);
    const renewed: Date = be.fn.renewActivationKey(key);
    // Seven more whole days, still ending at 23:59:59 IST.
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

describe('offline budget', () => {
  const HOUR = 60 * 60 * 1000;

  it('gives 8 hours for each day left, written on the key, never more than the time left', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    expect(keyRow(key)['Hours Per Day']).toBe(8);
    const lic = verified(activate(key).data.license);
    expect(lic.hoursPerDay).toBe(8);
    const left = Date.parse(lic.expiresAt) - Date.parse(lic.issuedAt);
    expect(lic.offlineBudgetMs).toBe(Math.min(Math.ceil(left / DAY) * 8 * HOUR, left));
    expect(lic.offlineBudgetMs).toBeGreaterThan(48 * HOUR);
    expect(lic.offlineBudgetMs).toBeLessThanOrEqual(56 * HOUR);
  });

  it('takes Hours Per Day from the key when it is changed there', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '14d');
    setKeyCell(key, 'Hours Per Day', 12);
    const lic = verified(activate(key).data.license);
    expect(lic.hoursPerDay).toBe(12);
    expect(lic.offlineBudgetMs).toBeGreaterThan(13 * 12 * HOUR);
  });

  it('gives a one-day key what is left of the day, at most 8 hours', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '1d');
    const lic = verified(activate(key).data.license);
    const left = Date.parse(lic.expiresAt) - Date.parse(lic.issuedAt);
    expect(lic.offlineBudgetMs).toBe(Math.min(8 * HOUR, left));
  });

  it('caps a long key at 90 days of use per check-in', () => {
    const [key] = be.fn.generateActivationKeys(1, '', '1y');
    expect(verified(activate(key).data.license).offlineBudgetMs).toBe(90 * 8 * HOUR);
  });

  it('gives a lifetime key no limit, and an expired one nothing', () => {
    const [life] = be.fn.generateActivationKeys(1);
    expect(verified(activate(life).data.license)).toMatchObject({ offlineBudgetMs: null, hoursPerDay: null });
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    const res = activate(key, 'ravi@example.com');
    setKeyCell(key, 'Expiry Date', new Date(Date.now() - DAY));
    be.fn.resetTableCache_();
    const again = be.call('getUserProfile', { userId: res.data.userId }, res.data.authToken);
    expect(verified(again.data.license).offlineBudgetMs).toBe(0);
  });
});

describe('usage reports', () => {
  function signedIn() {
    const [key] = be.fn.generateActivationKeys(1, '', '7d');
    const res = activate(key);
    return { key, token: res.data.authToken as string, userId: res.data.userId as string };
  }
  const row = (id: string, minutes: number, extra = {}) => ({
    id,
    minutes,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    offline: false,
    ...extra,
  });

  it('adds a stretch once, updates it as it grows, and totals the key', () => {
    const { key, token, userId } = signedIn();
    const first = be.call(
      'reportUsage',
      { userId, clientTime: new Date().toISOString(), usage: [row('use-aaaaaaaa', 30), row('use-bbbbbbbb', 45, { offline: true })] },
      token,
    );
    expect(first).toMatchObject({ success: true, data: { received: 2 } });
    be.call('reportUsage', { userId, clientTime: new Date().toISOString(), usage: [row('use-aaaaaaaa', 75)] }, token);
    const rows = be.ss.sheet('Usage').objects();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r['Usage ID'] === 'use-aaaaaaaa')).toMatchObject({ Minutes: 75, 'Activation Key': key });
    expect(rows.find((r) => r['Usage ID'] === 'use-bbbbbbbb')).toBeDefined();
    expect(rows[0]).not.toHaveProperty('Offline');
    expect(keyRow(key)['Used Hours']).toBe(2);
    expect(Object.prototype.toString.call(keyRow(key)['Last Online'])).toBe('[object Date]');
    expect(keyRow(key)['Clock Skew (min)']).toBe(0);
  });

  it('notes a clock set back, and keeps no count of it', () => {
    const { key, token, userId } = signedIn();
    const back = new Date(Date.now() - 2 * DAY).toISOString();
    be.call('reportUsage', { userId, clientTime: back }, token);
    expect(keyRow(key)['Clock Skew (min)']).toBe(-2880);
    expect(keyRow(key)).not.toHaveProperty('Rollback Count');
  });

  it('keeps the highest running total, hands it back in the license, and counts a put-back database', () => {
    const { key, token, userId } = signedIn();
    const at = new Date().toISOString();
    be.call('reportUsage', { userId, clientTime: at, totalMinutes: 120 }, token);
    expect(keyRow(key)).toMatchObject({ 'Usage Counter (min)': 120 });
    expect(keyRow(key)['Restore Count']).toBe('');
    const profile = be.call('getUserProfile', { userId }, token);
    expect(verified(profile.data.license).usageFloorMin).toBe(120);
    // Lower than before: its local data was put back. Stays at the highest.
    be.call('reportUsage', { userId, clientTime: at, totalMinutes: 40 }, token);
    expect(keyRow(key)).toMatchObject({ 'Usage Counter (min)': 120, 'Restore Count': 1 });
    // The app found it itself and raised its total to the floor.
    be.call('reportUsage', { userId, clientTime: at, totalMinutes: 125, restored: true }, token);
    expect(keyRow(key)).toMatchObject({ 'Usage Counter (min)': 125, 'Restore Count': 2 });
    // A few minutes' slack for an answer lost on the way.
    be.call('reportUsage', { userId, clientTime: at, totalMinutes: 122 }, token);
    expect(keyRow(key)['Restore Count']).toBe(2);
  });

  it('refuses another pilot, a bad id and an impossible length', () => {
    const { token, userId } = signedIn();
    expect(be.call('reportUsage', { userId: 'USR-999999', usage: [] }, token)).toMatchObject({ code: 'FORBIDDEN' });
    expect(be.call('reportUsage', { userId, usage: [row('x', 5)] }, token)).toMatchObject({ code: 'VALIDATION' });
    expect(be.call('reportUsage', { userId, usage: [row('use-cccccccc', 5000)] }, token)).toMatchObject({ code: 'VALIDATION' });
    expect(be.call('reportUsage', { userId, usage: [] })).toMatchObject({ success: false });
  });
});
