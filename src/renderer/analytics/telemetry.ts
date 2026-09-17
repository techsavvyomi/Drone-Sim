import type { FlightType, GameplayEventType, InputMode, SessionResult } from '@shared/backend/contract';
import type { SessionEnd } from '@shared/backend/ipc';
import { useAccountStore } from '../state/accountStore';
import { useFlightStore } from '../state/flightStore';
import { useMissionStore } from '../state/missionStore';
import { useSettingsStore } from '../state/settingsStore';
import { useSimStore } from '../state/simStore';
import { useTrainingStore } from '../state/trainingStore';
import { useUiStore } from '../state/uiStore';
import { activeInputSource, isScripted } from '../input/controls';
import { activeDeviceKey, detectKind } from '../input/gamepad';
import { AnalyticsService } from '../services/analyticsService';
import { SessionService } from '../services/sessionService';
import { FlightMetrics } from './flightMetrics';

// Session & gameplay telemetry.
//
// Watches the stores the game already keeps (missions, Flight School, free
// flight, the aircraft) and turns what happens in them into sessions and events.
// Nothing in the flight code calls this: a new mission or lesson is recorded
// without anyone remembering to add a call.
//
// What a SESSION is, per category:
//   MISSION      from the first "fly" after the briefing until the mission is
//                completed or left. Retries after a failure are attempts within
//                the same session; flying again after a completion is a new one.
//   TRAINING     from the first demonstration or practice of a module until it is
//                completed or left. Every practice run is an attempt.
//   FREE_FLIGHT  from the first arm in the Fly view until the pilot leaves the
//                view or swaps drone.
// A briefing read and closed, or a Fly view visited without arming, is not a
// session.
//
// Only one session is ever open: the three live in different sections.

const SAMPLE_MS = 250;
const CHECKPOINT_MS = 15000;

interface OpenFlight {
  key: string;
  type: FlightType;
  /** The mission id or lesson id the session is about. */
  subject: string | null;
  metrics: FlightMetrics;
  attempts: number;
  crashes: number;
  lastAttemptFailed: boolean;
  failReason: string;
  score: number;
  stars: number;
  objectivesCompleted: number;
  objectivesTotal: number;
}

function inputMode(): InputMode {
  if (activeInputSource() !== 'gamepad') return 'KEYBOARD';
  const device = useSettingsStore.getState().settings.gamepad.devices[activeDeviceKey()];
  return device?.kind === 'rc' ? 'RC_TRANSMITTER' : 'GAMEPAD';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface TelemetryOptions {
  sampleMs?: number;
  checkpointMs?: number;
}

/** Start recording. Returns a function that stops it. */
export function attachTelemetry(opts: TelemetryOptions = {}): () => void {
  let current: OpenFlight | null = null;
  let appVersion: string | undefined;
  void Promise.resolve(window.api.appInfo?.())
    .then((info) => (appVersion = info?.version))
    .catch(() => undefined);

  const recording = () => useAccountStore.getState().status === 'signedIn';

  const track = (type: GameplayEventType, data?: Record<string, unknown>) => {
    if (!recording()) return;
    AnalyticsService.track(type, data, current?.key ?? null);
  };

  function open(type: FlightType, subject: string | null): OpenFlight | null {
    if (!recording()) return null;
    const droneKey = useSettingsStore.getState().settings.selectedDroneId;
    const key = SessionService.start({
      flightType: type,
      droneKey,
      missionKey: type === 'MISSION' ? (subject ?? undefined) : undefined,
      lessonKey: type === 'TRAINING' ? (subject ?? undefined) : undefined,
      inputMode: inputMode(),
      appVersion,
    });
    if (!key) return null;
    current = {
      key,
      type,
      subject,
      metrics: new FlightMetrics(),
      attempts: 0,
      crashes: 0,
      lastAttemptFailed: false,
      failReason: '',
      score: 0,
      stars: 0,
      objectivesCompleted: 0,
      objectivesTotal: 0,
    };
    lastCheckpoint = Date.now();
    return current;
  }

  function snapshot(f: OpenFlight, result: SessionResult): SessionEnd {
    const m = f.metrics;
    return {
      endTime: new Date().toISOString(),
      duration: Math.round(m.activeSec),
      flightTime: Math.round(Math.min(m.flightSec, m.activeSec)),
      result,
      score: f.score,
      stars: f.type === 'FREE_FLIGHT' ? undefined : f.stars,
      crashCount: f.crashes,
      collisionCount: m.collisions,
      attempts: Math.max(1, f.attempts),
      distance: round1(m.distanceM),
      maxAltitude: round1(m.maxAltitudeM),
      batteryUsed: round1(m.batteryUsed * 100),
      inputMode: m.dominantInput(),
      objectivesCompleted: f.objectivesTotal > 0 ? f.objectivesCompleted : undefined,
      objectivesTotal: f.objectivesTotal > 0 ? f.objectivesTotal : undefined,
      failReason: f.failReason || undefined,
    };
  }

  function close(type: FlightType, result: SessionResult): void {
    if (!current || current.type !== type) return;
    SessionService.end(current.key, snapshot(current, result));
    current = null;
  }

  /** The outcome of a session that was left rather than finished. */
  const leftResult = (f: OpenFlight): SessionResult => (f.lastAttemptFailed ? 'FAILED' : 'ABORTED');

  // ---- Continuous sampling ------------------------------------------------

  let lastSample = Date.now();
  let lastCheckpoint = Date.now();
  let lastResetToken = useSimStore.getState().resetToken;

  const sampler = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastSample) / 1000;
    lastSample = now;

    const sim = useSimStore.getState();
    if (sim.resetToken !== lastResetToken) {
      lastResetToken = sim.resetToken;
      if (current) {
        track('DRONE_RESET');
        // R during practice starts a fresh attempt, unless it is clearing a
        // failure (which already counted the next attempt when it cleared).
        const t = useTrainingStore.getState();
        if (current.type === 'TRAINING' && t.phase === 'practice' && !t.validation.failed) {
          current.attempts += 1;
          current.lastAttemptFailed = false;
        }
      }
    }
    if (!current) return;

    const flight = useFlightStore.getState();
    current.metrics.sample(
      {
        armed: flight.armed,
        onGround: flight.onGround,
        paused: flight.paused,
        scripted: isScripted(),
        position: sim.position,
        altitude: sim.altitude,
        batterySoc: sim.batterySoc,
        touches: flight.touches,
        input: inputMode(),
      },
      dt,
    );

    if (now - lastCheckpoint >= (opts.checkpointMs ?? CHECKPOINT_MS)) {
      lastCheckpoint = now;
      SessionService.checkpoint(current.key, snapshot(current, leftResult(current)));
    }
  }, opts.sampleMs ?? SAMPLE_MS);

  // ---- Missions -----------------------------------------------------------

  const offMission = useMissionStore.subscribe((s, prev) => {
    if (prev.mission && s.mission?.id !== prev.mission.id && current?.type === 'MISSION') {
      close('MISSION', leftResult(current));
    }
    if (!s.mission) return;

    if (s.attempt !== prev.attempt && s.attempt > 0 && s.phase === 'flying') {
      if (current?.type === 'MISSION' && current.subject === s.mission.id) {
        current.attempts += 1;
        current.lastAttemptFailed = false;
        track('MISSION_RESTARTED', { attempt: current.attempts, after: prev.phase });
      } else if (open('MISSION', s.mission.id)) {
        current!.attempts = 1;
        track('MISSION_STARTED', { mission: s.mission.id, name: s.mission.name });
      }
    }

    const f = current;
    if (!f || f.type !== 'MISSION') return;

    f.score = s.points;
    f.objectivesCompleted = s.points;
    f.objectivesTotal = s.maxPoints;

    for (const id of Object.keys(s.collected)) {
      if (!prev.collected[id]) track('CHECKPOINT_REACHED', { checkpoint: id, points: s.points });
    }
    for (const zone of Object.keys(s.zonesTaken)) {
      if (prev.zonesTaken[zone as keyof typeof prev.zonesTaken]) continue;
      track(zone === 'pickup' ? 'PACKAGE_COLLECTED' : 'ZONE_REACHED', { zone, elapsed: round1(s.elapsed) });
    }
    if (s.deliveredCount > prev.deliveredCount) {
      track('PACKAGE_DELIVERED', { delivered: s.deliveredCount, elapsed: round1(s.elapsed) });
    }
    if (s.located && !prev.located) track('TARGET_DETECTED', { elapsed: round1(s.elapsed) });

    if (s.phase === 'failed' && prev.phase !== 'failed') {
      f.lastAttemptFailed = true;
      f.failReason = s.failReason ?? '';
      track('MISSION_FAILED', { reason: s.failReason, attempt: f.attempts, points: s.points, elapsed: round1(s.elapsed) });
    }

    if (s.phase === 'complete' && prev.phase !== 'complete' && s.result) {
      f.score = s.result.points;
      f.objectivesCompleted = s.result.points;
      f.objectivesTotal = s.result.maxPoints;
      f.stars = s.result.stars;
      f.lastAttemptFailed = false;
      f.failReason = '';
      track('MISSION_COMPLETED', {
        points: s.result.points,
        maxPoints: s.result.maxPoints,
        stars: s.result.stars,
        timeSec: round1(s.result.timeSec),
        collisions: s.result.collisions,
        attempt: f.attempts,
      });
      close('MISSION', 'SUCCESS');
    }
  });

  // ---- Flight School --------------------------------------------------------

  const offTraining = useTrainingStore.subscribe((s, prev) => {
    if (prev.activeLessonId && s.activeLessonId !== prev.activeLessonId && current?.type === 'TRAINING') {
      close('TRAINING', leftResult(current));
    }
    if (!s.activeLessonId) return;

    if (s.phase !== prev.phase || s.activeLessonId !== prev.activeLessonId) {
      const flying = s.phase === 'demo' || s.phase === 'practice';
      if (flying && current?.type !== 'TRAINING' && open('TRAINING', s.activeLessonId)) {
        track('TRAINING_STARTED', { lesson: s.activeLessonId });
      }
      const f = current;
      if (f?.type === 'TRAINING') {
        if (s.phase === 'demo') track('TRAINING_DEMO_STARTED');
        if (s.phase === 'practice') {
          f.attempts += 1;
          f.lastAttemptFailed = false;
          track('TRAINING_ATTEMPT_STARTED', { attempt: f.attempts });
        }
        if (s.phase === 'reward') {
          f.stars = s.lastStars;
          f.score = Math.round((s.lastStars / 3) * 100);
          f.lastAttemptFailed = false;
          track('TRAINING_COMPLETED', {
            stars: s.lastStars,
            timeSec: round1(s.lastTimeSec),
            xp: s.lastXp,
            attempt: f.attempts,
          });
          close('TRAINING', 'SUCCESS');
        }
      }
    }

    const f = current;
    if (f?.type !== 'TRAINING' || s.phase !== 'practice' || prev.phase !== 'practice') return;
    if (s.validation.failed && !prev.validation.failed) {
      f.lastAttemptFailed = true;
      f.failReason = useFlightStore.getState().crashed ? 'crash' : 'failed';
      track('TRAINING_ATTEMPT_FAILED', { attempt: f.attempts, reason: f.failReason, hint: s.hint });
    } else if (!s.validation.failed && prev.validation.failed) {
      f.attempts += 1;
      f.lastAttemptFailed = false;
      track('TRAINING_ATTEMPT_STARTED', { attempt: f.attempts });
    }
  });

  // ---- Free flight ---------------------------------------------------------

  const endFreeFlight = () => {
    if (current?.type !== 'FREE_FLIGHT') return;
    track('FREE_FLIGHT_ENDED', {
      flightTimeSec: Math.round(current.metrics.flightSec),
      distance: round1(current.metrics.distanceM),
    });
    close('FREE_FLIGHT', current.metrics.flightSec > 0 ? 'SUCCESS' : 'ABORTED');
  };

  const offUi = useUiStore.subscribe((s, prev) => {
    if (prev.section === 'fly' && s.section !== 'fly') endFreeFlight();
  });

  // ---- The aircraft ----------------------------------------------------------

  const offFlight = useFlightStore.subscribe((s, prev) => {
    if (s.armed && !prev.armed) {
      if (!current && useUiStore.getState().section === 'fly' && open('FREE_FLIGHT', null)) {
        current!.attempts = 1;
        track('FREE_FLIGHT_STARTED', { environment: useSettingsStore.getState().settings.selectedEnvironmentId });
      }
      if (current && !isScripted()) track('DRONE_ARMED');
    }
    if (!current || isScripted()) return;
    if (s.armed && prev.onGround && !s.onGround) track('DRONE_TOOK_OFF');
    if (!prev.onGround && s.onGround && (s.armed || prev.armed)) track('DRONE_LANDED');
    if (s.crashed && !prev.crashed) {
      current.crashes += 1;
      track('DRONE_CRASHED', {
        impactSpeed: round1(s.crashSpeed),
        altitude: round1(useSimStore.getState().altitude),
        brokenProps: s.brokenProps.length,
      });
    }
    if (s.lowBattery && !prev.lowBattery) track('BATTERY_LOW');
  });

  // ---- Drone and controller ---------------------------------------------------

  const offSettings = useSettingsStore.subscribe((s, prev) => {
    const from = prev.settings.selectedDroneId;
    const to = s.settings.selectedDroneId;
    // Missions swap the airframe themselves and put it back on the way out;
    // that is not the pilot choosing a drone.
    if (from === to || !prev.hydrated || useUiStore.getState().section === 'missions') return;
    endFreeFlight();
    track('DRONE_CHANGED', { from, to });
  });

  const hasWindowEvents = typeof window.addEventListener === 'function';
  const onPadConnected = (e: GamepadEvent) =>
    track('CONTROLLER_CONNECTED', { id: e.gamepad.id, kind: detectKind(e.gamepad) });
  const onPadDisconnected = (e: GamepadEvent) => track('CONTROLLER_DISCONNECTED', { id: e.gamepad.id });
  // The window closing mid-flight: end the session as best we know it. If the
  // message does not make it out, the last checkpoint closes it next launch.
  const onUnload = () => {
    if (current) close(current.type, current.type === 'FREE_FLIGHT' ? 'SUCCESS' : leftResult(current));
  };
  if (hasWindowEvents) {
    window.addEventListener('gamepadconnected', onPadConnected);
    window.addEventListener('gamepaddisconnected', onPadDisconnected);
    window.addEventListener('beforeunload', onUnload);
  }

  // Signing out mid-flight ends the session; it stays attributed to the user
  // who flew it.
  const offAccount = useAccountStore.subscribe((s, prev) => {
    if (prev.status === 'signedIn' && s.status !== 'signedIn' && current) {
      SessionService.end(current.key, snapshot(current, 'ABORTED'));
      current = null;
    }
  });

  return () => {
    onUnload();
    clearInterval(sampler);
    offMission();
    offTraining();
    offUi();
    offFlight();
    offSettings();
    offAccount();
    if (hasWindowEvents) {
      window.removeEventListener('gamepadconnected', onPadConnected);
      window.removeEventListener('gamepaddisconnected', onPadDisconnected);
      window.removeEventListener('beforeunload', onUnload);
    }
  };
}
