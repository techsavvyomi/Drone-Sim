// PlutoSim API: Google Apps Script backend (generated file).
//
// Paste this whole file into Code.gs of the Apps Script project, set the
// manifest from backend/apps-script/appsscript.json, then deploy as a web app.
// Full steps: backend/README.md.
//
// Do not edit here: edit backend/apps-script/*.js and run
// `node scripts/build-apps-script.mjs`.

// ==========================================================================
// Schema.js
// ==========================================================================

// PlutoSim DB: sheet definitions.
//
// Every sheet is a table whose first row is its header. Code addresses columns
// by header NAME (see Db.js), never by letter, so an admin can add columns or
// reorder them without breaking the API. Renaming or deleting a column listed
// here does break it; run `setupDatabase` to restore any that went missing.
//
// Each table maps to one Firebase collection later (see backend/README.md), and
// the ID column is that collection's document id.

const API_VERSION = 1;

const SHEET = {
  USERS: 'Users',
  KEYS: 'ActivationKeys',
  TOKENS: 'AuthTokens',
  SESSIONS: 'FlightSessions',
  EVENTS: 'GameplayEvents',
  DRONES: 'Drones',
  MISSIONS: 'Missions',
  TRAINING: 'TrainingModules',
  SETTINGS: 'Settings',
  CRASHES: 'CrashReports',
};

const SCHEMA = {
  [SHEET.USERS]: [
    'User ID',
    'Name',
    'Email',
    'Activation Key',
    'Registration Date',
    'Last Active',
    'Total Points',
    'Total Flights',
    'Total Flight Time',
    'Training Flights',
    'Mission Flights',
    'Free Flights',
    'Missions Completed',
    'Training Completed',
    'Free Flight Time',
    'Crash Count',
    'Scored Sessions',
    'Score Percent Sum',
    'Current Level',
    'Status',
    // The one computer this profile may sign in on. Clear both to let the pilot
    // move to a new computer: the next one to sign in is bound.
    'Device ID',
    'Device Name',
    'Device Bound At',
  ],
  [SHEET.KEYS]: [
    'Activation Key',
    'Status',
    'Assigned Email',
    'User ID',
    'Created Date',
    'Activated Date',
    'Notes',
  ],
  // One row per signed-in device. Only a SHA-256 of the token is stored, so the
  // sheet cannot be used to impersonate anyone. Set Status to REVOKED to sign a
  // device out.
  [SHEET.TOKENS]: ['Token Hash', 'User ID', 'Device ID', 'Created Date', 'Last Used', 'Status'],
  [SHEET.SESSIONS]: [
    'Session ID',
    'User ID',
    'Email',
    'Date',
    'Start Time',
    'End Time',
    'Duration',
    'Flight Time',
    'Flight Type',
    'Mission ID',
    'Mission Name',
    'Training ID',
    'Training Name',
    'Drone ID',
    'Drone Name',
    'Points Earned',
    'Score',
    'Max Score',
    'Score Percent',
    'Stars',
    'Success',
    'Attempts',
    'Crash Count',
    'Collision Count',
    'Distance',
    'Max Altitude',
    'Battery Used',
    'Controls/Input Mode',
    'Objectives Completed',
    'Objectives Total',
    'Fail Reason',
    'App Version',
    'Client Session Key',
    'Timestamp',
  ],
  [SHEET.EVENTS]: [
    'Event ID',
    'Session ID',
    'User ID',
    'Event Type',
    'Event Data',
    'Timestamp',
    'Received At',
  ],
  [SHEET.DRONES]: ['Drone ID', 'Drone Name', 'Model', 'Sim Key', 'Status'],
  [SHEET.MISSIONS]: ['Mission ID', 'Mission Name', 'Sim Key', 'Max Score', 'Order', 'Status'],
  [SHEET.TRAINING]: ['Training ID', 'Training Name', 'Sim Key', 'Order', 'Status'],
  [SHEET.SETTINGS]: ['Key', 'Value', 'Description'],
  // One row per crash. `Fingerprint` groups repeats of the same fault; the
  // `Report: Crashes` sheet counts them. User columns are blank when nobody was
  // signed in.
  [SHEET.CRASHES]: [
    'Report ID',
    'Occurred At',
    'Received At',
    'Kind',
    'Fatal',
    'Message',
    'Fingerprint',
    'User ID',
    'Email',
    'Device ID',
    'Device Name',
    'App Version',
    'Platform',
    'OS Version',
    'Electron Version',
    'Context',
    'Stack',
  ],
};

/** Columns written as timestamps, formatted as date-times in the sheet. */
const DATETIME_COLUMNS = [
  'Device Bound At',
  'Registration Date',
  'Last Active',
  'Created Date',
  'Activated Date',
  'Last Used',
  'Start Time',
  'End Time',
  'Timestamp',
  'Received At',
  'Occurred At',
];

/**
 * Tunable rules, seeded into the Settings sheet. Change the Value in the sheet;
 * the code reads it on every request. SEQ_* are the ID counters.
 */
const DEFAULT_SETTINGS = [
  ['SEQ_USER', 0, 'Last issued USR- number. Do not lower it.'],
  ['SEQ_SESSION', 0, 'Last issued SES- number. Do not lower it.'],
  ['SEQ_EVENT', 0, 'Last issued EVT- number. Do not lower it.'],
  ['SEQ_CRASH', 0, 'Last issued CRS- number. Do not lower it.'],
  ['MAX_CRASH_REPORTS_PER_HOUR', 60, 'Crash reports accepted per device per hour; the rest are dropped.'],
  ['LEVEL_POINTS', 500, 'Points per level. Level = 1 + floor(total points / this).'],
  ['MISSION_COMPLETE_POINTS', 50, 'Points for completing a mission.'],
  ['MISSION_SCORE_POINTS', 10, 'Extra points per mission score point.'],
  ['TRAINING_COMPLETE_POINTS', 30, 'Points for completing a training module.'],
  ['STAR_POINTS', 25, 'Extra points per star on a completed mission or module.'],
  ['REPEAT_COMPLETION_PERCENT', 25, 'Percent of the award paid for re-completing the same mission/module.'],
  ['FREE_FLIGHT_POINTS_PER_MINUTE', 2, 'Points per full airborne minute of free flight.'],
  ['FREE_FLIGHT_POINTS_CAP', 30, 'Most points one free-flight session can earn.'],
  ['MAX_LOGIN_FAILURES', 10, 'Failed activations/logins per email before a 15 minute lockout.'],
];

// ==========================================================================
// Catalog.js
// ==========================================================================

// The catalog `setupDatabase` seeds into Drones, Missions and TrainingModules.
//
// The simulator maps its own keys (`pluto`, `forest-fire`) to these ids in
// src/renderer/services/catalog.ts, and tests/backend-catalog.test.ts fails if
// the two lists drift apart. Add a drone, mission or module in both places, then
// run `setupDatabase` again: it adds new rows and never overwrites edits made in
// the sheet.
//
// Mission `maxScore` is the most points one attempt can score in the simulator.
// The server clamps a reported score to it.

const CATALOG = {
  drones: [
    { id: 'DRONE-001', name: 'Pluto', model: 'Pluto nano quad (50 g)', simKey: 'pluto' },
    { id: 'DRONE-002', name: 'Pluto Guru', model: 'Guru quad (1.5 kg)', simKey: 'pluto-guru' },
    { id: 'DRONE-003', name: 'Racing Drone', model: '5 inch racing quad (720 g)', simKey: 'racing-drone' },
  ],
  missions: [
    { id: 'MISSION-001', name: 'Precision Delivery', simKey: 'precision-delivery', maxScore: 15, order: 1 },
    { id: 'MISSION-002', name: 'Forest Fire Emergency', simKey: 'forest-fire', maxScore: 6, order: 2 },
    { id: 'MISSION-003', name: 'Multi-Point Delivery', simKey: 'multi-point-delivery', maxScore: 4, order: 3 },
    { id: 'MISSION-004', name: 'Logistics Drones', simKey: 'search-rescue', maxScore: 2, order: 4 },
    { id: 'MISSION-005', name: 'Animal Rescue', simKey: 'tiger-tracker', maxScore: 1, order: 5 },
    { id: 'MISSION-006', name: 'Search and Rescue', simKey: 'night-tracking', maxScore: 1, order: 6 },
  ],
  training: [
    { id: 'TRAINING-001', name: 'Arm & Take Off', simKey: 'arm-takeoff', order: 1 },
    { id: 'TRAINING-002', name: 'Land & Disarm', simKey: 'land-disarm', order: 2 },
    { id: 'TRAINING-003', name: 'Throttle Up & Down', simKey: 'throttle', order: 3 },
    { id: 'TRAINING-004', name: 'Yaw Control', simKey: 'yaw', order: 4 },
    { id: 'TRAINING-005', name: 'Pitch Control', simKey: 'pitch', order: 5 },
    { id: 'TRAINING-006', name: 'Roll Control', simKey: 'roll', order: 6 },
    { id: 'TRAINING-007', name: 'Straight Flight', simKey: 'straight-line', order: 7 },
    { id: 'TRAINING-008', name: 'Diagonal Run', simKey: 'diagonal', order: 8 },
    { id: 'TRAINING-009', name: 'Square Circuit', simKey: 'square', order: 9 },
    { id: 'TRAINING-010', name: 'Square Circuit using Yaw', simKey: 'square-yaw', order: 10 },
    { id: 'TRAINING-011', name: 'Triangle Circuit', simKey: 'triangle', order: 11 },
    { id: 'TRAINING-012', name: 'Full Circle', simKey: 'circle', order: 12 },
    { id: 'TRAINING-013', name: 'Your First Route', simKey: 'nav-ab', order: 13 },
    { id: 'TRAINING-014', name: 'Three Gates in Order', simKey: 'nav-abc', order: 14 },
    { id: 'TRAINING-015', name: 'The Whole Flight', simKey: 'nav-abcd', order: 15 },
  ],
};

/** Training scores are percentages. */
const TRAINING_MAX_SCORE = 100;

// ==========================================================================
// Db.js
// ==========================================================================

// A thin table layer over Google Sheets.
//
// Everything that touches a sheet goes through here. Rows come back as plain
// objects keyed by header name, with dates as Date objects, and go in the same
// way. Swapping Sheets for Firebase replaces this file and the ID counter; the
// handlers in Api.js only ever see objects.

/**
 * The prototype's DroneSimulatorDB. A `SPREADSHEET_ID` Script Property
 * overrides it (for a test copy); with neither, a script bound to a sheet uses
 * that sheet.
 */
const DEFAULT_SPREADSHEET_ID = '19q9iUHRDD6MPORsL98WOGi6GtxQ4-b4m1l9THFUg-S0';

let spreadsheetCache_ = null;

function spreadsheet_() {
  if (spreadsheetCache_) return spreadsheetCache_;
  const id =
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  spreadsheetCache_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheetCache_) throw new Error('No spreadsheet: set SPREADSHEET_ID or bind the script');
  return spreadsheetCache_;
}

function timeZone_() {
  return spreadsheet_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

/**
 * Anything a user typed that starts with = + - or @ would be evaluated by Sheets
 * as a formula (and could, for example, IMPORTXML data out of the sheet).
 * Prefixing an apostrophe stores it as literal text.
 */
function cellSafe_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

/** Per-request cache, so one request reads each sheet at most once. */
let tableCache_ = {};

function resetTableCache_() {
  tableCache_ = {};
}

function table_(name) {
  if (!tableCache_[name]) tableCache_[name] = new Table_(name);
  return tableCache_[name];
}

function Table_(name) {
  let sheet = spreadsheet_().getSheetByName(name);
  // A table added in a later version is created on first use, like a column.
  if (!sheet && SCHEMA[name]) sheet = ensureSheet_(spreadsheet_(), name, SCHEMA[name]);
  if (!sheet) throw new Error('Missing sheet "' + name + '". Run setupDatabase.');
  this.name = name;
  this.sheet = sheet;
  const width = Math.max(sheet.getLastColumn(), 1);
  this.headers = sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .map((h) => String(h).trim());
  // A column added to the schema in a later version is added to the sheet the
  // first time it is needed, so deploying new code never breaks a live sheet
  // that `setupDatabase` has not been re-run on.
  const missing = (SCHEMA[name] || []).filter((col) => this.headers.indexOf(col) < 0);
  if (missing.length > 0) {
    const used = this.headers.filter((h) => h !== '').length;
    sheet.getRange(1, used + 1, 1, missing.length).setValues([missing]);
    this.headers = this.headers.slice(0, used).concat(missing);
  }
  this.rowsCache = null;
}

/** All data rows as objects. `_row` is the 1-based sheet row. */
Table_.prototype.rows = function () {
  if (this.rowsCache) return this.rowsCache;
  const last = this.sheet.getLastRow();
  const out = [];
  if (last >= 2) {
    const values = this.sheet.getRange(2, 1, last - 1, this.headers.length).getValues();
    for (let i = 0; i < values.length; i++) {
      const obj = { _row: i + 2 };
      let blank = true;
      for (let c = 0; c < this.headers.length; c++) {
        const v = values[i][c];
        if (v !== '' && v !== null) blank = false;
        if (this.headers[c]) obj[this.headers[c]] = v;
      }
      if (!blank) out.push(obj);
    }
  }
  this.rowsCache = out;
  return out;
};

Table_.prototype.find = function (predicate) {
  const rows = this.rows();
  for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
  return null;
};

Table_.prototype.filter = function (predicate) {
  return this.rows().filter(predicate);
};

Table_.prototype.toValues_ = function (obj) {
  return this.headers.map((h) => (h && obj[h] !== undefined ? cellSafe_(obj[h]) : ''));
};

/** Append one or more row objects in a single write. */
Table_.prototype.append = function (objs) {
  const list = Array.isArray(objs) ? objs : [objs];
  if (list.length === 0) return;
  const values = list.map((o) => this.toValues_(o));
  const start = this.sheet.getLastRow() + 1;
  this.sheet.getRange(start, 1, values.length, this.headers.length).setValues(values);
  if (this.rowsCache) {
    list.forEach((o, i) => {
      const copy = Object.assign({}, o, { _row: start + i });
      this.rowsCache.push(copy);
    });
  }
};

/** Write the given fields of an existing row object back to its sheet row. */
Table_.prototype.update = function (row, patch) {
  Object.assign(row, patch);
  const values = [this.headers.map((h) => (h && row[h] !== undefined ? cellSafe_(row[h]) : ''))];
  this.sheet.getRange(row._row, 1, 1, this.headers.length).setValues(values);
};

// ---------------------------------------------------------------------------
// Settings & ID counters
// ---------------------------------------------------------------------------

function setting_(key, fallback) {
  const row = table_(SHEET.SETTINGS).find((r) => r.Key === key);
  if (!row || row.Value === '' || row.Value === null) return fallback;
  const n = Number(row.Value);
  return isNaN(n) ? row.Value : n;
}

/**
 * Reserve `count` sequential ids like USR-000001. Must be called under the
 * script lock (see withLock_), which every writing handler holds.
 */
function nextIds_(counterKey, prefix, width, count) {
  const settings = table_(SHEET.SETTINGS);
  let row = settings.find((r) => r.Key === counterKey);
  if (!row) {
    settings.append({ Key: counterKey, Value: 0, Description: 'ID counter' });
    row = settings.find((r) => r.Key === counterKey);
  }
  const last = Number(row.Value) || 0;
  settings.update(row, { Value: last + count });
  const ids = [];
  for (let i = 1; i <= count; i++) {
    ids.push(prefix + String(last + i).padStart(width, '0'));
  }
  return ids;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Rows read before the lock may be stale; re-read inside it.
    resetTableCache_();
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function iso_(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

function num_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function dayKey_(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}

// ==========================================================================
// Api.js
// ==========================================================================

// API handlers. Contract: src/shared/backend/contract.ts, documented in
// backend/README.md.
//
// Every handler takes the request payload and (except activation and login) the
// authenticated user row, and returns the `data` of a success response. Failures
// are thrown as ApiError_ and turned into `{ success: false, code, message }` by
// the router in Code.js.
//
// Nothing a client sends is trusted for identity, totals or status: the user
// comes from the auth token, points and levels are computed here, and catalog
// ids are checked against the catalog sheets.

function ApiError_(code, message) {
  this.code = code;
  this.message = message;
}

function fail_(code, message) {
  throw new ApiError_(code, message);
}

const FLIGHT_TYPES_ = ['TRAINING', 'MISSION', 'FREE_FLIGHT'];
const RESULTS_ = ['SUCCESS', 'FAILED', 'ABORTED'];
const INPUT_MODES_ = ['KEYBOARD', 'GAMEPAD', 'RC_TRANSMITTER'];
const EMAIL_RE_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE_ = /^PLUTO-SIM-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const EVENT_TYPE_RE_ = /^[A-Z][A-Z0-9_]{1,48}$/;
const DEVICE_ID_RE_ = /^[A-Za-z0-9-]{16,128}$/;
/** How far a client clock may run ahead of the server's before we distrust it. */
const CLOCK_SKEW_MS_ = 10 * 60 * 1000;
/** Sessions queued offline may be uploaded late, but not this late. */
const MAX_BACKFILL_MS_ = 60 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function str_(payload, field, opts) {
  const o = opts || {};
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') {
    if (o.optional) return '';
    fail_('VALIDATION', field + ' is required');
  }
  if (typeof raw !== 'string') fail_('VALIDATION', field + ' must be a string');
  const v = raw.trim();
  if (!o.optional && v === '') fail_('VALIDATION', field + ' is required');
  if (v.length > (o.max || 200)) fail_('VALIDATION', field + ' is too long');
  return v;
}

function number_(payload, field, min, max, opts) {
  const o = opts || {};
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') {
    if (o.optional) return o.fallback === undefined ? 0 : o.fallback;
    fail_('VALIDATION', field + ' is required');
  }
  const n = Number(raw);
  if (typeof raw === 'boolean' || !isFinite(n)) fail_('VALIDATION', field + ' must be a number');
  if (n < min || n > max) fail_('VALIDATION', field + ' must be between ' + min + ' and ' + max);
  return o.integer ? Math.round(n) : n;
}

function oneOf_(payload, field, allowed, opts) {
  const v = str_(payload, field, opts);
  if (v === '' && opts && opts.optional) return '';
  if (allowed.indexOf(v) < 0) fail_('VALIDATION', field + ' must be one of ' + allowed.join(', '));
  return v;
}

function email_(payload) {
  const v = str_(payload, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE_.test(v)) fail_('VALIDATION', 'email is not a valid address');
  return v;
}

function activationKey_(payload) {
  const v = str_(payload, 'activationKey', { max: 40 }).toUpperCase();
  if (!KEY_RE_.test(v)) fail_('VALIDATION', 'activationKey is not in the PLUTO-SIM-XXXX-XXXX format');
  return v;
}

/** A client-supplied ISO time, bounded to something plausible. */
function clientTime_(payload, field, now) {
  const raw = payload[field];
  if (!raw) return now;
  const d = new Date(raw);
  if (isNaN(d.getTime())) fail_('VALIDATION', field + ' is not a valid time');
  if (d.getTime() > now.getTime() + CLOCK_SKEW_MS_) fail_('VALIDATION', field + ' is in the future');
  if (d.getTime() < now.getTime() - MAX_BACKFILL_MS_) fail_('VALIDATION', field + ' is too old');
  return d;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function sha256_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8,
  );
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** Sheet text, compared the way a person reading the sheet would. */
function cell_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function device_(payload) {
  const id = str_(payload, 'deviceId', { max: 128 });
  if (!DEVICE_ID_RE_.test(id)) fail_('VALIDATION', 'deviceId is not valid');
  return { id: id, name: str_(payload, 'deviceName', { optional: true, max: 80 }) || 'Unknown computer' };
}

/**
 * One profile, one computer.
 *
 * The first computer to sign in binds the profile; any other is refused until an
 * admin clears `Device ID` in the Users sheet, after which the next computer to
 * sign in is bound instead. Returns the patch that records a new binding.
 */
function bindDevice_(user, device, now) {
  const bound = cell_(user['Device ID']);
  if (!bound) {
    return { 'Device ID': device.id, 'Device Name': device.name, 'Device Bound At': now };
  }
  if (bound !== device.id) {
    const where = cell_(user['Device Name']) || 'another computer';
    fail_(
      'DEVICE_MISMATCH',
      'This profile is locked to ' + where + '. Ask your administrator to move it to this computer.',
    );
  }
  return cell_(user['Device Name']) === device.name ? {} : { 'Device Name': device.name };
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function issueToken_(userId, deviceId, now) {
  const token = newToken_();
  table_(SHEET.TOKENS).append({
    'Token Hash': sha256_(token),
    'User ID': userId,
    'Device ID': deviceId,
    'Created Date': now,
    'Last Used': now,
    Status: 'ACTIVE',
  });
  return token;
}

/** Resolve the calling user from the request's auth token. */
function authenticate_(authToken) {
  if (!authToken || typeof authToken !== 'string') fail_('AUTH_INVALID', 'Sign in required');
  const hash = sha256_(authToken);
  const token = table_(SHEET.TOKENS).find((r) => r['Token Hash'] === hash);
  if (!token || token.Status !== 'ACTIVE') fail_('AUTH_INVALID', 'Session expired. Sign in again.');
  const user = table_(SHEET.USERS).find((r) => r['User ID'] === token['User ID']);
  if (!user) fail_('AUTH_INVALID', 'Account not found. Sign in again.');
  if (user.Status !== 'ACTIVE') fail_('USER_INACTIVE', 'This account has been deactivated');
  // A token only works on the computer the profile is bound to. Moving the
  // profile to another computer (or clearing the binding) signs this one out.
  if (cell_(token['Device ID']) !== cell_(user['Device ID'])) {
    fail_('AUTH_INVALID', 'This profile has been moved to another computer. Sign in again.');
  }
  return { user: user, token: token };
}

/**
 * The caller's user row, re-read inside the lock. The row `authenticate_` found
 * was read before the lock was taken; updating totals from it could overwrite a
 * concurrent request's update.
 */
function lockedUser_(auth) {
  const user = table_(SHEET.USERS).find((r) => r['User ID'] === auth.user['User ID']);
  if (!user) fail_('AUTH_INVALID', 'Account not found. Sign in again.');
  return user;
}

/** The payload's userId, when present, must be the caller's own. */
function assertSelf_(payload, user) {
  if (payload.userId !== undefined && payload.userId !== user['User ID']) {
    fail_('FORBIDDEN', 'You can only access your own profile');
  }
}

/** Failed activations/logins are throttled per email. */
function checkThrottle_(email) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('authfail:' + email) || 0);
  if (count >= setting_('MAX_LOGIN_FAILURES', 10)) {
    fail_('VALIDATION', 'Too many failed attempts. Try again in 15 minutes.');
  }
}

function noteFailure_(email) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('authfail:' + email) || 0);
  cache.put('authfail:' + email, String(count + 1), 15 * 60);
}

function clearFailures_(email) {
  CacheService.getScriptCache().remove('authfail:' + email);
}

/** Run an auth handler, counting the credential failures it throws. */
function throttled_(email, fn) {
  checkThrottle_(email);
  try {
    const result = fn();
    clearFailures_(email);
    return result;
  } catch (e) {
    const counted = ['KEY_NOT_FOUND', 'KEY_ALREADY_USED', 'INVALID_CREDENTIALS'];
    if (e instanceof ApiError_ && counted.indexOf(e.code) >= 0) noteFailure_(email);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function levelFor_(points) {
  const step = Math.max(1, setting_('LEVEL_POINTS', 500));
  return {
    level: 1 + Math.floor(points / step),
    current: points % step,
    next: step,
  };
}

function profileOf_(user) {
  const points = num_(user['Total Points']);
  const lvl = levelFor_(points);
  const scored = num_(user['Scored Sessions']);
  return {
    userId: user['User ID'],
    name: String(user.Name),
    email: String(user.Email),
    level: lvl.level,
    levelPoints: { current: lvl.current, next: lvl.next },
    status: user.Status,
    registeredAt: iso_(user['Registration Date']),
    device: cell_(user['Device ID'])
      ? { name: cell_(user['Device Name']), boundAt: iso_(user['Device Bound At']) }
      : null,
    lastActiveAt: iso_(user['Last Active']),
    stats: {
      totalPoints: points,
      totalFlights: num_(user['Total Flights']),
      totalFlightTimeSec: num_(user['Total Flight Time']),
      trainingFlights: num_(user['Training Flights']),
      missionFlights: num_(user['Mission Flights']),
      freeFlights: num_(user['Free Flights']),
      missionsCompleted: num_(user['Missions Completed']),
      trainingCompleted: num_(user['Training Completed']),
      freeFlightTimeSec: num_(user['Free Flight Time']),
      crashCount: num_(user['Crash Count']),
      averageScore: scored > 0 ? Math.round((num_(user['Score Percent Sum']) / scored) * 10) / 10 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// activateUser / loginUser
// ---------------------------------------------------------------------------

function activateUser_(payload) {
  const name = str_(payload, 'name', { max: 80 });
  const email = email_(payload);
  const key = activationKey_(payload);
  const device = device_(payload);

  return throttled_(email, () =>
    withLock_(() => {
      const now = new Date();
      const keys = table_(SHEET.KEYS);
      const users = table_(SHEET.USERS);
      const keyRow = keys.find((r) => cell_(r['Activation Key']).toUpperCase() === key);

      if (!keyRow) fail_('KEY_NOT_FOUND', 'That activation key does not exist');
      if (keyRow.Status === 'DISABLED') fail_('KEY_DISABLED', 'That activation key has been disabled');

      if (keyRow.Status === 'ACTIVATED') {
        // The owner coming back through the activation form is a login, not an
        // error. Anyone else is refused: a key belongs to one email forever.
        if (cell_(keyRow['Assigned Email']).toLowerCase() !== email) {
          fail_('KEY_ALREADY_USED', 'That activation key is already linked to another email');
        }
        const existing = users.find((r) => cell_(r['User ID']) === cell_(keyRow['User ID']));
        if (!existing) fail_('SERVER_ERROR', 'Activated key has no user. Contact the admin.');
        if (existing.Status !== 'ACTIVE') fail_('USER_INACTIVE', 'This account has been deactivated');
        users.update(existing, Object.assign({ 'Last Active': now }, bindDevice_(existing, device, now)));
        return {
          userId: existing['User ID'],
          authToken: issueToken_(existing['User ID'], device.id, now),
          profile: profileOf_(existing),
          existingUser: true,
        };
      }

      if (keyRow.Status !== 'AVAILABLE') fail_('KEY_DISABLED', 'That activation key cannot be used');

      if (users.find((r) => cell_(r.Email).toLowerCase() === email)) {
        fail_(
          'EMAIL_ALREADY_REGISTERED',
          'This email already has an account. Sign in with the key it was activated with.',
        );
      }

      const userId = nextIds_('SEQ_USER', 'USR-', 6, 1)[0];
      const user = {
        'User ID': userId,
        Name: name,
        Email: email,
        'Activation Key': key,
        'Registration Date': now,
        'Last Active': now,
        'Total Points': 0,
        'Total Flights': 0,
        'Total Flight Time': 0,
        'Training Flights': 0,
        'Mission Flights': 0,
        'Free Flights': 0,
        'Missions Completed': 0,
        'Training Completed': 0,
        'Free Flight Time': 0,
        'Crash Count': 0,
        'Scored Sessions': 0,
        'Score Percent Sum': 0,
        'Current Level': 1,
        Status: 'ACTIVE',
        'Device ID': device.id,
        'Device Name': device.name,
        'Device Bound At': now,
      };
      users.append(user);
      keys.update(keyRow, {
        Status: 'ACTIVATED',
        'Assigned Email': email,
        'User ID': userId,
        'Activated Date': now,
      });

      return {
        userId: userId,
        authToken: issueToken_(userId, device.id, now),
        profile: profileOf_(user),
      };
    }),
  );
}

function loginUser_(payload) {
  const email = email_(payload);
  const key = activationKey_(payload);
  const device = device_(payload);

  return throttled_(email, () =>
    withLock_(() => {
      const now = new Date();
      const user = table_(SHEET.USERS).find((r) => cell_(r.Email).toLowerCase() === email);
      const keyRow = table_(SHEET.KEYS).find((r) => cell_(r['Activation Key']).toUpperCase() === key);
      // One message for every mismatch, so the form cannot be used to find out
      // which emails are registered or which keys exist.
      const matches =
        user &&
        keyRow &&
        cell_(user['Activation Key']).toUpperCase() === key &&
        cell_(keyRow['User ID']) === cell_(user['User ID']) &&
        cell_(keyRow['Assigned Email']).toLowerCase() === email;
      if (!matches) fail_('INVALID_CREDENTIALS', 'Email and activation key do not match');
      if (keyRow.Status === 'DISABLED') fail_('KEY_DISABLED', 'That activation key has been disabled');
      if (user.Status !== 'ACTIVE') fail_('USER_INACTIVE', 'This account has been deactivated');

      table_(SHEET.USERS).update(user, Object.assign({ 'Last Active': now }, bindDevice_(user, device, now)));
      return {
        userId: user['User ID'],
        authToken: issueToken_(user['User ID'], device.id, now),
        profile: profileOf_(user),
      };
    }),
  );
}

function getUserProfile_(payload, auth) {
  assertSelf_(payload, auth.user);
  return profileOf_(auth.user);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function activeCatalogRow_(sheetName, idColumn, id, label) {
  const row = table_(sheetName).find((r) => r[idColumn] === id);
  if (!row || (row.Status && row.Status !== 'ACTIVE')) fail_('VALIDATION', 'Unknown ' + label + ': ' + id);
  return row;
}

function startSession_(payload, auth) {
  assertSelf_(payload, auth.user);
  const flightType = oneOf_(payload, 'flightType', FLIGHT_TYPES_);
  const droneId = str_(payload, 'droneId', { max: 40 });
  const inputMode = oneOf_(payload, 'inputMode', INPUT_MODES_, { optional: true }) || 'KEYBOARD';
  const clientKey = str_(payload, 'clientSessionKey', { max: 64 });
  const missionId = str_(payload, 'missionId', { optional: true, max: 40 });
  const trainingId = str_(payload, 'trainingId', { optional: true, max: 40 });
  const appVersion = str_(payload, 'appVersion', { optional: true, max: 40 });

  if (flightType === 'MISSION' && !missionId) fail_('VALIDATION', 'missionId is required for MISSION');
  if (flightType === 'TRAINING' && !trainingId) fail_('VALIDATION', 'trainingId is required for TRAINING');

  return withLock_(() => {
    const now = new Date();
    const startTime = clientTime_(payload, 'startTime', now);
    const user = lockedUser_(auth);
    const sessions = table_(SHEET.SESSIONS);

    // A retried start (the response was lost) returns the session it opened.
    const existing = sessions.find(
      (r) => r['Client Session Key'] === clientKey && r['User ID'] === user['User ID'],
    );
    if (existing) return { sessionId: existing['Session ID'], duplicate: true };

    const drone = activeCatalogRow_(SHEET.DRONES, 'Drone ID', droneId, 'drone');
    const mission =
      flightType === 'MISSION' ? activeCatalogRow_(SHEET.MISSIONS, 'Mission ID', missionId, 'mission') : null;
    const training =
      flightType === 'TRAINING'
        ? activeCatalogRow_(SHEET.TRAINING, 'Training ID', trainingId, 'training module')
        : null;

    const sessionId = nextIds_('SEQ_SESSION', 'SES-', 6, 1)[0];
    sessions.append({
      'Session ID': sessionId,
      'User ID': user['User ID'],
      Email: user.Email,
      Date: dayKey_(startTime),
      'Start Time': startTime,
      'Flight Type': flightType,
      'Mission ID': mission ? mission['Mission ID'] : '',
      'Mission Name': mission ? mission['Mission Name'] : '',
      'Training ID': training ? training['Training ID'] : '',
      'Training Name': training ? training['Training Name'] : '',
      'Drone ID': drone['Drone ID'],
      'Drone Name': drone['Drone Name'],
      Success: 'IN_PROGRESS',
      'Controls/Input Mode': inputMode,
      'App Version': appVersion,
      'Client Session Key': clientKey,
      Timestamp: now,
    });
    table_(SHEET.USERS).update(user, { 'Last Active': now });
    return { sessionId: sessionId };
  });
}

function ownedSession_(sessionId, user) {
  const row = table_(SHEET.SESSIONS).find((r) => r['Session ID'] === sessionId);
  if (!row) fail_('NOT_FOUND', 'Session ' + sessionId + ' does not exist');
  if (row['User ID'] !== user['User ID']) fail_('FORBIDDEN', 'That session belongs to another user');
  return row;
}

/**
 * Points for a finished session. The formula is here, not in the simulator, and
 * every constant in it is a row in the Settings sheet.
 */
function pointsFor_(session, result, score, stars, flightTime, isRepeat) {
  const type = session['Flight Type'];
  if (type === 'FREE_FLIGHT') {
    const perMinute = setting_('FREE_FLIGHT_POINTS_PER_MINUTE', 2);
    return Math.min(setting_('FREE_FLIGHT_POINTS_CAP', 30), Math.floor(flightTime / 60) * perMinute);
  }
  if (result !== 'SUCCESS') return 0;
  let points = stars * setting_('STAR_POINTS', 25);
  if (type === 'MISSION') {
    points += setting_('MISSION_COMPLETE_POINTS', 50) + score * setting_('MISSION_SCORE_POINTS', 10);
  } else {
    points += setting_('TRAINING_COMPLETE_POINTS', 30);
  }
  if (isRepeat) points = (points * setting_('REPEAT_COMPLETION_PERCENT', 25)) / 100;
  return Math.round(points);
}

function endSession_(payload, auth) {
  const sessionId = str_(payload, 'sessionId', { max: 20 });
  const result = oneOf_(payload, 'result', RESULTS_);
  let duration = number_(payload, 'duration', 0, 86400);
  let flightTime = number_(payload, 'flightTime', 0, 86400, { optional: true });
  let score = number_(payload, 'score', 0, 1000000, { optional: true });
  const stars = number_(payload, 'stars', 0, 3, { optional: true, integer: true });
  const crashCount = number_(payload, 'crashCount', 0, 10000, { optional: true, integer: true });
  const collisionCount = number_(payload, 'collisionCount', 0, 100000, { optional: true, integer: true });
  const attempts = number_(payload, 'attempts', 0, 10000, { optional: true, integer: true, fallback: 1 });
  const distance = number_(payload, 'distance', 0, 1000000, { optional: true });
  const maxAltitude = number_(payload, 'maxAltitude', -1000, 100000, { optional: true });
  const batteryUsed = number_(payload, 'batteryUsed', 0, 100000, { optional: true });
  const inputMode = oneOf_(payload, 'inputMode', INPUT_MODES_, { optional: true });
  const objectivesCompleted = number_(payload, 'objectivesCompleted', 0, 1000, { optional: true, integer: true });
  const objectivesTotal = number_(payload, 'objectivesTotal', 0, 1000, { optional: true, integer: true });
  const failReason = str_(payload, 'failReason', { optional: true, max: 60 });

  return withLock_(() => {
    const now = new Date();
    const endTime = clientTime_(payload, 'endTime', now);
    const user = lockedUser_(auth);
    const session = ownedSession_(sessionId, user);

    if (session.Success !== 'IN_PROGRESS') {
      return {
        sessionId: sessionId,
        pointsEarned: num_(session['Points Earned']),
        profile: profileOf_(user),
        duplicate: true,
      };
    }

    // A session cannot have lasted longer than the time between its two ends
    // (plus a minute of rounding), and nobody flies longer than the session.
    const start = session['Start Time'] instanceof Date ? session['Start Time'] : new Date(session['Start Time']);
    if (!isNaN(start.getTime())) {
      if (endTime.getTime() < start.getTime()) fail_('VALIDATION', 'endTime is before the session started');
      duration = Math.min(duration, (endTime.getTime() - start.getTime()) / 1000 + 60);
    }
    duration = Math.round(duration);
    flightTime = Math.round(Math.min(flightTime, duration));

    const type = session['Flight Type'];
    let maxScore = 0;
    if (type === 'MISSION') {
      const mission = table_(SHEET.MISSIONS).find((r) => r['Mission ID'] === session['Mission ID']);
      maxScore = mission ? num_(mission['Max Score']) : 0;
    } else if (type === 'TRAINING') {
      maxScore = TRAINING_MAX_SCORE;
    }
    score = maxScore > 0 ? Math.min(score, maxScore) : 0;
    const scoreRounded = Math.round(score * 100) / 100;
    const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : '';

    // Only the first completion of a mission or module pays in full.
    const catalogColumn = type === 'MISSION' ? 'Mission ID' : 'Training ID';
    const isRepeat =
      result === 'SUCCESS' &&
      type !== 'FREE_FLIGHT' &&
      !!table_(SHEET.SESSIONS).find(
        (r) =>
          r['User ID'] === user['User ID'] &&
          r['Session ID'] !== sessionId &&
          r['Flight Type'] === type &&
          r[catalogColumn] === session[catalogColumn] &&
          r.Success === 'SUCCESS',
      );
    const points = pointsFor_(session, result, score, stars, flightTime, isRepeat);

    table_(SHEET.SESSIONS).update(session, {
      'End Time': endTime,
      Duration: duration,
      'Flight Time': flightTime,
      'Points Earned': points,
      Score: scoreRounded,
      'Max Score': maxScore || '',
      'Score Percent': scorePercent,
      Stars: type === 'FREE_FLIGHT' ? '' : stars,
      Success: result,
      Attempts: attempts,
      'Crash Count': crashCount,
      'Collision Count': collisionCount,
      Distance: Math.round(distance * 10) / 10,
      'Max Altitude': Math.round(maxAltitude * 10) / 10,
      'Battery Used': Math.round(batteryUsed * 10) / 10,
      'Controls/Input Mode': inputMode || session['Controls/Input Mode'],
      'Objectives Completed': objectivesTotal > 0 ? objectivesCompleted : '',
      'Objectives Total': objectivesTotal > 0 ? objectivesTotal : '',
      'Fail Reason': failReason,
      Timestamp: now,
    });

    const totalPoints = num_(user['Total Points']) + points;
    const patch = {
      'Total Points': totalPoints,
      'Total Flights': num_(user['Total Flights']) + 1,
      'Total Flight Time': num_(user['Total Flight Time']) + flightTime,
      'Crash Count': num_(user['Crash Count']) + crashCount,
      'Current Level': levelFor_(totalPoints).level,
      'Last Active': now,
    };
    if (type === 'TRAINING') {
      patch['Training Flights'] = num_(user['Training Flights']) + 1;
      if (result === 'SUCCESS') patch['Training Completed'] = num_(user['Training Completed']) + 1;
    } else if (type === 'MISSION') {
      patch['Mission Flights'] = num_(user['Mission Flights']) + 1;
      if (result === 'SUCCESS') patch['Missions Completed'] = num_(user['Missions Completed']) + 1;
    } else {
      patch['Free Flights'] = num_(user['Free Flights']) + 1;
      patch['Free Flight Time'] = num_(user['Free Flight Time']) + flightTime;
    }
    // Average score counts finished attempts, not walk-aways.
    if (scorePercent !== '' && result !== 'ABORTED') {
      patch['Scored Sessions'] = num_(user['Scored Sessions']) + 1;
      patch['Score Percent Sum'] = num_(user['Score Percent Sum']) + scorePercent;
    }
    table_(SHEET.USERS).update(user, patch);

    return { sessionId: sessionId, pointsEarned: points, profile: profileOf_(user) };
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function recordEvents_(payload, auth) {
  const sessionId = str_(payload, 'sessionId', { optional: true, max: 20 });
  const events = payload.events;
  if (!Array.isArray(events) || events.length === 0) fail_('VALIDATION', 'events must be a non-empty array');
  if (events.length > 100) fail_('VALIDATION', 'at most 100 events per request');

  const now = new Date();
  const rows = events.map((e, i) => {
    if (!e || typeof e !== 'object') fail_('VALIDATION', 'events[' + i + '] must be an object');
    const type = str_(e, 'eventType', { max: 50 });
    if (!EVENT_TYPE_RE_.test(type)) fail_('VALIDATION', 'events[' + i + '].eventType must be UPPER_SNAKE_CASE');
    let data = '';
    if (e.eventData !== undefined && e.eventData !== null) {
      if (typeof e.eventData !== 'object') fail_('VALIDATION', 'events[' + i + '].eventData must be an object');
      data = JSON.stringify(e.eventData);
      if (data.length > 5000) fail_('VALIDATION', 'events[' + i + '].eventData is too large');
    }
    return { type: type, data: data, at: clientTime_(e, 'timestamp', now) };
  });

  return withLock_(() => {
    const user = lockedUser_(auth);
    if (sessionId) ownedSession_(sessionId, user);
    const ids = nextIds_('SEQ_EVENT', 'EVT-', 6, rows.length);
    table_(SHEET.EVENTS).append(
      rows.map((r, i) => ({
        'Event ID': ids[i],
        'Session ID': sessionId,
        'User ID': user['User ID'],
        'Event Type': r.type,
        'Event Data': r.data,
        Timestamp: r.at,
        'Received At': now,
      })),
    );
    return { eventIds: ids };
  });
}

function recordEvent_(payload, auth) {
  return recordEvents_(
    {
      sessionId: payload.sessionId,
      events: [{ eventType: payload.eventType, eventData: payload.eventData, timestamp: payload.timestamp }],
    },
    auth,
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function sessionSummary_(r) {
  return {
    sessionId: r['Session ID'],
    date: r.Date instanceof Date ? dayKey_(r.Date) : String(r.Date),
    startTime: iso_(r['Start Time']),
    flightType: r['Flight Type'],
    missionId: r['Mission ID'],
    missionName: r['Mission Name'],
    trainingId: r['Training ID'],
    trainingName: r['Training Name'],
    droneId: r['Drone ID'],
    droneName: r['Drone Name'],
    duration: num_(r.Duration),
    flightTime: num_(r['Flight Time']),
    score: num_(r.Score),
    stars: num_(r.Stars),
    pointsEarned: num_(r['Points Earned']),
    result: r.Success,
    crashCount: num_(r['Crash Count']),
  };
}

function timeOf_(value) {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function getUserDashboard_(payload, auth) {
  assertSelf_(payload, auth.user);
  const recentLimit = number_(payload, 'recentLimit', 1, 50, { optional: true, integer: true, fallback: 10 });
  const days = number_(payload, 'days', 1, 180, { optional: true, integer: true, fallback: 30 });
  const userId = auth.user['User ID'];

  const sessions = table_(SHEET.SESSIONS)
    .filter((r) => r['User ID'] === userId)
    .sort((a, b) => timeOf_(b['Start Time']) - timeOf_(a['Start Time']));
  const finished = sessions.filter((r) => r.Success !== 'IN_PROGRESS');

  // Daily series, oldest first, with empty days filled in so a chart's x axis
  // is continuous.
  const daily = [];
  const byDay = {};
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey_(new Date(today.getTime() - i * 86400000));
    const entry = { date: key, sessions: 0, points: 0, flightTimeSec: 0 };
    byDay[key] = entry;
    daily.push(entry);
  }
  finished.forEach((r) => {
    const entry = byDay[dayKey_(new Date(timeOf_(r['Start Time'])))];
    if (!entry) return;
    entry.sessions += 1;
    entry.points += num_(r['Points Earned']);
    entry.flightTimeSec += num_(r['Flight Time']);
  });

  const missions = table_(SHEET.MISSIONS)
    .rows()
    .slice()
    .sort((a, b) => num_(a.Order) - num_(b.Order))
    .map((m) => {
      const mine = finished.filter((r) => r['Mission ID'] === m['Mission ID']);
      return {
        missionId: m['Mission ID'],
        missionName: m['Mission Name'],
        sessions: mine.length,
        attempts: mine.reduce((s, r) => s + num_(r.Attempts), 0),
        completed: mine.filter((r) => r.Success === 'SUCCESS').length,
        bestScore: mine.reduce((s, r) => Math.max(s, num_(r.Score)), 0),
      };
    });

  const modules = table_(SHEET.TRAINING)
    .rows()
    .slice()
    .sort((a, b) => num_(a.Order) - num_(b.Order))
    .map((t) => {
      const mine = finished.filter((r) => r['Training ID'] === t['Training ID']);
      const done = mine.filter((r) => r.Success === 'SUCCESS');
      return {
        trainingId: t['Training ID'],
        trainingName: t['Training Name'],
        order: num_(t.Order),
        sessions: mine.length,
        completed: done.length > 0,
        bestStars: done.reduce((s, r) => Math.max(s, num_(r.Stars)), 0),
      };
    });

  const droneMap = {};
  finished.forEach((r) => {
    const id = r['Drone ID'];
    if (!droneMap[id]) {
      droneMap[id] = { droneId: id, droneName: r['Drone Name'], sessions: 0, flightTimeSec: 0, crashes: 0 };
    }
    droneMap[id].sessions += 1;
    droneMap[id].flightTimeSec += num_(r['Flight Time']);
    droneMap[id].crashes += num_(r['Crash Count']);
  });

  const missionSessions = finished.filter((r) => r['Flight Type'] === 'MISSION');
  const missionSuccesses = missionSessions.filter((r) => r.Success === 'SUCCESS').length;

  return {
    profile: profileOf_(auth.user),
    recentSessions: sessions.slice(0, recentLimit).map(sessionSummary_),
    daily: daily,
    missions: missions,
    training: {
      completed: modules.filter((m) => m.completed).length,
      total: modules.length,
      modules: modules,
    },
    drones: Object.keys(droneMap)
      .map((k) => droneMap[k])
      .sort((a, b) => b.flightTimeSec - a.flightTimeSec),
    missionCompletionRate:
      missionSessions.length > 0 ? Math.round((missionSuccesses / missionSessions.length) * 1000) / 10 : 0,
  };
}

// ==========================================================================
// Code.js
// ==========================================================================

// Web app entry point: routes JSON requests to the handlers in Api.js.
//
// The simulator POSTs `{ apiVersion, action, payload, authToken? }` with a
// text/plain body and reads back `{ success: true, data }` or
// `{ success: false, code, message }`. Apps Script always answers HTTP 200, so
// the envelope, not the status code, carries the outcome.

const PUBLIC_ACTIONS_ = {
  activateUser: activateUser_,
  loginUser: loginUser_,
};

/** Accepted signed out; attributed to the pilot when a valid token comes with it. */
const OPTIONAL_AUTH_ACTIONS_ = {
  reportCrashes: reportCrashes_,
};

const AUTHENTICATED_ACTIONS_ = {
  getUserProfile: getUserProfile_,
  getUserDashboard: getUserDashboard_,
  startSession: startSession_,
  endSession: endSession_,
  recordEvent: recordEvent_,
  recordEvents: recordEvents_,
};

function doPost(e) {
  return json_(handleRequest_(e && e.postData ? e.postData.contents : ''));
}

/** A health check, so a deployment URL can be tested from a browser. */
function doGet() {
  return json_({
    success: true,
    data: { service: 'plutosim-api', apiVersion: API_VERSION },
  });
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** Parse, route and run one request. Returns the response envelope. */
function handleRequest_(rawBody) {
  resetTableCache_();
  let body;
  try {
    body = JSON.parse(rawBody || '');
  } catch (err) {
    return { success: false, code: 'VALIDATION', message: 'Request body is not valid JSON' };
  }
  if (!body || typeof body !== 'object') {
    return { success: false, code: 'VALIDATION', message: 'Request body must be an object' };
  }

  const action = body.action;
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  try {
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS_, action)) {
      return { success: true, data: PUBLIC_ACTIONS_[action](payload) };
    }
    if (Object.prototype.hasOwnProperty.call(OPTIONAL_AUTH_ACTIONS_, action)) {
      let auth = null;
      if (body.authToken) {
        try {
          auth = authenticate_(body.authToken);
        } catch (err) {
          if (!(err instanceof ApiError_)) throw err;
        }
      }
      return { success: true, data: OPTIONAL_AUTH_ACTIONS_[action](payload, auth) };
    }
    if (Object.prototype.hasOwnProperty.call(AUTHENTICATED_ACTIONS_, action)) {
      const auth = authenticate_(body.authToken);
      touchToken_(auth.token);
      return { success: true, data: AUTHENTICATED_ACTIONS_[action](payload, auth) };
    }
    return { success: false, code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action };
  } catch (err) {
    if (err instanceof ApiError_) return { success: false, code: err.code, message: err.message };
    console.error('Unhandled error in ' + action + ': ' + (err && err.stack ? err.stack : err));
    return { success: false, code: 'SERVER_ERROR', message: 'Something went wrong on the server' };
  }
}

/** Record when a device was last seen, at most hourly to spare writes. */
function touchToken_(token) {
  const last = token['Last Used'] instanceof Date ? token['Last Used'].getTime() : 0;
  const now = new Date();
  if (now.getTime() - last < 60 * 60 * 1000) return;
  try {
    table_(SHEET.TOKENS).update(token, { 'Last Used': now });
  } catch (err) {
    // Bookkeeping only; never fail a request over it.
    console.warn('Could not update token Last Used: ' + err);
  }
}

// ==========================================================================
// Setup.js
// ==========================================================================

// Admin tools: create the database, seed the catalog, issue activation keys.
//
// Run from the "PlutoSim" menu in the spreadsheet (a script bound to the
// sheet), or pick the function in the Apps Script editor and press Run.
// Everything here is safe to run again: it adds what is missing and leaves
// existing rows and edits alone.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PlutoSim')
    .addItem('Set up / repair database', 'setupDatabase')
    .addItem('Generate activation keys…', 'promptGenerateKeys')
    .addSeparator()
    .addItem('Refresh analytics reports', 'refreshAnalytics')
    .addItem('Refresh reports every hour', 'installAnalyticsTrigger')
    .addToUi();
}

function setupDatabase() {
  const ss = spreadsheet_();
  Object.keys(SCHEMA).forEach((name) => ensureSheet_(ss, name, SCHEMA[name]));
  resetTableCache_();
  seedSettings_();
  seedCatalog_();
  return 'Database ready';
}

/** Create the sheet if needed and append any schema columns it lacks. */
function ensureSheet_(ss, name, columns) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const width = sheet.getLastColumn();
  const existing =
    width > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim()) : [];
  const missing = columns.filter((c) => existing.indexOf(c) < 0);
  if (missing.length > 0) {
    const start = existing.filter((h) => h !== '').length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  const headers = existing.filter((h) => h !== '').concat(missing);
  const header = sheet.getRange(1, 1, 1, headers.length);
  header.setFontWeight('bold');
  header.setBackground('#1f2937');
  header.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Date-time columns get a readable format for the whole column. Rows are
  // capped so a fresh sheet does not format a million empty cells.
  headers.forEach((h, i) => {
    if (DATETIME_COLUMNS.indexOf(h) >= 0) {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    } else if (h === 'Date') {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('yyyy-mm-dd');
    } else if (h === 'Activation Key' || h === 'Token Hash' || h === 'Client Session Key') {
      sheet.getRange(2, i + 1, 5000, 1).setNumberFormat('@');
    }
  });
  return sheet;
}

function seedSettings_() {
  const settings = table_(SHEET.SETTINGS);
  const rows = DEFAULT_SETTINGS.filter(([key]) => !settings.find((r) => r.Key === key)).map(
    ([key, value, description]) => ({ Key: key, Value: value, Description: description }),
  );
  settings.append(rows);
}

function seedCatalog_() {
  upsertCatalog_(SHEET.DRONES, 'Drone ID', CATALOG.drones, (d) => ({
    'Drone ID': d.id,
    'Drone Name': d.name,
    Model: d.model,
    'Sim Key': d.simKey,
    Status: 'ACTIVE',
  }));
  upsertCatalog_(SHEET.MISSIONS, 'Mission ID', CATALOG.missions, (m) => ({
    'Mission ID': m.id,
    'Mission Name': m.name,
    'Sim Key': m.simKey,
    'Max Score': m.maxScore,
    Order: m.order,
    Status: 'ACTIVE',
  }));
  upsertCatalog_(SHEET.TRAINING, 'Training ID', CATALOG.training, (t) => ({
    'Training ID': t.id,
    'Training Name': t.name,
    'Sim Key': t.simKey,
    Order: t.order,
    Status: 'ACTIVE',
  }));
}

/** Add catalog rows that are missing. Rows already there are left as edited. */
function upsertCatalog_(sheetName, idColumn, items, toRow) {
  const table = table_(sheetName);
  const fresh = items.filter((item) => !table.find((r) => r[idColumn] === item.id)).map(toRow);
  table.append(fresh);
}

// ---------------------------------------------------------------------------
// Activation keys
// ---------------------------------------------------------------------------

/** No 0/O, 1/I/L: keys get read aloud and typed from paper. */
const KEY_ALPHABET_ = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Four unbiased random characters from the key alphabet. */
function randomKeyBlock_() {
  let out = '';
  while (out.length < 4) {
    // A v4 UUID carries 122 bits from a secure source; Math.random does not.
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i + 2 <= hex.length && out.length < 4; i += 2) {
      const byte = parseInt(hex.substr(i, 2), 16);
      // Rejection sampling keeps every character equally likely.
      if (byte < 248) out += KEY_ALPHABET_.charAt(byte % KEY_ALPHABET_.length);
    }
  }
  return out;
}

function newActivationKey_() {
  return 'PLUTO-SIM-' + randomKeyBlock_() + '-' + randomKeyBlock_();
}

/**
 * Append `count` new AVAILABLE keys and return them. `notes` is stored beside
 * each (for example the school or batch the keys are for).
 */
function generateActivationKeys(count, notes) {
  const n = Math.max(1, Math.min(500, Math.floor(Number(count) || 10)));
  return withLock_(() => {
    const table = table_(SHEET.KEYS);
    const taken = {};
    table.rows().forEach((r) => (taken[String(r['Activation Key']).toUpperCase()] = true));
    const now = new Date();
    const keys = [];
    while (keys.length < n) {
      const key = newActivationKey_();
      if (taken[key]) continue;
      taken[key] = true;
      keys.push(key);
    }
    table.append(
      keys.map((key) => ({
        'Activation Key': key,
        Status: 'AVAILABLE',
        'Created Date': now,
        Notes: notes ? String(notes) : '',
      })),
    );
    return keys;
  });
}

/** For the editor's Run button, which cannot pass arguments. */
function generateTenActivationKeys() {
  const keys = generateActivationKeys(10, '');
  console.log(keys.join('\n'));
  return keys;
}

function promptGenerateKeys() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Generate activation keys', 'How many keys? (1-500)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const note = ui.prompt('Notes (optional)', 'Batch or recipient, stored beside each key', ui.ButtonSet.OK);
  const keys = generateActivationKeys(res.getResponseText(), note.getResponseText());
  ui.alert(keys.length + ' keys added to the ActivationKeys sheet.');
}

// ---------------------------------------------------------------------------
// Repairing hand-entered users
// ---------------------------------------------------------------------------

const USER_NUMBER_COLUMNS_ = [
  'Total Points',
  'Total Flights',
  'Total Flight Time',
  'Training Flights',
  'Mission Flights',
  'Free Flights',
  'Missions Completed',
  'Training Completed',
  'Free Flight Time',
  'Crash Count',
  'Scored Sessions',
  'Score Percent Sum',
];

/**
 * Make users typed straight into the Users sheet work like activated ones.
 *
 * Activation fills in a dozen columns, links the key in ActivationKeys and
 * advances the ID counter. A row added by hand has none of that, so its owner
 * cannot sign in and the next real activation reuses its ID. For every user row
 * this:
 *   - gives it a User ID if it has none, and lower-cases the email;
 *   - fills blank totals with 0, a blank Status with ACTIVE, blank dates with now;
 *   - marks its key ACTIVATED and linked to it (adding the key row if missing);
 *   - moves SEQ_USER past the highest USR- number in use.
 * A key already linked to a different email is reported and left alone. Safe to
 * run any number of times; rows that are already fine are not rewritten.
 */
function repairUsers() {
  return withLock_(() => {
    const now = new Date();
    const users = table_(SHEET.USERS);
    const keys = table_(SHEET.KEYS);
    const report = [];

    let highest = 0;
    users.rows().forEach((u) => {
      const m = /^USR-(\d+)$/.exec(String(u['User ID']).trim());
      if (m) highest = Math.max(highest, Number(m[1]));
    });
    const settings = table_(SHEET.SETTINGS);
    const counter = settings.find((r) => r.Key === 'SEQ_USER');
    if (counter && Number(counter.Value) < highest) {
      settings.update(counter, { Value: highest });
      report.push('SEQ_USER moved to ' + highest);
    }

    const seenEmails = {};
    users.rows().forEach((u) => {
      const patch = {};
      const label = String(u.Email || u['User ID'] || 'row ' + u._row);

      if (!String(u['User ID']).trim()) patch['User ID'] = nextIds_('SEQ_USER', 'USR-', 6, 1)[0];
      const userId = patch['User ID'] || String(u['User ID']).trim();
      if (userId !== u['User ID'] && !patch['User ID']) patch['User ID'] = userId;

      const email = String(u.Email || '').trim().toLowerCase();
      if (email !== u.Email) patch.Email = email;
      if (!EMAIL_RE_.test(email)) {
        report.push(label + ': email is missing or invalid, skipped');
        return;
      }
      if (seenEmails[email]) {
        report.push(label + ': same email as ' + seenEmails[email] + ', skipped');
        return;
      }
      seenEmails[email] = userId;

      USER_NUMBER_COLUMNS_.forEach((c) => {
        if (u[c] === '' || u[c] === null || isNaN(Number(u[c]))) patch[c] = 0;
      });
      if (!(u['Registration Date'] instanceof Date)) patch['Registration Date'] = now;
      if (!(u['Last Active'] instanceof Date)) patch['Last Active'] = patch['Registration Date'] || u['Registration Date'];
      if (!u.Status) patch.Status = 'ACTIVE';
      const points = patch['Total Points'] !== undefined ? 0 : num_(u['Total Points']);
      const level = levelFor_(points).level;
      if (num_(u['Current Level']) !== level) patch['Current Level'] = level;

      const key = String(u['Activation Key'] || '').trim().toUpperCase();
      if (key !== u['Activation Key']) patch['Activation Key'] = key;
      if (!KEY_RE_.test(key)) {
        report.push(label + ': activation key is missing or not PLUTO-SIM-XXXX-XXXX; user cannot sign in');
      } else {
        const keyRow = keys.find((r) => String(r['Activation Key']).trim().toUpperCase() === key);
        const linked = {
          'Activation Key': key,
          Status: 'ACTIVATED',
          'Assigned Email': email,
          'User ID': userId,
        };
        if (!keyRow) {
          keys.append(Object.assign({}, linked, { 'Created Date': now, 'Activated Date': now, Notes: 'added by repairUsers' }));
          report.push(label + ': added key ' + key);
        } else {
          const assigned = String(keyRow['Assigned Email'] || '').trim().toLowerCase();
          if (assigned && assigned !== email) {
            report.push(label + ': key ' + key + ' already belongs to ' + assigned + ', left alone');
          } else if (keyRow.Status === 'DISABLED') {
            report.push(label + ': key ' + key + ' is DISABLED, left alone');
          } else if (keyRow.Status !== 'ACTIVATED' || keyRow['User ID'] !== userId || keyRow['Assigned Email'] !== email) {
            keys.update(keyRow, Object.assign({}, linked, { 'Activated Date': keyRow['Activated Date'] || now }));
            report.push(label + ': linked key ' + key);
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        users.update(u, patch);
        report.push(label + ': filled ' + Object.keys(patch).join(', '));
      }
    });

    if (report.length === 0) report.push('Nothing to repair');
    console.log(report.join('\n'));
    return report;
  });
}

// ==========================================================================
// Crashes.js
// ==========================================================================

// Crash reports from the simulator.
//
// Accepted signed in or not: a crash on the activation screen is as worth
// knowing about as one mid-mission. When the report carries a valid token the
// row is attributed to that pilot; an expired or missing one just leaves the
// user columns blank rather than losing the report.
//
// Reports are grouped by a fingerprint computed here, not by the client: the
// kind, the message with its numbers and quoted values blanked, and the top
// stack frame without line numbers. "Cannot read properties of undefined
// (reading 'x')" at the same place is one issue however many times it fires.

const CRASH_KINDS_ = [
  'MAIN_EXCEPTION',
  'MAIN_REJECTION',
  'RENDERER_EXCEPTION',
  'RENDERER_REJECTION',
  'RENDER_ERROR',
  'RENDERER_GONE',
  'CHILD_PROCESS_GONE',
  'WEBGL_CONTEXT_LOST',
  'NATIVE_CRASH',
];

function crashFingerprint_(kind, message, stack) {
  const normalisedMessage = String(message)
    .split('\n')[0]
    .replace(/(['"`]).*?\1/g, '$1…$1')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .slice(0, 200);
  const frames = String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s/.test(l) || /@/.test(l));
  const topFrame = (frames[0] || '').replace(/:\d+(:\d+)?\)?$/, '').replace(/\?[^)\s]*/g, '');
  return sha256_(kind + '|' + normalisedMessage + '|' + topFrame).slice(0, 12);
}

function reportCrashes_(payload, auth) {
  const reports = payload.reports;
  if (!Array.isArray(reports) || reports.length === 0) fail_('VALIDATION', 'reports must be a non-empty array');
  if (reports.length > 20) fail_('VALIDATION', 'at most 20 reports per request');

  const now = new Date();
  const rows = reports.map((r, i) => {
    if (!r || typeof r !== 'object') fail_('VALIDATION', 'reports[' + i + '] must be an object');
    const kind = oneOf_(r, 'kind', CRASH_KINDS_);
    const message = str_(r, 'message', { max: 1000 });
    const stack = typeof r.stack === 'string' ? r.stack.slice(0, 8000) : '';
    let context = '';
    if (r.context !== undefined && r.context !== null) {
      if (typeof r.context !== 'object') fail_('VALIDATION', 'reports[' + i + '].context must be an object');
      context = JSON.stringify(r.context).slice(0, 4000);
    }
    let occurred = now;
    const at = new Date(r.occurredAt);
    // A report from a crash can arrive days late, and a broken clock is common
    // on exactly the machines that crash; keep the time but never reject over it.
    if (!isNaN(at.getTime()) && at.getTime() <= now.getTime() + CLOCK_SKEW_MS_) occurred = at;
    return {
      'Occurred At': occurred,
      'Received At': now,
      Kind: kind,
      Fatal: r.fatal === true,
      Message: message,
      Fingerprint: crashFingerprint_(kind, message, stack),
      'User ID': auth ? auth.user['User ID'] : '',
      Email: auth ? auth.user.Email : '',
      'Device ID': str_(r, 'deviceId', { optional: true, max: 128 }),
      'Device Name': str_(r, 'deviceName', { optional: true, max: 80 }),
      'App Version': str_(r, 'appVersion', { optional: true, max: 40 }),
      Platform: str_(r, 'platform', { optional: true, max: 40 }),
      'OS Version': str_(r, 'osVersion', { optional: true, max: 80 }),
      'Electron Version': str_(r, 'electronVersion', { optional: true, max: 40 }),
      Context: context,
      Stack: stack,
    };
  });

  // A crash loop must not be able to fill the sheet. Per device (or per caller
  // when there is none), per hour; the excess is acknowledged and dropped so the
  // client does not keep retrying it.
  const cache = CacheService.getScriptCache();
  const limit = setting_('MAX_CRASH_REPORTS_PER_HOUR', 60);
  const bucket = 'crash:' + (rows[0]['Device ID'] || rows[0]['User ID'] || 'anonymous');
  const used = Number(cache.get(bucket) || 0);
  const accepted = rows.slice(0, Math.max(0, limit - used));
  cache.put(bucket, String(used + rows.length), 60 * 60);
  if (accepted.length === 0) return { reportIds: [], dropped: rows.length };

  return withLock_(() => {
    const ids = nextIds_('SEQ_CRASH', 'CRS-', 6, accepted.length);
    table_(SHEET.CRASHES).append(accepted.map((row, i) => Object.assign({ 'Report ID': ids[i] }, row)));
    return { reportIds: ids, dropped: rows.length - accepted.length };
  });
}

// ==========================================================================
// Analytics.js
// ==========================================================================

// Admin analytics: computed report sheets over the raw tables.
//
// The raw sheets (FlightSessions, GameplayEvents, Users) are the record, and
// pivot tables or ad-hoc formulas over them are always an option. These reports
// answer the standing questions without anyone having to build one: they are
// recomputed from scratch by `refreshAnalytics`, from the menu or hourly once
// `installAnalyticsTrigger` has been run. Report sheets are overwritten on each
// refresh, so do not edit them by hand.
//
// A section may list `charts`, drawn beside the tables on refresh: one series
// per chart, so each reads without a legend.

const REPORT = {
  OVERVIEW: 'Report: Overview',
  USERS: 'Report: Users',
  MISSIONS: 'Report: Missions',
  TRAINING: 'Report: Training',
  DRONES: 'Report: Drones',
  CRASHES: 'Report: Crashes',
};

function refreshAnalytics() {
  resetTableCache_();
  const reports = buildAnalytics_(new Date());
  const ss = spreadsheet_();
  Object.keys(reports).forEach((name) => writeReport_(ss, name, reports[name]));
  return 'Reports refreshed';
}

function installAnalyticsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'refreshAnalytics')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshAnalytics').timeBased().everyHours(1).create();
  return 'Hourly refresh installed';
}

// ---------------------------------------------------------------------------
// Computation (no sheet writes; unit-tested)
// ---------------------------------------------------------------------------

function round1_(n) {
  return Math.round(n * 10) / 10;
}

function hours_(sec) {
  return round1_(sec / 3600);
}

function mean_(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function pct_(part, whole) {
  return whole > 0 ? round1_((part / whole) * 100) : 0;
}

function mode_(values) {
  const counts = {};
  let best = '';
  let bestCount = 0;
  values.forEach((v) => {
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) {
      best = v;
      bestCount = counts[v];
    }
  });
  return best ? best + ' (' + bestCount + ')' : '';
}

function distinct_(values) {
  const seen = {};
  values.forEach((v) => (seen[v] = true));
  return Object.keys(seen).length;
}

/**
 * Every report as { name: sections[] }, where a section is
 * { title, headers, rows }.
 */
function buildAnalytics_(now) {
  const users = table_(SHEET.USERS).rows();
  const keys = table_(SHEET.KEYS).rows();
  const all = table_(SHEET.SESSIONS).rows();
  const finished = all.filter((r) => r.Success !== 'IN_PROGRESS');
  const startMs = (r) => timeOf_(r['Start Time']);

  const dayMs = 86400000;
  const todayKey = dayKey_(now);
  const within = (ms) => finished.filter((r) => now.getTime() - startMs(r) <= ms);
  const pilotsIn = (rows) => distinct_(rows.map((r) => r['User ID']));
  const byType = (type) => finished.filter((r) => r['Flight Type'] === type);

  const overview = [
    {
      title: 'Users',
      headers: ['Metric', 'Value'],
      rows: [
        ['Registered users', users.length],
        ['Active accounts', users.filter((u) => u.Status === 'ACTIVE').length],
        ['Pilots who flew today', pilotsIn(finished.filter((r) => dayKey_(new Date(startMs(r))) === todayKey))],
        ['Pilots who flew in the last 7 days', pilotsIn(within(7 * dayMs))],
        ['Pilots who flew in the last 30 days', pilotsIn(within(30 * dayMs))],
        ['Activation keys available', keys.filter((k) => k.Status === 'AVAILABLE').length],
        ['Activation keys activated', keys.filter((k) => k.Status === 'ACTIVATED').length],
        ['Activation keys disabled', keys.filter((k) => k.Status === 'DISABLED').length],
      ],
    },
    {
      title: 'Activity',
      headers: ['Metric', 'Value'],
      rows: [
        ['Sessions (finished)', finished.length],
        ['Sessions still open', all.length - finished.length],
        ['Sessions today', finished.filter((r) => dayKey_(new Date(startMs(r))) === todayKey).length],
        ['Sessions in the last 7 days', within(7 * dayMs).length],
        ['Sessions in the last 30 days', within(30 * dayMs).length],
        ['Total flight time (hours)', hours_(finished.reduce((s, r) => s + num_(r['Flight Time']), 0))],
        ['Total session time (hours)', hours_(finished.reduce((s, r) => s + num_(r.Duration), 0))],
        ['Total points awarded', finished.reduce((s, r) => s + num_(r['Points Earned']), 0)],
        ['Training sessions', byType('TRAINING').length],
        ['Mission sessions', byType('MISSION').length],
        ['Free-flight sessions', byType('FREE_FLIGHT').length],
      ],
    },
    {
      title: 'Daily activity, last 30 days',
      headers: ['Date', 'Sessions', 'Active pilots', 'Flight hours', 'Points'],
      rows: dailyRows_(finished, now, 30),
      charts: [
        { type: 'COLUMN', title: 'Sessions per day', columns: [0, 1] },
        { type: 'COLUMN', title: 'Flight hours per day', columns: [0, 3] },
      ],
    },
    {
      title: 'Last refreshed',
      headers: ['Time'],
      rows: [[now]],
    },
  ];

  const userRows = users.slice().sort((a, b) => num_(b['Total Points']) - num_(a['Total Points'])).map((u) => {
    const mine = finished.filter((r) => r['User ID'] === u['User ID']);
    const scored = mine.filter((r) => r['Score Percent'] !== '' && r.Success !== 'ABORTED');
    return [
      u['User ID'],
      u.Name,
      u.Email,
      num_(u['Total Points']),
      num_(u['Current Level']),
      mine.length,
      hours_(mine.reduce((s, r) => s + num_(r['Flight Time']), 0)),
      mine.filter((r) => r['Flight Type'] === 'MISSION' && r.Success === 'SUCCESS').length,
      mine.filter((r) => r['Flight Type'] === 'TRAINING' && r.Success === 'SUCCESS').length,
      hours_(
        mine.filter((r) => r['Flight Type'] === 'FREE_FLIGHT').reduce((s, r) => s + num_(r['Flight Time']), 0),
      ),
      round1_(mean_(scored.map((r) => num_(r['Score Percent'])))),
      mine.reduce((s, r) => s + num_(r['Crash Count']), 0),
      u['Last Active'],
      u.Status,
    ];
  });

  const catalogReport = (catalogRows, idColumn, nameColumn, type) =>
    catalogRows
      .slice()
      .sort((a, b) => num_(a.Order) - num_(b.Order))
      .map((c) => {
        const rows = finished.filter((r) => r['Flight Type'] === type && r[idColumn] === c[idColumn]);
        const done = rows.filter((r) => r.Success === 'SUCCESS');
        const failed = rows.filter((r) => r.Success === 'FAILED');
        const attempts = rows.reduce((s, r) => s + num_(r.Attempts), 0);
        const base = [
          c[idColumn],
          c[nameColumn],
          rows.length,
          pilotsIn(rows),
          attempts,
          round1_(rows.length ? attempts / rows.length : 0),
          done.length,
          pct_(done.length, rows.length),
          round1_(mean_(done.map((r) => num_(r['Score Percent'])))),
          round1_(mean_(rows.map((r) => num_(r.Duration))) / 60),
          rows.reduce((s, r) => s + num_(r['Crash Count']), 0),
        ];
        return type === 'MISSION'
          ? base.concat([failed.length, mode_(failed.map((r) => String(r['Fail Reason'] || '')))])
          : base;
      });

  const catalogHeaders = [
    'Sessions',
    'Pilots',
    'Attempts',
    'Avg attempts / session',
    'Completions',
    'Completion rate %',
    'Avg score % (completed)',
    'Avg duration (min)',
    'Crashes',
  ];

  const droneRows = table_(SHEET.DRONES)
    .rows()
    .map((d) => {
      const rows = finished.filter((r) => r['Drone ID'] === d['Drone ID']);
      const crashes = rows.reduce((s, r) => s + num_(r['Crash Count']), 0);
      const flightSec = rows.reduce((s, r) => s + num_(r['Flight Time']), 0);
      const scored = rows.filter((r) => r['Score Percent'] !== '' && r.Success !== 'ABORTED');
      return [
        d['Drone ID'],
        d['Drone Name'],
        rows.length,
        pilotsIn(rows),
        hours_(flightSec),
        rows.filter((r) => r['Flight Type'] === 'MISSION' && r.Success === 'SUCCESS').length,
        round1_(mean_(scored.map((r) => num_(r['Score Percent'])))),
        crashes,
        pct_(rows.filter((r) => num_(r['Crash Count']) > 0).length, rows.length),
        flightSec > 0 ? round1_(crashes / (flightSec / 3600)) : 0,
      ];
    })
    .sort((a, b) => b[2] - a[2]);

  const reports = {};
  reports[REPORT.CRASHES] = crashReport_(now);
  reports[REPORT.OVERVIEW] = overview;
  reports[REPORT.USERS] = [
    {
      title: 'Per user',
      headers: [
        'User ID',
        'Name',
        'Email',
        'Total points',
        'Level',
        'Sessions',
        'Flight time (h)',
        'Missions completed',
        'Training completed',
        'Free-flight time (h)',
        'Avg score %',
        'Crashes',
        'Last active',
        'Status',
      ],
      rows: userRows,
      charts: [{ type: 'BAR', title: 'Top pilots by points', columns: [1, 3], maxRows: 10 }],
    },
  ];
  reports[REPORT.MISSIONS] = [
    {
      title: 'Per mission',
      headers: ['Mission ID', 'Mission'].concat(catalogHeaders, ['Failures', 'Most common failure']),
      rows: catalogReport(table_(SHEET.MISSIONS).rows(), 'Mission ID', 'Mission Name', 'MISSION'),
      charts: [{ type: 'BAR', title: 'Mission completion rate %', columns: [1, 7] }],
    },
  ];
  reports[REPORT.TRAINING] = [
    {
      title: 'Per training module',
      headers: ['Training ID', 'Module'].concat(catalogHeaders),
      rows: catalogReport(table_(SHEET.TRAINING).rows(), 'Training ID', 'Training Name', 'TRAINING'),
      charts: [{ type: 'BAR', title: 'Training sessions by module', columns: [1, 2] }],
    },
  ];
  reports[REPORT.DRONES] = [
    {
      title: 'Per drone',
      headers: [
        'Drone ID',
        'Drone',
        'Sessions',
        'Pilots',
        'Flight time (h)',
        'Missions completed',
        'Avg score %',
        'Crashes',
        'Sessions with a crash %',
        'Crashes per flight hour',
      ],
      rows: droneRows,
      charts: [{ type: 'BAR', title: 'Flight hours by drone', columns: [1, 4] }],
    },
  ];
  return reports;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Crash totals, a daily count, and issues grouped by fingerprint. */
function crashReport_(now) {
  const crashes = table_(SHEET.CRASHES).rows();
  const at = (r) => timeOf_(r['Occurred At']);
  const dayMs = 86400000;
  const recent = (ms) => crashes.filter((r) => now.getTime() - at(r) <= ms);
  const devices = (rows) => distinct_(rows.map((r) => r['Device ID'] || r['Report ID']));

  const byKind = {};
  crashes.forEach((r) => (byKind[r.Kind] = (byKind[r.Kind] || 0) + 1));

  const issues = {};
  crashes.forEach((r) => {
    const key = r.Fingerprint;
    const issue =
      issues[key] ||
      (issues[key] = { rows: [], first: at(r), last: at(r), latest: r });
    issue.rows.push(r);
    issue.first = Math.min(issue.first, at(r));
    if (at(r) >= issue.last) {
      issue.last = at(r);
      issue.latest = r;
    }
  });
  const issueRows = Object.keys(issues)
    .map((key) => {
      const i = issues[key];
      return [
        key,
        i.latest.Kind,
        i.rows.length,
        i.rows.filter((r) => r.Fatal === true || r.Fatal === 'TRUE').length,
        distinct_(i.rows.filter((r) => r['User ID']).map((r) => r['User ID'])),
        devices(i.rows),
        new Date(i.first),
        new Date(i.last),
        i.latest['App Version'],
        i.latest.Message,
      ];
    })
    .sort((a, b) => b[2] - a[2]);

  const daily = [];
  for (let d = 29; d >= 0; d--) {
    const key = dayKey_(new Date(now.getTime() - d * dayMs));
    daily.push([key, crashes.filter((r) => dayKey_(new Date(at(r))) === key).length]);
  }

  return [
    {
      title: 'Crashes',
      headers: ['Metric', 'Value'],
      rows: [
        ['Reports, last 24 hours', recent(dayMs).length],
        ['Reports, last 7 days', recent(7 * dayMs).length],
        ['Reports, all time', crashes.length],
        ['Fatal, last 7 days', recent(7 * dayMs).filter((r) => r.Fatal === true || r.Fatal === 'TRUE').length],
        ['Devices affected, last 7 days', devices(recent(7 * dayMs))],
        ['Distinct issues', issueRows.length],
      ],
    },
    {
      title: 'By kind',
      headers: ['Kind', 'Reports'],
      rows: Object.keys(byKind)
        .sort((a, b) => byKind[b] - byKind[a])
        .map((k) => [k, byKind[k]]),
    },
    {
      title: 'Crashes per day, last 30 days',
      headers: ['Date', 'Reports'],
      rows: daily,
      charts: [{ type: 'COLUMN', title: 'Crash reports per day', columns: [0, 1] }],
    },
    {
      title: 'Issues (same fingerprint = same fault)',
      headers: [
        'Fingerprint',
        'Kind',
        'Reports',
        'Fatal',
        'Pilots',
        'Devices',
        'First seen',
        'Last seen',
        'Latest app version',
        'Message',
      ],
      rows: issueRows,
    },
  ];
}

/** One row per day, oldest first: date, sessions, pilots, flight hours, points. */
function dailyRows_(finished, now, days) {
  const byDay = {};
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey_(new Date(now.getTime() - i * 86400000));
    byDay[key] = { sessions: 0, pilots: {}, flightSec: 0, points: 0 };
    rows.push(key);
  }
  finished.forEach((r) => {
    const day = byDay[dayKey_(new Date(timeOf_(r['Start Time'])))];
    if (!day) return;
    day.sessions += 1;
    day.pilots[r['User ID']] = true;
    day.flightSec += num_(r['Flight Time']);
    day.points += num_(r['Points Earned']);
  });
  return rows.map((key) => {
    const d = byDay[key];
    return [key, d.sessions, Object.keys(d.pilots).length, hours_(d.flightSec), d.points];
  });
}

const CHART_COLOR_ = '#1d7fb8';

function writeReport_(ss, name, sections) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  sheet.getCharts().forEach((c) => sheet.removeChart(c));
  const widest = sections.reduce((w, s) => Math.max(w, s.headers.length), 1);
  let row = 1;
  let chartRow = 1;
  sections.forEach((section) => {
    sheet.getRange(row, 1, 1, 1).setValues([[section.title]]).setFontWeight('bold');
    row += 1;
    const width = section.headers.length;
    const headerRow = row;
    sheet.getRange(row, 1, 1, width).setValues([section.headers]).setFontWeight('bold');
    row += 1;
    if (section.rows.length > 0) {
      sheet.getRange(row, 1, section.rows.length, width).setValues(section.rows);
      row += section.rows.length;
    }

    (section.charts || []).forEach((chart) => {
      if (section.rows.length === 0) return;
      const count = Math.min(section.rows.length, chart.maxRows || section.rows.length) + 1;
      let builder = sheet
        .newChart()
        .setChartType(Charts.ChartType[chart.type])
        .setNumHeaders(1)
        .setOption('title', chart.title)
        .setOption('legend', { position: 'none' })
        .setOption('colors', [CHART_COLOR_])
        .setOption('width', 620)
        .setOption('height', 300);
      chart.columns.forEach((c) => {
        builder = builder.addRange(sheet.getRange(headerRow, c + 1, count, 1));
      });
      // Charts stack down a column to the right of the widest table.
      sheet.insertChart(builder.setPosition(chartRow, widest + 2, 0, 0).build());
      chartRow += 16;
    });
    row += 1;
  });
}
