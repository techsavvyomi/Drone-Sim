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
const THROTTLE_RATE = 0.42;
const STICK_LAMBDA = 14;
/** Spring-return rate for the throttle in altitude-managed modes (~200 ms). */
const THROTTLE_CENTER_LAMBDA = 15;
const THROTTLE_CENTER = 0.5;

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

  if (ALT_MANAGED.includes(useFlightStore.getState().mode)) {
    // Altitude-managed modes: the throttle stick is spring-centred, like a DJI
    // or a game controller. Centre holds altitude; deflection commands climb or
    // descent rate. Releasing eases back to centre rather than snapping.
    if (up) stick.throttle += THROTTLE_RATE * dt;
    else if (down) stick.throttle -= THROTTLE_RATE * dt;
    else stick.throttle = damp(stick.throttle, THROTTLE_CENTER, THROTTLE_CENTER_LAMBDA, dt);
  } else {
    // Direct-thrust modes: throttle is a position and holds where you leave it.
    if (up) stick.throttle += THROTTLE_RATE * dt;
    if (down) stick.throttle -= THROTTLE_RATE * dt;
  }
  stick.throttle = clamp(stick.throttle, 0, 1);

  // Self-centering sticks ease toward the key-implied target.
  const rollTarget = axis(pressed.has(CODE.rollLeft), pressed.has(CODE.rollRight));
  const pitchTarget = axis(pressed.has(CODE.pitchBack), pressed.has(CODE.pitchFwd));
  const yawTarget = axis(pressed.has(CODE.yawLeft), pressed.has(CODE.yawRight));

  stick.roll = damp(stick.roll, rollTarget, STICK_LAMBDA, dt);
  stick.pitch = damp(stick.pitch, pitchTarget, STICK_LAMBDA, dt);
  stick.yaw = damp(stick.yaw, yawTarget, STICK_LAMBDA, dt);
}

/** Reset sticks (e.g. on scene reset). */
export function resetStick(): void {
  stick.roll = 0;
  stick.pitch = 0;
  stick.yaw = 0;
  // Altitude-managed modes rest at centre; direct-thrust modes rest at zero.
  stick.throttle = ALT_MANAGED.includes(useFlightStore.getState().mode) ? THROTTLE_CENTER : 0;
  pressed.clear();
}

function runCommand(code: string): void {
  switch (code) {
    case CODE.arm:
      useFlightStore.getState().toggleArm();
      break;
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
  const flight = useFlightStore.getState();
  switch (action) {
    case 'arm':
      if (!flight.armed) flight.toggleArm();
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
