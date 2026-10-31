import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendService } from '../src/main/backend/service';
import { LocalStore } from '../src/main/backend/localStore';
import {
  CLOCK_TOLERANCE_MS,
  calendarDaysBetween,
  evaluateLicense,
  noticeFor,
  noticeText,
} from '../src/shared/backend/license';
import type { LicensePayload } from '../src/shared/backend/contract';
import { loadBackend, TEST_LICENSE_KEYS, type Backend } from './helpers/appsScript';

// Licenses in the app: the signed copy kept in SQLite, worked out offline, the
// expiry warnings, and the clock that may not be set back. The backend is the
// real Apps Script code (in Node), signing with the test key.

const DAY = 24 * 60 * 60 * 1000;
const EMAIL = 'asha@example.com';
const DEVICE_A = { deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' };
const DEVICE_B = { deviceId: 'device-bbbbbbbbbbbbbbbb', deviceName: 'Home Mac (macOS)' };
const NO_NET = { success: false as const, code: 'NETWORK' as const, message: 'Could not reach the backend' };

describe('evaluateLicense', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const lic = (over: Partial<LicensePayload> = {}): LicensePayload => ({
    v: 1,
    userId: 'USR-000001',
    email: EMAIL,
    deviceId: DEVICE_A.deviceId,
    type: 'TRIAL',
    duration: '30 days',
    activatedAt: new Date(now - DAY).toISOString(),
    expiresAt: new Date(now + 20 * DAY).toISOString(),
    status: 'ACTIVE',
    issuedAt: new Date(now - DAY).toISOString(),
    ...over,
  });

  it('is unchecked with no license, and lifetime is always running', () => {
    expect(evaluateLicense({ license: null, now, lastSeen: null, notified: null }).state).toBe('unchecked');
    const life = evaluateLicense({
      license: lic({ type: 'LIFETIME', expiresAt: null, duration: '' }),
      now: now - 30 * DAY,
      lastSeen: now,
      notified: null,
    });
    expect(life).toMatchObject({ state: 'active', daysLeft: null, notice: null });
  });

  it('counts calendar days and warns at the closest threshold, once', () => {
    const s = evaluateLicense({ license: lic(), now, lastSeen: now, notified: null });
    expect(s).toMatchObject({ state: 'active', daysLeft: 20, notice: 30 });
    expect(evaluateLicense({ license: lic(), now, lastSeen: now, notified: 30 }).notice).toBeNull();
    const later = now + 17 * DAY;
    expect(evaluateLicense({ license: lic(), now: later, lastSeen: now, notified: 30 })).toMatchObject({
      daysLeft: 3,
      notice: 3,
    });
  });

  it('warns on the expiry day, then expires at the expiry time', () => {
    const expiresAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    expect(evaluateLicense({ license: lic({ expiresAt }), now, lastSeen: now, notified: 1 })).toMatchObject({
      state: 'active',
      daysLeft: 0,
      notice: 0,
    });
    expect(
      evaluateLicense({ license: lic({ expiresAt }), now: now + 3 * 60 * 60 * 1000, lastSeen: now, notified: 0 }),
    ).toMatchObject({ state: 'expired' });
  });

  it('flags a clock set back past the tolerance, and never gives back days', () => {
    const back = evaluateLicense({ license: lic(), now: now - 2 * DAY, lastSeen: now, notified: null });
    expect(back.state).toBe('clock');
    expect(back.daysLeft).toBe(20);
    // Within the tolerance: running, but counted from the last time seen.
    const slight = evaluateLicense({
      license: lic(),
      now: now - CLOCK_TOLERANCE_MS / 2,
      lastSeen: now,
      notified: null,
    });
    expect(slight).toMatchObject({ state: 'active', daysLeft: 20 });
  });

  it('cannot be revived by setting the clock back once it is past expiry', () => {
    const lastSeen = now + 21 * DAY;
    expect(evaluateLicense({ license: lic(), now: lastSeen, lastSeen, notified: null }).state).toBe('expired');
    // Back by any amount: still expired, and only that is said (user, 2026-10-29).
    expect(
      evaluateLicense({ license: lic(), now: lastSeen - 30 * 60 * 1000, lastSeen, notified: null }).state,
    ).toBe('expired');
    expect(evaluateLicense({ license: lic(), now, lastSeen, notified: null }).state).toBe('expired');
  });

  it('trusts the server time in the license when the last-seen record is gone', () => {
    const issuedAt = new Date(now).toISOString();
    expect(
      evaluateLicense({ license: lic({ issuedAt }), now: now - 3 * DAY, lastSeen: null, notified: null }).state,
    ).toBe('clock');
  });

  it('follows the server when it says expired', () => {
    expect(evaluateLicense({ license: lic({ status: 'EXPIRED' }), now, lastSeen: now, notified: null }).state).toBe(
      'expired',
    );
  });

  it('words the warnings as the brief does', () => {
    expect(noticeFor(31)).toBeNull();
    expect(noticeFor(8)).toBe(30);
    expect(noticeFor(1)).toBe(1);
    expect(noticeText(7).text).toBe('Your license will expire in 7 days. Please renew your license.');
    expect(noticeText(1).title).toBe('License Expiring Tomorrow');
    expect(noticeText(0).title).toBe('License Expires Today');
  });
});

describe('license in the app', () => {
  let be: Backend;
  let local: LocalStore;
  let online: boolean;
  let clock: number;
  let mono: number;
  /** The shadow copy kept outside the database (shadow.ts); null = none. */
  let shadowRaw: string | null;
  let withShadow: boolean;

  function boot(device = DEVICE_A, send?: unknown) {
    const svc = new BackendService({
      configured: true,
      send: (send ??
        (async (action: string, payload: unknown, token?: string) =>
          online ? be.call(action, payload, token) : NO_NET)) as never,
      loadAccounts: async () => local.loadAccountFile(),
      saveAccounts: async (file) => local.saveAccountFile(file),
      loadOutbox: async () => null,
      saveOutbox: async () => {},
      codec: { available: () => true, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
      device: async () => device,
      notify: () => {},
      local,
      online: () => online,
      license: { publicKey: TEST_LICENSE_KEYS.publicKey, now: () => clock },
      monotonic: () => mono,
      shadow: withShadow ? { read: () => shadowRaw, write: (v) => (shadowRaw = v) } : undefined,
    });
    return svc.init().then(() => svc);
  }

  function setKeyCell(key: string, column: string, value: unknown) {
    const s = be.ss.sheet('ActivationKeys');
    const headers = s.data[0] as string[];
    const row = s.data.findIndex((r, i) => i > 0 && r[headers.indexOf('Activation Key')] === key);
    s.data[row][headers.indexOf(column)] = value;
    be.fn.resetTableCache_();
  }

  async function activated(plan: string) {
    const [key] = be.fn.generateActivationKeys(1, '', plan);
    const svc = await boot();
    const res = await svc.activate({ name: 'Asha', email: EMAIL, activationKey: key });
    expect(res.success).toBe(true);
    return { svc, key };
  }

  beforeEach(() => {
    be = loadBackend();
    be.fn.setupDatabase();
    local = LocalStore.open(':memory:');
    online = true;
    clock = Date.now();
    mono = 0;
    shadowRaw = null;
    withShadow = true;
  });

  afterEach(() => local.close());

  it('keeps a lifetime key running, even with the clock set back', async () => {
    const { svc } = await activated('lifetime');
    expect(svc.account().license).toMatchObject({ state: 'active', type: 'LIFETIME', notice: null });
    clock -= 30 * DAY;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('active');
  });

  it('runs a 7-day trial offline after a restart, warns once, and closes at expiry', async () => {
    const { svc } = await activated('7d');
    const expiresAt = Date.parse(svc.account().license!.expiresAt!);
    const daysLeft = () => calendarDaysBetween(clock, expiresAt);
    // Day 1 is today, so six more calendar days are left.
    expect(daysLeft()).toBeGreaterThanOrEqual(5);
    expect(svc.account().license).toMatchObject({ state: 'active', type: 'TRIAL', daysLeft: daysLeft(), notice: 7 });
    svc.ackLicenseNotice(7);
    expect(svc.account().license?.notice).toBeNull();

    online = false;
    const again = await boot();
    expect(again.account().license).toMatchObject({ state: 'active', notice: null });

    clock += 4 * DAY;
    again.tickLicense();
    expect(again.account().license).toMatchObject({ daysLeft: daysLeft(), notice: 3 });

    clock += 4 * DAY;
    again.tickLicense();
    expect(again.account().license?.state).toBe('expired');
  });

  it('runs a 1-hour trial, warns that it expires today, and closes after the hour', async () => {
    const { svc } = await activated('1h');
    const now = svc.account().license!;
    expect(now.state).toBe('active');
    expect(now.notice === 0 || now.notice === 1).toBe(true);
    clock += 59 * 60 * 1000;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('active');
    clock += 2 * 60 * 1000;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('expired');
  });

  it('locks when the clock goes back, and opens again when it is put right', async () => {
    const { svc } = await activated('30d');
    clock += 2 * DAY;
    svc.tickLicense();
    clock -= 5 * DAY;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('clock');
    // Back to the right time: the last time seen, two days in.
    clock += 5 * DAY;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('active');
  });

  it('keeps the last time seen sealed: editing it in the database does not help', async () => {
    // The database alone; with the copy outside it, see the next test.
    withShadow = false;
    const { svc } = await activated('30d');
    clock += 10 * DAY;
    svc.tickLicense();
    const record = JSON.parse(local.clockRecord()!);
    local.saveClockRecord(JSON.stringify({ ...record, t: record.t - 9 * DAY }));
    online = false;
    clock -= 9 * DAY;
    const again = await boot();
    // The edited record fails its seal; the server time in the license stands in.
    expect(again.account().license?.state).toBe('active');
    const expiresAt = Date.parse(again.account().license!.expiresAt!);
    expect(again.account().license?.daysLeft).toBe(calendarDaysBetween(clock, expiresAt));
  });

  it('with the copy outside the database, an edited last-seen time still catches the clock set back', async () => {
    const { svc } = await activated('30d');
    clock += 10 * DAY;
    svc.tickLicense();
    const record = JSON.parse(local.clockRecord()!);
    local.saveClockRecord(JSON.stringify({ ...record, t: record.t - 9 * DAY }));
    online = false;
    clock -= 9 * DAY;
    expect((await boot()).account().license?.state).toBe('clock');
  });

  it('a clock that ran ahead and was put right opens again with the server time', async () => {
    const { svc } = await activated('30d');
    clock += 3 * DAY;
    svc.tickLicense();
    clock -= 3 * DAY;
    svc.tickLicense();
    expect(svc.account().license?.state).toBe('clock');
    const info = await svc.checkLicense();
    expect(info.license?.state).toBe('active');
  });

  it('is unchecked with no license kept, until the profile check brings one', async () => {
    const [key] = be.fn.generateActivationKeys(1, '', '30d');
    // A backend older than licenses: no license in the answer.
    const old = async (action: string, payload: unknown, token?: string) => {
      const res = be.call(action, payload, token);
      if (res.success) delete res.data.license;
      return res;
    };
    const svc = await boot(DEVICE_A, old);
    await svc.activate({ name: 'Asha', email: EMAIL, activationKey: key });
    expect(svc.account().license?.state).toBe('unchecked');

    const fresh = await boot();
    await fresh.refreshProfile();
    expect(fresh.account().license?.state).toBe('active');
    expect(fresh.account().profile).not.toHaveProperty('license');
  });

  it('refuses a license edited in the database', async () => {
    const { svc } = await activated('7d');
    const userId = svc.account().profile!.userId;
    const kept = local.license(userId)!;
    local.saveLicense(userId, {
      payload: kept.license.payload.replace(/"expiresAt":"[^"]+"/, '"expiresAt":"2099-01-01T00:00:00.000Z"'),
      signature: kept.license.signature,
    });
    expect(svc.account().license?.state).toBe('unchecked');
  });

  it('does not trust a license signed for another computer', async () => {
    await activated('30d');
    online = false;
    const other = await boot(DEVICE_B);
    expect(other.account().license?.state).toBe('unchecked');
  });

  it('closes on a server-side expiry and opens again once the same key is renewed', async () => {
    const { svc, key } = await activated('30d');
    setKeyCell(key, 'Expiry Date', new Date(Date.now() - DAY));
    await svc.refreshProfile();
    expect(svc.account().license?.state).toBe('expired');
    be.fn.renewActivationKey(key);
    be.fn.resetTableCache_();
    const info = await svc.checkLicense();
    expect(info.license).toMatchObject({ state: 'active' });
    expect(info.license?.daysLeft).toBeGreaterThanOrEqual(29);
  });

  it('refuses sign-in with an expired key, with the server message', async () => {
    const { svc, key } = await activated('30d');
    await svc.signOut();
    setKeyCell(key, 'Expiry Date', new Date(Date.now() - DAY));
    const res = await svc.login({ email: EMAIL, activationKey: key });
    expect(res).toMatchObject({ success: false, code: 'LICENSE_EXPIRED' });
  });

  describe('offline budget', () => {
    const MIN = 60 * 1000;
    const HOUR = 60 * MIN;

    /** A 7-day key with 1 offline hour a day: a budget of at most 7 hours. */
    async function smallBudget() {
      const [key] = be.fn.generateActivationKeys(1, '', '7d');
      setKeyCell(key, 'Hours Per Day', 1);
      const svc = await boot();
      expect((await svc.activate({ name: 'Asha', email: EMAIL, activationKey: key })).success).toBe(true);
      const left = svc.account().license!.offlineLeftMs!;
      expect(left).toBeGreaterThan(5 * HOUR);
      expect(left).toBeLessThanOrEqual(7 * HOUR);
      return { svc, key, left };
    }

    /** Minutes of the window being open, a license tick each minute; the clock as given. */
    function useFor(svc: BackendService, minutes: number, clockMoves = true) {
      for (let i = 0; i < minutes; i++) {
        mono += MIN;
        if (clockMoves) clock += MIN;
        svc.tickLicense();
      }
    }

    it('asks to connect once the offline window time is used up, even with the date held still', async () => {
      const { svc, left } = await smallBudget();
      online = false;
      svc.setWindowShown(true);
      useFor(svc, Math.floor(left / MIN) - 1, false);
      expect(svc.account().license?.state).toBe('active');
      useFor(svc, 2, false);
      expect(svc.account().license).toMatchObject({ state: 'verify', offlineLeftMs: 0 });
      // Online again: a fresh license, a fresh budget.
      online = true;
      const info = await svc.checkLicense();
      expect(info.license?.state).toBe('active');
      expect(info.license?.offlineLeftMs).toBeGreaterThan(5 * HOUR);
    });

    it('counts only while the window is shown, and survives a restart', async () => {
      const { svc, left } = await smallBudget();
      online = false;
      useFor(svc, 600);
      expect(svc.account().license?.offlineLeftMs).toBe(left);
      svc.setWindowShown(true);
      useFor(svc, 60);
      svc.setWindowShown(false);
      useFor(svc, 600);
      const again = await boot();
      expect(again.account().license?.offlineLeftMs).toBe(left - HOUR);
    });

    it('a computer asleep with the window open counts at most two minutes', async () => {
      const { svc, left } = await smallBudget();
      svc.setWindowShown(true);
      mono += 8 * HOUR;
      svc.tickLicense();
      expect(svc.account().license?.offlineLeftMs).toBe(left - 2 * MIN);
    });

    it('a count edited or deleted in the database is a spent budget', async () => {
      withShadow = false;
      const { svc } = await smallBudget();
      const userId = svc.account().profile!.userId;
      const record = JSON.parse(local.usageRecord(userId)!);
      local.saveUsageRecord(userId, JSON.stringify({ ...record, usedMs: -10 * HOUR }));
      expect(svc.account().license?.state).toBe('verify');
      local.saveUsageRecord(userId, '');
      expect(svc.account().license?.state).toBe('verify');
    });

    it('with the copy outside the database, an edited count gives back nothing', async () => {
      const { svc, left } = await smallBudget();
      svc.setWindowShown(true);
      useFor(svc, 30);
      const userId = svc.account().profile!.userId;
      const record = JSON.parse(local.usageRecord(userId)!);
      local.saveUsageRecord(userId, JSON.stringify({ ...record, usedMs: 0 }));
      expect(svc.account().license?.offlineLeftMs).toBe(left - 30 * MIN);
    });

    it('says expired, not "connect", once the license has run out', async () => {
      const { svc } = await smallBudget();
      online = false;
      svc.setWindowShown(true);
      useFor(svc, 8 * DAY / MIN / 8, false);
      clock += 8 * DAY;
      svc.tickLicense();
      expect(svc.account().license?.state).toBe('expired');
    });

    it('a lifetime key has no offline limit', async () => {
      const { svc } = await activated('lifetime');
      online = false;
      svc.setWindowShown(true);
      useFor(svc, 30 * 60);
      expect(svc.account().license).toMatchObject({ state: 'active', offlineLeftMs: null });
    });

    it('reports offline window time to the Usage sheet when online again', async () => {
      const { svc, key } = await smallBudget();
      online = false;
      svc.setWindowShown(true);
      useFor(svc, 45);
      svc.setWindowShown(false);
      online = true;
      await svc.refreshProfile();
      const rows = be.ss.sheet('Usage').objects();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ Minutes: 45, 'Activation Key': key });
      const keyRow = be.ss.sheet('ActivationKeys').objects().find((r) => r['Activation Key'] === key)!;
      expect(keyRow['Used Hours']).toBe(0.75);
      // The test's clock ran 45 minutes ahead of the backend's real one.
      expect(keyRow['Clock Skew (min)']).toBe(45);
      // Nothing new and not long after: no second report.
      await svc.refreshProfile();
      expect(be.ss.sheet('Usage').objects()).toHaveLength(1);
    });
  });

  describe('a database put back from a backup', () => {
    const MIN = 60 * 1000;

    async function spentOffline() {
      const [key] = be.fn.generateActivationKeys(1, '', '7d');
      setKeyCell(key, 'Hours Per Day', 1);
      const svc = await boot();
      await svc.activate({ name: 'Asha', email: EMAIL, activationKey: key });
      const userId = svc.account().profile!.userId;
      const backup = {
        license: local.license(userId)!.license,
        usage: local.usageRecord(userId)!,
        clock: local.clockRecord()!,
        total: local.totalRecord(userId),
      };
      online = false;
      svc.setWindowShown(true);
      while (svc.account().license?.state === 'active') {
        mono += MIN;
        svc.tickLicense();
      }
      expect(svc.account().license?.state).toBe('verify');
      return { key, userId, backup };
    }

    function putBack(userId: string, b: Awaited<ReturnType<typeof spentOffline>>['backup']) {
      local.saveLicense(userId, b.license);
      local.saveUsageRecord(userId, b.usage);
      local.saveClockRecord(b.clock);
      if (b.total) local.saveTotalRecord(userId, b.total);
    }

    it('brings back no offline time: the copy outside the database still counts', async () => {
      const { userId, backup } = await spentOffline();
      putBack(userId, backup);
      const again = await boot();
      expect(again.account().license?.state).toBe('verify');
    });

    it('without that copy, the old count would have come back (what it guards against)', async () => {
      withShadow = false;
      const { userId, backup } = await spentOffline();
      putBack(userId, backup);
      const again = await boot();
      expect(again.account().license?.state).toBe('active');
    });

    it('a license older than one already seen needs a check-in', async () => {
      const { svc } = await activated('7d');
      const userId = svc.account().profile!.userId;
      const old = { license: local.license(userId)!.license, usage: local.usageRecord(userId)! };
      clock += 60 * MIN;
      await new Promise((r) => setTimeout(r, 5));
      await svc.refreshProfile();
      expect(local.license(userId)!.license.payload).not.toBe(old.license.payload);
      online = false;
      local.saveLicense(userId, old.license);
      local.saveUsageRecord(userId, old.usage);
      expect((await boot()).account().license?.state).toBe('verify');
    });

    it('deleting the copy outside the database needs a check-in, which clears it', async () => {
      const { svc } = await activated('7d');
      expect(shadowRaw).not.toBeNull();
      shadowRaw = null;
      online = false;
      const again = await boot();
      expect(again.account().license?.state).toBe('verify');
      online = true;
      expect((await again.checkLicense()).license?.state).toBe('active');
      void svc;
    });

    it('the backend keeps the highest running total and counts a put-back database', async () => {
      const { svc, key } = await activated('7d');
      const userId = svc.account().profile!.userId;
      const emptyTotal = local.totalRecord(userId);
      svc.setWindowShown(true);
      for (let i = 0; i < 30; i++) {
        mono += MIN;
        svc.tickLicense();
      }
      await svc.refreshProfile();
      const row = () => be.ss.sheet('ActivationKeys').objects().find((r) => r['Activation Key'] === key)!;
      expect(row()['Usage Counter (min)']).toBe(30);

      // An old database, and no copy outside it (an install from before it existed).
      withShadow = false;
      if (emptyTotal) local.saveTotalRecord(userId, emptyTotal);
      else local.saveTotalRecord(userId, '');
      const again = await boot();
      await again.refreshProfile();
      expect(row()).toMatchObject({ 'Restore Count': 1, 'Usage Counter (min)': 30 });
      expect(local.restorePending(userId)).toBe(false);
    });
  });
});
