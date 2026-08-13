import {
  axisPos,
  CAL_MIN_SPAN,
  normalizeAxis,
  normalizeUnipolar,
  type AxisCalibration,
  type AxisPos,
  type GamepadAction,
  type GamepadBinding,
  type GamepadChannel,
  type GamepadKind,
  type GamepadSettings,
  type StickInput,
} from '@shared/types';
import { clamp } from '../sim/mathx';

// USB gamepad / RC transmitter input.
//
// Ported from the Pluto ROS dashboard's gamepad tick so mappings and feel carry
// over. The Gamepad API has no event stream for axis movement — it must be
// polled — so this module owns a single requestAnimationFrame loop. Everything
// else (the sim's stick read, the settings UI's live meters) reads the snapshot
// it publishes. One owner matters for correctness, not just tidiness: button and
// switch edges are consumed on transition, so a second poller would race for
// them and actions would fire once, twice, or not at all.

/** Movement required during "Detect" before an axis is accepted. */
const DETECT_DELTA = 0.35;

/** Deflection past the deadzone that hands control back to the gamepad. */
const ACTIVITY_THRESHOLD = 0.06;

/** Live device snapshot, refreshed every frame for the settings UI. */
export interface GamepadLive {
  index: number | null;
  id: string;
  /** What the device was detected as; drives which axis layout is applied. */
  kind: GamepadKind;
  axes: number[];
  buttons: boolean[];
}

export const gamepadLive: GamepadLive = {
  index: null,
  id: '',
  kind: 'standard',
  axes: [],
  buttons: [],
};

/** Every currently connected pad, for the device picker. */
export function listGamepads(): { index: number; id: string; kind: GamepadKind }[] {
  const out: { index: number; id: string; kind: GamepadKind }[] = [];
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (pad && pad.axes.length >= 2) {
      out.push({ index: pad.index, id: pad.id, kind: detectKind(pad) });
    }
  }
  return out;
}

// --- Device identification --------------------------------------------------

// Radios and their USB/BT sim dongles. Matched first because many of them do
// report `mapping: 'standard'` while emphatically not being an Xbox pad.
const RC_PATTERN =
  /betaflight|betafpv|literadio|opentx|edgetx|taranis|radiomaster|tx16s|tx12|jumper|flysky|fs-?i6|frsky|spektrum|dsm|nirvana|jeti|futaba|rc ?sim|transmitter|joystick/i;

const PAD_PATTERN =
  /xbox|x-?box|playstation|dualshock|dualsense|wireless controller|nintendo|switch pro|joy-?con|8bitdo|steam|logitech|gamepad|046d|045e|054c/i;

/**
 * Classify a device so the right stick layout is applied automatically.
 *
 * The two families put their sticks on different axes, so this is the
 * difference between working out of the box and having roll and yaw swapped.
 * The Gamepad API exposes no transport field, so wired and Bluetooth devices
 * are indistinguishable here — which is fine, the OS presents both as plain HID
 * gamepads and they behave identically.
 */
export function detectKind(pad: Gamepad): GamepadKind {
  if (RC_PATTERN.test(pad.id)) return 'rc';
  if (PAD_PATTERN.test(pad.id)) return 'standard';
  if (pad.mapping === 'standard') return 'standard';
  // Unknown HID: radios expose many axes and few buttons, pads the reverse.
  if (pad.axes.length >= 4 && pad.buttons.length <= 8) return 'rc';
  return 'standard';
}

/** Stable per-model key for remembering a mapping. */
export function deviceKey(pad: Gamepad): string {
  return pad.id.trim() || `gamepad-${pad.axes.length}x${pad.buttons.length}`;
}

let onDevice:
  | ((key: string, id: string, kind: GamepadKind, buttonCount: number) => void)
  | null = null;

/** Register the callback that loads/creates this device's saved mapping. */
export function setDeviceHandler(
  fn: (key: string, id: string, kind: GamepadKind, buttonCount: number) => void,
): void {
  onDevice = fn;
}

let activeKey = '';
let lastNotifiedKey = '';
export function activeDeviceKey(): string {
  return activeKey;
}

/** Processed stick values. Throttle 0..1 (0.5 = centre), rest -1..1. */
export const gamepadStick: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 };

/** True on any frame where the pilot actually moved a gamepad stick. */
let hadActivity = false;

/** Throttle position that last counted as input, for drift-based detection. */
let throttleMark: number | null = null;

export function consumeGamepadActivity(): boolean {
  const a = hadActivity;
  hadActivity = false;
  return a;
}

export function gamepadConnected(): boolean {
  return gamepadLive.index !== null;
}

// --- Configuration, pushed in from the settings store -----------------------

let config: GamepadSettings | null = null;
export function setGamepadConfig(next: GamepadSettings): void {
  config = next;
}

// --- Binding capture, driven by the settings UI ----------------------------

type BindResult =
  | { kind: 'action'; action: GamepadAction; binding: GamepadBinding }
  | { kind: 'channel'; channel: GamepadChannel; axis: number };

let pendingAction: GamepadAction | null = null;
let pendingChannel: GamepadChannel | null = null;
let detectBaseline: number[] = [];
let bindBaselinePos: AxisPos[] = [];
let onBind: ((r: BindResult) => void) | null = null;
let onCaptureChange: (() => void) | null = null;

export function setBindHandlers(
  bound: (r: BindResult) => void,
  changed: () => void,
): void {
  onBind = bound;
  onCaptureChange = changed;
}

export function captureState(): { action: GamepadAction | null; channel: GamepadChannel | null } {
  return { action: pendingAction, channel: pendingChannel };
}

/** Listen for the next button press / switch flick and bind it to `action`. */
export function beginBindAction(action: GamepadAction): void {
  calibrating = false;
  pendingChannel = null;
  pendingAction = action;
  bindBaselinePos = gamepadLive.axes.map((v) => axisPos(v));
  onCaptureChange?.();
}

/** Listen for the next axis to be wiggled and assign it to `channel`. */
export function beginDetectAxis(channel: GamepadChannel): void {
  calibrating = false;
  pendingAction = null;
  pendingChannel = channel;
  detectBaseline = [...gamepadLive.axes];
  onCaptureChange?.();
}

export function cancelCapture(): void {
  pendingAction = null;
  pendingChannel = null;
  onCaptureChange?.();
}

// --- Endpoint calibration ---------------------------------------------------

/**
 * Watch every axis and remember how far it actually travels.
 *
 * This is the piece that lets an external controller reach the ends of the
 * range. Nothing else in the pipeline knows what a given radio reports at full
 * deflection, so without a measured span the code has to assume the documented
 * ±1 and a device that only swings ±0.75 permanently falls a quarter short.
 */
let calibrating = false;
let calRange: { lo: number; hi: number }[] = [];
let calCenters: number[] = [];

export function isCalibrating(): boolean {
  return calibrating;
}

/** Snapshot the rest positions and start tracking extremes. */
export function beginCalibration(): void {
  pendingAction = null;
  pendingChannel = null;
  calCenters = [...gamepadLive.axes];
  calRange = gamepadLive.axes.map((v) => ({ lo: v, hi: v }));
  calibrating = true;
  onCaptureChange?.();
}

export function cancelCalibration(): void {
  calibrating = false;
  onCaptureChange?.();
}

/** How far one channel has been swept either side of its rest position. */
export interface SweepProgress {
  /** Travel seen below rest, and above it. */
  below: number;
  above: number;
  /** Whether enough has been seen to calibrate this channel. */
  done: boolean;
}

/**
 * Per-channel sweep progress, so the UI can say which direction is still
 * missing rather than only whether *something* moved.
 */
export function calibrationProgress(cfg: GamepadSettings): Record<GamepadChannel, SweepProgress> {
  const out = {} as Record<GamepadChannel, SweepProgress>;
  for (const name of Object.keys(cfg.axes) as GamepadChannel[]) {
    const idx = cfg.axes[name].axis;
    const r = calRange[idx];
    const mid = restPosition(idx, r);
    const below = r ? mid - r.lo : 0;
    const above = r ? r.hi - mid : 0;
    out[name] = {
      below,
      above,
      // A centred stick is stretched half by half, so each half needs its own
      // measurement; a radio throttle is one travel and only needs the total.
      done: cfg.axes[name].unipolar
        ? below + above >= CAL_MIN_SPAN
        : below >= CAL_MIN_SPAN && above >= CAL_MIN_SPAN,
    };
  }
  return out;
}

/** Rest position for an axis, clamped inside whatever travel was observed. */
function restPosition(idx: number, r: { lo: number; hi: number } | undefined): number {
  const raw = calCenters[idx] ?? 0;
  return r ? clamp(raw, r.lo, r.hi) : raw;
}

/**
 * Freeze what was swept into a per-channel calibration.
 *
 * Channels that were not swept far enough are left out rather than saved with
 * a lopsided span. This gate is not cosmetic: `normalizeAxis` stretches the two
 * halves of a centred axis independently, so a stick pushed only one way would
 * save a zero-width half and go completely dead in the other direction — worse
 * than never having calibrated it.
 */
export function finishCalibration(
  cfg: GamepadSettings,
): Partial<Record<GamepadChannel, AxisCalibration>> {
  const progress = calibrationProgress(cfg);
  calibrating = false;
  const out: Partial<Record<GamepadChannel, AxisCalibration>> = {};
  for (const name of Object.keys(cfg.axes) as GamepadChannel[]) {
    const idx = cfg.axes[name].axis;
    const r = calRange[idx];
    if (!r || !progress[name].done) continue;
    out[name] = { lo: r.lo, mid: restPosition(idx, r), hi: r.hi };
  }
  onCaptureChange?.();
  return out;
}

// --- Action dispatch --------------------------------------------------------

let onAction: ((a: GamepadAction) => void) | null = null;
export function setActionHandler(fn: (a: GamepadAction) => void): void {
  onAction = fn;
}

// --- Poll loop --------------------------------------------------------------

let prevButtons: boolean[] = [];
let prevPos: AxisPos[] = [];
let raf = 0;
/** Consecutive frames the adopted slot has read empty. */
let missFrames = 0;
const MISS_LIMIT = 30; // ~0.5s at 60fps
/**
 * Loop generation. StrictMode mounts effects twice, so two loops can exist
 * briefly; a single shared rAF handle means only the newer one is cancellable
 * and the older keeps consuming button edges forever. Each loop carries a token
 * and exits as soon as it is superseded.
 */
let loopToken = 0;

/** Travel at either end that snaps to the extreme, absorbing calibration slop. */
const END_TOLERANCE = 0.02;

/**
 * Response gain, as an exponent rather than a multiplier.
 *
 * `x * sensitivity` caps the endpoints: at 0.8 a fully deflected stick tops out
 * at 0.8, which is precisely the "the stick is maxed but the channel isn't"
 * complaint. Raising to a power leaves ±1 fixed and bends everything between.
 */
function gain(v: number, sensitivity: number): number {
  if (sensitivity === 1) return v;
  return Math.sign(v) * Math.abs(v) ** (1 / clamp(sensitivity, 0.2, 1.5));
}

/** Deadzone, then expo, then gain — the order a transmitter applies them. */
function shapeCentered(n: number, cfg: GamepadSettings): number {
  const dz = clamp(cfg.deadzone, 0, 0.5);
  const a = Math.abs(n);
  if (a <= dz) return 0;
  // Rescale so the curve starts at zero just outside the deadzone rather than
  // jumping straight to `dz` worth of output, and still reaches 1 at the end of
  // the travel rather than 1 - dz.
  const v = (Math.sign(n) * (a - dz)) / (1 - dz);
  const curved = cfg.expo * v * v * v + (1 - cfg.expo) * v;
  const out = gain(curved, cfg.sensitivity);
  return clamp(Math.abs(out) >= 1 - END_TOLERANCE ? Math.sign(out) : out, -1, 1);
}

/**
 * A radio throttle: one continuous travel, bottom to top.
 *
 * No centre deadzone and no expo — both are shapes for a stick that springs
 * back, and about a throttle's midpoint they only cost authority where hover
 * lives. Only the ends are snapped, so idle is exactly 0 and full is exactly 1.
 */
function shapeUnipolar(n: number): number {
  const u = clamp((n + 1) / 2, 0, 1);
  const snapped = u <= END_TOLERANCE ? 0 : u >= 1 - END_TOLERANCE ? 1 : u;
  return snapped * 2 - 1;
}

/**
 * Shaped value for one channel, -1..1. Exported so the settings UI can show
 * live meters even while gamepad input is switched off — otherwise you could
 * not check that a controller works without first enabling it.
 */
export function readChannel(
  name: GamepadChannel,
  cfg: GamepadSettings,
  axes: number[],
): number {
  const c = cfg.axes[name];
  const raw = c.invert ? -(axes[c.axis] ?? 0) : (axes[c.axis] ?? 0);
  // Inverting flips which physical end is which, so the calibration has to be
  // read through the same flip or lo and hi land on the wrong sides.
  const cal = c.cal && c.invert
    ? { lo: -c.cal.hi, mid: -c.cal.mid, hi: -c.cal.lo }
    : c.cal;
  return c.unipolar
    ? shapeUnipolar(normalizeUnipolar(raw, cal))
    : shapeCentered(normalizeAxis(raw, cal), cfg);
}

function findAction(pred: (b: GamepadBinding) => boolean): GamepadAction | null {
  if (!config) return null;
  for (const [action, binding] of Object.entries(config.bindings)) {
    if (binding && pred(binding)) return action as GamepadAction;
  }
  return null;
}

function tick(): void {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];

  // Rescan whenever nothing is adopted. The connect event is not sufficient on
  // its own: browsers withhold a gamepad until it emits activity, so a pad that
  // was already plugged in (or paired over Bluetooth) before launch never fires
  // one. Polling every frame costs nothing — getGamepads returns a snapshot.
  let gp = gamepadLive.index !== null ? pads[gamepadLive.index] : null;
  if (!gp) {
    if (gamepadLive.index !== null) {
      // Chromium stops exposing gamepads while the window is unfocused, so a
      // slot reading null for a frame or two is not a disconnect. Dropping the
      // device on the first empty frame made detection look random: alt-tab or
      // any focus blip and the controller "vanished".
      if (++missFrames < MISS_LIMIT) return;
      clearLive();
    }
    missFrames = 0;
    const found = pickPad(pads);
    if (!found) return;
    adopt(found);
    gp = found;
  } else {
    missFrames = 0;
  }

  const axes = Array.from(gp.axes);
  const buttons = gp.buttons.map((b) => b.pressed);
  gamepadLive.axes = axes;
  gamepadLive.buttons = buttons;
  const pos = axes.map((v) => axisPos(v));

  // --- Capture modes take priority and never drive the aircraft ---
  if (calibrating) {
    for (let i = 0; i < axes.length; i++) {
      const r = (calRange[i] ??= { lo: axes[i], hi: axes[i] });
      if (axes[i] < r.lo) r.lo = axes[i];
      if (axes[i] > r.hi) r.hi = axes[i];
    }
    prevButtons = buttons;
    prevPos = pos;
    return;
  }

  if (pendingChannel) {
    let best = -1;
    let bestDelta = DETECT_DELTA;
    for (let i = 0; i < axes.length; i++) {
      const d = Math.abs(axes[i] - (detectBaseline[i] ?? 0));
      if (d > bestDelta) {
        bestDelta = d;
        best = i;
      }
    }
    if (best >= 0) {
      const channel = pendingChannel;
      pendingChannel = null;
      onBind?.({ kind: 'channel', channel, axis: best });
      onCaptureChange?.();
    }
    prevButtons = buttons;
    prevPos = pos;
    return;
  }

  if (pendingAction) {
    let binding: GamepadBinding | null = null;
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i] && !prevButtons[i]) {
        binding = { t: 'b', i };
        break;
      }
    }
    if (!binding) {
      for (let i = 0; i < pos.length; i++) {
        // Require landing on lo/hi so a stick sweeping through centre doesn't
        // bind itself on the way past.
        if (pos[i] !== (bindBaselinePos[i] ?? 'mid') && pos[i] !== 'mid') {
          binding = { t: 'a', a: i, p: pos[i] };
          break;
        }
      }
    }
    if (binding) {
      const action = pendingAction;
      pendingAction = null;
      onBind?.({ kind: 'action', action, binding });
      onCaptureChange?.();
    }
    prevButtons = buttons;
    prevPos = pos;
    return;
  }

  const cfg = config;
  if (!cfg || !cfg.enabled) {
    prevButtons = buttons;
    prevPos = pos;
    return;
  }

  // --- Continuous channels ---
  const roll = readChannel('roll', cfg, axes);
  const pitch = readChannel('pitch', cfg, axes);
  const yaw = readChannel('yaw', cfg, axes);
  const thr = readChannel('throttle', cfg, axes);

  gamepadStick.roll = roll;
  gamepadStick.pitch = pitch;
  gamepadStick.yaw = yaw;
  // A gamepad stick springs to centre, so centre must mean "hold": 0.5 is the
  // hover point in altitude-managed modes and roughly hover in direct modes.
  // A radio's throttle does not spring, so its own resting position is the
  // command and the full 0..1 travel is available.
  const throttle = clamp((thr + 1) / 2, 0, 1);
  gamepadStick.throttle = throttle;

  // Throttle is tested for *movement*, not deflection. A radio's throttle rests
  // at an extreme, so an absolute test reads as "the pilot is flying" on every
  // single frame and the keyboard can never take control back.
  //
  // Measured as drift from the last position that counted, not as a per-frame
  // delta: easing a throttle up over a couple of seconds moves well under a
  // hundredth per frame, so a frame-to-frame test would miss every slow input
  // and only ever notice a stick being slammed.
  if (throttleMark === null) throttleMark = throttle;
  const throttleMoved = Math.abs(throttle - throttleMark) > ACTIVITY_THRESHOLD;
  if (throttleMoved) throttleMark = throttle;

  if (
    Math.abs(roll) > ACTIVITY_THRESHOLD ||
    Math.abs(pitch) > ACTIVITY_THRESHOLD ||
    Math.abs(yaw) > ACTIVITY_THRESHOLD ||
    throttleMoved
  ) {
    hadActivity = true;
  }

  // --- Button edges ---
  for (let i = 0; i < buttons.length; i++) {
    if (buttons[i] && !prevButtons[i]) {
      const action = findAction((b) => b.t === 'b' && b.i === i);
      if (action) onAction?.(action);
    }
  }

  // --- Switch-position edges (2/3-position switches on real transmitters) ---
  if (prevPos.length) {
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] === prevPos[i]) continue;
      const action = findAction((b) => b.t === 'a' && b.a === i && b.p === pos[i]);
      if (action) onAction?.(action);
    }
  }

  prevButtons = buttons;
  prevPos = pos;
}

function adopt(pad: Gamepad): void {
  gamepadLive.index = pad.index;
  gamepadLive.id = pad.id;
  gamepadLive.kind = detectKind(pad);
  activeKey = deviceKey(pad);
  prevButtons = [];
  prevPos = [];
  // Only notify on a genuine device change. Re-adopting the same controller
  // after a focus blip must not rewrite its stored profile, or a flap would
  // clobber the mapping the pilot just configured.
  if (activeKey !== lastNotifiedKey) {
    lastNotifiedKey = activeKey;
    onDevice?.(activeKey, pad.id, gamepadLive.kind, pad.buttons.length);
  }
}

/** Pick the most plausible controller from whatever is plugged in. */
function pickPad(pads: (Gamepad | null)[]): Gamepad | null {
  let best: Gamepad | null = null;
  for (const pad of pads) {
    // Steering wheels, pedal boards and some BT accessories enumerate as
    // gamepads with too few axes to fly with; skip them.
    if (!pad || pad.axes.length < 2) continue;
    if (!best || pad.axes.length > best.axes.length) best = pad;
  }
  return best;
}

function clearLive(): void {
  gamepadLive.index = null;
  gamepadLive.id = '';
  gamepadLive.axes = [];
  gamepadLive.buttons = [];
  activeKey = '';
  gamepadStick.roll = 0;
  gamepadStick.pitch = 0;
  gamepadStick.yaw = 0;
  gamepadStick.throttle = 0.5;
  throttleMark = null;
}

/** Switch to a specific device (device picker in settings). */
export function selectGamepad(index: number): void {
  const pad = (navigator.getGamepads ? navigator.getGamepads() : [])[index];
  if (pad) adopt(pad);
}

/** Start polling. Returns a detach function. */
export function attachGamepad(): () => void {
  // A pad already connected at load time may fire no connect event until it is
  // touched, so adopt anything the browser already reports. The poll loop keeps
  // rescanning regardless, which is what actually covers the Bluetooth case.
  const existing = pickPad(navigator.getGamepads ? navigator.getGamepads() : []);
  if (existing) adopt(existing);

  const onConnect = (e: GamepadEvent) => {
    // Prefer a device we already have a mapping for; otherwise take the newcomer.
    if (gamepadLive.index === null) adopt(e.gamepad);
  };
  const onDisconnect = (e: GamepadEvent) => {
    if (e.gamepad.index !== gamepadLive.index) return;
    clearLive();
    // Fall back to any other controller still attached rather than going dead.
    const next = pickPad(navigator.getGamepads ? navigator.getGamepads() : []);
    if (next) adopt(next);
  };

  window.addEventListener('gamepadconnected', onConnect);
  window.addEventListener('gamepaddisconnected', onDisconnect);

  const token = ++loopToken;
  const step = () => {
    if (token !== loopToken) return; // superseded by a newer attach
    raf = requestAnimationFrame(step);
    tick();
  };
  raf = requestAnimationFrame(step);

  return () => {
    loopToken++;
    cancelAnimationFrame(raf);
    window.removeEventListener('gamepadconnected', onConnect);
    window.removeEventListener('gamepaddisconnected', onDisconnect);
  };
}

// This module owns singleton runtime state: the poll loop, the adopted device,
// and the previous-frame edges. A hot swap creates a fresh copy with no loop and
// no adopted device, while the discarded copy's rAF keeps running — the UI then
// imports the empty one and reports "no controller" even though a pad is plugged
// in. That state cannot be transferred, so force a full reload instead.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loopToken++;
    cancelAnimationFrame(raf);
  });
  import.meta.hot.accept(() => import.meta.hot?.invalidate());
}
