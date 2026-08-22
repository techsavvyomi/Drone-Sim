// Domain types shared across the Electron main process, preload, and renderer.
// Keep this file dependency-free so it can be imported from any process.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type ContactState =
  | 'AIRBORNE'
  | 'FLYING_NEAR_SURFACE'
  | 'LANDING'
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSTABLE'
  | 'FALLING'
  | 'CRASHED';

export interface SupportInfo {
  supported: [boolean, boolean, boolean, boolean]; // [FR, FL, BR, BL]
  supportedCount: number;
  isStable: boolean;
  contactState: ContactState;
  distances: [number, number, number, number];
}

// ----------------------------------------------------------------------------
// Settings (persisted to disk via the main process)
// ----------------------------------------------------------------------------

export type GraphicsPreset = 'low' | 'medium' | 'high';
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
  /** Blue locator ring + tether line drawn on the surface under the drone. */
  groundMarker: boolean;
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
  groundMarker: 'Ground marker (blue ring)',
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
  /**
   * Motor/rotor engine level 0..1, applied before the master volume.
   *
   * Separate from `volume` because it is the one sound that never stops. A
   * level that sits well under the one-shot effects is fine for a short flight
   * and fatiguing over an hour, and that trade is the pilot's to make.
   */
  engineVolume: number;
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

/**
 * Raw readings captured at an axis's physical extremes.
 *
 * The Gamepad API is documented as reporting -1..+1, but almost no real
 * transmitter does. Radios in USB-joystick mode scale their channel endpoints
 * into the HID logical range, so ±100% travel commonly arrives as ±0.7..±0.9,
 * and subtrim leaves the rest position off zero. Without the measured endpoints
 * there is nothing to stretch against, and full stick deflection lands short of
 * full output — the deadzone then eats a further slice off both ends.
 */
export interface AxisCalibration {
  /** Raw reading at full negative deflection (throttle: idle). */
  lo: number;
  /** Raw reading with the stick at rest. */
  mid: number;
  /** Raw reading at full positive deflection (throttle: full). */
  hi: number;
}

export interface GamepadAxisConfig {
  /** Index into `Gamepad.axes`. */
  axis: number;
  invert: boolean;
  /** Measured endpoints. Absent until the pilot runs calibration. */
  cal?: AxisCalibration;
  /**
   * Bottom-to-top axis with no spring centre — a real radio's throttle.
   *
   * A centred axis gets its deadzone and expo about the middle, which is right
   * for a self-centring stick and wrong for this one: it puts a dead notch at
   * mid-throttle and squashes resolution exactly where hover lives.
   */
  unipolar?: boolean;
}

/** Ignore an endpoint pair this close together — the stick was never swept. */
export const CAL_MIN_SPAN = 0.15;

/**
 * Slack on a measured span, so a sweep that stops a hair short of the recorded
 * extreme still saturates. Applied on read rather than when the calibration is
 * stored, or repeated calibration runs would compound it.
 */
const CAL_MARGIN = 0.02;

function clamp1(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Map a raw axis reading onto -1..+1 using its measured endpoints.
 *
 * The two halves are stretched independently so a stick whose rest position
 * sits off centre still reaches both extremes, instead of clipping on one side
 * and falling short on the other.
 */
export function normalizeAxis(raw: number, cal?: AxisCalibration): number {
  if (!cal) return clamp1(raw, -1, 1);
  // A half narrower than this was never really swept. Fall through to the raw
  // reading rather than returning zero: an unmeasured half should behave as if
  // uncalibrated, not go dead and silently cost half the stick's travel.
  if (raw >= cal.mid) {
    const span = (cal.hi - cal.mid) * (1 - CAL_MARGIN);
    return span < CAL_MIN_SPAN ? clamp1(raw, -1, 1) : clamp1((raw - cal.mid) / span, 0, 1);
  }
  const span = (cal.mid - cal.lo) * (1 - CAL_MARGIN);
  return span < CAL_MIN_SPAN ? clamp1(raw, -1, 1) : clamp1((raw - cal.mid) / span, -1, 0);
}

/** As `normalizeAxis`, but across one continuous travel with no centre. */
export function normalizeUnipolar(raw: number, cal?: AxisCalibration): number {
  if (!cal) return clamp1(raw, -1, 1);
  if (cal.hi - cal.lo < CAL_MIN_SPAN) return clamp1(raw, -1, 1);
  // Grow the margin outward from the middle of the travel rather than off one
  // end, or half-throttle drifts by the whole margin instead of nothing.
  const half = ((cal.hi - cal.lo) / 2) * (1 - CAL_MARGIN);
  return clamp1((raw - (cal.lo + cal.hi) / 2) / half, -1, 1);
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
  /**
   * Response gain either side of centre, 0.2..1.5. Applied as an exponent, not
   * a multiplier: full deflection still reaches full output at every setting,
   * so this sharpens or softens the middle of the travel without capping the
   * ends. Multiplying here is what used to shorten the usable range.
   */
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
    out[channel] = {
      axis: i,
      invert: RC_INVERT[channel],
      // A radio's throttle ratchets bottom-to-top and stays where it is put.
      ...(channel === 'throttle' ? { unipolar: true } : {}),
    };
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
 *
 * rev 2 shaped a radio's throttle as if it were spring-centred, giving it a
 * deadzone notch and expo about mid-stick. Rebuilding is what attaches the
 * `unipolar` flag to throttle on profiles saved before it existed.
 */
export const PROFILE_REV = 3;

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
  graphics: 'medium',
  physics: 'beginner',
  selectedDroneId: 'pluto',
  selectedEnvironmentId: 'drone-academy',
  volume: 0.7,
  engineVolume: 0.75,
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
    groundMarker: true,
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
  /**
   * Blades per propeller, default 2. Only the engine sound uses it: blade-pass
   * frequency is shaft speed times blade count, so a 3-blade prop sings a fifth
   * higher than a 2-blade one at the same RPM.
   *
   * Both shipped airframes are 2-blade — measured off the CAD, by rotational
   * symmetry of the prop geometry (PlutoX scores 0.90 for 2-fold and negative
   * for every other order), so neither needs to set this.
   */
  propBlades?: number;
  battery: BatterySpec;
  maxSpeed: number; // m/s
  maxAltitude: number; // m
  cameraMount: { position: Vec3; tiltDeg: number };
  /** Optional .glb visual asset; falls back to the procedural mesh when absent. */
  model?: string;
  /** Uniform scale applied to the .glb (1 = the model is already in metres). */
  modelScale?: number;
  /**
   * Presentation size multiplier, default 1. **Rendered model only.**
   *
   * A 160 mm nano is a speck in a 250 m city, and this is what makes it legible
   * there. It scales the drawn airframe — the model, its offset and the blur
   * discs — and NOTHING in the flight model: `armLength`, `mass`, the motors,
   * the collider stack and the rotor positions all stay the real hardware
   * figures.
   *
   * Scaling the colliders was tried and reverted. Rapier derives inertia from
   * collider positions, so `I` grows with the square of the scale — 6.25x on
   * the Guru at 2.5. The controller asks for `tau = I * a`, so the torque
   * demand grew with it while the motors did not, the mixer saturated, and the
   * aircraft flew heavy and would barely climb.
   *
   * The trade-off is that the drawn airframe is wider than what it collides
   * with, so it can visually overlap a wall it has already stopped against.
   */
  sizeScale?: number;
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
  /**
   * How the .glb draws its propellers.
   *
   * 'blades' (default) — real modelled blades, faded out as RPM rises. Past
   * ~15 rev/s a prop stops resolving at 60 fps and reads as a translucent disc,
   * which is exactly what a real one does to the eye.
   *
   * 'blur' — the model ships pre-rendered motion-blur discs instead of blades,
   * which is how most game-ready drone art is built. The same fade run forwards
   * would leave a drone at full throttle with no visible props at all, so it
   * runs backwards: a ghost at rest, solid once turning.
   */
  propArt?: 'blades' | 'blur';
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
  /**
   * Height of this map's flat ground plane, if it has one.
   *
   * Outdoor maps get an under-floor rescue: sink below the ground and the sim
   * pushes — eventually teleports — the drone back above it, which is what stops
   * a fast dive ending up under the world. That only makes sense when "the
   * ground" is a single height.
   *
   * Terrain maps must OMIT this. The Forest's ground is a real surface that falls
   * from the clearing at 0 to −77 m in the valley; with a plane assumed at 0 the
   * drone was shoved back up the moment it descended, and teleported to 0.012
   * every step below that — an invisible floor across the whole map. There, the
   * terrain trimesh and the catch floor do the job instead.
   */
  groundY?: number;
  /** Optional environment-specific distance fog override [near, far]. */
  fog?: { near: number; far: number };
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
