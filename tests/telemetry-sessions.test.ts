import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { attachTelemetry } from '../src/renderer/analytics/telemetry';
import { FlightMetrics, type FlightSample } from '../src/renderer/analytics/flightMetrics';
import { MISSIONS } from '../src/renderer/missions';
import { LESSONS } from '../src/renderer/training/lessons';
import { useAccountStore } from '../src/renderer/state/accountStore';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { useMissionStore } from '../src/renderer/state/missionStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useSimStore } from '../src/renderer/state/simStore';
import { useTrainingStore } from '../src/renderer/state/trainingStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { setScripted } from '../src/renderer/input/controls';

// What a flight turns into on the wire. The stores are driven the way the game
// drives them; the assertions are on the telemetry channel, so these hold
// whatever backend sits behind it.

const flightInitial = useFlightStore.getState();
const missionInitial = useMissionStore.getState();
const trainingInitial = useTrainingStore.getState();
const uiInitial = useUiStore.getState();

let detach: () => void;

const api = () => window.api.telemetry as unknown as Record<string, ReturnType<typeof vi.fn>>;
const starts = () => api().startSession.mock.calls.map((c) => c[0]);
const ends = () => api().endSession.mock.calls.map((c) => ({ key: c[0], ...c[1] }));
const events = () => api().recordEvents.mock.calls.flatMap((c) => c[1].map((e: any) => ({ key: c[0], ...e })));
const eventTypes = () => events().map((e) => e.eventType);

/** Fly for `seconds`: armed, airborne, moving 1 m per sample along x. */
function fly(seconds: number) {
  useFlightStore.setState({ armed: true, onGround: false });
  for (let t = 0; t < seconds * 4; t++) {
    const [x, , z] = useSimStore.getState().position;
    useSimStore.setState({ position: [x + 1, 3, z], altitude: 3 });
    vi.advanceTimersByTime(250);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  useFlightStore.setState(flightInitial, true);
  useMissionStore.setState(missionInitial, true);
  useTrainingStore.setState(trainingInitial, true);
  useUiStore.setState(uiInitial, true);
  useSimStore.setState({ position: [0, 0, 0], altitude: 0, batterySoc: 1 });
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, selectedDroneId: 'pluto-guru' },
    hydrated: true,
  });
  useAccountStore.setState({ status: 'signedIn', profile: null, needsSignIn: false });
  detach = attachTelemetry();
});

afterEach(() => {
  detach();
  vi.useRealTimers();
});

describe('mission sessions', () => {
  it('records nothing for a briefing that is read and closed', () => {
    useUiStore.setState({ section: 'missions' });
    useMissionStore.getState().start(MISSIONS[0]);
    useMissionStore.getState().exit();
    expect(starts()).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it('is one session across a failed attempt and the retry that completes it', () => {
    useUiStore.setState({ section: 'missions' });
    const mission = MISSIONS[0];
    const store = useMissionStore.getState();
    store.start(mission);
    store.beginFlight();

    expect(starts()).toEqual([
      expect.objectContaining({ flightType: 'MISSION', missionId: 'MISSION-001', droneId: 'DRONE-002' }),
    ]);
    const key = starts()[0].clientSessionKey;

    fly(4);
    useFlightStore.getState().crash(7);
    useMissionStore.getState().fail('crash');
    useFlightStore.getState().clearCrash();
    useMissionStore.getState().restart();
    fly(6);
    useMissionStore.getState().finish({
      points: 12,
      maxPoints: 15,
      timeSec: 6,
      collisions: 0,
      delivered: true,
      landed: true,
    });
    useMissionStore.getState().exit();

    expect(starts()).toHaveLength(1);
    expect(ends()).toHaveLength(1);
    const end = ends()[0];
    expect(end).toMatchObject({
      key,
      result: 'SUCCESS',
      attempts: 2,
      crashCount: 1,
      score: 12,
      objectivesCompleted: 12,
      objectivesTotal: 15,
      inputMode: 'KEYBOARD',
    });
    expect(end.stars).toBeGreaterThanOrEqual(1);
    expect(end.flightTime).toBeGreaterThanOrEqual(9);
    expect(end.distance).toBeGreaterThan(30);
    expect(end.maxAltitude).toBe(3);
    expect(end.failReason).toBeUndefined();

    expect(eventTypes()).toEqual(
      expect.arrayContaining(['MISSION_STARTED', 'DRONE_CRASHED', 'MISSION_FAILED', 'MISSION_RESTARTED', 'MISSION_COMPLETED']),
    );
    expect(events().every((e) => e.key === key)).toBe(true);
    expect(events().find((e) => e.eventType === 'MISSION_FAILED').eventData).toMatchObject({ reason: 'crash' });
  });

  it('ends as FAILED when the pilot leaves after a failure, and ABORTED mid-flight', () => {
    useUiStore.setState({ section: 'missions' });
    const store = useMissionStore.getState();
    store.start(MISSIONS[1]);
    store.beginFlight();
    useMissionStore.getState().fail('timeout');
    useMissionStore.getState().exit();

    useMissionStore.getState().start(MISSIONS[1]);
    useMissionStore.getState().beginFlight();
    useMissionStore.getState().exit();

    expect(ends().map((e) => [e.result, e.failReason])).toEqual([
      ['FAILED', 'timeout'],
      ['ABORTED', undefined],
    ]);
  });

  it('starts a new session when flying again after a completion', () => {
    useUiStore.setState({ section: 'missions' });
    const store = useMissionStore.getState();
    store.start(MISSIONS[0]);
    store.beginFlight();
    const result = { points: 15, maxPoints: 15, timeSec: 60, collisions: 0, delivered: true, landed: true };
    useMissionStore.getState().finish(result);
    useMissionStore.getState().restart();
    expect(starts()).toHaveLength(2);
    expect(ends()).toHaveLength(1);
  });
});

describe('training sessions', () => {
  it('counts every practice run as an attempt and ends on the reward', () => {
    useUiStore.setState({ section: 'training' });
    const lesson = LESSONS[2];
    const t = useTrainingStore.getState();
    t.start(lesson.id);
    expect(starts()).toHaveLength(0);

    t.setPhase('demo');
    expect(starts()[0]).toMatchObject({ flightType: 'TRAINING', trainingId: 'TRAINING-003' });

    useTrainingStore.getState().setPhase('practice');
    fly(2);
    useTrainingStore.getState().setValidation({ progress: 0.3, failed: true });
    useTrainingStore.getState().setValidation({ progress: 0, failed: false });
    fly(2);
    useTrainingStore.getState().completeLesson(lesson.id, 2, 2 / 3, 8);

    expect(ends()).toEqual([expect.objectContaining({ result: 'SUCCESS', attempts: 2, stars: 2, score: 67 })]);
    expect(eventTypes()).toEqual([
      'TRAINING_STARTED',
      'TRAINING_DEMO_STARTED',
      'TRAINING_ATTEMPT_STARTED',
      'DRONE_ARMED',
      'DRONE_TOOK_OFF',
      'TRAINING_ATTEMPT_FAILED',
      'TRAINING_ATTEMPT_STARTED',
      'TRAINING_COMPLETED',
    ]);
  });

  it('does not count the demonstration as the pilot flying', () => {
    useTrainingStore.getState().start(LESSONS[0].id);
    useTrainingStore.getState().setPhase('demo');
    // The demo flies the aircraft through the scripted input channel.
    setScripted(true);
    try {
      fly(3);
    } finally {
      setScripted(false);
    }
    useTrainingStore.getState().exitLesson();
    expect(ends()).toEqual([expect.objectContaining({ result: 'ABORTED', flightTime: 0 })]);
    expect(ends()[0].duration).toBe(3);
    expect(eventTypes()).not.toContain('DRONE_TOOK_OFF');
  });
});

describe('free flight sessions', () => {
  it('opens on the first arm in the Fly view and closes on leaving it', () => {
    useUiStore.getState().setSection('fly');
    vi.advanceTimersByTime(5000);
    expect(starts()).toHaveLength(0);

    fly(3);
    expect(starts()[0]).toMatchObject({ flightType: 'FREE_FLIGHT', droneId: 'DRONE-002' });
    useUiStore.getState().setSection('home');

    expect(ends()).toEqual([expect.objectContaining({ result: 'SUCCESS', score: 0, stars: undefined })]);
    expect(eventTypes()).toEqual(['FREE_FLIGHT_STARTED', 'DRONE_ARMED', 'DRONE_TOOK_OFF', 'FREE_FLIGHT_ENDED']);
  });

  it('closes the session when the pilot swaps drone', () => {
    useUiStore.getState().setSection('fly');
    fly(1);
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, selectedDroneId: 'racing-drone' } }));
    expect(ends()).toHaveLength(1);
    expect(events().at(-1)).toMatchObject({ eventType: 'DRONE_CHANGED', key: null, eventData: { from: 'pluto-guru', to: 'racing-drone' } });
  });

  it('checkpoints an open session so a crash of the app loses little', () => {
    useUiStore.getState().setSection('fly');
    fly(16);
    expect(api().checkpoint).toHaveBeenCalled();
    expect(api().checkpoint.mock.calls.at(-1)![1]).toMatchObject({ result: 'ABORTED' });
  });
});

describe('when nobody is signed in', () => {
  it('records nothing at all', () => {
    useAccountStore.setState({ status: 'signedOut' });
    useUiStore.getState().setSection('fly');
    fly(2);
    useUiStore.getState().setSection('missions');
    useMissionStore.getState().start(MISSIONS[0]);
    useMissionStore.getState().beginFlight();
    expect(starts()).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });
});

describe('flight metrics', () => {
  const base: FlightSample = {
    armed: true,
    onGround: false,
    paused: false,
    scripted: false,
    position: [0, 2, 0],
    altitude: 2,
    batterySoc: 1,
    touches: 0,
    input: 'GAMEPAD',
  };

  it('ignores pauses, resets and recharges', () => {
    const m = new FlightMetrics();
    m.sample(base, 0.25);
    m.sample({ ...base, position: [3, 2, 4], batterySoc: 0.9 }, 1);
    m.sample({ ...base, position: [3, 2, 4], paused: true }, 30);
    // A reset teleports the aircraft home and refills the pack.
    m.sample({ ...base, position: [500, 2, 0], batterySoc: 1 }, 1);
    m.sample({ ...base, position: [500, 5, 0], altitude: 5, touches: 2, input: 'KEYBOARD' }, 0.5);

    expect(m.activeSec).toBeCloseTo(2.5);
    expect(m.flightSec).toBeCloseTo(2.5);
    expect(m.distanceM).toBeCloseTo(8);
    expect(m.batteryUsed).toBeCloseTo(0.1);
    expect(m.maxAltitudeM).toBe(5);
    expect(m.collisions).toBe(2);
    expect(m.dominantInput()).toBe('GAMEPAD');
  });

  it('does not count ground time or a scripted demo as flight', () => {
    const m = new FlightMetrics();
    m.sample(base, 0);
    m.sample({ ...base, onGround: true }, 1);
    m.sample({ ...base, scripted: true }, 1);
    m.sample({ ...base, armed: false }, 1);
    expect(m.activeSec).toBe(3);
    expect(m.flightSec).toBe(0);
  });
});
