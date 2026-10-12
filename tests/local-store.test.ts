import { beforeEach, describe, expect, it } from 'vitest';
import type {
  EndSessionRequest,
  StartSessionRequest,
  UserProfile,
} from '../src/shared/backend/contract';
import { CATALOG } from '../src/shared/backend/scoring';
import { LocalStore } from '../src/main/backend/localStore';
import { loadBackend, type Backend } from './helpers/appsScript';

// The offline profile: flights logged in SQLite on this computer, with points,
// levels and per-lesson progress worked out the way the backend works them out.
// The parity tests fly the same flights through the real Apps Script code and
// through the local store, and expect the same profile from both.

const DEVICE = { deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'Lab PC 1 (Windows)' };

let be: Backend;
let store: LocalStore;

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function activate() {
  const key = be.fn.generateActivationKeys(1)[0];
  const res = be.call('activateUser', {
    ...DEVICE,
    name: 'Asha',
    email: 'asha@example.com',
    activationKey: key,
  });
  expect(res.success).toBe(true);
  return res.data as { userId: string; authToken: string; profile: UserProfile };
}

type Flight = Omit<StartSessionRequest, 'userId' | 'clientSessionKey' | 'startTime' | 'inputMode'> &
  Omit<EndSessionRequest, 'sessionId' | 'endTime'> & { minutes: number };

const FLIGHTS: Flight[] = [
  {
    flightType: 'TRAINING',
    trainingId: 'TRAINING-001',
    droneId: 'DRONE-001',
    minutes: 3,
    duration: 170,
    flightTime: 120,
    result: 'SUCCESS',
    score: 92,
    stars: 3,
    crashCount: 0,
    attempts: 1,
  },
  {
    flightType: 'TRAINING',
    trainingId: 'TRAINING-001',
    droneId: 'DRONE-001',
    minutes: 3,
    duration: 160,
    flightTime: 100,
    result: 'SUCCESS',
    score: 70,
    stars: 2,
    crashCount: 1,
    attempts: 2,
  },
  {
    flightType: 'TRAINING',
    trainingId: 'TRAINING-002',
    droneId: 'DRONE-001',
    minutes: 2,
    duration: 100,
    flightTime: 60,
    result: 'FAILED',
    score: 20,
    stars: 0,
    crashCount: 1,
    attempts: 1,
  },
  {
    flightType: 'MISSION',
    missionId: 'MISSION-001',
    droneId: 'DRONE-002',
    minutes: 6,
    duration: 330,
    flightTime: 300,
    result: 'SUCCESS',
    score: 40,
    stars: 2,
    crashCount: 0,
    attempts: 1,
  },
  {
    flightType: 'MISSION',
    missionId: 'MISSION-002',
    droneId: 'DRONE-002',
    minutes: 4,
    duration: 200,
    flightTime: 180,
    result: 'ABORTED',
    score: 2,
    stars: 0,
    crashCount: 2,
    attempts: 1,
  },
  {
    flightType: 'FREE_FLIGHT',
    droneId: 'DRONE-003',
    minutes: 25,
    duration: 1400,
    flightTime: 1300,
    result: 'SUCCESS',
    score: 0,
    stars: 0,
    crashCount: 3,
    attempts: 1,
  },
  {
    flightType: 'FREE_FLIGHT',
    droneId: 'DRONE-001',
    minutes: 5,
    duration: 280,
    flightTime: 250,
    result: 'ABORTED',
    score: 0,
    stars: 0,
    crashCount: 0,
    attempts: 1,
  },
];

/** Fly `f` on the backend and in the local store; the backend's answer. */
function fly(auth: { userId: string; authToken: string }, f: Flight, i: number) {
  const { minutes, duration, flightTime, result, score, stars, crashCount, attempts, ...start } = f;
  const req: StartSessionRequest = {
    ...start,
    userId: auth.userId,
    inputMode: 'KEYBOARD',
    startTime: ago(100 - i * 10),
    clientSessionKey: `key-${i}`,
  };
  const end = {
    endTime: ago(100 - i * 10 - minutes),
    duration,
    flightTime,
    result,
    score,
    stars,
    crashCount,
    attempts,
  };
  store.startFlight(auth.userId, req);
  store.endFlight(req.clientSessionKey, end);
  const opened = be.call('startSession', req, auth.authToken);
  expect(opened.success).toBe(true);
  const ended = be.call('endSession', { ...end, sessionId: opened.data.sessionId }, auth.authToken);
  expect(ended.success).toBe(true);
  return { sessionId: opened.data.sessionId as string, ...ended.data };
}

beforeEach(() => {
  be = loadBackend();
  be.fn.setupDatabase();
  store = LocalStore.open(':memory:');
});

describe('local scoring matches the backend', () => {
  it('keeps the same catalog as backend/apps-script', () => {
    const sheet = (name: string) => be.ss.sheet(name).objects();
    expect(CATALOG.drones.map((d) => [d.id, d.name])).toEqual(
      sheet('Drones').map((r) => [r['Drone ID'], r['Drone Name']]),
    );
    expect(CATALOG.missions.map((m) => [m.id, m.name, m.maxScore])).toEqual(
      sheet('Missions').map((r) => [r['Mission ID'], r['Mission Name'], r['Max Score']]),
    );
    expect(CATALOG.training.map((t) => [t.id, t.name, t.order])).toEqual(
      sheet('TrainingModules').map((r) => [r['Training ID'], r['Training Name'], r.Order]),
    );
  });

  it('works out the same points, totals and level as the backend for flights flown offline', () => {
    const auth = activate();
    const before = auth.profile;
    let server: UserProfile = before;
    FLIGHTS.forEach((f, i) => {
      server = fly(auth, f, i).profile;
    });
    const local = store.profile(auth.userId, before);
    // The average score is the backend's alone: it is not sent with enough to recompute.
    expect({ ...local.stats, averageScore: 0 }).toEqual({ ...server.stats, averageScore: 0 });
    expect(local.level).toBe(server.level);
    expect(local.levelPoints).toEqual(server.levelPoints);
    expect(local.stats.totalPoints).toBeGreaterThan(0);
  });

  it("gives each flight the backend's points, a repeat at a quarter", () => {
    const auth = activate();
    const earned = FLIGHTS.map((f, i) => fly(auth, f, i).pointsEarned);
    const dash = store.dashboard(auth.userId, auth.profile, 50, 30);
    const local = [...dash.recentSessions].reverse().map((s) => s.pointsEarned);
    expect(local).toEqual(earned);
    // The second pass of the same lesson is a repeat.
    expect(earned[1]).toBeLessThan(earned[0]);
    expect(earned[1]).toBeGreaterThan(0);
  });

  it('shows the same lesson and mission progress as the backend dashboard', () => {
    const auth = activate();
    FLIGHTS.forEach((f, i) => fly(auth, f, i));
    const server = be.call(
      'getUserDashboard',
      { userId: auth.userId, recentLimit: 50 },
      auth.authToken,
    ).data;
    const local = store.dashboard(auth.userId, auth.profile, 50, 30);
    expect(local.training.completed).toBe(server.training.completed);
    expect(local.training.modules.map((m) => [m.trainingId, m.completed, m.bestStars])).toEqual(
      server.training.modules.map((m: Record<string, unknown>) => [
        m.trainingId,
        m.completed,
        m.bestStars,
      ]),
    );
    expect(local.missions.map((m) => [m.missionId, m.completed])).toEqual(
      server.missions.map((m: Record<string, unknown>) => [m.missionId, m.completed]),
    );
  });
});

describe('the flight log', () => {
  const base = {
    userId: 'USR-1',
    stats: {
      totalPoints: 0,
      totalFlights: 0,
      totalFlightTimeSec: 0,
      trainingFlights: 0,
      missionFlights: 0,
      freeFlights: 0,
      missionsCompleted: 0,
      trainingCompleted: 0,
      freeFlightTimeSec: 0,
      crashCount: 0,
      averageScore: 0,
    },
    level: 1,
    levelPoints: { current: 0, next: 500 },
  } as UserProfile;
  const start = (key: string, extra: Partial<StartSessionRequest> = {}) =>
    store.startFlight('USR-1', {
      userId: 'USR-1',
      flightType: 'FREE_FLIGHT',
      droneId: 'DRONE-001',
      inputMode: 'KEYBOARD',
      startTime: ago(30),
      clientSessionKey: key,
      ...extra,
    });
  const end = {
    endTime: ago(20),
    duration: 600,
    flightTime: 600,
    result: 'SUCCESS' as const,
    score: 0,
    crashCount: 0,
    attempts: 1,
  };

  it('shows an ended flight at once, and stops adding it once the backend has applied it', () => {
    start('a');
    store.endFlight('a', end);
    expect(store.unsyncedCount('USR-1')).toBe(1);
    expect(store.profile('USR-1', base).stats.totalFlights).toBe(1);
    store.setSessionId('a', 'SES-1');
    store.markSynced('SES-1', 20);
    expect(store.unsyncedCount('USR-1')).toBe(0);
    // The backend's profile now carries it; adding it again would count it twice.
    expect(store.profile('USR-1', base).stats.totalFlights).toBe(0);
  });

  it('ends a flight the app never ended as ABORTED with its last checkpoint', () => {
    start('b');
    store.checkpointFlight('b', {
      ...end,
      duration: 90,
      flightTime: 80,
      result: 'ABORTED',
      crashCount: 1,
    });
    store.abortOpen();
    const [s] = store.dashboard('USR-1', base).recentSessions;
    expect(s).toMatchObject({ result: 'ABORTED', flightTime: 80, crashCount: 1 });
  });

  it('keeps a flight the backend refused in the history, never in the totals', () => {
    start('c');
    store.endFlight('c', end);
    store.markDropped('c');
    expect(store.profile('USR-1', base).stats.totalFlights).toBe(0);
    expect(store.dashboard('USR-1', base).recentSessions).toHaveLength(1);
  });

  it('does not copy in a session it already has from the backend history', () => {
    store.savePilot(
      { userId: 'USR-1', email: 'a@x.in', name: 'A', keySalt: 's', keyHash: 'h', keyCipher: null },
      base,
    );
    start('d');
    store.endFlight('d', end);
    store.setSessionId('d', 'SES-9');
    const dash = store.dashboard('USR-1', base, 50);
    store.importServer('USR-1', {
      ...dash,
      recentSessions: [
        { ...dash.recentSessions[0], sessionId: 'SES-9' },
        { ...dash.recentSessions[0], sessionId: 'SES-8', startTime: ago(500) },
      ],
    });
    const ids = store.dashboard('USR-1', base, 50).recentSessions.map((s) => s.sessionId);
    expect(ids).toEqual(['SES-9', 'SES-8']);
  });

  it('forgets a pilot and all their flights', () => {
    store.savePilot(
      { userId: 'USR-1', email: 'a@x.in', name: 'A', keySalt: 's', keyHash: 'h', keyCipher: null },
      base,
    );
    start('e');
    store.forgetPilot('USR-1');
    expect(store.pilotByEmail('a@x.in')).toBeNull();
    expect(store.dashboard('USR-1', base).recentSessions).toHaveLength(0);
  });

  it('round-trips the signed-in account and its token', () => {
    expect(store.loadAccountFile()).toBeNull();
    const file = {
      current: 'USR-1',
      accounts: { 'USR-1': { token: 'cipher', encrypted: true, profile: base } },
    };
    store.saveAccountFile(file);
    expect(store.loadAccountFile()).toEqual(file);
    store.saveAccountFile({ current: null, accounts: {} });
    expect(store.loadAccountFile()).toEqual({ current: null, accounts: {} });
  });
});
