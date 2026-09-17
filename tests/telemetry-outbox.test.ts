import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '../src/shared/backend/contract';
import { Outbox, type EndSnapshot, type OutboxState } from '../src/main/backend/outbox';

// The outbox is what stands between a flight and lost data: patchy classroom
// Wi-Fi, an app quit mid-mission, a token revoked by the admin. These pin that
// nothing recorded is dropped, sent out of order, or sent as the wrong user.

type Sent = { action: string; payload: any; token: string | undefined };

function harness(opts: { tokens?: Record<string, string>; initial?: OutboxState | null } = {}) {
  const sent: Sent[] = [];
  let disk: OutboxState | null = opts.initial ?? null;
  const tokens: Record<string, string> = opts.tokens ?? { 'USR-000001': 'tok-1' };
  let nextSession = 1;
  const timers: number[] = [];
  let respond: (s: Sent) => ApiResponse<unknown> | null = () => null;
  const authInvalid: string[] = [];

  const outbox = new Outbox({
    load: async () => (disk ? JSON.parse(JSON.stringify(disk)) : null),
    save: async (state) => {
      disk = state;
    },
    send: async (action, payload, token) => {
      const call = { action, payload: JSON.parse(JSON.stringify(payload)), token };
      sent.push(call);
      const override = respond(call);
      if (override) return override as any;
      if (action === 'startSession') {
        return { success: true, data: { sessionId: `SES-${String(nextSession++).padStart(6, '0')}` } } as any;
      }
      if (action === 'reportCrashes') {
        return { success: true, data: { reportIds: (payload as any).reports.map(() => 'CRS') } } as any;
      }
      if (action === 'endSession') {
        return { success: true, data: { sessionId: (payload as any).sessionId, pointsEarned: 0, profile: {} } } as any;
      }
      return { success: true, data: { eventIds: [] } } as any;
    },
    tokenFor: (userId) => tokens[userId],
    onAuthInvalid: (userId) => authInvalid.push(userId),
    setTimer: (_fn, ms) => timers.push(ms),
    clearTimer: () => undefined,
  });

  return {
    outbox,
    sent,
    tokens,
    timers,
    authInvalid,
    disk: () => disk,
    respondWith: (fn: typeof respond) => {
      respond = fn;
    },
  };
}

const start = (key: string) => ({
  flightType: 'MISSION' as const,
  missionId: 'MISSION-001',
  droneId: 'DRONE-002',
  inputMode: 'KEYBOARD' as const,
  startTime: '2026-09-17T10:00:00.000Z',
  clientSessionKey: key,
  userId: 'USR-000001',
});

const endOf = (over: Partial<EndSnapshot> = {}): EndSnapshot => ({
  endTime: '2026-09-17T10:07:00.000Z',
  duration: 420,
  flightTime: 380,
  result: 'SUCCESS',
  score: 12,
  crashCount: 0,
  attempts: 1,
  ...over,
});

const ev = (eventType: string) => ({ eventType, timestamp: '2026-09-17T10:01:00.000Z' });

describe('telemetry outbox', () => {
  it('sends a session start, its events and its end in order, resolving the server id', async () => {
    const h = harness();
    await h.outbox.init();
    h.outbox.startSession('USR-000001', start('k1'));
    h.outbox.recordEvents('USR-000001', 'k1', [ev('MISSION_STARTED')]);
    h.outbox.recordEvents('USR-000001', 'k1', [ev('CHECKPOINT_REACHED')]);
    h.outbox.endSession('k1', endOf());
    await h.outbox.flush();

    expect(h.sent.map((s) => s.action)).toEqual(['startSession', 'recordEvents', 'endSession']);
    // Two recordEvents calls became one request.
    expect(h.sent[1].payload).toMatchObject({ sessionId: 'SES-000001' });
    expect(h.sent[1].payload.events).toHaveLength(2);
    expect(h.sent[2].payload).toMatchObject({ sessionId: 'SES-000001', result: 'SUCCESS' });
    expect(h.sent.every((s) => s.token === 'tok-1')).toBe(true);
    expect(h.outbox.status().pending).toBe(0);
    expect(h.disk()?.sessionIds).toEqual({});
  });

  it('keeps everything through an outage and delivers it once the network is back', async () => {
    const h = harness();
    await h.outbox.init();
    let online = false;
    h.respondWith(() => (online ? null : { success: false, code: 'NETWORK', message: 'offline' }));

    h.outbox.startSession('USR-000001', start('k1'));
    h.outbox.endSession('k1', endOf());
    await h.outbox.flush();
    expect(h.outbox.status()).toMatchObject({ pending: 2, lastError: 'offline' });
    // A backoff retry was scheduled rather than a tight loop.
    expect(h.timers.at(-1)).toBeGreaterThanOrEqual(5000);

    online = true;
    await h.outbox.flush();
    expect(h.sent.filter((s) => s.action === 'endSession')).toHaveLength(1);
    expect(h.outbox.status().pending).toBe(0);
  });

  it('survives a restart, and closes a session the last run never ended as ABORTED', async () => {
    const first = harness();
    await first.outbox.init();
    first.respondWith(() => ({ success: false, code: 'NETWORK', message: 'offline' }));
    first.outbox.startSession('USR-000001', start('k1'));
    first.outbox.checkpoint('k1', endOf({ result: 'ABORTED', duration: 200, flightTime: 150, crashCount: 1 }));
    await first.outbox.flush();
    // The app dies here: no endSession.

    const second = harness({ initial: first.disk() });
    await second.outbox.init();
    await second.outbox.flush();

    expect(second.sent.map((s) => s.action)).toEqual(['startSession', 'recordEvents', 'endSession']);
    expect(second.sent[1].payload.events[0].eventType).toBe('SESSION_RECOVERED');
    expect(second.sent[2].payload).toMatchObject({
      sessionId: 'SES-000001',
      result: 'ABORTED',
      duration: 200,
      flightTime: 150,
      crashCount: 1,
    });
  });

  it("drops a refused start's dependents without blocking the rest of the queue", async () => {
    const h = harness();
    await h.outbox.init();
    h.respondWith((s) =>
      s.action === 'startSession' && s.payload.clientSessionKey === 'bad'
        ? { success: false, code: 'VALIDATION', message: 'Unknown drone' }
        : null,
    );
    h.outbox.startSession('USR-000001', start('bad'));
    h.outbox.recordEvents('USR-000001', 'bad', [ev('MISSION_STARTED')]);
    h.outbox.endSession('bad', endOf());
    h.outbox.startSession('USR-000001', start('good'));
    h.outbox.endSession('good', endOf());
    await h.outbox.flush();

    expect(h.sent.map((s) => `${s.action}:${s.payload.clientSessionKey ?? s.payload.sessionId}`)).toEqual([
      'startSession:bad',
      'startSession:good',
      'endSession:SES-000001',
    ]);
    expect(h.outbox.status().pending).toBe(0);
  });

  it('holds a user whose token was refused, and still sends everyone else', async () => {
    const h = harness({ tokens: { 'USR-000001': 'revoked', 'USR-000002': 'tok-2' } });
    await h.outbox.init();
    h.respondWith((s) => (s.token === 'revoked' ? { success: false, code: 'AUTH_INVALID', message: 'expired' } : null));

    h.outbox.startSession('USR-000001', start('a'));
    h.outbox.endSession('a', endOf());
    h.outbox.startSession('USR-000002', { ...start('b'), userId: 'USR-000002' });
    h.outbox.endSession('b', endOf());
    await h.outbox.flush();

    expect(h.authInvalid).toEqual(['USR-000001']);
    // User 1 was tried once and then held; user 2 went through.
    expect(h.sent.filter((s) => s.token === 'revoked')).toHaveLength(1);
    expect(h.sent.filter((s) => s.token === 'tok-2').map((s) => s.action)).toEqual(['startSession', 'endSession']);
    expect(h.outbox.status()).toMatchObject({ pending: 2, authBlocked: ['USR-000001'] });

    // Signing in again releases them, with the new token.
    h.tokens['USR-000001'] = 'fresh';
    h.respondWith(() => null);
    h.outbox.unblock('USR-000001');
    await h.outbox.flush();
    expect(h.sent.filter((s) => s.token === 'fresh').map((s) => s.action)).toEqual(['startSession', 'endSession']);
    expect(h.outbox.status().pending).toBe(0);
  });

  it('does not send for a user with no stored token', async () => {
    const h = harness({ tokens: {} });
    await h.outbox.init();
    h.outbox.recordEvents('USR-000009', null, [ev('CONTROLLER_CONNECTED')]);
    await h.outbox.flush();
    expect(h.sent).toHaveLength(0);
    expect(h.outbox.hasPendingFor('USR-000009')).toBe(true);
  });

  it('sends crash reports signed out, batched, and with the token when there is one', async () => {
    const h = harness({ tokens: { 'USR-000001': 'tok-1' } });
    await h.outbox.init();
    const report = (message: string) =>
      ({ kind: 'RENDERER_EXCEPTION', message, fatal: false, occurredAt: '2026-09-17T10:00:00Z' }) as any;
    h.outbox.recordCrash(null, report('a'));
    h.outbox.recordCrash(null, report('b'));
    h.outbox.recordCrash('USR-000001', report('c'));
    await h.outbox.flush();
    expect(h.sent.map((s) => [s.action, s.token, s.payload.reports.length])).toEqual([
      ['reportCrashes', undefined, 2],
      ['reportCrashes', 'tok-1', 1],
    ]);
  });

  it('still sends a signed-in pilot\'s crash report after their token is refused', async () => {
    const h = harness({ tokens: {} });
    await h.outbox.init();
    h.outbox.recordCrash('USR-000009', { kind: 'RENDERER_GONE', message: 'crashed', fatal: true } as any);
    await h.outbox.flush();
    expect(h.sent.map((s) => [s.action, s.token])).toEqual([['reportCrashes', undefined]]);
  });

  it('ends open sessions as ABORTED when the game window crashes', async () => {
    const h = harness();
    await h.outbox.init();
    h.outbox.startSession('USR-000001', start('k1'));
    h.outbox.checkpoint('k1', endOf({ result: 'ABORTED', duration: 90 }));
    h.outbox.abortOpenSessions('window crashed');
    await h.outbox.flush();
    expect(h.sent.map((s) => s.action)).toEqual(['startSession', 'recordEvents', 'endSession']);
    expect(h.sent[1].payload.events[0].eventData).toEqual({ reason: 'window crashed' });
    expect(h.sent[2].payload).toMatchObject({ result: 'ABORTED', duration: 90 });
    // A later endSession for it from the (reloaded) window is a no-op.
    h.outbox.endSession('k1', endOf());
    await h.outbox.flush();
    expect(h.sent.filter((s) => s.action === 'endSession')).toHaveLength(1);
  });

  it('gives up on an item the server keeps failing on, instead of blocking forever', async () => {
    const h = harness();
    await h.outbox.init();
    h.respondWith((s) =>
      s.action === 'recordEvents' ? { success: false, code: 'SERVER_ERROR', message: 'boom' } : null,
    );
    h.outbox.recordEvents('USR-000001', null, [ev('CONTROLLER_CONNECTED')]);
    h.outbox.startSession('USR-000001', start('k1'));
    for (let i = 0; i < 10; i++) await h.outbox.flush();
    expect(h.sent.filter((s) => s.action === 'startSession')).toHaveLength(1);
    expect(h.outbox.status().pending).toBe(0);
  });
});
