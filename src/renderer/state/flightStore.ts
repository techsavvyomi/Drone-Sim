import { create } from 'zustand';
import type { FlightMode } from '@shared/types';
import { dronePose } from '../sim/drone/pose';

export type AutoState = 'manual' | 'takeoff' | 'land';

/** High-level drone state, driven by arm/disarm, ground contact and crashes. */
export type DroneStatus = 'disarmed' | 'armed' | 'flying' | 'crashed';

/** Below this, Space means takeoff — above it, Space means land. */
const TAKEOFF_ALT_GATE = 1.2;
/** After starting takeoff, ignore Space→land for this long (ms). */
const LAND_LOCKOUT_MS = 4000;
/** After a landing starts or finishes, ignore Space→takeoff (ms). */
const RELAUNCH_LOCKOUT_MS = 1800;

/** Wall-clock when takeoff last started — blocks accidental land. */
let takeoffStartedAt = 0;
/** Wall-clock when land last started/finished — blocks accidental takeoff. */
let landHoldUntil = 0;

interface FlightState {
  armed: boolean;
  mode: FlightMode;
  /** See `setAutoDisarmOnLand`. */
  autoDisarmOnLand: boolean;
  auto: AutoState;
  /** Whether the drone is resting on the ground (set by the drone entity). */
  onGround: boolean;
  /** Set by a major impact; blocks control until reset. */
  crashed: boolean;
  /** Impact speed of the crash, m/s — shown on the crash overlay. */
  crashSpeed: number;
  /** Motor indices whose propeller broke off (FR/FL/BR/BL). */
  brokenProps: number[];
  paused: boolean;
  /** Pack at/below the 3.5 V warning threshold — pilot keeps control. */
  batteryWarning: boolean;
  /** Pack at/below 3.3 V — forced auto-landing that cannot be cancelled. */
  lowBattery: boolean;
  /** Pack is depleted — arming is blocked until reset or recharge. */
  batteryLocked: boolean;
  /** Incremented to request a battery recharge. */
  rechargeToken: number;

  status: () => DroneStatus;
  toggleArm: () => void;
  disarm: () => void;
  cycleMode: () => void;
  /** Put the aircraft in a specific mode. Flight School uses it to pin Altitude
   *  Hold for the duration of a lesson: every lesson is written around "centre
   *  the stick and it holds height", which is only true in that mode. */
  setMode: (mode: FlightMode) => void;
  setAuto: (auto: AutoState) => void;
  /** Whether an auto-landing shuts the motors down when it touches down.
   *
   *  True in free flight, where nobody else is going to do it. Flight School
   *  turns it OFF: Module 2 is called Land & Disarm, and a landing that disarms
   *  itself leaves the pilot one key to press instead of two, which is not the
   *  lesson. */
  setAutoDisarmOnLand: (on: boolean) => void;
  setOnGround: (onGround: boolean) => void;
  requestTakeoffLand: () => void;
  /** Major impact — motors cut, controls locked until reset. */
  crash: (speed: number, brokenProps?: number[]) => void;
  clearCrash: () => void;
  togglePause: () => void;
  setBatteryWarning: (on: boolean) => void;
  /** Begin the critical-battery forced landing (uncancellable). */
  triggerLowBattery: () => void;
  /** Pack is empty and the drone is down — block further flight. */
  lockBattery: () => void;
  /** Refill the pack and allow arming again. */
  recharge: () => void;
}

// All eight modes are selectable from Phase 2 onward.
const CYCLE: FlightMode[] = ['stabilize', 'altitude-hold', 'acro'];

export const useFlightStore = create<FlightState>((set, get) => ({
  armed: false,
  autoDisarmOnLand: true,
  // Altitude Hold by default: the drone holds height when the throttle stick
  // is centred, which is far more forgiving for a first flight than Stabilize.
  mode: 'altitude-hold',
  auto: 'manual',
  onGround: true,
  crashed: false,
  crashSpeed: 0,
  brokenProps: [],
  paused: false,
  batteryWarning: false,
  lowBattery: false,
  batteryLocked: false,
  rechargeToken: 0,

  status: () => {
    const s = get();
    if (s.crashed) return 'crashed';
    if (!s.armed) return 'disarmed';
    return s.onGround ? 'armed' : 'flying';
  },

  // A crashed drone — or a flat battery — must be cleared before arming again.
  toggleArm: () =>
    set((s) => {
      if (s.crashed) return s;
      // Disarming is always allowed; arming on a dead pack is not.
      if (!s.armed && s.batteryLocked) return s;
      return { armed: !s.armed, auto: 'manual' };
    }),
  disarm: () => {
    if (get().auto === 'land') landHoldUntil = performance.now() + RELAUNCH_LOCKOUT_MS;
    set({ armed: false, auto: 'manual' });
  },
  setMode: (mode) => set((s) => (s.lowBattery ? s : { mode })),
  cycleMode: () =>
    set((s) => {
      // The critical-battery landing must not be cancellable.
      if (s.lowBattery) return s;
      const i = CYCLE.indexOf(s.mode);
      return { mode: CYCLE[(i + 1) % CYCLE.length] };
    }),
  setAuto: (auto) => set({ auto }),
  setAutoDisarmOnLand: (autoDisarmOnLand) => set({ autoDisarmOnLand }),
  setOnGround: (onGround) => set({ onGround }),

  requestTakeoffLand: () => {
    const { armed, onGround, crashed, batteryLocked, lowBattery, auto } = get();
    if (crashed || lowBattery) return;
    if (onGround && batteryLocked) return;
    // Already climbing out on auto-takeoff — don't flip to land on a second Space.
    if (auto === 'takeoff') return;
    // Already landing — a second Space must not climb out near the floor.
    if (auto === 'land') return;
    if (performance.now() < landHoldUntil) return;

    const alt = dronePose.present ? dronePose.position.y : 0;
    // Spawns near/on ground clearance so onGround can be false initially;
    // treat near-ground as takeoff, not land.
    const nearGround = onGround || alt < TAKEOFF_ALT_GATE;
    const landLocked = performance.now() - takeoffStartedAt < LAND_LOCKOUT_MS;

    if (nearGround || landLocked) {
      // Arming is a deliberate, separate action. A takeoff command must never
      // arm the aircraft on the pilot's behalf — a disarmed airframe stays put,
      // exactly as it would on real hardware.
      if (!armed) return;
      // Still in the takeoff window — climb (or re-issue takeoff), never land.
      takeoffStartedAt = performance.now();
      set({ auto: 'takeoff' });
    } else if (armed) {
      landHoldUntil = performance.now() + RELAUNCH_LOCKOUT_MS;
      set({ auto: 'land' });
    }
  },

  crash: (speed, brokenProps = []) =>
    set((s) =>
      s.crashed
        ? s
        : { crashed: true, crashSpeed: speed, brokenProps, armed: false, auto: 'manual' },
    ),
  clearCrash: () => set({ crashed: false, crashSpeed: 0, brokenProps: [] }),

  setBatteryWarning: (on) => set((s) => (s.batteryWarning === on ? s : { batteryWarning: on })),

  // Critical: force Altitude Hold and a landing the pilot cannot cancel.
  triggerLowBattery: () =>
    set((s) => (s.lowBattery ? s : { lowBattery: true, auto: 'land', mode: 'altitude-hold' })),
  lockBattery: () => set({ batteryLocked: true, lowBattery: false, armed: false, auto: 'manual' }),
  recharge: () =>
    set((s) => ({
      rechargeToken: s.rechargeToken + 1,
      batteryLocked: false,
      lowBattery: false,
      batteryWarning: false,
    })),
  togglePause: () => set((s) => ({ paused: !s.paused })),
}));
