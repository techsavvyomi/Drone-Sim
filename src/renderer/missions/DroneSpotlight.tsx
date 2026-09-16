import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The searchlight under the drone, on Mission 5.
//
// It is the mission's only instrument. There is no marker, no radar dot and no
// distance readout until the observation is done, so what the pilot flies is a
// pool of light over a dark forest — and the whole of the mission's difficulty
// is the trade the cone imposes: climb and the pool widens and dims, descend and
// it is bright, tight and moving too fast to hold anything in.
//
// It hangs BELOW the aircraft, pointing down, and is aimed by flying: the Guru
// has no gimbal, and giving the beam its own axis would be a second aircraft to
// fly.
//
// The angle and the reach are the mission's own numbers (`MissionTracking`), so
// the light the pilot sees and the light the runtime judges against cannot drift
// apart — the Director tests the same cone this draws.
//
// ---- Why it is three things and not one ------------------------------------
//
// The first build was a bare `<spotLight>`, and flown it read as a flash going
// off on the ground rather than as a lamp on an aircraft. Three separate
// reasons, and a light alone could not fix any of them:
//
//   1. NOTHING EMITTED IT. A spotlight in three.js is a maths object: it lights
//      surfaces and is itself invisible. The pilot saw a bright patch on the
//      ground with no visible cause, and the eye reads an uncaused bright patch
//      as a flash. So there is a LAMP now — a housing and a lit lens under the
//      belly — and it is the thing the light appears to come out of.
//   2. NOTHING CARRIED IT. Between the aircraft and the ground there was
//      nothing at all. A real searchlight at dusk has a visible shaft, because
//      the air it crosses scatters some of it back. So there is a soft CONE,
//      drawn additively and faded out along its length, which is what actually
//      connects the drone to the pool.
//   3. IT DID NOT FALL OFF LIKE LIGHT. `decay` was 1.35 with an artificial
//      `distance` cutoff — so the pool barely dimmed with altitude and then
//      ended on a hard sphere. Real light is inverse-square. See `INTENSITY`.
//
// All three move as one rigid group, so nothing can jitter relative to anything
// else — a lamp that swam a few centimetres against its own beam was the other
// half of why it did not read as attached to the aircraft.
// ----------------------------------------------------------------------------

/** How far in front of the drone the beam is aimed, metres, so the pilot sees
 *  where they are GOING rather than only where they are. Small: a lamp aimed
 *  too far ahead lights nothing under the aircraft, and the lock is judged on
 *  what is under it. */
const LEAD = 1.2;
/** How far below the airframe the lamp sits. Under the belly, clear of the
 *  props. */
const DROP = 0.14;

/**
 * How fast the aim catches up with the nose, per second.
 *
 * The lead used to be applied instantly, so every stick input snapped the beam
 * sideways and the pool jumped rather than swung. A real lamp is bolted to an
 * airframe that has mass. Low enough to smooth a twitch, high enough that the
 * beam is never seen to lag a deliberate turn.
 */
const AIM_LERP = 3.5;

/**
 * Candela, and it has to be read against `decay = 2`.
 *
 * three.js lights are physical: with decay 2 and no `distance` cutoff the
 * irradiance at the centre of the pool is simply `INTENSITY / agl²`. The
 * ambient at `dusk` is 0.38, so the arithmetic that chose this number is:
 *
 *      9 m up  →  360 / 81  = 4.4    hot, and the lowest legal altitude
 *     12 m up  →  360 / 144 = 2.5    a strong working pool
 *     20 m up  →  360 / 400 = 0.9    still clearly a pool
 *     30 m up  →  360 / 900 = 0.4    barely above the ambient — the ceiling
 *
 * That last line IS the mission: climbing widens the pool and dims it until it
 * stops being worth anything, which is what stops the answer to "search the
 * forest" being "go to the ceiling and look down". The old pairing could not
 * express that at all — 190 against `decay = 1.35` is not a falloff any light
 * has, and it made 30 m nearly as bright as 10 m, so the pool had no altitude
 * behaviour and read as a flat white disc stamped on the ground.
 *
 * Close up it blows out badly — 360 / 0.35² is thousands — and the claim that
 * this was self-limiting because the pool is only 17 cm wide down there was
 * simply WRONG, as the first flight showed: bloom spreads a patch that
 * overexposed across half the airframe, and on the pad the whole helipad went
 * white. The fix is not a lower number, it is `LAMP_ON_*` below — the lamp is
 * off on the ground and comes up as the aircraft climbs away, which is what a
 * survey aircraft actually does with its light.
 */
const INTENSITY = 360;

/**
 * How soft the edge of the cone is, 0 (a knife edge) to 1 (soft to the centre).
 *
 * 0.65 puts the start of the falloff at about 40% of the cone angle, so there
 * is a definite core with a wide soft ramp around it. It matters more than it
 * sounds: the old 0.42 drew a crisp ellipse on the ground, and a crisp-edged
 * bright ellipse is the shape of a projected image rather than of a light.
 *
 * It does not weaken the mission's contract that what looks lit IS lit. The
 * runtime judges the full cone, and the ramp is INSIDE it — so anything bright
 * enough for the pilot to read is comfortably within what counts.
 */
const PENUMBRA = 0.65;

/** How far down the visible beam is drawn, metres. Under the 30 m tracking
 *  ceiling, and it is faded to nothing well before this — a shaft that ended on
 *  a visible rim in mid-air would be worse than no shaft at all. */
const BEAM_LEN = 26;

/**
 * The beam's own brightness at the lamp, before the fade.
 *
 * Deliberately faint. It is additive and it is a shell, so it doubles up where
 * the line of sight crosses more of it — which is exactly how a real shaft
 * reads, brighter round its edge than through its middle — and a value that
 * looks right on the ground looks like a solid cone from the side.
 */
const BEAM_ALPHA = 0.07;

/**
 * THE TAKE-OFF GATE: metres above the ground the lamp comes up between.
 *
 * The first flight had the light burning on the pad, and it was indefensible in
 * two separate ways. Visually, an inverse-square light a few centimetres off
 * the deck overexposes everything under it and bloom smears that across the
 * whole airframe — the drone stopped being a drone and became a bulb sitting in
 * a white hole. And behaviourally, no survey aircraft sits on its pad with the
 * searchlight lit: the light is for the search, and the search starts when you
 * leave the ground.
 *
 * So it fades in across the first metre and a half of climb. The reading comes
 * from the four-corner support probe, which is the only thing on this map that
 * knows where the ground actually IS — world altitude says nothing here, the
 * gorge floor being twenty-seven metres below the clearing. The probe's own
 * reach is 2 m and it saturates there, which is exactly the range this needs.
 */
const LAMP_ON_FROM = 0.3;
const LAMP_ON_FULL = 1.8;
/** How fast the lamp fades in and out, per second. Slow enough to read as a
 *  light coming up rather than a switch being flicked. */
const LAMP_LERP = 2.6;

/**
 * How far up the lamp should be, given the height above whatever is underneath
 * and whether the motors are live. 0 is dark, 1 is full.
 *
 * Pulled out of the frame loop as a pure function purely so it can be tested.
 * "The searchlight is off while the drone is on its pad" is not a thing the
 * typecheck can see, and it is a thing that has already been wrong once.
 */
export function lampRamp(height: number, live: boolean): number {
  if (!live) return 0;
  const t = (height - LAMP_ON_FROM) / (LAMP_ON_FULL - LAMP_ON_FROM);
  return Math.min(1, Math.max(0, t));
}

/**
 * A vertical fade for the beam shell: lit at the lamp, gone by the far end.
 *
 * A canvas gradient rather than a shader, for the reason `MissionMarkers` uses
 * one for its column: the shaft is a soft cue, and a one-off shader program is
 * a compile and a look to maintain for a fade. Cached at module scope — one
 * texture for the life of the process, and only a tracking mission ever builds
 * it.
 */
let beamTex: THREE.CanvasTexture | null = null;
function beamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Cone UVs run v = 0 at the base and v = 1 at the tip, and canvas y runs
    // downward — so the TOP of the canvas is the tip of the cone, which is
    // where the lamp is.
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  }
  beamTex = new THREE.CanvasTexture(canvas);
  return beamTex;
}

export function DroneSpotlight({ mission }: { mission: Mission }) {
  const rig = useRef<THREE.Group>(null);
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const track = mission.tracking;

  /** Scratch. Nothing allocates in the frame loop. */
  const forward = useMemo(() => new THREE.Vector3(), []);
  /** The smoothed aim offset, in world XZ. Chased rather than snapped. */
  const aim = useRef({ x: 0, z: 0 });
  /** How far up the lamp is, 0 (dark, on the pad) to 1 (full). */
  const lamp = useRef(0);

  // The cone is the mission's, in radians. `THREE.SpotLight.angle` is the HALF
  // angle, which is the same thing `coneDeg` means — see the Director, which
  // builds the ground pool from the tangent of exactly this number.
  const angle = ((track?.coneDeg ?? 26) * Math.PI) / 180;

  /** The shell, sized from the same angle so the drawn beam and the judged cone
   *  are the same cone. `ConeGeometry` takes the base radius. */
  const beam = useMemo(() => {
    const r = Math.tan(angle) * BEAM_LEN;
    // Open-ended: there is no cap on a beam of light, and a cap would catch the
    // additive blend as a bright disc hanging in the air at the far end.
    return new THREE.ConeGeometry(r, BEAM_LEN, 22, 4, true);
  }, [angle]);

  const beamMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#dce9ff',
        alphaMap: beamTexture(),
        transparent: true,
        opacity: BEAM_ALPHA,
        blending: THREE.AdditiveBlending,
        // Never writes depth: it is volume, not surface. Writing it would let
        // the shaft occlude the trees it is supposed to be shining between.
        depthWrite: false,
        side: THREE.DoubleSide,
        // Additive already blows past 1; tone mapping it as if it were a
        // surface crushes the whole shaft to nothing.
        toneMapped: false,
      }),
    [],
  );

  /**
   * The lens.
   *
   * Dim, and that is the whole of what was wrong with it. It was pure white and
   * untonemapped, which put it straight through the bloom threshold: the
   * halo swallowed the airframe and the drone read as a light bulb rather than
   * as a machine carrying one. This colour peaks at 0.80, which is the `dusk`
   * preset's bloom threshold exactly — so it is plainly a lit lens and it
   * glows, but it does not flare.
   *
   * Its brightness is scaled by the take-off gate every frame, so on the pad it
   * is a dark piece of the airframe.
   */
  const lensBase = useMemo(() => new THREE.Color('#93a9cc'), []);
  const lensMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false, fog: false }),
    [],
  );
  const housingMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.6, metalness: 0.3 }),
    [],
  );

  useEffect(
    () => () => {
      beam.dispose();
      beamMat.dispose();
      lensMat.dispose();
      housingMat.dispose();
    },
    [beam, beamMat, lensMat, housingMat],
  );

  useEffect(() => {
    // The target has to be in the scene graph for three to read its world
    // matrix; it is a child of the rig below, and this only pairs them.
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame((_, dt) => {
    const g = rig.current;
    const t = target.current;
    if (!g || !t) return;

    // Before the aircraft exists there is nothing to hang a lamp off. Hidden
    // rather than parked at the origin, which would put a lit cone on the pad.
    g.visible = dronePose.present;
    if (!dronePose.present) {
      // Put the gate back with it. Otherwise the next attempt's first frame
      // draws the lamp at whatever brightness the last one left behind, which
      // is a lit searchlight sitting on the pad — the exact frame this whole
      // mechanism exists to prevent.
      lamp.current = 0;
      return;
    }

    const p = dronePose.position;
    // The aircraft's own forward, so the lead follows the nose rather than a
    // world axis. −Z is forward in this engine's convention.
    forward.set(0, 0, -1).applyQuaternion(dronePose.quaternion);
    // Flattened: the lead is a horizontal offset, not a tilt. A beam that
    // pitched with the airframe would swing wildly on every stick input, and
    // the pilot would be chasing their own light.
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();

    // Chased, not snapped — see AIM_LERP. Framerate-independent so the beam
    // behaves the same on a machine holding 60 and one holding 20.
    const k = 1 - Math.exp(-AIM_LERP * dt);
    aim.current.x += (forward.x * LEAD - aim.current.x) * k;
    aim.current.z += (forward.z * LEAD - aim.current.z) * k;

    // ---- The take-off gate -------------------------------------------------
    //
    // Height above whatever is actually underneath, from the support probe —
    // the same reading `RotorWash` sits its dust on, and for the same reason:
    // world altitude is meaningless on a map whose floor moves sixty metres.
    // Past the probe's 2 m reach every corner reports 2.0, which is already
    // well clear of the gate, so saturation needs no special case.
    const d = useSimStore.getState().support.distances;
    const height = Math.min(d[0], d[1], d[2], d[3]);
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';
    const wanted = lampRamp(height, live);
    lamp.current += (wanted - lamp.current) * (1 - Math.exp(-LAMP_LERP * dt));
    const on = lamp.current;

    if (light.current) light.current.intensity = INTENSITY * on;
    beamMat.opacity = BEAM_ALPHA * on;
    lensMat.color.copy(lensBase).multiplyScalar(on);

    // The rig is unrotated, so its children's local axes are world axes: the
    // lamp, the shaft and the light all sit straight down from the aircraft and
    // only the AIM moves.
    g.position.set(p.x, p.y - DROP, p.z);
    t.position.set(aim.current.x, -10, aim.current.z);
  });

  if (!track) return null;

  return (
    <group ref={rig}>
      {/* The lamp. Small, and the point of it is entirely that the pilot can
          see where the light leaves the aircraft. */}
      <mesh material={housingMat} position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.055, 0.07, 0.07, 10]} />
      </mesh>
      {/* The lens: unlit, untonemapped, so it stays a hot white dot at any
          exposure rather than being graded down with the rest of the scene. */}
      <mesh material={lensMat} position={[0, -0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.028, 12]} />
      </mesh>

      {/* The shaft, hanging point-up from the lens.
          `ConeGeometry`'s apex is at +height/2 and its base at −height/2, so
          dropping it half its own length puts the POINT at the lamp and the
          wide end 26 m below — which is the way a beam actually spreads. It is
          deliberately NOT rotated: turning it over would hang it apex-down, so
          the light would converge to a point in mid-air under the aircraft.
          The fade agrees with that orientation — a cone's side UVs run v = 0 at
          the base to v = 1 at the apex, and the texture is brightest at v = 1,
          which is the lamp. */}
      <mesh geometry={beam} material={beamMat} position={[0, -BEAM_LEN / 2, 0]} />

      <spotLight
        ref={light}
        angle={angle}
        /* Zero at mount: the frame loop owns it, and a light that flashed at
           full power for the one frame before the first update is the exact
           thing the gate exists to prevent. */
        intensity={0}
        penumbra={PENUMBRA}
        /* INVERSE SQUARE, and no `distance` cutoff.
           Two is what light actually does, and the cutoff is an optimisation
           that buys nothing here — one light, and its own falloff has taken it
           to nothing long before any radius worth clipping at. The old pair
           (1.35 with a 61 m sphere) gave the pool no altitude behaviour and
           then ended it on a hard edge. */
        decay={2}
        color="#eaf1ff"
        /* NO SHADOWS. A shadow-casting spot over a forest of five thousand
           trunk boxes is a second shadow pass across the whole canopy every
           frame, on a 512 MB integrated GPU that is already VRAM-bound. The
           pool reads perfectly well without one, and the mission never asks the
           pilot to judge anything by a shadow. */
        castShadow={false}
      />
      <object3D ref={target} />
    </group>
  );
}
