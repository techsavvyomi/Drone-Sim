import type { GamepadAction, StickInput } from '@shared/types';
import { clamp, damp } from '../sim/mathx';
import { useFlightStore } from '../state/flightStore';
import { ALT_MANAGED } from '../sim/control/flightController';
import { useUiStore } from '../state/uiStore';
import { useSimStore } from '../state/simStore';
import {
  consumeGamepadActivity,
  gamepadConnected,
  gamepadStick,
  setActionHandler,
} from './gamepad';

// Non-React control singleton. Continuous stick values are eased here every
// frame and read directly by the drone's physics step — keeping them out of
// React avoids a re-render per frame. Discrete commands dispatch to the stores.

/** Eased analog stick state (throttle 0..1, rest -1..1). */
export const stick: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

const pressed = new Set<string>();

// ---- Scripted input (Flight School demonstrations) --------------------------
// During a lesson demo the Director drives the drone through the *real*
// controller and physics by writing `stick` and issuing commands directly. While
// scripted, live keyboard/gamepad input is ignored so the pilot can't fight the
// demonstration, and `updateStick` leaves `stick` exactly as the script set it.
let scripted = false;

export function setScripted(on: boolean): void {
  scripted = on;
  // Drop any keys held when the mode flips, so they neither leak into the demo
  // nor fire the instant control is handed back.
  pressed.clear();
}

export function isScripted(): boolean {
  return scripted;
}

/** Set stick channels during a scripted demo (unset channels are left as-is). */
export function setScriptedStick(s: Partial<StickInput>): void {
  if (s.roll !== undefined) stick.roll = s.roll;
  if (s.pitch !== undefined) stick.pitch = s.pitch;
  if (s.yaw !== undefined) stick.yaw = s.yaw;
  if (s.throttle !== undefined) stick.throttle = s.throttle;
}

/** Issue a discrete command from a scripted demo. */
export function runScriptedCommand(cmd: 'arm' | 'disarm' | 'takeoffLand'): void {
  const flight = useFlightStore.getState();
  switch (cmd) {
    case 'arm':
      if (!flight.armed) flight.toggleArm();
      break;
    case 'disarm':
      flight.disarm();
      break;
    case 'takeoffLand':
      flight.requestTakeoffLand();
      break;
  }
}

// Which device last actually moved a stick. A connected-but-idle gamepad must
// not lock out the keyboard, and a keyboard resting untouched must not fight a
// gamepad — so whichever the pilot touched most recently drives the aircraft.
type Source = 'keyboard' | 'gamepad';
let activeSource: Source = 'keyboard';

export function activeInputSource(): Source {
  return activeSource;
}

// How fast throttle ramps while W/S held (full range per ~1.6s), and how snappy
// the self-centering sticks are.
// Slower ramp = finer resolution around the hover point (~50% stick).
const STICK_LAMBDA = 14;
/** Spring-return rate for the throttle in altitude-managed modes (~200 ms). */
const THROTTLE_CENTER_LAMBDA = 15;
const THROTTLE_CENTER = 0.5;
/**
 * Expo applied to the keyboard attitude sticks: gentle around centre for fine
 * corrections (less twitchy), full authority at the ends (not sluggish). 0 =
 * linear, 1 = fully cubic.
 */
const KEYBOARD_EXPO = 0.6;

function expo(x: number, e: number): number {
  return x * (e * x * x + (1 - e));
}

// Raw (pre-expo) eased stick positions. We ease these toward the key target and
// then shape them with expo, so easing stays smooth while the sim reads a curved
// response.
let rawRoll = 0;
let rawPitch = 0;
let rawYaw = 0;

// Mode-2 layout (matches a real transmitter): left stick = throttle + yaw,
// right stick = pitch + roll.
const CODE = {
  throttleUp: 'KeyW',
  throttleDown: 'KeyS',
  yawLeft: 'KeyA',
  yawRight: 'KeyD',
  pitchFwd: 'ArrowUp',
  pitchBack: 'ArrowDown',
  rollLeft: 'ArrowLeft',
  rollRight: 'ArrowRight',
  arm: 'Enter',
  takeoffLand: 'Space',
  camera: 'KeyC',
  mode: 'KeyM',
  reset: 'KeyR',
  help: 'KeyH',
} as const;

const COMMAND_CODES = new Set<string>([
  CODE.arm,
  CODE.takeoffLand,
  CODE.camera,
  CODE.mode,
  CODE.reset,
  CODE.help,
]);

function axis(neg: boolean, pos: boolean): number {
  return (pos ? 1 : 0) - (neg ? 1 : 0);
}

/** Advance eased stick state by dt. Called once per frame by the drone entity. */
export function updateStick(dt: number): void {
  // A scripted demo owns the sticks outright — do not let easing or live input
  // overwrite the values the Director just wrote.
  if (scripted) return;

  const up = pressed.has(CODE.throttleUp);
  const down = pressed.has(CODE.throttleDown);

  // Hand control to whichever device moved last.
  if (consumeGamepadActivity()) activeSource = 'gamepad';
  else if (up || down || pressed.has(CODE.rollLeft) || pressed.has(CODE.rollRight) ||
           pressed.has(CODE.pitchFwd) || pressed.has(CODE.pitchBack) ||
           pressed.has(CODE.yawLeft) || pressed.has(CODE.yawRight)) {
    activeSource = 'keyboard';
  }

  if (activeSource === 'gamepad' && gamepadConnected()) {
    // Gamepad axes are absolute positions — no easing, the spring in the stick
    // already does that job.
    stick.roll = gamepadStick.roll;
    stick.pitch = gamepadStick.pitch;
    stick.yaw = gamepadStick.yaw;
    stick.throttle = gamepadStick.throttle;
    return;
  }

  const throttleRateUp = 0.6;
  const throttleRateDown = 0.95;

  if (ALT_MANAGED.includes(useFlightStore.getState().mode)) {
    // Altitude-managed modes: W climbs, S descends responsively.
    if (up) stick.throttle += throttleRateUp * dt;
    else if (down) stick.throttle -= throttleRateDown * dt;
    else stick.throttle = damp(stick.throttle, THROTTLE_CENTER, THROTTLE_CENTER_LAMBDA, dt);
  } else {
    // Direct-thrust modes: W increases throttle, S decreases throttle to descend.
    if (up) stick.throttle += throttleRateUp * dt;
    if (down) stick.throttle -= throttleRateDown * dt;
  }
  stick.throttle = clamp(stick.throttle, 0, 1);

  // Self-centering sticks ease toward the key-implied target.
  const rollTarget = axis(pressed.has(CODE.rollLeft), pressed.has(CODE.rollRight));
  const pitchTarget = axis(pressed.has(CODE.pitchBack), pressed.has(CODE.pitchFwd));
  const yawTarget = axis(pressed.has(CODE.yawLeft), pressed.has(CODE.yawRight));

  rawRoll = damp(rawRoll, rollTarget, STICK_LAMBDA, dt);
  rawPitch = damp(rawPitch, pitchTarget, STICK_LAMBDA, dt);
  rawYaw = damp(rawYaw, yawTarget, STICK_LAMBDA, dt);

  stick.roll = expo(rawRoll, KEYBOARD_EXPO);
  stick.pitch = expo(rawPitch, KEYBOARD_EXPO);
  stick.yaw = expo(rawYaw, KEYBOARD_EXPO);
}

/** Reset sticks (e.g. on scene reset). */
export function resetStick(): void {
  stick.roll = 0;
  stick.pitch = 0;
  stick.yaw = 0;
  rawRoll = 0;
  rawPitch = 0;
  rawYaw = 0;
  // Altitude-managed modes rest at centre; direct-thrust modes rest at zero.
  stick.throttle = ALT_MANAGED.includes(useFlightStore.getState().mode) ? THROTTLE_CENTER : 0;
  pressed.clear();
}

/**
 * Real flight controllers refuse to arm unless the throttle is at its safe
 * resting position — arming with the throttle raised would spin up and lurch.
 * In altitude-managed modes the safe position is the spring centre; in direct
 * modes it is near idle. Returns true when it's safe to arm.
 */
export function throttleSafeToArm(): boolean {
  const managed = ALT_MANAGED.includes(useFlightStore.getState().mode);
  const limit = managed ? THROTTLE_CENTER + 0.12 : 0.15;
  return stick.throttle <= limit;
}

function runCommand(code: string): void {
  switch (code) {
    case CODE.arm: {
      const flight = useFlightStore.getState();
      // Block arming with the throttle up; disarming is always allowed.
      if (!flight.armed && !throttleSafeToArm()) break;
      flight.toggleArm();
      break;
    }
    case CODE.takeoffLand:
      useFlightStore.getState().requestTakeoffLand();
      break;
    case CODE.camera:
      useUiStore.getState().cycleCameraMode();
      break;
    case CODE.mode:
      useFlightStore.getState().cycleMode();
      break;
    case CODE.help:
      useUiStore.getState().toggleControls();
      break;
    case CODE.reset:
      useSimStore.getState().requestReset();
      useFlightStore.getState().disarm();
      useFlightStore.getState().clearCrash();
      resetStick();
      break;
  }
}

function runGamepadAction(action: GamepadAction): void {
  // Scripted demo in progress: ignore controller buttons too.
  if (scripted) return;
  const flight = useFlightStore.getState();
  switch (action) {
    case 'arm':
      if (!flight.armed && throttleSafeToArm()) flight.toggleArm();
      break;
    case 'disarm':
      flight.disarm();
      break;
    case 'takeoffLand':
      flight.requestTakeoffLand();
      break;
    case 'modeCycle':
      flight.cycleMode();
      break;
    case 'cameraCycle':
      useUiStore.getState().cycleCameraMode();
      break;
    case 'reset':
      runCommand(CODE.reset);
      break;
  }
}

/** Attach keyboard listeners. Returns a detach function. */
export function attachKeyboard(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Scripted demo in progress: swallow all flight input.
    if (scripted) return;
    if (e.repeat) {
      if (!COMMAND_CODES.has(e.code)) pressed.add(e.code);
      return;
    }
    if (COMMAND_CODES.has(e.code)) {
      e.preventDefault();
      runCommand(e.code);
    } else {
      pressed.add(e.code);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    pressed.delete(e.code);
  };
  const onBlur = () => pressed.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // The poll loop itself runs app-wide (see App.tsx) so the settings screen can
  // show live meters and capture bindings. Only *dispatching* actions is scoped
  // to the flight view — otherwise a bound button would arm the drone while the
  // pilot was sitting in a menu.
  setActionHandler(runGamepadAction);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    setActionHandler(() => {});
  };
}
