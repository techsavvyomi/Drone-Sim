// Licenses: how long an activation key lets its pilot fly, and the signed copy
// the simulator checks with no internet.
//
// A key is TRIAL, ANNUAL or LIFETIME (`License Type` in ActivationKeys; blank is
// LIFETIME, so every key issued before licenses existed stays lifetime). Its
// `Duration` ("7 days", "6 months", "1 year") starts at the key's first
// activation, on the server's clock, and `Expiry Date` is written then. The
// activation day counts as day 1 and the last day runs to 23:59:59 India time
// (a 7-day key activated on 30 Oct runs to the end of 5 Nov); an hour plan is
// exact. Renewing moves `Expiry Date` forward on the same key ("Renew a key…").
//
// Offline the app cannot know the real date, so each license also carries an
// offline budget: Hours Per Day × the days left (at most OFFLINE_MAX_DAYS), and
// never more than the time left. The app counts its open-window time on its own
// timer, and once the budget is spent offline it asks to be connected. Every
// online check hands out a fresh budget; usage reports land in the Usage sheet.
//
// Activation, login and every profile check return the license as a JSON
// payload signed RSA-SHA256 with the `LICENSE_PRIVATE_KEY` Script Property. The
// app holds only the public key: it can check a license, never make one, and a
// date edited on the computer breaks the signature.

const LICENSE_TYPES_ = ['TRIAL', 'ANNUAL', 'LIFETIME'];
const DURATION_RE_ = /^(\d{1,3})\s*(hour|hours|day|days|month|months|year|years)$/i;
/** Hours and days are fixed lengths; months and years follow the calendar. */
const FIXED_MS_ = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
/** Day-based licenses end on India's calendar, whatever zone the computer is set to. */
const IST_OFFSET_MS_ = (5 * 60 + 30) * 60 * 1000;

/**
 * What the key-generation prompt offers: trial 1/7/14/30 days, annual 6 months
 * or a year, lifetime, and a 1-hour trial for checking the whole flow quickly.
 */
const LICENSE_PLANS_ = {
  '1h': { type: 'TRIAL', duration: '1 hour' },
  '1d': { type: 'TRIAL', duration: '1 day' },
  '7d': { type: 'TRIAL', duration: '7 days' },
  '14d': { type: 'TRIAL', duration: '14 days' },
  '30d': { type: 'TRIAL', duration: '30 days' },
  '6m': { type: 'ANNUAL', duration: '6 months' },
  '1y': { type: 'ANNUAL', duration: '1 year' },
  lifetime: { type: 'LIFETIME', duration: '' },
};

function licensePlan_(name) {
  const plan = LICENSE_PLANS_[String(name || 'lifetime').trim().toLowerCase()];
  if (!plan) {
    throw new Error('Unknown license "' + name + '". Use one of: ' + Object.keys(LICENSE_PLANS_).join(', '));
  }
  return plan;
}

function licenseType_(keyRow) {
  const type = cell_(keyRow['License Type']).toUpperCase();
  return LICENSE_TYPES_.indexOf(type) >= 0 ? type : 'LIFETIME';
}

/** "7 days" → { n: 7, unit: 'day' }; null when it cannot be read. */
function parseDuration_(text) {
  const m = DURATION_RE_.exec(cell_(text));
  if (!m || Number(m[1]) < 1) return null;
  return { n: Number(m[1]), unit: m[2].toLowerCase().replace(/s$/, '') };
}

/**
 * `start` plus a duration. Months and years land on the same day of the month,
 * or the month's last day when it has no such day (31 Jan + 1 month = 28/29 Feb).
 */
function addDuration_(start, d) {
  const out = new Date(start.getTime());
  if (FIXED_MS_[d.unit]) {
    out.setTime(out.getTime() + d.n * FIXED_MS_[d.unit]);
    return out;
  }
  const months = d.unit === 'year' ? d.n * 12 : d.n;
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** The key's expiry, or null for a lifetime key. */
function licenseExpiry_(keyRow) {
  if (licenseType_(keyRow) === 'LIFETIME') return null;
  const v = keyRow['Expiry Date'];
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const t = v ? Date.parse(String(v)) : NaN;
  return isNaN(t) ? null : new Date(t);
}

/**
 * When a license that starts at `start` ends. An hour plan is exact; any other
 * counts `start`'s day (India time) as day 1 and ends at 23:59:59 IST on the
 * last day: 30 Oct + 7 days ends 5 Nov 23:59:59 IST.
 */
function expiryFrom_(start, d) {
  if (d.unit === 'hour') return addDuration_(start, d);
  const ist = new Date(start.getTime() + IST_OFFSET_MS_);
  const day1 = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  // Midnight IST after the last day, less a second.
  return new Date(addDuration_(day1, d).getTime() - IST_OFFSET_MS_ - 1000);
}

/**
 * The `Expiry Date` a first activation writes. A timed key whose Duration
 * cannot be read is refused rather than activated as lifetime.
 */
function expiryOnActivation_(keyRow, now) {
  if (licenseType_(keyRow) === 'LIFETIME') return {};
  const d = parseDuration_(keyRow.Duration);
  if (!d) fail_('KEY_DISABLED', 'This key has no valid license duration. Ask the PlutoSim team.');
  return { 'Expiry Date': expiryFrom_(now, d) };
}

/** The key's Hours Per Day, or the OFFLINE_HOURS_PER_DAY setting when blank. */
function hoursPerDay_(keyRow) {
  const own = Number(keyRow['Hours Per Day']);
  if (keyRow['Hours Per Day'] !== '' && isFinite(own) && own > 0) return Math.min(own, 24);
  const fallback = Number(setting_('OFFLINE_HOURS_PER_DAY', 8));
  return isFinite(fallback) && fallback > 0 ? Math.min(fallback, 24) : 8;
}

/**
 * How long the app may stay open offline from `now` before it must check in:
 * Hours Per Day for each day left (the last, part day counted whole), at most
 * OFFLINE_MAX_DAYS of them, and never more than the time actually left. Null
 * for a lifetime key, which has no limit.
 */
function offlineBudgetMs_(keyRow, expiry, now) {
  if (!expiry) return null;
  const left = expiry.getTime() - now.getTime();
  if (left <= 0) return 0;
  const maxDays = Math.max(1, Number(setting_('OFFLINE_MAX_DAYS', 90)) || 90);
  const days = Math.min(Math.ceil(left / FIXED_MS_.day), maxDays);
  return Math.min(Math.round(days * hoursPerDay_(keyRow) * FIXED_MS_.hour), left);
}

/** An expired key signs nobody in. Renewing the key (a later Expiry Date) lets it in again. */
function assertLicenseActive_(keyRow, now) {
  const expiry = licenseExpiry_(keyRow);
  if (expiry && now.getTime() >= expiry.getTime()) {
    fail_(
      'LICENSE_EXPIRED',
      'Your license expired on ' + dayKey_(expiry) + '. Please renew your license to continue.',
      { expiresAt: iso_(expiry) },
    );
  }
}

function keyRowOf_(user) {
  const key = cell_(user['Activation Key']).toUpperCase();
  return key ? table_(SHEET.KEYS).find((r) => cell_(r['Activation Key']).toUpperCase() === key) : null;
}

/** The signed license the app keeps. `issuedAt` is the server's clock, which the app trusts over its own. */
function signedLicense_(user, keyRow, now) {
  if (!keyRow) return null;
  const type = licenseType_(keyRow);
  const expiry = licenseExpiry_(keyRow);
  const payload = JSON.stringify({
    v: 1,
    userId: cell_(user['User ID']),
    email: cell_(user.Email).toLowerCase(),
    deviceId: cell_(user['Device ID']),
    type: type,
    duration: type === 'LIFETIME' ? '' : cell_(keyRow.Duration),
    activatedAt: iso_(keyRow['Activated Date']),
    expiresAt: expiry ? expiry.toISOString() : null,
    status: expiry && now.getTime() >= expiry.getTime() ? 'EXPIRED' : 'ACTIVE',
    issuedAt: now.toISOString(),
    // Added later: an older app ignores them and keeps working.
    hoursPerDay: type === 'LIFETIME' ? null : hoursPerDay_(keyRow),
    offlineBudgetMs: type === 'LIFETIME' ? null : offlineBudgetMs_(keyRow, expiry, now),
    // The highest running total the app has reported: an app below it has had
    // its local data put back, and says so in its next usage report.
    usageFloorMin: num_(keyRow['Usage Counter (min)']),
  });
  return { payload: payload, signature: signLicense_(payload) };
}

/**
 * Script Properties hold one line, so the PEM may be pasted with its line
 * breaks written as \n; both forms work.
 */
function licensePrivateKey_() {
  const raw = PropertiesService.getScriptProperties().getProperty('LICENSE_PRIVATE_KEY');
  return raw ? String(raw).replace(/\\n/g, '\n').trim() + '\n' : '';
}

function signLicense_(payload) {
  const pem = licensePrivateKey_();
  if (!pem) {
    // Unsigned, the app refuses the license and asks the pilot to check again.
    console.error('LICENSE_PRIVATE_KEY is not set: licenses go out unsigned.');
    return '';
  }
  return Utilities.base64Encode(Utilities.computeRsaSha256Signature(payload, pem));
}

/**
 * Renew a timed key by one more of its Duration, from its expiry or from now if
 * it has already expired. Returns the new expiry.
 */
function renewActivationKey(key) {
  const wanted = cell_(key).toUpperCase();
  return withLock_(() => {
    const keys = table_(SHEET.KEYS);
    const row = keys.find((r) => cell_(r['Activation Key']).toUpperCase() === wanted);
    if (!row) throw new Error('No key ' + wanted);
    if (licenseType_(row) === 'LIFETIME') throw new Error(wanted + ' is a lifetime key; it never expires.');
    const d = parseDuration_(row.Duration);
    if (!d) throw new Error(wanted + ' has no valid Duration.');
    const now = new Date();
    const current = licenseExpiry_(row);
    const running = current && current.getTime() > now.getTime();
    // Still running: the renewal starts where it ends (the second after
    // 23:59:59 IST is the next day's start). Run out: from today.
    let expiry;
    if (!running) expiry = expiryFrom_(now, d);
    else if (d.unit === 'hour') expiry = addDuration_(current, d);
    else expiry = expiryFrom_(new Date(current.getTime() + 1000), d);
    keys.update(row, { 'Expiry Date': expiry });
    return expiry;
  });
}

function promptRenewKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Renew a key', 'Activation key to renew by one more of its Duration', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    const expiry = renewActivationKey(res.getResponseText());
    ui.alert('Renewed. The key now expires on ' + dayKey_(expiry) + '.');
  } catch (e) {
    ui.alert(String(e && e.message ? e.message : e));
  }
}

// ---------------------------------------------------------------------------
// Usage reports
// ---------------------------------------------------------------------------

const USAGE_ID_RE_ = /^[A-Za-z0-9-]{8,64}$/;
/** A running total this far below the highest one reported counts as local data put back. */
const RESTORE_SLACK_MIN_ = 5;

/** A client time as given, or '' when it cannot be read. Never refused: a wrong clock is what is being recorded. */
function looseTime_(value) {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return isNaN(t) ? '' : new Date(t);
}

/**
 * The app's open-window time, sent while online (every stretch flown offline
 * goes with the next one). A stretch is sent again while it grows, so a known
 * Usage ID updates its row. Also notes the app's clock against the server's in
 * `Clock Skew (min)`. And keeps the app's running total (`totalMinutes`) as high as
 * it has been: a total below that, or `restored` from an app that found itself
 * below the license's `usageFloorMin`, is a restored backup (`Restore Count`).
 */
function reportUsage_(payload, auth) {
  assertSelf_(payload, auth.user);
  const list = payload.usage === undefined ? [] : payload.usage;
  if (!Array.isArray(list)) fail_('VALIDATION', 'usage must be an array');
  if (list.length > 200) fail_('VALIDATION', 'at most 200 usage rows per request');
  const items = list.map((u, i) => {
    if (!u || typeof u !== 'object') fail_('VALIDATION', 'usage[' + i + '] must be an object');
    const id = str_(u, 'id', { max: 64 });
    if (!USAGE_ID_RE_.test(id)) fail_('VALIDATION', 'usage[' + i + '].id is not a valid id');
    return {
      id: id,
      minutes: Math.round(number_(u, 'minutes', 0, 24 * 60) * 100) / 100,
      startedAt: looseTime_(u.startedAt),
      endedAt: looseTime_(u.endedAt),
    };
  });
  const total = number_(payload, 'totalMinutes', 0, 10000000, { optional: true, fallback: null });
  const restored = payload.restored === true;
  const now = new Date();
  const client = Date.parse(payload.clientTime);
  // `+ 0` keeps a skew rounded from a hair behind as 0, not -0.
  const skewMin = isNaN(client) ? null : Math.round((client - now.getTime()) / 60000) + 0;

  return withLock_(() => {
    const user = lockedUser_(auth);
    const userId = user['User ID'];
    const key = cell_(user['Activation Key']).toUpperCase();
    const usage = table_(SHEET.USAGE);
    const known = {};
    usage.rows().forEach((r) => {
      if (r['User ID'] === userId) known[r['Usage ID']] = r;
    });
    const fresh = [];
    items.forEach((u) => {
      const row = known[u.id];
      const fields = { 'Ended At': u.endedAt, Minutes: u.minutes, 'Received At': now };
      if (row) usage.update(row, fields);
      else {
        const added = Object.assign(
          {
            'Usage ID': u.id,
            'User ID': userId,
            Email: cell_(user.Email).toLowerCase(),
            'Activation Key': key,
            'Started At': u.startedAt,
          },
          fields,
        );
        known[u.id] = added;
        fresh.push(added);
      }
    });
    usage.append(fresh);

    const keyRow = keyRowOf_(user);
    if (keyRow) {
      let minutes = 0;
      usage.rows().forEach((r) => {
        if (cell_(r['Activation Key']).toUpperCase() === key) minutes += num_(r.Minutes);
      });
      const patch = { 'Used Hours': Math.round((minutes / 60) * 100) / 100, 'Last Online': now };
      if (skewMin !== null) patch['Clock Skew (min)'] = skewMin;
      if (total !== null) {
        const highest = num_(keyRow['Usage Counter (min)']);
        if (restored || total < highest - RESTORE_SLACK_MIN_) patch['Restore Count'] = num_(keyRow['Restore Count']) + 1;
        patch['Usage Counter (min)'] = Math.round(Math.max(highest, total) * 100) / 100;
      }
      table_(SHEET.KEYS).update(keyRow, patch);
    }
    return { received: items.length };
  });
}
