import { describe, expect, it, vi } from 'vitest';

// The flight view's handler for bound buttons, captured so a test can press one.
const padAction = vi.hoisted(() => ({ run: (_a: string) => {} }));

// The same scale with a gamepad flying: it must be 1, so the pad keeps 670 deg/s.
vi.mock('../src/renderer/input/gamepad', () => ({
  consumeGamepadActivity: () => true,
  gamepadConnected: () => true,
  gamepadLive: { kind: 'standard' },
  gamepadStick: { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
  setActionHandler: (fn: (a: string) => void) => {
    padAction.run = fn;
  },
}));

const {
  acroRateScaleFor,
  updateStick,
  activeInputSource,
  throttleRestsAtCentre,
  throttleSafeToArm,
  attachKeyboard,
} = await import('../src/renderer/input/controls');
const { gamepadLive, gamepadStick } = await import('../src/renderer/input/gamepad');
const { useFlightStore } = await import('../src/renderer/state/flightStore');
const { racingDrone } = await import('../src/renderer/plugins/drones/racer');

describe('keyboard Acro rate scale, gamepad flying', () => {
  it('is 1 once the pad is the active device', () => {
    updateStick(1 / 60);
    expect(activeInputSource()).toBe('gamepad');
    expect(acroRateScaleFor(racingDrone)).toBe(1);
  });

  it('requires idle throttle on a radio in Acro, while a gamepad rests at centre', () => {
    useFlightStore.setState({ mode: 'acro' });
    gamepadLive.kind = 'rc';
    gamepadStick.throttle = 0.5;
    updateStick(1 / 60);
    expect(throttleRestsAtCentre('acro')).toBe(false);
    expect(throttleSafeToArm()).toBe(false);
    gamepadStick.throttle = 0;
    updateStick(1 / 60);
    expect(throttleSafeToArm()).toBe(true);
    gamepadLive.kind = 'standard';
    gamepadStick.throttle = 0.5;
    updateStick(1 / 60);
    expect(throttleRestsAtCentre('acro')).toBe(true);
    expect(throttleSafeToArm()).toBe(true);
  });

  it('arms a radio only from the bottom of the stick, in every mode', () => {
    gamepadLive.kind = 'rc';
    for (const mode of ['altitude-hold', 'stabilize', 'acro'] as const) {
      useFlightStore.setState({ mode });
      for (const [throttle, safe] of [
        [0.5, false],
        [0.15, false],
        [0.08, true],
      ] as const) {
        gamepadStick.throttle = throttle;
        updateStick(1 / 60);
        expect(throttleSafeToArm(), `${mode} at ${throttle}`).toBe(safe);
      }
    }
    gamepadLive.kind = 'standard';
    useFlightStore.setState({ mode: 'altitude-hold' });
    gamepadStick.throttle = 0.5;
    updateStick(1 / 60);
    expect(throttleSafeToArm()).toBe(true);
  });
});

describe('radio Arm with the throttle up', () => {
  // attachKeyboard() registers the pad's action handler; it also listens on
  // window, which the node environment does not have.
  (globalThis as { window?: EventTarget }).window ??= new EventTarget();
  const pressArm = () => padAction.run('arm');

  it('stays disarmed with the notice up, and arms once the stick reaches the bottom', () => {
    const detach = attachKeyboard();
    useFlightStore.setState({
      mode: 'acro',
      armed: false,
      crashed: false,
      onGround: true,
      armThrottleHigh: false,
    });
    gamepadLive.kind = 'rc';
    gamepadStick.throttle = 0.8;
    updateStick(1 / 60);
    pressArm();
    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().armThrottleHigh).toBe(true);
    gamepadStick.throttle = 0.4;
    updateStick(1 / 60);
    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().armThrottleHigh).toBe(true);
    gamepadStick.throttle = 0;
    updateStick(1 / 60);
    expect(useFlightStore.getState().armed).toBe(true);
    expect(useFlightStore.getState().armThrottleHigh).toBe(false);
    useFlightStore.getState().disarm();
    detach();
  });

  it('Disarm cancels a held Arm', () => {
    useFlightStore.setState({ armed: false, onGround: true, armThrottleHigh: true });
    useFlightStore.getState().disarm();
    gamepadLive.kind = 'rc';
    gamepadStick.throttle = 0;
    updateStick(1 / 60);
    expect(useFlightStore.getState().armed).toBe(false);
  });

  it('a gamepad with the throttle up is refused, notice up', () => {
    const detach = attachKeyboard();
    useFlightStore.setState({
      mode: 'stabilize',
      armed: false,
      onGround: true,
      armThrottleHigh: false,
    });
    gamepadLive.kind = 'standard';
    gamepadStick.throttle = 0.8;
    updateStick(1 / 60);
    pressArm();
    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().armThrottleHigh).toBe(true);
    gamepadStick.throttle = 0;
    updateStick(1 / 60);
    expect(useFlightStore.getState().armThrottleHigh).toBe(false);
    expect(useFlightStore.getState().armed).toBe(false);
    detach();
  });

  it('in the air it arms at once on any throttle, with no notice', () => {
    attachKeyboard();
    for (const kind of ['rc', 'standard'] as const) {
      useFlightStore.setState({
        mode: 'stabilize',
        armed: false,
        onGround: false,
        armThrottleHigh: false,
      });
      gamepadLive.kind = kind;
      gamepadStick.throttle = 0.8;
      updateStick(1 / 60);
      pressArm();
      expect(useFlightStore.getState().armed, kind).toBe(true);
      expect(useFlightStore.getState().armThrottleHigh, kind).toBe(false);
    }
    useFlightStore.setState({ armed: false, onGround: true });
  });

  it('a crash drops the notice', () => {
    useFlightStore.setState({ armed: true, crashed: false, armThrottleHigh: true });
    useFlightStore.getState().crash(5);
    expect(useFlightStore.getState().armThrottleHigh).toBe(false);
    useFlightStore.getState().clearCrash();
  });
});
