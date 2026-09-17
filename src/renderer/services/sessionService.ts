import type { FlightType, InputMode } from '@shared/backend/contract';
import type { SessionEnd } from '@shared/backend/ipc';
import { profileBackend } from './backend';
import { DRONE_IDS, MISSION_IDS, TRAINING_IDS } from './catalog';

// SessionService: one flight session's start, checkpoints and end.
//
// Callers speak in the simulator's own keys ('pluto-guru', 'forest-fire'); this
// maps them to catalog ids. Sessions are identified by a client-generated key,
// so nothing here ever waits for the backend to hand an id back.

export interface SessionSubject {
  flightType: FlightType;
  droneKey: string;
  missionKey?: string;
  lessonKey?: string;
  inputMode: InputMode;
  appVersion?: string;
}

function newKey(): string {
  return crypto.randomUUID();
}

export const SessionService = {
  /**
   * Open a session and return its client key, or null when the subject is not
   * in the analytics catalog (a new drone or mission nobody has registered yet).
   */
  start(subject: SessionSubject, startedAt: Date = new Date()): string | null {
    const droneId = DRONE_IDS[subject.droneKey];
    const missionId = subject.missionKey ? MISSION_IDS[subject.missionKey] : undefined;
    const trainingId = subject.lessonKey ? TRAINING_IDS[subject.lessonKey] : undefined;
    const missing =
      !droneId ||
      (subject.flightType === 'MISSION' && !missionId) ||
      (subject.flightType === 'TRAINING' && !trainingId);
    if (missing) {
      console.warn('[telemetry] not recorded: no catalog id for', subject);
      return null;
    }

    const key = newKey();
    profileBackend().telemetry.startSession({
      flightType: subject.flightType,
      droneId,
      missionId,
      trainingId,
      inputMode: subject.inputMode,
      startTime: startedAt.toISOString(),
      clientSessionKey: key,
      appVersion: subject.appVersion,
    });
    return key;
  },

  /** Latest numbers, kept in case the app closes before `end`. */
  checkpoint(key: string, snapshot: SessionEnd): void {
    profileBackend().telemetry.checkpoint(key, snapshot);
  },

  end(key: string, snapshot: SessionEnd): void {
    profileBackend().telemetry.endSession(key, snapshot);
  },
};
