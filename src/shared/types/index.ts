// Domain types shared across the Electron main process, preload, and renderer.
// Keep this file dependency-free so it can be imported from any process.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

// ----------------------------------------------------------------------------
// Settings (persisted to disk via the main process)
// ----------------------------------------------------------------------------

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type PhysicsPreset = 'beginner' | 'intermediate' | 'advanced';

/** Which HUD widgets are visible in the flight view. */
export interface HudWidgets {
  altitudeTape: boolean;
  horizon: boolean;
  instruments: boolean;
  compass: boolean;
  status: boolean;
  battery: boolean;
  throttle: boolean;
  cameraInfo: boolean;
  tiles: boolean;
  sticks: boolean;
}

export const HUD_WIDGET_LABELS: Record<keyof HudWidgets, string> = {
  altitudeTape: 'Altitude tape',
  horizon: 'Artificial horizon',
  instruments: 'Speed / VSI / Heading',
  compass: 'Compass ribbon',
  status: 'Armed + flight mode',
  battery: 'Battery',
  throttle: 'Throttle bar',
  cameraInfo: 'Camera + FPS',
  tiles: 'Flight time',
  sticks: 'Virtual sticks',
};

export interface AppSettings {
  /** Persisted schema version, for future migrations. */
  version: number;
  graphics: GraphicsPreset;
  physics: PhysicsPreset;
  /** Currently selected drone / environment plugin ids. */
  selectedDroneId: string;
  selectedEnvironmentId: string;
  /** Master audio volume 0..1. */
  volume: number;
  /** Chase-camera distance multiplier (0.5 = close, 2.5 = far). */
  cameraZoom: number;
  /** Per-widget HUD visibility. */
  hud: HudWidgets;
  /** USB gamepad / RC transmitter configuration. */
  gamepad: GamepadSettings;
  /** Flight School progression (completed lessons, stars, pilot XP). */
  training: TrainingProgress;
}

// ----------------------------------------------------------------------------
// Training progression (Pluto Flight School)
// ----------------------------------------------------------------------------

/** Per-lesson result, persisted so completion and best score survive a restart. */
export interface LessonProgress {
  completed: boolean;
  /** Best star rating earned, 0..3. */
  stars: number;
  /** Best raw score 0..1 behind the star rating, for finer progress. */
  bestScore: number;
}

/** Everything the Flight School needs to remember between sessions. */
export interface TrainingProgress {
  /** Keyed by lesson id. Absent id = not yet attempted. */
  lessons: Record<string, LessonProgress>;
  /** Accumulated pilot XP, drives the Home rank badge. */
  xp: number;
}

export const DEFAULT_TRAINING: TrainingProgress = {
  lessons: {},
  xp: 0,
};


// ----------------------------------------------------------------------------
// Gamepad / RC transmitter
//
// The binding model mirrors the Pluto ROS dashboard so muscle memory and
// mappings carry over: continuous channels bind to an axis with an optional
// invert, while discrete actions bind either to a button edge OR to an axis
// entering a position. That second form matters because real RC transmitters
// expose their 2- and 3-position switches as *axes*, not buttons, so a
// button-only scheme cannot bind an arm switch on a FlySky or Taranis.
// ----------------------------------------------------------------------------

/** Continuous control channels. */
export type GamepadChannel = 'roll' | 'pitch' | 'yaw' | 'throttle';

export interface GamepadAxisConfig {
  /** Index into `Gamepad.axes`. */
  axis: number;
  invert: boolean;
}

/** Where an axis is sitting: below -0.5, between, or above +0.5. */
export type AxisPos = 'lo' | 'mid' | 'hi';

/** A discrete binding: a button edge, or an axis entering a switch position. */
export type GamepadBinding =
  | { t: 'b'; i: number }
  | { t: 'a'; a: number; p: AxisPos };

/** Discrete actions a gamepad can trigger. */
export type GamepadAction =
  | 'arm'
  | 'disarm'
  | 'takeoffLand'
  | 'modeCycle'
  | 'cameraCycle'
  | 'reset';

export const GAMEPAD_ACTION_LABELS: Record<GamepadAction, string> = {
  arm: 'Arm',
  disarm: 'Disarm',
  takeoffLand: 'Take off / Land',
  modeCycle: 'Cycle flight mode',
  cameraCycle: 'Cycle camera',
  reset: 'Reset flight',
};

export const GAMEPAD_CHANNEL_LABELS: Record<GamepadChannel, string> = {
  roll: 'Roll',
  pitch: 'Pitch',
  yaw: 'Yaw',
  throttle: 'Throttle',
};

export interface GamepadSettings {
  enabled: boolean;
  /** Stick centre tolerance, 0..0.5. */
  deadzone: number;
  /** Curve shape, 0 = linear, 1 = fully cubic (soft around centre). */
  expo: number;
  /** Output multiplier applied after expo, 0.2..1.5. */
  sensitivity: number;
  /** Active mapping — what the sim reads and the editor edits. */
  axes: Record<GamepadChannel, GamepadAxisConfig>;
  bindings: Partial<Record<GamepadAction, GamepadBinding>>;
  /** Remembered mappings keyed by device id, so each controller keeps its setup. */
  devices: Record<string, GamepadDeviceProfile>;
}

/**
 * What kind of device is on the other end. This is not cosmetic — the two
 * families report their sticks on completely different axes, so guessing wrong
 * means roll and yaw are swapped the moment you take off.
 */
export type GamepadKind = 'standard' | 'rc';

export const GAMEPAD_KIND_LABELS: Record<GamepadKind, string> = {
  standard: 'Game controller',
  rc: 'Radio transmitter',
};

/**
 * Standard-mapping gamepads (Xbox, DualShock/DualSense, 8BitDo, most BT pads)
 * report left stick on axes 0/1 and right stick on axes 2/3. Mode 2 puts
 * throttle+yaw on the left and pitch+roll on the right. Both Y axes report -1
 * when pushed up, hence the inverts.
 */
export const STANDARD_AXES: Record<GamepadChannel, GamepadAxisConfig> = {
  yaw: { axis: 0, invert: false },
  throttle: { axis: 1, invert: true },
  roll: { axis: 2, invert: false },
  pitch: { axis: 3, invert: true },
};

/**
 * Stick channel order on an RC radio, named the way radios name it: A=aileron
 * (roll), E=elevator (pitch), T=throttle, R=rudder (yaw). EdgeTX/OpenTX default
 * to AETR; other firmwares and older models ship the other orders, which is why
 * this is a one-click preset rather than four separate axis hunts.
 */
export const CHANNEL_ORDERS = ['AETR', 'AERT', 'RETA', 'TAER'] as const;
export type ChannelOrder = (typeof CHANNEL_ORDERS)[number];

const ORDER_LETTER: Record<string, GamepadChannel> = {
  A: 'roll',
  E: 'pitch',
  T: 'throttle',
  R: 'yaw',
};

/**
 * Inversion defaults for a real transmitter.
 *
 * Throttle is deliberately NOT inverted here, unlike on a gamepad. A radio
 * reports throttle at -1 with the stick down, so inverting it would mean an
 * idle stick commands FULL POWER — the aircraft would leap the instant it armed.
 * A gamepad's Y axis is the opposite sign, which is why the two profiles differ.
 */
const RC_INVERT: Record<GamepadChannel, boolean> = {
  roll: false,
  pitch: true,
  throttle: false,
  yaw: false,
};

export function axesForOrder(order: ChannelOrder): Record<GamepadChannel, GamepadAxisConfig> {
  const out = {} as Record<GamepadChannel, GamepadAxisConfig>;
  order.split('').forEach((letter, i) => {
    const channel = ORDER_LETTER[letter];
    out[channel] = { axis: i, invert: RC_INVERT[channel] };
  });
  return out;
}

/** RC transmitters / USB sim dongles. EdgeTX and OpenTX default to AETR. */
export const RC_AXES: Record<GamepadChannel, GamepadAxisConfig> = axesForOrder('AETR');

/** Best-guess channel order from an existing axis mapping, for the UI. */
export function orderFromAxes(
  axes: Record<GamepadChannel, GamepadAxisConfig>,
): ChannelOrder | null {
  return (
    CHANNEL_ORDERS.find((o) => {
      const candidate = axesForOrder(o);
      return (Object.keys(candidate) as GamepadChannel[]).every(
        (c) => candidate[c].axis === axes[c].axis,
      );
    }) ?? null
  );
}

export const DEFAULT_BINDINGS: Partial<Record<GamepadAction, GamepadBinding>> = {
  takeoffLand: { t: 'b', i: 0 },
  arm: { t: 'b', i: 2 },
  disarm: { t: 'b', i: 3 },
  modeCycle: { t: 'b', i: 4 },
  cameraCycle: { t: 'b', i: 5 },
  reset: { t: 'b', i: 9 },
};

export function axesForKind(kind: GamepadKind): Record<GamepadChannel, GamepadAxisConfig> {
  return kind === 'standard' ? { ...STANDARD_AXES } : { ...RC_AXES };
}

/**
 * Revision of the auto-detected defaults. Bumping this re-seeds saved profiles
 * on next connect.
 *
 * rev 1 gave RC transmitters an inverted throttle, carried over from a gamepad
 * layout. On a real radio that is not a preference, it is a hazard: the stick
 * reports -1 at idle, so inverting it means a resting throttle commands full
 * power. Any profile below the current rev is rebuilt rather than restored.
 */
export const PROFILE_REV = 2;

/** A remembered per-device mapping, so swapping controllers restores its setup. */
export interface GamepadDeviceProfile {
  /** `Gamepad.id` as reported when the device was first seen. */
  id: string;
  kind: GamepadKind;
  /** Which generation of defaults this was seeded from; see PROFILE_REV. */
  rev?: number;
  axes: Record<GamepadChannel, GamepadAxisConfig>;
  bindings: Partial<Record<GamepadAction, GamepadBinding>>;
}

/** Defaults match the ROS dashboard: Mode 2, pitch and throttle inverted. */
export const DEFAULT_GAMEPAD: GamepadSettings = {
  enabled: true,
  deadzone: 0.12,
  expo: 0.35,
  sensitivity: 1,
  axes: {
    roll: { axis: 0, invert: false },
    pitch: { axis: 1, invert: true },
    yaw: { axis: 2, invert: false },
    throttle: { axis: 3, invert: true },
  },
  bindings: { ...DEFAULT_BINDINGS },
  devices: {},
};

/** Axis position thresholds — same as the dashboard's switch detection. */
export const SWITCH_HI = 0.5;
export const SWITCH_LO = -0.5;

export function axisPos(v: number): AxisPos {
  return v > SWITCH_HI ? 'hi' : v < SWITCH_LO ? 'lo' : 'mid';
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  graphics: 'high',
  physics: 'beginner',
  selectedDroneId: 'pluto',
  selectedEnvironmentId: 'drone-academy',
  volume: 0.7,
  cameraZoom: 1,
  gamepad: DEFAULT_GAMEPAD,
  training: DEFAULT_TRAINING,
  hud: {
    altitudeTape: true,
    horizon: true,
    instruments: true,
    compass: true,
    status: true,
    battery: true,
    throttle: true,
    cameraInfo: true,
    tiles: true,
    sticks: true,
  },
};

export interface AppInfo {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  electron: string;
}

// ----------------------------------------------------------------------------
// Flight domain
// ----------------------------------------------------------------------------

/**
 * Supported flight modes.
 * Deliberately limited to what the simulator genuinely models: there is no GPS,
 * so position-based modes (Position Hold, Guided, RTH) are not offered rather
 * than being faked.
 */
export type FlightMode = 'stabilize' | 'altitude-hold' | 'acro';

/** Normalized, device-agnostic control input. throttle in [0,1], rest in [-1,1]. */
export interface StickInput {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

/** A single PID gain triplet. */
export interface Pid {
  p: number;
  i: number;
  d: number;
}

/** Cascaded angle + rate PID gains per axis, used by flight controllers. */
export interface PidSet {
  rate: { roll: Pid; pitch: Pid; yaw: Pid };
  angle: { roll: Pid; pitch: Pid };
}

// ----------------------------------------------------------------------------
// Plugin contracts (Deliverable #6 — the extensibility surface)
//
// These are the stable interfaces content plugins implement. Phase 0 registers
// placeholder content; later phases fill in real drones/environments/missions.
// ----------------------------------------------------------------------------

export interface MotorSpec {
  /** Motor velocity constant (RPM per volt, unloaded). */
  kv: number;
  /** Maximum static thrust at full battery, in Newtons. */
  maxThrustN: number;
  /** First-order spin-up time constant in seconds (motor lag). */
  responseTime: number;
}

export interface BatterySpec {
  cells: number; // e.g. 1S, 3S
  capacityMah: number;
  /** Nominal pack voltage, volts. */
  nominalV: number;
  /** Internal resistance (ohms) — drives voltage sag under load. */
  internalResistance: number;
}

export interface DroneSpec {
  id: string;
  name: string;
  frame: 'quad' | 'hex';
  /** Dry mass in kg, before payload. */
  mass: number;
  /** Motor distance from center of gravity, meters. */
  armLength: number;
  motors: MotorSpec[];
  propDiameterIn: number;
  battery: BatterySpec;
  maxSpeed: number; // m/s
  maxAltitude: number; // m
  cameraMount: { position: Vec3; tiltDeg: number };
  /** Optional .glb visual asset; falls back to the procedural mesh when absent. */
  model?: string;
  /** Uniform scale applied to the .glb (1 = the model is already in metres). */
  modelScale?: number;
  /** Yaw correction in degrees if the model doesn't face -Z. */
  modelYawDeg?: number;
  /** Positional offset applied to the .glb, in metres. */
  modelOffset?: Vec3;
  /**
   * Optional propeller tint by position, overriding whatever the .glb bakes in.
   * Real pilots colour the front pair differently from the rear so the nose is
   * readable at a distance — CAD exports rarely follow that convention.
   */
  propColors?: { front?: string; rear?: string };
  pidDefaults: PidSet;
}

/** Category of environment for lighting/weather defaults. */
export type EnvironmentKind = 'indoor' | 'outdoor';

export interface EnvironmentSpec {
  id: string;
  name: string;
  kind: EnvironmentKind;
  /** Optional .glb scene asset; falls back to procedural ground + props. */
  model?: string;
  /** Drone spawn point and heading (degrees). */
  spawn: { position: Vec3; heading: number };
  /** Axis-aligned play-area bounds [min, max]. */
  bounds: { min: Vec3; max: Vec3 };
}

export type MissionType =
  | 'takeoff'
  | 'hover'
  | 'hoops'
  | 'landing'
  | 'search'
  | 'race'
  | 'timetrial'
  | 'delivery';

export interface MissionSpec {
  id: string;
  name: string;
  type: MissionType;
  description: string;
  medalThresholds: { bronze: number; silver: number; gold: number };
}

export interface Objective {
  id: string;
  label: string;
  weight: number;
}

export interface LessonSpec {
  id: string;
  name: string;
  description: string;
  objectives: Objective[];
}
