import type { GamepadAction, StickInput } from '@shared/types';
import { clamp, damp } from '../sim/mathx';
import { useFlightStore } from '../state/flightStore';
import { ALT_MANAGED, SPRING_THROTTLE, THROTTLE_CENTER } from '../sim/control/flightController';
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
  // `updateStick` returns early while scripted, so this would otherwise keep
  // whatever it was when the demo started and read as live pilot input.
  throttleCommanded = false;
}

// ---- Command softening (missions) -------------------------------------------
// A single multiplier over what the pilot commands, so a view can ask for a
// gentler aircraft without a second control path. It scales the attitude
// channels and the keyboard's throttle ramp; it deliberately does NOT scale a
// gamepad's throttle, which is an absolute stick position — halving that is not
// a softer climb, it is half power, and the drone falls out of the sky.
//
// Missions only, set by the mission view and put back on the way out. Free
// flight and Flight School keep the full-rate sticks they were tuned against.
let commandScale = 1;

/** 1 = the normal aircraft; below 1 = softer sticks. Missions use this. */
export function setCommandScale(scale: number): void {
  commandScale = clamp(scale, 0.1, 1);
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

/**
 * Whether the pilot is actually commanding throttle right now, as opposed to
 * the stick merely holding or drifting.
 *
 * Auto sequences use this to decide that the pilot has taken over. Reading the
 * stick value alone is not enough: in altitude-managed modes an untouched
 * keyboard throttle springs back toward centre on its own, and that drift is
 * indistinguishable from a deliberate push if you only watch the number.
 */
let throttleCommanded = false;

export function isThrottleCommanded(): boolean {
  return throttleCommanded;
}

export function activeInputSource(): Source {
  return activeSource;
}

/** Stick position that counts as the throttle's idle end, matching the flight
 *  controller's own `<= 0.08` idle test. */
const IDLE_STICK = 0.08;

/**
 * Whether the pilot is actively commanding idle — S held, or a gamepad throttle
 * pushed to the bottom of its travel.
 *
 * The flight controller spins the motors at an ESC idle rather than cutting them
 * dead on this signal, so it has to be a COMMAND and not a position: the
 * keyboard's throttle rests at zero in the direct modes, and a position test
 * would therefore spin the props up the instant the aircraft armed — precisely
 * what `invariants.md` #15a says must never happen. A radio is the opposite
 * case: its throttle stick physically rests at the bottom, so there the resting
 * position IS the command, exactly as it is on the real aircraft.
 *
 * A scripted demonstration is excluded. It writes stick values rather than
 * pressing keys, and the modules that sit armed on the pad at zero throttle are
 * the ones teaching that arming does not spin the props.
 */
export function isThrottleDown(): boolean {
  if (scripted) return false;
  if (activeSource === 'gamepad' && gamepadConnected()) {
    return gamepadStick.throttle <= IDLE_STICK;
  }
  return pressed.has(CODE.throttleDown);
}

// How fast throttle ramps while W/S held (full range per ~1.6s), and how snappy
// the self-centering sticks are.
// Slower ramp = finer resolution around the hover point (~50% stick).
const STICK_LAMBDA = 14;
/** Spring-return rate for the throttle in the spring-centred modes (~200 ms). */
const THROTTLE_CENTER_LAMBDA = 15;
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
    // already does that job. Nothing moves the throttle here but the pilot, so
    // its position is always a live command.
    stick.roll = gamepadStick.roll * commandScale;
    stick.pitch = gamepadStick.pitch * commandScale;
    stick.yaw = gamepadStick.yaw * commandScale;
    stick.throttle = gamepadStick.throttle;
    throttleCommanded = true;
    return;
  }

  throttleCommanded = up || down;

  const throttleRateUp = 0.6 * commandScale;
  const throttleRateDown = 0.95 * commandScale;

  const flight = useFlightStore.getState();
  if (ALT_MANAGED.includes(flight.mode)) {
    // Altitude-managed modes: W climbs, S descends responsively.
    if (up) stick.throttle += throttleRateUp * dt;
    else if (down) stick.throttle -= throttleRateDown * dt;
    else stick.throttle = damp(stick.throttle, THROTTLE_CENTER, THROTTLE_CENTER_LAMBDA, dt);
  } else {
    // Direct-thrust modes: W increases throttle, S decreases throttle to descend.
    if (up) stick.throttle += throttleRateUp * dt;
    if (down) stick.throttle -= throttleRateDown * dt;
    // Acro flies a direct throttle on a spring-centred stick: let go and it
    // returns to mid-throttle, which is a hover on both Pluto airframes. It is
    // the same left stick a gamepad already presents in this mode; the keyboard
    // was the odd one out, holding whatever the last W or S left behind.
    //
    // On the pad as well as in the air. What used to make that unsafe — a stick
    // resting at centre is a *raised* stick to a direct mode, so arming would
    // spool straight to hover thrust — is now covered twice over: the arming
    // interlock holds the motors until S is pressed, and the collective ignores
    // a grounded stick at or below centre (both in `flightController`).
    if (!up && !down && SPRING_THROTTLE.includes(flight.mode)) {
      stick.throttle = damp(stick.throttle, THROTTLE_CENTER, THROTTLE_CENTER_LAMBDA, dt);
    }
  }
  stick.throttle = clamp(stick.throttle, 0, 1);

  // Self-centering sticks ease toward the key-implied target.
  const rollTarget = axis(pressed.has(CODE.rollLeft), pressed.has(CODE.rollRight));
  const pitchTarget = axis(pressed.has(CODE.pitchBack), pressed.has(CODE.pitchFwd));
  const yawTarget = axis(pressed.has(CODE.yawLeft), pressed.has(CODE.yawRight));

  rawRoll = damp(rawRoll, rollTarget, STICK_LAMBDA, dt);
  rawPitch = damp(rawPitch, pitchTarget, STICK_LAMBDA, dt);
  rawYaw = damp(rawYaw, yawTarget, STICK_LAMBDA, dt);

  stick.roll = expo(rawRoll, KEYBOARD_EXPO) * commandScale;
  stick.pitch = expo(rawPitch, KEYBOARD_EXPO) * commandScale;
  stick.yaw = expo(rawYaw, KEYBOARD_EXPO) * commandScale;
}

/** Reset sticks (e.g. on scene reset). */
export function resetStick(): void {
  stick.roll = 0;
  stick.pitch = 0;
  stick.yaw = 0;
  rawRoll = 0;
  rawPitch = 0;
  rawYaw = 0;
  // A spring-centred mode rests at centre; Stabilize's direct stick rests at zero.
  stick.throttle = SPRING_THROTTLE.includes(useFlightStore.getState().mode) ? THROTTLE_CENTER : 0;
  pressed.clear();
}

/**
 * Real flight controllers refuse to arm unless the throttle is at its safe
 * resting position — arming with the throttle raised would spin up and lurch.
 * Where that position IS depends on how the stick rests, not on how its value is
 * spent: a spring-centred mode is safe at the centre, Stabilize's stick near
 * idle. Keyed on `ALT_MANAGED` this refused to arm in Acro at all, the stick
 * having sprung to a centre the test read as raised. Returns true when it's safe.
 */
export function throttleSafeToArm(): boolean {
  const sprung = SPRING_THROTTLE.includes(useFlightStore.getState().mode);
  const limit = sprung ? THROTTLE_CENTER + 0.12 : 0.15;
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
