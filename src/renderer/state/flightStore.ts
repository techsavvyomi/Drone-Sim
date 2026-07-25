import { create } from 'zustand';
import type { FlightMode } from '@shared/types';

export type AutoState = 'manual' | 'takeoff' | 'land';

/** High-level drone state, driven by arm/disarm, ground contact and crashes. */
export type DroneStatus = 'disarmed' | 'armed' | 'flying' | 'crashed';

interface FlightState {
  armed: boolean;
  mode: FlightMode;
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
  setAuto: (auto: AutoState) => void;
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
  disarm: () => set({ armed: false, auto: 'manual' }),
  cycleMode: () =>
    set((s) => {
      // The critical-battery landing must not be cancellable.
      if (s.lowBattery) return s;
      const i = CYCLE.indexOf(s.mode);
      return { mode: CYCLE[(i + 1) % CYCLE.length] };
    }),
  setAuto: (auto) => set({ auto }),
  setOnGround: (onGround) => set({ onGround }),

  requestTakeoffLand: () => {
    const { armed, onGround, crashed, batteryLocked, lowBattery } = get();
    if (crashed || lowBattery) return;
    if (onGround && batteryLocked) return;
    if (onGround) {
      set({ armed: true, auto: 'takeoff' });
    } else if (armed) {
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
    set((s) =>
      s.lowBattery ? s : { lowBattery: true, auto: 'land', mode: 'altitude-hold' },
    ),
  lockBattery: () =>
    set({ batteryLocked: true, lowBattery: false, armed: false, auto: 'manual' }),
  recharge: () =>
    set((s) => ({
      rechargeToken: s.rechargeToken + 1,
      batteryLocked: false,
      lowBattery: false,
      batteryWarning: false,
    })),
  togglePause: () => set((s) => ({ paused: !s.paused })),
}));
