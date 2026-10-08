import { create } from 'zustand';
import type { FlightMode } from '@shared/types';
import { dronePose } from '../sim/drone/pose';
import { useSimStore } from './simStore';

export type AutoState = 'manual' | 'takeoff' | 'land';

/** High-level drone state, driven by arm/disarm, ground contact and crashes. */
export type DroneStatus = 'disarmed' | 'armed' | 'flying' | 'crashed';

/** Below this, Space means takeoff — above it, Space means land. */
const TAKEOFF_ALT_GATE = 1.2;

interface FlightState {
  /** Arm was pressed with the throttle raised and refused; the HUD says so. On a
   *  radio the request stands: lowering the stick to the bottom completes it. */
  armThrottleHigh: boolean;
  setArmThrottleHigh: (high: boolean) => void;
  armed: boolean;
  mode: FlightMode;
  /** See `setAutoDisarmOnLand`. */
  autoDisarmOnLand: boolean;
  auto: AutoState;
  /** Whether the drone is resting on the ground (set by the drone entity). */
  onGround: boolean;
  /** Set by a major impact; blocks control until reset. */
  crashed: boolean;
  /** Impact speed of the crash, m/s — shown on the crash card. */
  crashSpeed: number;
  /** Where the crash happened, for the crash card's "At 3:12, 1.2 m up" line.
   *  Display only: stamped from the last published telemetry at `crash`. */
  crashAt: { flightTime: number; altitude: number } | null;
  /** The pause card is asking "Exit the mission?" (lessons and missions). */
  exitAsk: boolean;
  /**
   * Everything the drone has hit while airborne, since the app started.
   *
   * A running total, never reset here: whoever cares about a stretch of flying
   * takes a reading at the start of it and subtracts. Counts CONTACTS, not
   * crashes — brushing a gate upright at walking pace is not a crash, and until
   * this existed it cost the pilot nothing at all, which is not what "a clean
   * flight" means. Ground contact is excluded by the caller; taking off and
   * landing are not things you bump into.
   */
  touches: number;
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
  /** Record one contact with something that is not the floor. */
  registerTouch: () => void;
  togglePause: () => void;
  /** Show or drop the pause card's exit question. */
  setExitAsk: (ask: boolean) => void;
  setBatteryWarning: (on: boolean) => void;
  /** Begin the critical-battery forced landing (uncancellable). */
  triggerLowBattery: () => void;
  /** Pack is empty and the drone is down — block further flight. */
  lockBattery: () => void;
  /** Refill the pack and allow arming again. */
  recharge: () => void;
}

// The three supported flight modes.
const CYCLE: FlightMode[] = ['stabilize', 'altitude-hold', 'acro'];

export const useFlightStore = create<FlightState>((set, get) => ({
  armThrottleHigh: false,
  setArmThrottleHigh: (armThrottleHigh) => set({ armThrottleHigh }),
  armed: false,
  autoDisarmOnLand: true,
  // Altitude Hold by default: the drone holds height when the throttle stick
  // is centred, which is far more forgiving for a first flight than Stabilize.
  mode: 'altitude-hold',
  auto: 'manual',
  onGround: true,
  crashed: false,
  crashSpeed: 0,
  crashAt: null,
  exitAsk: false,
  touches: 0,
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
      return { armed: !s.armed, auto: 'manual', armThrottleHigh: false };
    }),
  disarm: () => set({ armed: false, auto: 'manual', armThrottleHigh: false }),
  // Acro has no automatic takeoff or landing: entering it hands a running one
  // back to the pilot, so no assisted thrust is ever flown in Acro.
  setMode: (mode) =>
    set((s) => (s.lowBattery ? s : { mode, auto: mode === 'acro' ? 'manual' : s.auto })),
  cycleMode: () =>
    set((s) => {
      // The critical-battery landing must not be cancellable.
      if (s.lowBattery) return s;
      const mode = CYCLE[(CYCLE.indexOf(s.mode) + 1) % CYCLE.length];
      return { mode, auto: mode === 'acro' ? 'manual' : s.auto };
    }),
  setAuto: (auto) => set({ auto }),
  setAutoDisarmOnLand: (autoDisarmOnLand) => set({ autoDisarmOnLand }),
  setOnGround: (onGround) => set({ onGround }),

  requestTakeoffLand: () => {
    const { armed, onGround, crashed, batteryLocked, lowBattery, auto, mode } = get();
    // Acro is flown by hand from the pad to the pad.
    if (mode === 'acro' || crashed || lowBattery) return;
    if (onGround && batteryLocked) return;
    // Already climbing out on auto-takeoff — don't flip to land on a second Space.
    if (auto === 'takeoff') return;
    // Already landing — a second Space must not climb out near the floor.
    if (auto === 'land') return;

    const alt = dronePose.present ? dronePose.position.y : 0;
    // Spawns near/on ground clearance so onGround can be false initially;
    // treat near-ground as takeoff, not land.
    const nearGround = onGround || alt < TAKEOFF_ALT_GATE;

    // Height is the ONLY thing that decides which of the two this key means.
    //
    // There used to be two timed lockouts here — four seconds in which a
    // take-off could not be turned into a landing, and nearly two after a
    // landing in which the aircraft refused to go back up. Both were a key that
    // did nothing, with nothing on screen saying why, and the first re-armed
    // itself on every press so a pilot tapping Space never landed at all.
    // Neither is needed: the sequences themselves are already protected, since
    // `auto` swallows Space for the whole of a climb-out or a descent. Once one
    // has handed back, the pilot's press is answered at once.
    if (nearGround) {
      // Arming is a deliberate, separate action. A takeoff command must never
      // arm the aircraft on the pilot's behalf — a disarmed airframe stays put,
      // exactly as it would on real hardware.
      if (!armed) return;
      set({ auto: 'takeoff' });
    } else if (armed) {
      set({ auto: 'land' });
    }
  },

  crash: (speed, brokenProps = []) =>
    set((s) =>
      s.crashed
        ? s
        : {
            crashed: true,
            crashSpeed: speed,
            crashAt: {
              flightTime: useSimStore.getState().flightTime,
              altitude: useSimStore.getState().altitude,
            },
            brokenProps,
            armed: false,
            auto: 'manual',
            armThrottleHigh: false,
          },
    ),
  clearCrash: () =>
    set({ crashed: false, crashSpeed: 0, crashAt: null, brokenProps: [], armThrottleHigh: false }),

  registerTouch: () => set((s) => ({ touches: s.touches + 1 })),

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
  // Any change of pause drops the exit question: it belongs to one showing of
  // the pause card.
  togglePause: () => set((s) => ({ paused: !s.paused, exitAsk: false })),
  setExitAsk: (exitAsk) => set({ exitAsk }),
}));
