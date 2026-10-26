// Licenses: how long an activation key lets its pilot fly, and the signed copy
// the simulator checks with no internet.
//
// A key is TRIAL, ANNUAL or LIFETIME (`License Type` in ActivationKeys; blank is
// LIFETIME, so every key issued before licenses existed stays lifetime). Its
// `Duration` ("7 days", "6 months", "1 year") starts at the key's first
// activation, on the server's clock, and `Expiry Date` is written then.
// Renewing moves `Expiry Date` forward on the same key ("Renew a key…").
//
// Activation, login and every profile check return the license as a JSON
// payload signed RSA-SHA256 with the `LICENSE_PRIVATE_KEY` Script Property. The
// app holds only the public key: it can check a license, never make one, and a
// date edited on the computer breaks the signature.

const LICENSE_TYPES_ = ['TRIAL', 'ANNUAL', 'LIFETIME'];
const DURATION_RE_ = /^(\d{1,3})\s*(day|days|month|months|year|years)$/i;

/** What the key-generation prompt offers: trial 1/7/14/30 days, annual 6 months or a year, lifetime. */
const LICENSE_PLANS_ = {
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
  if (d.unit === 'day') {
    out.setTime(out.getTime() + d.n * 24 * 60 * 60 * 1000);
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
 * The `Expiry Date` a first activation writes. A timed key whose Duration
 * cannot be read is refused rather than activated as lifetime.
 */
function expiryOnActivation_(keyRow, now) {
  if (licenseType_(keyRow) === 'LIFETIME') return {};
  const d = parseDuration_(keyRow.Duration);
  if (!d) fail_('KEY_DISABLED', 'This key has no valid license duration. Ask the PlutoSim team.');
  return { 'Expiry Date': addDuration_(now, d) };
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
    const from = current && current.getTime() > now.getTime() ? current : now;
    const expiry = addDuration_(from, d);
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
