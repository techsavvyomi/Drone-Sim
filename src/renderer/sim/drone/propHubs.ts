import * as THREE from 'three';

// Measured propeller hub positions, published by DroneModel once the .glb has
// loaded and consumed by Propellers to place spin-blur discs / synthetic blades.
//
// These cannot be derived from DroneSpec.armLength: that's a nominal figure,
// and the real hubs on the PlutoX sit at x ~= +/-0.046, z ~= -0.043 / +0.049,
// which is ~10 mm inboard of armLength/sqrt(2). Guessing put the discs visibly
// outboard of the blades.

export const propHubs = {
  /** Hub positions in the DRONE BODY frame, ordered FR, FL, BR, BL. */
  positions: [] as THREE.Vector3[],
  ready: false,
  /**
   * True when the .glb has no PROP_ nodes (single-mesh). Propellers then draws
   * black stand-in blades that cover the baked props and spin with the motors.
   */
  synthetic: false,
  /** Blade radius (m) estimated from the model AABB when synthetic. */
  propRadius: 0,
  /**
   * A clonable copy of the real propeller, centred on its hub. Used for crash
   * debris so a detached prop is the actual PlutoX part rather than a stand-in.
   */
  template: null as THREE.Object3D | null,
  /**
   * Damped rotor speed per motor, 0..1, written by DroneModel every frame.
   *
   * Shared because for a 'blur' airframe the stand-in blades and the model's own
   * motion-blur discs are two halves of ONE crossfade: stopped you see blades,
   * spun up you see blur. Driving them from separate numbers would show both at
   * once during the handover.
   */
  spin: [0, 0, 0, 0],
  /**
   * Bumped to demand an immediate, un-damped stop of the rotors.
   *
   * The spool-down is normally damped, which is right when a pilot disarms and
   * watches the props wind down. It is wrong when the aircraft is replaced under
   * them: swapping the drone or the arena mid-flight teleports a fresh machine
   * onto the pad, and a damped decay left the previous one's propellers turning
   * on it for a second or two.
   */
  spinResetToken: 0,
};

/** Demand that the rotors stop dead on the next frame — see `spinResetToken`. */
export function resetPropSpin(): void {
  propHubs.spinResetToken += 1;
  propHubs.spin.fill(0);
}

/**
 * How blurred a rotor looks at this speed: 0 = stopped, draw solid blades;
 * 1 = fully smeared, draw the blur disc alone.
 *
 * Reaching 1 by a quarter throttle is deliberate. A propeller stops resolving
 * to the eye almost immediately — there is no speed at which you see a slightly
 * blurry blade — so the handover wants to be quick, not a long dissolve.
 */
export function blurMix(spin: number): number {
  return Math.min(1, Math.max(0, spin) * 4);
}

export const TAU = Math.PI * 2;

/**
 * Revolutions per second at full throttle for a motion-blur prop disc.
 *
 * Far below the real rate, and deliberately. A blur texture has rotational
 * symmetry — four-fold on the racer — so its pattern repeats every 90 degrees.
 * Once the disc advances more than half of that between frames the eye takes
 * the shorter way round and the prop appears to turn BACKWARDS. At 60 fps that
 * ceiling is 7.5 rev/s.
 *
 * 20 rev/s at full throttle keeps everything up to about a third throttle —
 * idle, hover, gentle flight, i.e. everywhere you actually look at the props —
 * on the correct side of it, and lets a hard punch alias the way real footage
 * of a real drone does.
 */
export const BLUR_REV_PER_SEC = 20;

/**
 * Revolutions per second at FULL throttle for real, solid propeller blades.
 *
 * The same ceiling as `BLUR_REV_PER_SEC`, worked out for a two-blade prop: its
 * pattern repeats every half turn, so once the blades advance more than a
 * quarter turn between frames the eye takes the shorter way round and they
 * appear to turn backwards. At 60 fps that ceiling is 15 rev/s.
 *
 * Applied through `solidRevs()`, not multiplied straight in, and only the range
 * where the blades are still legible has to respect the ceiling — `DroneModel`
 * fades them out as RPM rises. At 25 the crossing lands at an `rpm` of 0.36,
 * where they are already down to a third opacity; past that the props have
 * stopped resolving and are MEANT to alias, exactly as real footage does.
 *
 * This replaced a flat 6400 rad/s per unit — some 61,000 RPM at full throttle,
 * and 51 rev/s at the ESC idle (`invariants.md` #15d), which turned what should
 * be a visible idle spin into a strobe that read as four propellers running
 * backwards over four idling motors.
 */
export const SOLID_REV_PER_SEC = 25;

/**
 * Blade speed for a normalised motor output, in revolutions per second.
 *
 * Rotor speed goes as the SQUARE ROOT of thrust — which is why `motorAudio`
 * pitches its voices by `sqrt(load)`, and the props have to be drawn off the
 * same curve or they disagree with what the pilot is hearing. Linear was the
 * bug: at the ESC idle it drew 5% of full speed against a motor already singing
 * at 22% of its RPM, so an idle that sounded alive looked dead.
 *
 * The curve is steep exactly where it is looked at. Idle turns at 5.6 rev/s
 * rather than 1.3, and a hover is a disc either way.
 */
export function solidRevs(rpm: number): number {
  return SOLID_REV_PER_SEC * Math.sqrt(Math.max(rpm, 0));
}
