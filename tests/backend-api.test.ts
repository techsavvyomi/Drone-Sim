import { beforeEach, describe, expect, it } from 'vitest';
import { loadBackend, type Backend } from './helpers/appsScript';

// The Apps Script API, run in Node over an in-memory spreadsheet.
//
// These pin the rules the prototype exists to prove: a key belongs to one email
// forever, identity comes from the token and never from the payload, and every
// total is the server's arithmetic rather than the client's claim.

let be: Backend;

/** The computer the test pilot signs in from. */
const DEVICE = { deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' };
const OTHER_DEVICE = { deviceId: 'device-bbbbbbbbbbbbbbbb', deviceName: 'Home Mac (macOS)' };

function newKey(): string {
  return be.fn.generateActivationKeys(1)[0];
}

function activate(name = 'Omkar', email = 'omkar@example.com', key = newKey()) {
  const res = be.call('activateUser', { ...DEVICE, name, email, activationKey: key });
  expect(res.success).toBe(true);
  return { ...res.data, key };
}

function keyRow(key: string) {
  return be.ss.sheet('ActivationKeys').objects().find((r) => r['Activation Key'] === key)!;
}

function userRow(userId: string) {
  return be.ss.sheet('Users').objects().find((r) => r['User ID'] === userId)!;
}

function setCell(sheet: string, match: (r: Record<string, unknown>) => boolean, column: string, value: unknown) {
  const s = be.ss.sheet(sheet);
  const headers = s.data[0] as string[];
  const row = s.data.findIndex((r, i) => i > 0 && match(Object.fromEntries(headers.map((h, j) => [h, r[j]]))));
  s.data[row][headers.indexOf(column)] = value;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

function start(token: string, userId: string, overrides: Record<string, unknown> = {}) {
  return be.call(
    'startSession',
    {
      userId,
      flightType: 'MISSION',
      missionId: 'MISSION-001',
      droneId: 'DRONE-002',
      inputMode: 'KEYBOARD',
      startTime: minutesAgo(10),
      clientSessionKey: crypto.randomUUID(),
      ...overrides,
    },
    token,
  );
}

function end(token: string, sessionId: string, overrides: Record<string, unknown> = {}) {
  return be.call(
    'endSession',
    {
      sessionId,
      endTime: new Date().toISOString(),
      duration: 420,
      flightTime: 380,
      result: 'SUCCESS',
      score: 12,
      stars: 2,
      crashCount: 1,
      attempts: 2,
      ...overrides,
    },
    token,
  );
}

beforeEach(() => {
  be = loadBackend();
  be.fn.setupDatabase();
});

describe('setup', () => {
  it('creates every table with its headers and seeds the catalog once', () => {
    for (const name of [
      'Users',
      'ActivationKeys',
      'AuthTokens',
      'FlightSessions',
      'GameplayEvents',
      'Drones',
      'Missions',
      'TrainingModules',
      'Settings',
      'CrashReports',
    ]) {
      expect(be.ss.getSheetByName(name), name).not.toBeNull();
    }
    expect(be.ss.sheet('Users').data[0]).toContain('User ID');
    expect(be.ss.sheet('Drones').objects()).toHaveLength(3);

    be.fn.setupDatabase();
    expect(be.ss.sheet('Drones').objects()).toHaveLength(3);
    expect(be.ss.sheet('Missions').objects()).toHaveLength(6);
    expect(be.ss.sheet('TrainingModules').objects()).toHaveLength(15);
    expect(be.ss.sheet('Settings').objects().filter((r) => r.Key === 'SEQ_USER')).toHaveLength(1);
  });

  it('answers a health check on GET', () => {
    expect(be.get()).toEqual({ success: true, data: { service: 'plutosim-api', apiVersion: 1 } });
  });

  it('generates unique, well-formed, AVAILABLE keys', () => {
    const keys: string[] = be.fn.generateActivationKeys(200, 'Batch A');
    expect(new Set(keys).size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^PLUTO-SIM-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const rows = be.ss.sheet('ActivationKeys').objects();
    expect(rows.every((r) => r.Status === 'AVAILABLE' && r.Notes === 'Batch A')).toBe(true);
  });
});

describe('request envelope', () => {
  it('rejects bad JSON and unknown actions without throwing', () => {
    expect(be.raw('not json')).toMatchObject({ success: false, code: 'VALIDATION' });
    expect(be.call('dropTables', {})).toMatchObject({ success: false, code: 'UNKNOWN_ACTION' });
  });

  it('requires a valid token for everything but activation and login', () => {
    for (const action of ['getUserProfile', 'getUserDashboard', 'startSession', 'endSession', 'recordEvents']) {
      expect(be.call(action, {}).code, action).toBe('AUTH_INVALID');
      expect(be.call(action, {}, 'forged-token').code, action).toBe('AUTH_INVALID');
    }
  });
});

describe('activation', () => {
  it('creates a user, links the key permanently and returns a token', () => {
    const { userId, authToken, profile, key } = activate();
    expect(userId).toBe('USR-000001');
    expect(authToken).toMatch(/^[0-9a-f]{64}$/);
    expect(profile).toMatchObject({ name: 'Omkar', email: 'omkar@example.com', level: 1 });

    expect(keyRow(key)).toMatchObject({ Status: 'ACTIVATED', 'Assigned Email': 'omkar@example.com', 'User ID': userId });
    // Only the hash is stored.
    const tokens = be.ss.sheet('AuthTokens').objects();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]['Token Hash']).not.toBe(authToken);

    expect(activate('Second', 'second@example.com').userId).toBe('USR-000002');
  });

  it('normalises email case and key case', () => {
    const key = newKey();
    const res = be.call('activateUser', { ...DEVICE, name: 'A', email: '  Pilot@Example.COM ', activationKey: key.toLowerCase() });
    expect(res.success).toBe(true);
    expect(res.data.profile.email).toBe('pilot@example.com');
  });

  it('refuses an activated key for any other email, forever', () => {
    const { key } = activate();
    const res = be.call('activateUser', { ...DEVICE, name: 'Thief', email: 'thief@example.com', activationKey: key });
    expect(res).toMatchObject({ success: false, code: 'KEY_ALREADY_USED' });
    expect(keyRow(key)['Assigned Email']).toBe('omkar@example.com');
    expect(be.ss.sheet('Users').objects()).toHaveLength(1);
  });

  it('lets the owner re-enter their own key and get the same account back', () => {
    const first = activate();
    const again = be.call('activateUser', { ...DEVICE, name: 'Omkar', email: 'omkar@example.com', activationKey: first.key });
    expect(again.success).toBe(true);
    expect(again.data).toMatchObject({ userId: first.userId, existingUser: true });
    expect(be.ss.sheet('Users').objects()).toHaveLength(1);
  });

  it('rejects unknown, disabled and malformed keys, and a second key for one email', () => {
    expect(be.call('activateUser', { ...DEVICE, name: 'A', email: 'a@x.io', activationKey: 'PLUTO-SIM-AAAA-AAAA' }).code).toBe(
      'KEY_NOT_FOUND',
    );

    const disabled = newKey();
    setCell('ActivationKeys', (r) => r['Activation Key'] === disabled, 'Status', 'DISABLED');
    expect(be.call('activateUser', { ...DEVICE, name: 'A', email: 'a@x.io', activationKey: disabled }).code).toBe('KEY_DISABLED');

    expect(be.call('activateUser', { ...DEVICE, name: 'A', email: 'a@x.io', activationKey: 'hello' }).code).toBe('VALIDATION');
    expect(be.call('activateUser', { ...DEVICE, name: 'A', email: 'not-an-email', activationKey: newKey() }).code).toBe(
      'VALIDATION',
    );
    expect(be.call('activateUser', { ...DEVICE, email: 'a@x.io', activationKey: newKey() }).code).toBe('VALIDATION');

    activate('A', 'a@x.io');
    const second = newKey();
    expect(be.call('activateUser', { ...DEVICE, name: 'A', email: 'a@x.io', activationKey: second }).code).toBe(
      'EMAIL_ALREADY_REGISTERED',
    );
    // The refused key stays available for someone else.
    expect(keyRow(second).Status).toBe('AVAILABLE');
  });

  it('stores typed text as text, never as a formula', () => {
    const { userId } = activate('=IMPORTXML("http://evil","//a")');
    expect(String(userRow(userId).Name).startsWith("'=")).toBe(true);
  });

  it('locks an email out after repeated failures', () => {
    for (let i = 0; i < 10; i++) {
      be.call('loginUser', { ...DEVICE, email: 'victim@example.com', activationKey: 'PLUTO-SIM-AAAA-AAAA' });
    }
    const res = be.call('loginUser', { ...DEVICE, email: 'victim@example.com', activationKey: 'PLUTO-SIM-AAAA-AAAA' });
    expect(res.message).toMatch(/Too many failed attempts/);
  });
});

describe('one device per profile', () => {
  it('binds the profile to the computer it was activated on', () => {
    const { userId, key } = activate();
    expect(userRow(userId)).toMatchObject({ 'Device ID': DEVICE.deviceId, 'Device Name': 'Lab PC 1 (Windows)' });
    expect(be.call('loginUser', { ...DEVICE, email: 'omkar@example.com', activationKey: key }).data.profile.device).toMatchObject({
      name: 'Lab PC 1 (Windows)',
    });
  });

  it('refuses another computer, by name, for sign-in and for re-activation', () => {
    const { key } = activate();
    const login = be.call('loginUser', { ...OTHER_DEVICE, email: 'omkar@example.com', activationKey: key });
    expect(login).toMatchObject({ success: false, code: 'DEVICE_MISMATCH' });
    expect(login.message).toContain('Lab PC 1 (Windows)');
    const again = be.call('activateUser', { ...OTHER_DEVICE, name: 'Omkar', email: 'omkar@example.com', activationKey: key });
    expect(again.code).toBe('DEVICE_MISMATCH');
    // No token was issued to the refused computer.
    expect(be.ss.sheet('AuthTokens').objects()).toHaveLength(1);
  });

  it('moves to a new computer when the admin clears the binding, and signs the old one out', () => {
    const { userId, key, authToken: oldToken } = activate();
    setCell('Users', (r) => r['User ID'] === userId, 'Device ID', '');
    setCell('Users', (r) => r['User ID'] === userId, 'Device Name', '');

    // The old computer's token stops working as soon as the binding changes.
    expect(be.call('getUserProfile', { userId }, oldToken).code).toBe('AUTH_INVALID');

    const moved = be.call('loginUser', { ...OTHER_DEVICE, email: 'omkar@example.com', activationKey: key });
    expect(moved.success).toBe(true);
    expect(userRow(userId)['Device ID']).toBe(OTHER_DEVICE.deviceId);
    expect(be.call('getUserProfile', { userId }, moved.data.authToken).success).toBe(true);
    expect(be.call('loginUser', { ...DEVICE, email: 'omkar@example.com', activationKey: key }).code).toBe('DEVICE_MISMATCH');
  });

  it('binds an account that predates device locking on its next sign-in', () => {
    const { userId, key } = activate();
    setCell('Users', (r) => r['User ID'] === userId, 'Device ID', '');
    expect(be.call('loginUser', { ...OTHER_DEVICE, email: 'omkar@example.com', activationKey: key }).success).toBe(true);
    expect(userRow(userId)['Device ID']).toBe(OTHER_DEVICE.deviceId);
  });

  it('requires a device id, and does not count a device refusal as a guess', () => {
    const key = newKey();
    expect(be.call('activateUser', { name: 'A', email: 'a@x.io', activationKey: key }).code).toBe('VALIDATION');
    expect(be.call('activateUser', { deviceId: 'short', name: 'A', email: 'a@x.io', activationKey: key }).code).toBe(
      'VALIDATION',
    );
    const { key: owned } = activate('B', 'b@x.io');
    for (let i = 0; i < 12; i++) be.call('loginUser', { ...OTHER_DEVICE, email: 'b@x.io', activationKey: owned });
    expect(be.call('loginUser', { ...DEVICE, email: 'b@x.io', activationKey: owned }).success).toBe(true);
  });

  it('adds the device columns to a sheet created before they existed', () => {
    const users = be.ss.sheet('Users');
    const headers = users.data[0] as string[];
    const cut = headers.indexOf('Device ID');
    users.data = users.data.map((r) => r.slice(0, cut));
    be.fn.resetTableCache_();
    expect(activate('Old', 'old@example.com').userId).toBe('USR-000001');
    expect((users.data[0] as string[]).slice(-3)).toEqual(['Device ID', 'Device Name', 'Device Bound At']);
  });

  it('matches sheet cells that carry stray spaces', () => {
    const { userId, key } = activate();
    setCell('Users', (r) => r['User ID'] === userId, 'Email', 'omkar@example.com  ');
    setCell('ActivationKeys', (r) => r['Activation Key'] === key, 'Activation Key', ` ${key} `);
    expect(be.call('loginUser', { ...DEVICE, email: 'omkar@example.com', activationKey: key }).success).toBe(true);
  });
});

describe('repairUsers', () => {
  it('makes a hand-typed user row sign in, and moves the ID counter past it', () => {
    const users = be.ss.sheet('Users');
    const headers = users.data[0] as string[];
    const row = headers.map(() => '' as unknown);
    const set = (col: string, v: unknown) => (row[headers.indexOf(col)] = v);
    set('User ID', 'USR-000001');
    set('Name', 'Omkar Dandekar');
    set('Email', 'Omi007Dandekar@gmail.com ');
    set('Activation Key', 'PLUTO-SIM-7K2P-X9MQ');
    users.data.push(row);

    expect(
      be.call('loginUser', { ...DEVICE, email: 'omi007dandekar@gmail.com', activationKey: 'PLUTO-SIM-7K2P-X9MQ' }).code,
    ).toBe('INVALID_CREDENTIALS');

    const report: string[] = be.fn.repairUsers();
    expect(report.join('\n')).toMatch(/added key PLUTO-SIM-7K2P-X9MQ/);

    const login = be.call('loginUser', { ...DEVICE, email: 'omi007dandekar@gmail.com', activationKey: 'PLUTO-SIM-7K2P-X9MQ' });
    expect(login.success).toBe(true);
    expect(login.data.profile).toMatchObject({ userId: 'USR-000001', status: 'ACTIVE', level: 1 });
    expect(login.data.profile.stats.totalPoints).toBe(0);

    // The next real activation does not reuse USR-000001.
    expect(activate('Next', 'next@example.com').userId).toBe('USR-000002');
    // And running it again changes nothing.
    expect(be.fn.repairUsers()).toEqual(['Nothing to repair']);
  });

  it('links an existing AVAILABLE key but never steals one bound to another email', () => {
    const owner = activate('Owner', 'owner@example.com');
    const free = newKey();
    const users = be.ss.sheet('Users');
    const headers = users.data[0] as string[];
    const add = (id: string, email: string, key: string) => {
      const row = headers.map(() => '' as unknown);
      row[headers.indexOf('User ID')] = id;
      row[headers.indexOf('Email')] = email;
      row[headers.indexOf('Activation Key')] = key;
      users.data.push(row);
    };
    add('USR-000007', 'typed@example.com', free);
    add('USR-000008', 'thief@example.com', owner.key);

    const report: string[] = be.fn.repairUsers();
    expect(report.join('\n')).toMatch(/already belongs to owner@example.com/);
    expect(keyRow(free)).toMatchObject({ Status: 'ACTIVATED', 'User ID': 'USR-000007' });
    expect(keyRow(owner.key)['Assigned Email']).toBe('owner@example.com');
    expect(be.call('loginUser', { ...DEVICE, email: 'typed@example.com', activationKey: free }).success).toBe(true);
    expect(activate('After', 'after@example.com').userId).toBe('USR-000009');
  });
});

describe('login', () => {
  it('signs a returning user in with email + key', () => {
    const { userId, key } = activate();
    const res = be.call('loginUser', { ...DEVICE, email: 'OMKAR@example.com', activationKey: key });
    expect(res.success).toBe(true);
    expect(res.data.userId).toBe(userId);
    expect(be.call('getUserProfile', { userId }, res.data.authToken).success).toBe(true);
  });

  it('gives one answer for every mismatch', () => {
    const a = activate('A', 'a@example.com');
    const b = activate('B', 'b@example.com');
    expect(be.call('loginUser', { ...DEVICE, email: 'a@example.com', activationKey: b.key }).code).toBe('INVALID_CREDENTIALS');
    expect(be.call('loginUser', { ...DEVICE, email: 'nobody@example.com', activationKey: a.key }).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(be.call('loginUser', { ...DEVICE, email: 'a@example.com', activationKey: 'PLUTO-SIM-ZZZZ-ZZZZ' }).code).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('refuses a deactivated user and a revoked device', () => {
    const { userId, authToken, key } = activate();
    setCell('AuthTokens', () => true, 'Status', 'REVOKED');
    expect(be.call('getUserProfile', { userId }, authToken).code).toBe('AUTH_INVALID');

    setCell('Users', (r) => r['User ID'] === userId, 'Status', 'INACTIVE');
    expect(be.call('loginUser', { ...DEVICE, email: 'omkar@example.com', activationKey: key }).code).toBe('USER_INACTIVE');
  });
});

describe('profile access', () => {
  it('never returns another user through a userId in the payload', () => {
    const a = activate('A', 'a@example.com');
    const b = activate('B', 'b@example.com');
    expect(be.call('getUserProfile', { userId: b.userId }, a.authToken).code).toBe('FORBIDDEN');
    expect(be.call('getUserDashboard', { userId: b.userId }, a.authToken).code).toBe('FORBIDDEN');
    expect(be.call('startSession', { userId: b.userId }, a.authToken).code).toBe('FORBIDDEN');
  });
});

describe('sessions', () => {
  it('validates flight type and catalog ids', () => {
    const { userId, authToken } = activate();
    expect(start(authToken, userId, { flightType: 'RACING' }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { droneId: 'DRONE-999' }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { missionId: 'MISSION-999' }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { missionId: undefined }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { flightType: 'TRAINING', trainingId: undefined }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { startTime: new Date(Date.now() + 3600e3).toISOString() }).code).toBe(
      'VALIDATION',
    );

    setCell('Drones', (r) => r['Drone ID'] === 'DRONE-003', 'Status', 'INACTIVE');
    expect(start(authToken, userId, { droneId: 'DRONE-003', flightType: 'FREE_FLIGHT' }).code).toBe('VALIDATION');
    expect(start(authToken, userId, { flightType: 'FREE_FLIGHT', missionId: undefined }).success).toBe(true);
  });

  it('opens a session with catalog names and IN_PROGRESS status', () => {
    const { userId, authToken } = activate();
    const res = start(authToken, userId);
    expect(res).toMatchObject({ success: true, data: { sessionId: 'SES-000001' } });
    const row = be.ss.sheet('FlightSessions').objects()[0];
    expect(row).toMatchObject({
      'User ID': userId,
      Email: 'omkar@example.com',
      'Mission Name': 'Precision Delivery',
      'Drone Name': 'Pluto Guru',
      Success: 'IN_PROGRESS',
    });
  });

  it('returns the same session for a retried start', () => {
    const { userId, authToken } = activate();
    const key = crypto.randomUUID();
    const a = start(authToken, userId, { clientSessionKey: key });
    const b = start(authToken, userId, { clientSessionKey: key });
    expect(b.data).toEqual({ sessionId: a.data.sessionId, duplicate: true });
    expect(be.ss.sheet('FlightSessions').objects()).toHaveLength(1);
  });

  it('records the result and updates totals with server-computed points', () => {
    const { userId, authToken } = activate();
    const sessionId = start(authToken, userId).data.sessionId;
    // A client claiming a million points gets what the rules give it.
    const res = end(authToken, sessionId, { pointsEarned: 1000000 });
    expect(res.success).toBe(true);
    // 50 complete + 2 stars x 25 + 12 score x 10
    expect(res.data.pointsEarned).toBe(220);
    expect(res.data.profile.stats).toMatchObject({
      totalPoints: 220,
      totalFlights: 1,
      totalFlightTimeSec: 380,
      missionFlights: 1,
      missionsCompleted: 1,
      crashCount: 1,
      averageScore: 80,
    });

    const row = be.ss.sheet('FlightSessions').objects()[0];
    expect(row).toMatchObject({ Success: 'SUCCESS', 'Points Earned': 220, Score: 12, 'Max Score': 15, Attempts: 2 });
  });

  it('clamps what cannot be true', () => {
    const { userId, authToken } = activate();
    const sessionId = start(authToken, userId, { startTime: minutesAgo(2) }).data.sessionId;
    end(authToken, sessionId, { score: 999, duration: 5000, flightTime: 9000 });
    const row = be.ss.sheet('FlightSessions').objects()[0];
    expect(row.Score).toBe(15);
    // Two minutes of wall clock (+60 s slack) bounds the duration; flight time
    // cannot exceed it.
    expect(row.Duration).toBeLessThanOrEqual(181);
    expect(row['Flight Time']).toBe(row.Duration);
  });

  it('pays a repeat completion at the reduced rate, and nothing for a failure', () => {
    const { userId, authToken } = activate();
    end(authToken, start(authToken, userId).data.sessionId);
    const repeat = end(authToken, start(authToken, userId).data.sessionId);
    expect(repeat.data.pointsEarned).toBe(55);
    const failed = end(authToken, start(authToken, userId).data.sessionId, { result: 'FAILED', stars: 0 });
    expect(failed.data.pointsEarned).toBe(0);
    expect(failed.data.profile.stats.missionsCompleted).toBe(2);
    expect(failed.data.profile.stats.missionFlights).toBe(3);
  });

  it('scores training and free flight by their own rules', () => {
    const { userId, authToken } = activate();
    const t = start(authToken, userId, { flightType: 'TRAINING', trainingId: 'TRAINING-003', missionId: undefined });
    const tr = end(authToken, t.data.sessionId, { score: 67, stars: 2 });
    expect(tr.data.pointsEarned).toBe(80);
    expect(tr.data.profile.stats).toMatchObject({ trainingFlights: 1, trainingCompleted: 1 });

    const f = start(authToken, userId, { flightType: 'FREE_FLIGHT', missionId: undefined, startTime: minutesAgo(60) });
    const fr = end(authToken, f.data.sessionId, { duration: 3000, flightTime: 1500, score: 50, stars: 3 });
    // 25 minutes x 2 = 50, capped at 30. Score and stars mean nothing here.
    expect(fr.data.pointsEarned).toBe(30);
    expect(fr.data.profile.stats).toMatchObject({ freeFlights: 1, freeFlightTimeSec: 1500 });
    expect(be.ss.sheet('FlightSessions').objects()[1].Score).toBe(0);
  });

  it('applies an end exactly once', () => {
    const { userId, authToken } = activate();
    const sessionId = start(authToken, userId).data.sessionId;
    end(authToken, sessionId);
    const again = end(authToken, sessionId);
    expect(again.data).toMatchObject({ duplicate: true, pointsEarned: 220 });
    expect(again.data.profile.stats.totalFlights).toBe(1);
  });

  it("refuses to end or annotate another user's session", () => {
    const a = activate('A', 'a@example.com');
    const b = activate('B', 'b@example.com');
    const sessionId = start(a.authToken, a.userId).data.sessionId;
    expect(end(b.authToken, sessionId).code).toBe('FORBIDDEN');
    expect(
      be.call('recordEvent', { sessionId, eventType: 'DRONE_CRASHED', timestamp: new Date().toISOString() }, b.authToken)
        .code,
    ).toBe('FORBIDDEN');
    expect(end(a.authToken, 'SES-999999').code).toBe('NOT_FOUND');
  });
});

describe('events', () => {
  it('stores a batch with sequential ids and JSON data', () => {
    const { userId, authToken } = activate();
    const sessionId = start(authToken, userId).data.sessionId;
    const res = be.call(
      'recordEvents',
      {
        sessionId,
        events: [
          { eventType: 'MISSION_STARTED', timestamp: minutesAgo(9) },
          { eventType: 'CHECKPOINT_REACHED', eventData: { checkpoint: 3 }, timestamp: minutesAgo(8) },
        ],
      },
      authToken,
    );
    expect(res.data.eventIds).toEqual(['EVT-000001', 'EVT-000002']);
    const single = be.call('recordEvent', { eventType: 'CONTROLLER_CONNECTED', timestamp: minutesAgo(1) }, authToken);
    expect(single.data.eventIds).toEqual(['EVT-000003']);

    const rows = be.ss.sheet('GameplayEvents').objects();
    expect(rows[1]).toMatchObject({ 'Session ID': sessionId, 'User ID': userId, 'Event Data': '{"checkpoint":3}' });
    expect(rows[2]['Session ID']).toBe('');
  });

  it('rejects malformed events as a whole batch', () => {
    const { authToken } = activate();
    const bad = be.call(
      'recordEvents',
      { events: [{ eventType: 'OK_EVENT' }, { eventType: 'not upper case' }] },
      authToken,
    );
    expect(bad.code).toBe('VALIDATION');
    expect(be.call('recordEvents', { events: [] }, authToken).code).toBe('VALIDATION');
    expect(be.ss.sheet('GameplayEvents').objects()).toHaveLength(0);
  });
});

describe('crash reports', () => {
  const crash = (over: Record<string, unknown> = {}) => ({
    kind: 'RENDERER_EXCEPTION',
    message: "Cannot read properties of undefined (reading 'position')",
    stack: "TypeError: Cannot read properties of undefined (reading 'position')\n    at tick (app://src/renderer/missions/MissionDirector.tsx:412:17)\n    at loop (app://node_modules/three.js:9:9)",
    fatal: false,
    occurredAt: minutesAgo(3),
    appVersion: '0.1.0',
    platform: 'win32',
    osVersion: 'Windows 11',
    electronVersion: '43.2.0',
    deviceId: DEVICE.deviceId,
    deviceName: DEVICE.deviceName,
    context: { section: 'missions', mission: 'forest-fire', fps: 58 },
    ...over,
  });

  it('accepts a report from someone who is not signed in', () => {
    const res = be.call('reportCrashes', { reports: [crash()] });
    expect(res).toMatchObject({ success: true, data: { reportIds: ['CRS-000001'] } });
    const row = be.ss.sheet('CrashReports').objects()[0];
    expect(row).toMatchObject({ Kind: 'RENDERER_EXCEPTION', Fatal: false, 'User ID': '', 'Device Name': 'Lab PC 1 (Windows)' });
    expect(JSON.parse(String(row.Context))).toMatchObject({ mission: 'forest-fire' });
  });

  it('attributes it to the pilot when a valid token comes with it, and still accepts an expired one', () => {
    const { userId, authToken } = activate();
    be.call('reportCrashes', { reports: [crash()] }, authToken);
    be.call('reportCrashes', { reports: [crash()] }, 'expired-token');
    const rows = be.ss.sheet('CrashReports').objects();
    expect(rows.map((r) => r['User ID'])).toEqual([userId, '']);
  });

  it('groups the same fault under one fingerprint, whatever the line numbers and values', () => {
    be.call('reportCrashes', {
      reports: [
        crash(),
        crash({
          message: "Cannot read properties of undefined (reading 'rotation')",
          stack: "TypeError: x\n    at tick (app://src/renderer/missions/MissionDirector.tsx:418:3)",
        }),
        crash({ message: 'WebGL context lost', kind: 'WEBGL_CONTEXT_LOST', stack: '' }),
      ],
    });
    const [a, b, c] = be.ss.sheet('CrashReports').objects().map((r) => r.Fingerprint);
    expect(a).toBe(b);
    expect(c).not.toBe(a);

    const report = be.fn.buildAnalytics_(new Date())['Report: Crashes'];
    const issues = report[3].rows;
    expect(issues[0].slice(1, 4)).toEqual(['RENDERER_EXCEPTION', 2, 0]);
    expect(report[0].rows[0]).toEqual(['Reports, last 24 hours', 3]);
  });

  it('rejects malformed reports and caps a crash loop per device', () => {
    expect(be.call('reportCrashes', { reports: [] }).code).toBe('VALIDATION');
    expect(be.call('reportCrashes', { reports: [crash({ kind: 'OOPS' })] }).code).toBe('VALIDATION');
    expect(be.call('reportCrashes', { reports: [crash({ message: '' })] }).code).toBe('VALIDATION');

    setCell('Settings', (r) => r.Key === 'MAX_CRASH_REPORTS_PER_HOUR', 'Value', 3);
    const first = be.call('reportCrashes', { reports: [crash(), crash()] });
    const second = be.call('reportCrashes', { reports: [crash(), crash()] });
    const third = be.call('reportCrashes', { reports: [crash()] });
    expect([first.data.reportIds.length, second.data.reportIds.length, third.data.reportIds.length]).toEqual([2, 1, 0]);
    expect(third.success).toBe(true);
    expect(be.ss.sheet('CrashReports').objects()).toHaveLength(3);
  });

  it('creates the CrashReports sheet on a database set up before it existed', () => {
    be.ss.sheets.delete('CrashReports');
    be.fn.resetTableCache_();
    expect(be.call('reportCrashes', { reports: [crash()] }).success).toBe(true);
    expect(be.ss.getSheetByName('CrashReports')).not.toBeNull();
  });
});

describe('dashboard and reports', () => {
  it('summarises a user and the whole fleet', () => {
    const a = activate('A', 'a@example.com');
    const b = activate('B', 'b@example.com');
    end(a.authToken, start(a.authToken, a.userId).data.sessionId);
    end(a.authToken, start(a.authToken, a.userId).data.sessionId, { result: 'FAILED', failReason: 'crash', stars: 0 });
    end(a.authToken, start(a.authToken, a.userId).data.sessionId, { result: 'FAILED', failReason: 'timeout', stars: 0 });
    end(a.authToken, start(a.authToken, a.userId).data.sessionId, { result: 'FAILED', failReason: 'crash', stars: 0 });
    const t = start(b.authToken, b.userId, { flightType: 'TRAINING', trainingId: 'TRAINING-001', droneId: 'DRONE-001' });
    end(b.authToken, t.data.sessionId, { score: 100, stars: 3, crashCount: 0 });
    start(b.authToken, b.userId); // left open

    const dash = be.call('getUserDashboard', { recentLimit: 3, days: 7 }, a.authToken).data;
    expect(dash.recentSessions).toHaveLength(3);
    expect(dash.daily).toHaveLength(7);
    expect(dash.daily[6]).toMatchObject({ sessions: 4, flightTimeSec: 1520 });
    expect(dash.missionCompletionRate).toBe(25);
    expect(dash.missions[0]).toMatchObject({ missionId: 'MISSION-001', sessions: 4, completed: 1, attempts: 8 });
    expect(dash.training).toMatchObject({ completed: 0, total: 15 });
    expect(dash.drones).toEqual([
      { droneId: 'DRONE-002', droneName: 'Pluto Guru', sessions: 4, flightTimeSec: 1520, crashes: 4 },
    ]);

    const reports = be.fn.buildAnalytics_(new Date());
    const metric = (report: string, section: number, name: string) =>
      reports[report][section].rows.find((r: unknown[]) => r[0] === name)[1];
    expect(metric('Report: Overview', 0, 'Registered users')).toBe(2);
    expect(metric('Report: Overview', 0, 'Pilots who flew today')).toBe(2);
    expect(metric('Report: Overview', 1, 'Sessions (finished)')).toBe(5);
    expect(metric('Report: Overview', 1, 'Sessions still open')).toBe(1);

    const mission = reports['Report: Missions'][0].rows[0];
    const headers: string[] = reports['Report: Missions'][0].headers;
    const col = (name: string) => mission[headers.indexOf(name)];
    expect(col('Completion rate %')).toBe(25);
    expect(col('Most common failure')).toBe('crash (2)');
    expect(col('Avg attempts / session')).toBe(2);

    const training = reports['Report: Training'][0].rows[0];
    expect(training.slice(0, 3)).toEqual(['TRAINING-001', 'Arm & Take Off', 1]);

    const daily = reports['Report: Overview'][2].rows;
    expect(daily).toHaveLength(30);
    expect(daily[29].slice(1, 3)).toEqual([5, 2]);

    // Writing the reports produces the sheets and one chart per charted
    // section, each reading the header row plus its data.
    be.fn.refreshAnalytics();
    const drones = be.ss.sheet('Report: Drones');
    expect(drones.charts).toHaveLength(1);
    expect(drones.charts[0].options.title).toBe('Flight hours by drone');
    expect(drones.charts[0].ranges.map((r) => r.col)).toEqual([2, 5]);
    expect(drones.data[drones.charts[0].ranges[0].row - 1][1]).toBe('Drone');
    expect(be.ss.sheet('Report: Overview').charts).toHaveLength(2);

    // A second refresh replaces the charts rather than piling them up.
    be.fn.refreshAnalytics();
    expect(be.ss.sheet('Report: Overview').charts).toHaveLength(2);
  });
});
