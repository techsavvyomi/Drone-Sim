import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { dronePose } from '../src/renderer/sim/drone/pose';

// The arming interlock, the auto take-off and landing sequence, and the crash
// and battery locks — the rules that decide whether the aircraft may fly at all.
//
// Nearly every case here is a bug that shipped once; see docs/invariants.md
// #16-19. Test names carry the id of the manual case they replace, from
// docs/test-cases.csv.
//
// `flightStore` keeps two lockout timestamps OUTSIDE the store
// (`takeoffStartedAt`, `landHoldUntil`) and reads them through
// `performance.now()`. Nothing resets them between tests, so the clock is faked
// once and wound forward before each test instead — far enough that any lockout
// left by the previous test has expired. Production code is deliberately not
// given a reset hook just to suit the tests.

const INITIAL = { ...useFlightStore.getState() };

/** Put the aircraft back to a freshly-spawned, disarmed state. */
function reset(): void {
  useFlightStore.setState({ ...INITIAL }, true);
  dronePose.present = false;
  dronePose.position.set(0, 0, 0);
}

/** Park the drone in the air at `alt`, which is what makes Space mean "land". */
function hoverAt(alt: number): void {
  dronePose.present = true;
  dronePose.position.set(0, alt, 0);
  useFlightStore.setState({ onGround: false });
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['performance', 'Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // Past every lockout window the previous test may have opened.
  vi.advanceTimersByTime(60_000);
  reset();
});

describe('arming', () => {
  it('TC-022 Enter arms the drone on the ground', () => {
    useFlightStore.getState().toggleArm();

    expect(useFlightStore.getState().armed).toBe(true);
    // On the ground and armed reads as ARMED, not FLYING.
    expect(useFlightStore.getState().status()).toBe('armed');
  });

  it('TC-027 disarming is always allowed', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);

    useFlightStore.getState().disarm();

    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().auto).toBe('manual');
  });

  it('TC-028 a crashed drone cannot be armed', () => {
    useFlightStore.getState().crash(9);

    useFlightStore.getState().toggleArm();

    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().status()).toBe('crashed');
  });

  it('TC-029 a depleted pack blocks arming', () => {
    useFlightStore.getState().lockBattery();

    useFlightStore.getState().toggleArm();

    expect(useFlightStore.getState().armed).toBe(false);
  });

  it('TC-029 a recharge lets it arm again', () => {
    useFlightStore.getState().lockBattery();
    useFlightStore.getState().recharge();

    useFlightStore.getState().toggleArm();

    expect(useFlightStore.getState().armed).toBe(true);
    expect(useFlightStore.getState().batteryLocked).toBe(false);
    expect(useFlightStore.getState().batteryWarning).toBe(false);
  });
});

describe('auto take-off and landing', () => {
  it('TC-030 Space does nothing on a disarmed drone', () => {
    // invariants #16: a take-off command must NEVER arm the aircraft. This
    // shipped once — Space on a disarmed drone armed it and flew it.
    for (let i = 0; i < 5; i++) useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().auto).toBe('manual');
  });

  it('TC-031 Space starts a take-off on an armed drone', () => {
    useFlightStore.getState().toggleArm();

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('takeoff');
  });

  it('TC-032 a second Space during the climb does not turn it into a landing', () => {
    useFlightStore.getState().toggleArm();
    useFlightStore.getState().requestTakeoffLand();
    // Off the ground and climbing, one second in.
    hoverAt(1.6);
    vi.advanceTimersByTime(1_000);

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('takeoff');
  });

  it('TC-033 Space lands the drone from a hover', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('land');
  });

  it('TC-033 Space does not land a drone that is still below the take-off gate', () => {
    // Under 1.2 m counts as near-ground, so Space means take off, not land —
    // otherwise a spawn with ground clearance would answer Space with a descent.
    useFlightStore.getState().toggleArm();
    hoverAt(0.9);

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('takeoff');
  });

  it('TC-034 a second Space during a landing does not climb out', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);
    useFlightStore.getState().requestTakeoffLand();

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('land');
  });

  it('TC-035 a take-off cannot be started for a moment after landing', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);
    useFlightStore.getState().requestTakeoffLand();
    // Touched down, motors still running: the relaunch lockout is open.
    useFlightStore.setState({ auto: 'manual', onGround: true });
    dronePose.position.set(0, 0, 0);

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('manual');
  });

  it('TC-035 the take-off works again once the relaunch lockout has passed', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);
    useFlightStore.getState().requestTakeoffLand();
    useFlightStore.setState({ auto: 'manual', onGround: true });
    dronePose.position.set(0, 0, 0);

    vi.advanceTimersByTime(2_000);
    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('takeoff');
  });

  it('TC-030 a landing is refused on a crashed aircraft', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(4);
    useFlightStore.getState().crash(11);

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('manual');
  });
});

describe('flight modes', () => {
  it('TC-047 M cycles stabilize, altitude hold and acro', () => {
    // The default is altitude-hold, so the cycle runs on from there.
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      useFlightStore.getState().cycleMode();
      seen.push(useFlightStore.getState().mode);
    }

    expect(seen).toEqual(['acro', 'stabilize', 'altitude-hold']);
  });

  it('TC-047 no GPS-dependent mode is offered', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      useFlightStore.getState().cycleMode();
      seen.add(useFlightStore.getState().mode);
    }

    expect([...seen].sort()).toEqual(['acro', 'altitude-hold', 'stabilize']);
  });

  it('TC-081 the critical-battery landing cannot be cancelled by a mode change', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(6);

    useFlightStore.getState().triggerLowBattery();
    useFlightStore.getState().cycleMode();
    useFlightStore.getState().setMode('acro');

    expect(useFlightStore.getState().mode).toBe('altitude-hold');
    expect(useFlightStore.getState().auto).toBe('land');
  });

  it('TC-081 the critical-battery landing cannot be cancelled by Space', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(6);
    useFlightStore.getState().triggerLowBattery();

    useFlightStore.getState().requestTakeoffLand();

    expect(useFlightStore.getState().auto).toBe('land');
  });
});

describe('crash and touches', () => {
  it('TC-060 a hard impact crashes the drone and cuts the motors', () => {
    useFlightStore.getState().toggleArm();
    hoverAt(10);

    useFlightStore.getState().crash(7.4, [0, 2]);

    const s = useFlightStore.getState();
    expect(s.crashed).toBe(true);
    expect(s.crashSpeed).toBeCloseTo(7.4);
    expect(s.armed).toBe(false);
    expect(s.auto).toBe('manual');
  });

  it('TC-062 a crash records which propellers broke', () => {
    useFlightStore.getState().crash(6, [1, 3]);

    expect(useFlightStore.getState().brokenProps).toEqual([1, 3]);
  });

  it('TC-060 a second impact does not overwrite the first crash', () => {
    // The speed on the card must be the impact that wrote the airframe off,
    // not whatever it rolled to a stop at afterwards.
    useFlightStore.getState().crash(9.5, [0]);
    useFlightStore.getState().crash(0.4, [1, 2]);

    expect(useFlightStore.getState().crashSpeed).toBeCloseTo(9.5);
    expect(useFlightStore.getState().brokenProps).toEqual([0]);
  });

  it('TC-063 clearing the crash makes the aircraft flyable again', () => {
    useFlightStore.getState().crash(8, [0, 1]);

    useFlightStore.getState().clearCrash();
    useFlightStore.getState().toggleArm();

    const s = useFlightStore.getState();
    expect(s.crashed).toBe(false);
    expect(s.crashSpeed).toBe(0);
    expect(s.brokenProps).toEqual([]);
    expect(s.armed).toBe(true);
  });

  it('TC-064 a touch is counted without crashing the aircraft', () => {
    // invariants #40: three stars asks for zero touches, not just zero crashes.
    useFlightStore.getState().toggleArm();
    hoverAt(3);

    useFlightStore.getState().registerTouch();
    useFlightStore.getState().registerTouch();

    expect(useFlightStore.getState().touches).toBe(INITIAL.touches + 2);
    expect(useFlightStore.getState().crashed).toBe(false);
    expect(useFlightStore.getState().armed).toBe(true);
  });
});

describe('reported status', () => {
  it('TC-022 status reads disarmed, armed, flying and crashed in turn', () => {
    expect(useFlightStore.getState().status()).toBe('disarmed');

    useFlightStore.getState().toggleArm();
    expect(useFlightStore.getState().status()).toBe('armed');

    hoverAt(3);
    expect(useFlightStore.getState().status()).toBe('flying');

    useFlightStore.getState().crash(6);
    expect(useFlightStore.getState().status()).toBe('crashed');
  });
});
