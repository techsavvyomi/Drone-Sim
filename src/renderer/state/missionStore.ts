import { create } from 'zustand';
import type { MissionProgress } from '@shared/types';
import type {
  Mission,
  MissionDelivery,
  MissionKind,
  MissionResult,
  MissionZoneKind,
} from '../missions/types';
import { deliveryCount, maxPointsOf, rankFor } from '../missions/types';
import { zoneFor, type SearchZone } from '../missions/searchZone';
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
 *
 * A SEARCH mission puts two legs in front of that tail instead of the first
 * three:
 *
 * searching -> confirming -> delivered -> returning -> landing -> complete
 *
 * `searching` is the whole of the new part — no destination exists yet as far
 * as anything on screen is concerned. `confirming` is the five second hover
 * once the casualty has been found. From there it is an ordinary flight home,
 * deliberately: the search is over, and making the pilot find their way back as
 * well would be testing the same thing twice with a timer running.
 */
export type MissionLeg =
  | 'searching'
  | 'confirming'
  | 'toPickup'
  | 'carrying'
  | 'toDrop'
  | 'delivered'
  | 'returning'
  | 'landing'
  | 'complete';

export type PayloadState = 'waiting' | 'attached' | 'delivered';

/**
 * Why an attempt ended.
 *
 * The brief lists "payload lost before the destination" as a third failure. It
 * is not a case this mission can reach: the package is carried by the airframe,
 * not by a rope, so the only way to lose it is to wreck the aircraft — which is
 * the crash. Rather than carry an enum member nothing can ever set, a crash made
 * while carrying drops the package (see `Payload`) and the result card says so.
 *
 * `payload` is the load lost in flight rather than in a wreck: the suppression
 * fire takes the tank off an aircraft that drops into it — see `loseLoadAgl`.
 * There is no way to pick a second one up, so it ends the attempt rather than
 * leaving the pilot flying an unwinnable mission.
 *
 * `strayed` is the brief's optional fourth: the pilot left the mission area and
 * did not come back inside the grace period. Only a mission that declares a
 * `strayRadius` can reach it.
 */
export type FailReason = 'crash' | 'timeout' | 'strayed' | 'payload';

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

  /**
   * Which package of a multi-point delivery is live, 0-based.
   *
   * The whole of the "no skipping" rule lives in this one number. It is advanced
   * ONLY by completing the delivery it is on, so a pilot cannot collect B before
   * A is down, and cannot put B on C's mark — there is no C mark being tested
   * while the index says B. Always 0 on a single-drop mission.
   */
  runIndex: number;
  /** How many packages are down. Drives the HUD's "2 / 3" and which boxes are
   *  drawn standing on their marks rather than waiting at the hub. */
  deliveredCount: number;

  /**
   * Which of a search mission's candidate locations is live, 0-based.
   *
   * Chosen at random when the attempt arms and never touched again, so it is
   * the one number that makes the mission unmemorisable. Always 0 on every
   * other mission, where nothing reads it.
   */
  siteIndex: number;
  /**
   * The RED ZONE: the search area drawn on the map, world metres.
   *
   * Drawn once with the site and then fixed for the attempt — a circle that
   * moved would be the app searching on the pilot's behalf. Null on every
   * mission that is not a search, where nothing reads it.
   */
  searchZone: SearchZone | null;
  /**
   * How strong the emergency signal is, 0 to 1. Search missions only.
   *
   * Zero means BOTH "nothing heard" and "nothing to hear" — the HUD does not
   * distinguish them, and must not: a cell reading 0% across the whole map is a
   * detector that works at any range, because a pilot can fly a grid and watch
   * for it to leave zero. Outside the detect radius the cell is not drawn.
   */
  signal: number;
  /**
   * Whether the casualty has been FOUND.
   *
   * The single gate on every piece of target guidance in the app. False for the
   * whole search and true from the confirmation onwards; nothing else sets it,
   * and a restart puts it back.
   */
  located: boolean;

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
  /**
   * How far the active marker sits ABOVE the drone, in metres. Negative is
   * below.
   *
   * The Director already had this number — it is the `dy` the 3-D distance is
   * built from — and threw it away. Everything the pilot was given about where
   * to go was flat: a bearing arrow, a top-down radar, and an ALTITUDE cell
   * reading the DRONE's own height. On a mission whose drop is on a roof
   * twenty-five metres up, none of the three ever said so.
   */
  climb: number;
  /** Bearing to the active marker relative to the drone's nose, radians.
   *  0 is straight ahead, positive to the right. */
  bearing: number;
  checks: DeliveryChecks;
  /** Whether the drone is close enough to the pickup for its conditions card to
   *  mean anything. The collection leg starts at take-off, so without this the
   *  card sits on screen from the pad — ticking Height and Steady for a drone
   *  parked twenty-five metres from the package it has not gone to yet. */
  atPickup: boolean;
  /** Checkpoints still to be taken before the package will release, and how
   *  many there were to begin with. Published by the Director so the HUD can
   *  say why a delivery that looks correct is not firing. */
  gate: { left: number; total: number };
  collisions: number;

  /**
   * How much of the fire is left, 1 down to 0. Suppression missions only.
   *
   * Published rather than derived from the hold timer, because it is not the
   * same number: the hold RESETS when the pilot drifts off the mark and the
   * fire does not. A fire that jumped back to full every time the drone slid
   * two metres would make a ten second hover a thing nobody finishes, and the
   * brief is explicit that leaving the zone pauses the suppression.
   */
  fireIntensity: number;
  /** Whether the tank is actually spraying this frame — the spray plume, the
   *  HUD's live readout and the fire's own hiss all read it. */
  suppressing: boolean;

  result: CompletedResult | null;
  failReason: FailReason | null;

  start: (mission: Mission) => void;
  beginFlight: () => void;
  /** Put the attempt back to its opening state, keeping the mission loaded. */
  restart: () => void;
  /** Leave the mission entirely — back to the mission list. */
  exit: () => void;

  setLeg: (leg: MissionLeg) => void;
  /** Signal strength, published by the Director at the HUD's rate. */
  setSignal: (signal: number) => void;
  /** The casualty is found. One way only — nothing puts it back but a restart. */
  setLocated: () => void;
  setPayload: (payload: PayloadState) => void;
  /** Move on to the next package. The only way `runIndex` ever changes. */
  advanceRun: () => void;
  /** Score one delivery of a multi-point mission and count it. */
  takeDelivery: (label: string) => void;
  /** Put the pickup mark back in play for the next package. `zonesTaken` is a
   *  record of three kinds and the pickup is visited once per package, so the
   *  flag has to be cleared rather than merely re-read. */
  rearmPickup: () => void;
  collect: (id: string, label: string) => void;
  takeZone: (kind: MissionZoneKind, label: string, scores?: boolean) => void;
  showBanner: (b: Omit<Banner, 'id' | 'until'>, seconds: number) => void;
  clearBanner: () => void;
  /** Play a Mission Control line once. Returns false if it has already run. */
  playRadio: (key: string, text: string, seconds: number) => boolean;
  clearRadio: () => void;
  setFlightData: (d: {
    distance: number;
    altitude: number;
    bearing: number;
    climb: number;
  }) => void;
  setChecks: (checks: DeliveryChecks) => void;
  setAtPickup: (atPickup: boolean) => void;
  setGate: (gate: { left: number; total: number }) => void;
  setFire: (fire: { fireIntensity: number; suppressing: boolean }) => void;
  setElapsed: (elapsed: number) => void;
  setCollisions: (collisions: number) => void;
  finish: (r: MissionResult) => void;
  fail: (reason: FailReason) => void;
}

/** The parts of an attempt that a restart wipes. Kept in one place so a new
 *  field cannot be added to the store and forgotten by the teardown. */
function freshAttempt(mission: Mission | null) {
  return {
    // Every mission opens on the run to the pickup — the search too, which now
    // collects a food box before it goes looking for the person it is for.
    leg: 'toPickup' as MissionLeg,
    // WHICH SITE, decided here and only here. It is re-rolled on every attempt
    // — including a restart — so a pilot who failed at site B is not handed
    // site B again to fly from memory.
    ...pickSearch(mission),
    signal: 0,
    located: false,
    payload: 'waiting' as PayloadState,
    runIndex: 0,
    deliveredCount: 0,
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
    climb: 0,
    bearing: 0,
    checks: NO_CHECKS,
    atPickup: false,
    gate: { left: 0, total: 0 },
    collisions: 0,
    // A fresh attempt is a fire burning at full. It has to be reset here with
    // everything else: a retry that kept the last run's intensity would open on
    // a fire the pilot had already half put out.
    fireIntensity: 1,
    suppressing: false,
    result: null,
    failReason: null,
  };
}

/**
 * Which site the LAST attempt drew, so the next one can refuse to repeat it.
 *
 * Module scope rather than store state on purpose: it has to outlive the
 * attempt it describes, and `freshAttempt` exists to wipe everything the store
 * holds. A restart clears the run; it must not clear the memory of what the run
 * was, or the whole point of this is lost on the one path that needs it most.
 */
let lastSiteIndex = -1;

/**
 * One of the mission's search sites at random, never the one just flown.
 *
 * Plain random over four sites means one attempt in four hands the pilot the
 * position they have this moment finished searching, and a pilot who is handed
 * the same casualty twice does not search at all — they fly straight there,
 * which is the one thing this mission is built to prevent. So the draw is over
 * the OTHER sites: every start is somewhere new.
 *
 * With four sites that still leaves three possibilities each time, so the
 * sequence is not a rotation the pilot can learn either.
 */
function pickSiteIndex(mission: Mission | null): number {
  const n = mission?.search?.sites.length ?? 0;
  if (n <= 0) return 0;
  // With one site there is nothing to avoid; with two the "other" is forced.
  if (n === 1) return 0;
  const choices = [];
  for (let i = 0; i < n; i++) if (i !== lastSiteIndex) choices.push(i);
  const next = choices[Math.floor(Math.random() * choices.length)] ?? 0;
  lastSiteIndex = next;
  return next;
}

/**
 * The site and the red zone around it, drawn together.
 *
 * Together rather than in two fields, because a zone that does not contain its
 * own site is the mission's one unrecoverable state: the pilot searches the
 * circle honestly and completely, and nobody is in it. Deriving the second from
 * the first at the single moment the first is chosen is what makes that
 * impossible to express.
 */
function pickSearch(mission: Mission | null): { siteIndex: number; searchZone: SearchZone | null } {
  const siteIndex = pickSiteIndex(mission);
  const search = mission?.search;
  const site = search?.sites[siteIndex];
  return {
    siteIndex,
    searchZone: search && site ? zoneFor(site.at, search.zoneRadius) : null,
  };
}

let seq = 0;
const nextId = () => ++seq;

export const useMissionStore = create<MissionState>((set, get) => ({
  mission: null,
  phase: 'briefing',
  maxPoints: 0,
  ...freshAttempt(null),

  start: (mission) =>
    set({ mission, phase: 'briefing', maxPoints: maxPointsOf(mission), ...freshAttempt(mission) }),

  beginFlight: () => set((s) => ({ phase: 'flying', ...freshAttempt(s.mission) })),

  restart: () => set((s) => ({ phase: 'flying', ...freshAttempt(s.mission) })),

  exit: () => set({ mission: null, phase: 'briefing', maxPoints: 0, ...freshAttempt(null) }),

  setLeg: (leg) => set({ leg }),
  setSignal: (signal) => set({ signal }),
  setLocated: () => set({ located: true }),
  setPayload: (payload) => set({ payload }),

  advanceRun: () => set((s) => ({ runIndex: s.runIndex + 1 })),

  takeDelivery: (label) =>
    set((s) => ({
      deliveredCount: s.deliveredCount + 1,
      points: s.points + 1,
      pointPop: { id: nextId(), label },
    })),

  rearmPickup: () =>
    set((s) => {
      const zonesTaken = { ...s.zonesTaken };
      delete zonesTaken.pickup;
      return { zonesTaken };
    }),

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
  setAtPickup: (atPickup) => set({ atPickup }),
  setGate: (gate) => set({ gate }),
  setFire: (fire) => set(fire),
  setElapsed: (elapsed) => set({ elapsed }),
  setCollisions: (collisions) => set({ collisions }),

  finish: (r) => {
    const mission = get().mission;
    const stars = mission ? rankFor(mission.ranks, r) : 1;
    if (mission) record(mission.id, r, stars);
    // The tank is shut off with the flight. `suppressing` drives a plume in the
    // world, and the world is still being rendered behind the result card.
    set({
      phase: 'complete',
      leg: 'complete',
      banner: null,
      suppressing: false,
      result: { ...r, stars },
    });
  },

  fail: (reason) => set({ phase: 'failed', banner: null, suppressing: false, failReason: reason }),
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
  // 'searching' and 'confirming' answer null: a search mission declares no
  // route at all, and a leg with no rings on it must not fall through to
  // another leg's.
  return null;
}

/** Which zone the pilot is being sent to right now, or null once home. */
export function activeZone(leg: MissionLeg): MissionZoneKind | null {
  // NOTHING is live while the pilot is searching. This is the first of the two
  // halves of the no-guidance rule and the one that does most of the work: the
  // lit mark, the radar's dot and the DISTANCE readout all ask this question,
  // and all three go quiet on one answer.
  if (leg === 'searching') return null;
  if (leg === 'confirming') return 'drop';
  if (leg === 'toPickup') return 'pickup';
  if (leg === 'carrying' || leg === 'toDrop') return 'drop';
  if (leg === 'delivered' || leg === 'returning' || leg === 'landing') return 'base';
  return null;
}

/**
 * Whether every piece of target guidance is suppressed this frame.
 *
 * The OTHER half of the no-guidance rule, and the half that is a flag rather
 * than an absence. `activeZone` going null is what silences the mark and the
 * dot; this is what the HUD, the map and the in-picture pointer read to know
 * that the silence is DELIBERATE rather than a leg between two marks.
 *
 * Written as one exported function so there is exactly one answer for all four
 * consumers, and so a test can assert it — see TC-401. A mission that does not
 * declare `hideGuidanceUntilFound` can never reach it.
 */
export function guidanceHidden(
  mission: Mission | null,
  located: boolean,
  leg: MissionLeg = 'searching',
): boolean {
  // The run to the PICKUP is ordinary flying: the food box is on a marked pad
  // and the pilot is guided to it like any other collection. Only the search
  // that follows is silent.
  return mission?.hideGuidanceUntilFound === true && !located && leg !== 'toPickup';
}

/**
 * The objective line, in the pilot's words. One sentence, no punctuation games.
 *
 * Written per KIND rather than per mission. The state machine is the same on
 * both — collect, cross, hold, come home, land — and what changes is only what
 * the holding is for, so two short tables say it without either mission having
 * to carry seven strings of its own.
 */
export function objectiveFor(
  leg: MissionLeg,
  kind: MissionKind = 'delivery',
  run: RunContext | null = null,
): string {
  const fire = kind === 'suppression';
  switch (leg) {
    case 'searching':
      return 'Search the red zone for the person on the rooftop.';
    case 'confirming':
      return 'Hold a steady hover over them to drop the food box.';
    case 'toPickup':
      if (kind === 'search') return 'Collect the food box from the pickup pad.';
      // A multi-point delivery visits the pickup once per package, and the
      // second visit is a different instruction from the first: the pilot is
      // coming BACK, and the line has to say so or the objective reads as if
      // nothing has happened since the last one.
      if (run) {
        return run.index === 0
          ? `Collect ${run.name} from the logistics hub.`
          : `Return to the logistics hub for ${run.name}.`;
      }
      return fire ? 'Collect the firefighting payload.' : 'Fly to the pickup location.';
    case 'carrying':
      if (run) return `Deliver ${run.name} to ${run.to}.`;
      return fire
        ? 'Reach the fire zone and suppress the fire.'
        : 'Deliver the payload to the marked location.';
    case 'toDrop':
      if (run) return `Centre over ${run.to} and descend.`;
      return fire ? 'Hold your position over the fire.' : 'Centre over the drop mark and descend.';
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

/**
 * The live package, for the objective line and the HUD.
 *
 * Null on a single-drop mission, which is what keeps every existing string
 * exactly as it was: the multi-point wording is reached only by a mission that
 * actually has a list of packages.
 */
export function runContextOf(mission: Mission | null, runIndex: number): RunContext | null {
  const list = mission?.deliveries;
  if (!mission || !list || list.length === 0) return null;
  const i = Math.min(Math.max(runIndex, 0), list.length - 1);
  const d: MissionDelivery = list[i];
  return { name: d.name, to: d.zone.label, index: i, total: deliveryCount(mission) };
}

/** Which package the pilot is on, and where it goes. */
export interface RunContext {
  name: string;
  to: string;
  index: number;
  total: number;
}
