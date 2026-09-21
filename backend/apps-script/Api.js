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

/** `extra` fields go into the error envelope beside `code` and `message`. */
function ApiError_(code, message, extra) {
  this.code = code;
  this.message = message;
  this.extra = extra;
}

function fail_(code, message, extra) {
  throw new ApiError_(code, message, extra);
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
 * One profile, one computer at a time.
 *
 * The profile is bound to the computer it last signed in on. Another computer
 * takes it over straight away when that one is signed out, and only with
 * `signOutOthers` (the pilot confirmed "Sign out of all devices") while it is
 * still signed in; until then SIGNED_IN_ELSEWHERE names it so the app can ask.
 * The old computer's tokens are revoked by issueToken_, and a token for a
 * computer the profile is no longer bound to is refused by authenticate_.
 * Returns the patch that records a new binding.
 */
function bindDevice_(user, device, now, signOutOthers) {
  const bound = cell_(user['Device ID']);
  if (bound === device.id) {
    return cell_(user['Device Name']) === device.name ? {} : { 'Device Name': device.name };
  }
  const boundSignedIn = activeTokens_(user['User ID']).some((t) => cell_(t['Device ID']) === bound);
  if (bound && boundSignedIn && !signOutOthers) {
    const where = cell_(user['Device Name']) || 'another computer';
    fail_(
      'SIGNED_IN_ELSEWHERE',
      'This profile is signed in on ' + where + '. Update PlutoSim to sign it out there and continue here.',
      { deviceName: where },
    );
  }
  return { 'Device ID': device.id, 'Device Name': device.name, 'Device Bound At': now };
}

function activeTokens_(userId) {
  return table_(SHEET.TOKENS).filter(
    (r) => cell_(r['User ID']) === cell_(userId) && cell_(r.Status) === 'ACTIVE',
  );
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/**
 * Sign a computer in. Its token becomes the profile's only ACTIVE one: every
 * other is revoked, including older ones from this same computer, so the
 * AuthTokens sheet reads as the profile's sign-in status and history.
 */
function issueToken_(userId, deviceId, now) {
  const token = newToken_();
  table_(SHEET.TOKENS).updateColumn(activeTokens_(userId), 'Status', 'REVOKED');
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
  if (!token) fail_('AUTH_INVALID', 'Session expired. Sign in again.');
  const user = table_(SHEET.USERS).find((r) => r['User ID'] === token['User ID']);
  if (!user) fail_('AUTH_INVALID', 'Account not found. Sign in again.');
  // A token only works on the computer the profile is bound to. Another
  // computer taking the profile over (or an admin clearing the binding) signs
  // this one out, and says where the profile went. Checked before Status: the
  // takeover also revoked this token, and "expired" would not explain it.
  if (cell_(token['Device ID']) !== cell_(user['Device ID'])) {
    const where = cell_(user['Device Name']);
    fail_(
      'AUTH_INVALID',
      where
        ? 'This profile is now signed in on ' + where + '. Sign in again to use it here.'
        : 'This profile has been moved to another computer. Sign in again.',
    );
  }
  if (cell_(token.Status) !== 'ACTIVE') fail_('AUTH_INVALID', 'Session expired. Sign in again.');
  if (user.Status !== 'ACTIVE') fail_('USER_INACTIVE', 'This account has been deactivated');
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
  // Only read the limit when there is something to compare: this runs before
  // the lock, whose table reset would make the Settings read a wasted round trip.
  if (count > 0 && count >= setting_('MAX_LOGIN_FAILURES', 10)) {
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
        const binding = bindDevice_(existing, device, now, signOutOthers_(payload));
        users.update(existing, Object.assign({ 'Last Active': now }, binding));
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

      const binding = bindDevice_(user, device, now, signOutOthers_(payload));
      table_(SHEET.USERS).update(user, Object.assign({ 'Last Active': now }, binding));
      return {
        userId: user['User ID'],
        authToken: issueToken_(user['User ID'], device.id, now),
        profile: profileOf_(user),
      };
    }),
  );
}

/** The pilot confirmed "Sign out of all devices" for a profile signed in elsewhere. */
function signOutOthers_(payload) {
  return payload.signOutOtherDevices === true;
}

/**
 * Sign this computer out: revoke the caller's token, so the sheet shows it and
 * the next computer to sign in does so without being asked.
 */
function signOut_(payload, auth) {
  return withLock_(() => {
    const hash = auth.token['Token Hash'];
    const token = table_(SHEET.TOKENS).find((r) => r['Token Hash'] === hash);
    if (token) table_(SHEET.TOKENS).updateColumn([token], 'Status', 'REVOKED');
    return { signedOut: true };
  });
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
