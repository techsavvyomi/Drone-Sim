import { create } from 'zustand';
import type { MissionProgress } from '@shared/types';
import type { Mission, MissionResult, MissionZoneKind } from '../missions/types';
import { maxPointsOf, rankFor } from '../missions/types';
import { useSettingsStore } from './settingsStore';

// ----------------------------------------------------------------------------
// Live state for one mission attempt.
//
// Everything on screen reads off this — the objective line, which marker is lit,
// the HUD numbers, the banners, Mission Control — so nothing can disagree about
// what leg the flight is on. `MissionDirector` is the only writer during flight.
//
// EVERY transient thing in here is driven off the mission's own clock rather
// than a `setTimeout`: banners and radio lines carry the elapsed time they
// expire at, and the Director retires them on the frame that passes it. That is
// what makes `reset()` a complete teardown — there is no timer left running from
// the attempt that was thrown away, which is the class of bug that leaves a
// banner from the last go flashing over a fresh briefing.
// ----------------------------------------------------------------------------

/** Where the pilot is in the mission screen as a whole. */
export type MissionPhase = 'briefing' | 'flying' | 'complete' | 'failed';

/**
 * The mission state machine.
 *
 * toPickup -> carrying -> toDrop -> delivered -> returning -> landing -> complete
 *
 * `carrying` is the long crossing with the package; `toDrop` begins the moment
 * the drone enters the delivery zone and the job changes from navigating to
 * positioning. `delivered` is the flight home, `returning` is being over the pad
 * with the landing still to do, `landing` is the touchdown settling.
 */
export type MissionLeg =
  'toPickup' | 'carrying' | 'toDrop' | 'delivered' | 'returning' | 'landing' | 'complete';

export type PayloadState = 'waiting' | 'attached' | 'delivered';

/**
 * Why an attempt ended.
 *
 * The brief lists "payload lost before the destination" as a third failure. It
 * is not a case this mission can reach: the package is carried by the airframe,
 * not by a rope, so the only way to lose it is to wreck the aircraft — which is
 * the crash. Rather than carry an enum member nothing can ever set, a crash made
 * while carrying drops the package (see `Payload`) and the result card says so.
 */
export type FailReason = 'crash' | 'timeout';

/** A transient line across the middle of the view. */
export interface Banner {
  /** Bumped every time, so the HUD can re-run its entry animation. */
  id: number;
  kind: 'info' | 'good' | 'warn';
  title: string;
  sub?: string;
  /** Mission clock, in seconds, at which it retires. */
  until: number;
}

/** A Mission Control line, shown along the bottom of the view. */
export interface Radio {
  id: number;
  key: string;
  text: string;
  until: number;
}

/** The three tests the delivery hold is watching, for the HUD's checklist. */
export interface DeliveryChecks {
  centred: boolean;
  inBand: boolean;
  steady: boolean;
  /** 0..1 of the required hold that has been served. */
  hold: number;
}

export interface CompletedResult extends MissionResult {
  stars: 1 | 2 | 3;
}

const NO_CHECKS: DeliveryChecks = { centred: false, inBand: false, steady: false, hold: 0 };

interface MissionState {
  /** The mission being flown, or null on the mission list. */
  mission: Mission | null;
  phase: MissionPhase;
  leg: MissionLeg;
  payload: PayloadState;

  /** Route checkpoint ids already scored. */
  collected: Record<string, true>;
  /** Zones already scored. */
  zonesTaken: Partial<Record<MissionZoneKind, true>>;
  points: number;
  maxPoints: number;

  banner: Banner | null;
  radio: Radio | null;
  /** Radio keys already played, so a line can never repeat. */
  radioPlayed: Record<string, true>;
  /** Bumped on every point scored — the HUD floats a "+1" off it. */
  pointPop: { id: number; label: string } | null;

  /** Seconds since the mission started, published at 10 Hz. */
  elapsed: number;
  /** Metres to the active marker, in 3-D. */
  distance: number;
  altitude: number;
  /** Bearing to the active marker relative to the drone's nose, radians.
   *  0 is straight ahead, positive to the right. */
  bearing: number;
  checks: DeliveryChecks;
  /** Checkpoints still to be taken before the package will release, and how
   *  many there were to begin with. Published by the Director so the HUD can
   *  say why a delivery that looks correct is not firing. */
  gate: { left: number; total: number };
  collisions: number;

  result: CompletedResult | null;
  failReason: FailReason | null;

  start: (mission: Mission) => void;
  beginFlight: () => void;
  /** Put the attempt back to its opening state, keeping the mission loaded. */
  restart: () => void;
  /** Leave the mission entirely — back to the mission list. */
  exit: () => void;

  setLeg: (leg: MissionLeg) => void;
  setPayload: (payload: PayloadState) => void;
  collect: (id: string, label: string) => void;
  takeZone: (kind: MissionZoneKind, label: string, scores?: boolean) => void;
  showBanner: (b: Omit<Banner, 'id' | 'until'>, seconds: number) => void;
  clearBanner: () => void;
  /** Play a Mission Control line once. Returns false if it has already run. */
  playRadio: (key: string, text: string, seconds: number) => boolean;
  clearRadio: () => void;
  setFlightData: (d: { distance: number; altitude: number; bearing: number }) => void;
  setChecks: (checks: DeliveryChecks) => void;
  setGate: (gate: { left: number; total: number }) => void;
  setElapsed: (elapsed: number) => void;
  setCollisions: (collisions: number) => void;
  finish: (r: MissionResult) => void;
  fail: (reason: FailReason) => void;
}

/** The parts of an attempt that a restart wipes. Kept in one place so a new
 *  field cannot be added to the store and forgotten by the teardown. */
function freshAttempt() {
  return {
    leg: 'toPickup' as MissionLeg,
    payload: 'waiting' as PayloadState,
    collected: {} as Record<string, true>,
    zonesTaken: {} as Partial<Record<MissionZoneKind, true>>,
    points: 0,
    banner: null,
    radio: null,
    radioPlayed: {} as Record<string, true>,
    pointPop: null,
    elapsed: 0,
    distance: 0,
    altitude: 0,
    bearing: 0,
    checks: NO_CHECKS,
    gate: { left: 0, total: 0 },
    collisions: 0,
    result: null,
    failReason: null,
  };
}

let seq = 0;
const nextId = () => ++seq;

export const useMissionStore = create<MissionState>((set, get) => ({
  mission: null,
  phase: 'briefing',
  maxPoints: 0,
  ...freshAttempt(),

  start: (mission) =>
    set({ mission, phase: 'briefing', maxPoints: maxPointsOf(mission), ...freshAttempt() }),

  beginFlight: () => set({ phase: 'flying', ...freshAttempt() }),

  restart: () => set({ phase: 'flying', ...freshAttempt() }),

  exit: () => set({ mission: null, phase: 'briefing', maxPoints: 0, ...freshAttempt() }),

  setLeg: (leg) => set({ leg }),
  setPayload: (payload) => set({ payload }),

  collect: (id, label) =>
    set((s) =>
      s.collected[id]
        ? s
        : {
            collected: { ...s.collected, [id]: true },
            points: s.points + 1,
            pointPop: { id: nextId(), label },
          },
    ),

  // `scores` is false for the pickup: it is the start of the job rather than an
  // achievement, so it is marked as taken — the mark goes out, the leg moves on
  // — without a point or a "+1" for it.
  takeZone: (kind, label, scores = true) =>
    set((s) =>
      s.zonesTaken[kind]
        ? s
        : {
            zonesTaken: { ...s.zonesTaken, [kind]: true },
            points: s.points + (scores ? 1 : 0),
            pointPop: scores ? { id: nextId(), label } : s.pointPop,
          },
    ),

  showBanner: (b, seconds) =>
    set((s) => ({ banner: { ...b, id: nextId(), until: s.elapsed + seconds } })),

  clearBanner: () => set({ banner: null }),

  playRadio: (key, text, seconds) => {
    if (get().radioPlayed[key]) return false;
    set((s) => ({
      radio: { id: nextId(), key, text, until: s.elapsed + seconds },
      radioPlayed: { ...s.radioPlayed, [key]: true },
    }));
    return true;
  },

  clearRadio: () => set({ radio: null }),

  setFlightData: (d) => set(d),
  setChecks: (checks) => set({ checks }),
  setGate: (gate) => set({ gate }),
  setElapsed: (elapsed) => set({ elapsed }),
  setCollisions: (collisions) => set({ collisions }),

  finish: (r) => {
    const mission = get().mission;
    const stars = mission ? rankFor(mission.ranks, r) : 1;
    if (mission) record(mission.id, r, stars);
    set({ phase: 'complete', leg: 'complete', banner: null, result: { ...r, stars } });
  },

  fail: (reason) => set({ phase: 'failed', banner: null, failReason: reason }),
}));

/**
 * Write a completed attempt into the settings document, keeping the BEST of it.
 *
 * Stars, points and time are each kept at their own best rather than as one
 * "best run": a pilot who cleaned up the checkpoints on a slow flight and then
 * flew a fast one has genuinely done both, and the card should say so.
 *
 * Fire-and-forget through `settingsStore.set`, exactly as `completeLesson` does —
 * the IPC channel preserves ordering, so a result cannot land out of sequence.
 */
function record(missionId: string, r: MissionResult, stars: number): void {
  const settings = useSettingsStore.getState();
  const progress = settings.settings.missions;
  const prev = progress.missions[missionId];

  const next: MissionProgress = {
    missions: {
      ...progress.missions,
      [missionId]: {
        completed: true,
        stars: Math.max(prev?.stars ?? 0, stars),
        bestPoints: Math.max(prev?.bestPoints ?? 0, r.points),
        // A first completion has no previous time to beat, and Math.min against
        // a missing one would keep 0 forever.
        bestTimeSec: prev?.bestTimeSec ? Math.min(prev.bestTimeSec, r.timeSec) : r.timeSec,
      },
    },
  };
  settings.set('missions', next);
}

/** True if a mission can be opened: the first one, or the previous is done. */
export function isMissionUnlocked(missions: readonly Mission[], id: string): boolean {
  const i = missions.findIndex((m) => m.id === id);
  if (i <= 0) return true;
  const previous = missions[i - 1];
  return !!useSettingsStore.getState().settings.missions.missions[previous.id]?.completed;
}

/** Whether a route checkpoint is on the leg the pilot is currently flying.
 *
 *  What makes the NEXT one readable: the guide lights the checkpoints of the
 *  live leg and leaves the rest of the city dark, so a route of thirteen balls
 *  is never thirteen targets at once. */
export function legOf(leg: MissionLeg): 'toPickup' | 'toDrop' | 'toBase' | null {
  if (leg === 'toPickup') return 'toPickup';
  if (leg === 'carrying' || leg === 'toDrop') return 'toDrop';
  if (leg === 'delivered' || leg === 'returning') return 'toBase';
  return null;
}

/** Which zone the pilot is being sent to right now, or null once home. */
export function activeZone(leg: MissionLeg): MissionZoneKind | null {
  if (leg === 'toPickup') return 'pickup';
  if (leg === 'carrying' || leg === 'toDrop') return 'drop';
  if (leg === 'delivered' || leg === 'returning' || leg === 'landing') return 'base';
  return null;
}

/** The objective line, in the pilot's words. One sentence, no punctuation games. */
export function objectiveFor(leg: MissionLeg): string {
  switch (leg) {
    case 'toPickup':
      return 'Fly to the pickup location.';
    case 'carrying':
      return 'Deliver the payload to the marked location.';
    case 'toDrop':
      return 'Centre over the drop mark and descend.';
    case 'delivered':
      return 'Return to base.';
    case 'returning':
      return 'Land the drone safely.';
    case 'landing':
      return 'Hold it still on the pad.';
    case 'complete':
      return 'Mission complete.';
  }
}
