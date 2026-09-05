import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';

// ----------------------------------------------------------------------------
// The checkpoint bubble — a sphere of frosted pink glass that hangs in the air,
// bobs, breathes, and goes out when the drone flies into it.
//
// Self-contained on purpose. Everything it needs is here: the palette, the
// shader, the animation and the trigger. It knows nothing about lessons, routes
// or the HUD, so anything in the app can stand one somewhere and be told when it
// was taken.
//
// It is a CORONA, not a ball: additively-blended magenta with the world showing
// straight through it, striped down its length and turning slowly. The look is
// the checkpoint sphere every open-world game of the era used, and each part of
// it is doing a job:
//
//   1. ADDITIVE, not alpha-blended. This is the decision the whole thing hangs
//      on. An alpha-blended sphere COVERS what is behind it — the more of it you
//      can see, the less of the world you can — so the grass and the gate behind
//      go milky and grey and the marker reads as frosted glass hanging in the
//      opening. Additive can only ever ADD, so the world behind stays legible
//      and comes through TINTED PINK instead. Nothing is hidden, which is the
//      right promise for a thing you are meant to fly into.
//   2. The cost is a bright sky. Additive over the academy's pale sky sums
//      toward white, and the higher the marker sits the more of it is against
//      sky rather than against grass and buildings. That is why the palette is a
//      SATURATED magenta and nothing is driven past 1.0: the wash is bounded,
//      and green is the channel it has least of, so what it washes toward is a
//      hot pink rather than a white hole.
//   3. The STRIPES are the signature. They are longitude bands, densest facing
//      the eye and converging at the poles, and they turn on their own axis.
//      Without them a see-through additive sphere is a flat pink disc — there is
//      nothing in it to tell you it is round, or which way round it is, or that
//      it is a live thing rather than a decal. They are what read as rotation
//      from sixteen metres out, where the bob and the breath are too small to
//      see.
//   4. The SILHOUETTE is still the densest part, because the eye looks through
//      more of the sphere at a grazing angle than down the middle. That is what
//      keeps the marker legible against a building or against the deck, where a
//      flat wash would have no outline at all.
//
// There is no hot white heart and no specular highlight. Both were tried. A
// bright middle is what a solid marble has, and a highlight is what a lit
// surface has — this is neither, it is a volume of coloured light, and the two
// of them together were most of why the first version read as pink plastic.
// ----------------------------------------------------------------------------

/** The corona's colour, and the most saturated thing on the field.
 *
 *  Saturated on purpose — see point 2 of the header. Additive light washes
 *  toward white, and a magenta has almost no green in it, so the channel that
 *  carries most of the luminance is the one it pushes least: it can lie over a
 *  bright sky and still come out pink.
 *
 *  `RouteGuide` imports this for the pillar's wall, so the two checkpoint marks
 *  are recognisably the same colour. Changing it changes both. */
export const ORB_EDGE = '#ff17dd';
/** The silhouette, where the eye looks through the most of the volume. A touch
 *  hotter and a touch paler than the body, which is what an edge lit by more of
 *  the same light looks like. */
export const ORB_RIM = '#ff5ce8';
/** How much light the corona adds where it faces the eye squarely, and how much
 *  more it adds at the grazing silhouette.
 *
 *  These are INTENSITIES, not opacities — the blend is additive, so nothing here
 *  hides anything, and turning them up makes the world behind pinker rather than
 *  harder to see. The shell is drawn double-sided, so both numbers land TWICE
 *  down the middle of the ball and the values below are half of what reaches the
 *  screen. */
const BODY = 0.09;
const BODY_RIM = 0.24;
const RIM_POW = 2.0;

// `BODY` is the one of these you can see THROUGH, and it was too high. At 0.3,
// doubled by the double-sided shell, the middle of the ball added 0.6 before
// bloom — enough to bury whatever was behind it, so a gate marked this way came
// out as a solid pink disc with the arena painted out inside its outline. Halved,
// the world reads straight through the middle and the ball is plainly a volume
// of light rather than a lid.
//
// `BODY_RIM` deliberately did NOT come down with it. The silhouette is what
// makes the marker legible against a building or against the deck, and lowering
// both together does not make the ball more transparent, it makes it fainter —
// a different and worse thing. The gap between the two is the shape.

/** The stripes: how many run round the ball, how deep they cut, and how fast
 *  the whole set turns, in radians of phase per second.
 *
 *  Longitude bands, turning slowly — the spin is deliberately gentle, because it
 *  is a landmark being lined up on from sixteen metres and a marker that visibly
 *  races is harder to hold a line on than one that turns.
 *
 *  SHALLOW, and that is not a matter of taste. At 0.35 and drawn on both walls
 *  the ball came out as a BASKETBALL — a hard woven lattice with nothing round
 *  about it — for two reasons that are both fixed in the shader rather than
 *  here. The depth is kept well under that because the bands are texture: they
 *  are not the outline, not the colour and not what makes the ball legible. If
 *  it ever reads as a pattern again, this is the number to take to zero, and
 *  nothing else about the marker changes when you do.
 *
 *  The SPIN is what they are really for. A stripe you cannot see turning is a
 *  smudge, so the two numbers go together: at this depth and this rate a band
 *  reaches where the one before it was in about half a second, which is a ball
 *  that is plainly rotating rather than one with a pattern on it. Turn the depth
 *  down and the rotation goes with it. */
const BANDS = 14.0;
const BAND_DEPTH = 0.2;
const BAND_SPIN = 0.9;

/** The halo's width, in ball radii.
 *
 *  Additive geometry, so it lands ON whatever is behind it — which is why it is
 *  faint and weighted to a ring at the ball's own rim rather than to a bright
 *  middle stacked on the bright middle underneath. Most of the spill is bloom,
 *  which is a post-process and smears over the picture instead; this is the
 *  fallback that carries the glow on the Low graphics preset, where there is no
 *  bloom at all. */
const HALO_W = 1.8;

/** How close the CAMERA can get, in ball radii, before the marker starts
 *  dimming, and the least it is ever drawn at.
 *
 *  The shell is additive and drawn double-sided, so flying up to one puts both
 *  walls plus the halo across the whole picture and the sum saturates to flat
 *  white — the ball stops being a target and becomes a sheet over the city. The
 *  trigger is unaffected: this changes only how brightly the marker is DRAWN,
 *  and scoring is measured from its fixed centre. */
const NEAR_FADE = 5.5;
const NEAR_FLOOR = 0.05;
// --- The motion ------------------------------------------------------------
//
// Four things move, at four different rates, and the rates are deliberately not
// multiples of each other: locked to a common beat they read as one mechanism
// ticking, and drifting against each other they read as something alive.
//
//   the bob      the ball floats up and down
//   the breath   it swells and shrinks
//   the pulse    it brightens and dims
//   the spin     the stripes turn round it (`BAND_SPIN`)
//
// All four used to be a third of what they are, on the reasoning that a landmark
// being aimed at from tens of metres should sit still and that anything which
// visibly swims is harder to hold a line on. That reasoning is sound and it went
// too far: at 7 cm of bob and five per cent of breath on a ball a metre across,
// nothing was visible at all and the marker read as a decal. What is here is
// still small enough to aim at — the whole of the motion is under a fifth of the
// ball's own radius — and large enough to be seen from the far end of the
// approach, which is the point of it.
//
// None of it can move what counts as a pass: the TRIGGER is measured from the
// marker's fixed centre and never from where the ball happens to be drawn. See
// `CheckpointSphere`.

/** How far the ball rides up and down from its centre, in metres, and how
 *  often. */
const BOB_M = 0.18;
const BOB_HZ = 0.26;
/** The breathing: how much it swells, and how fast. */
const BREATHE = 0.08;
const BREATHE_HZ = 0.33;
/** The pulse: how much it brightens and dims, and how fast.
 *
 *  Its own term rather than a fraction of the breath, which is what it used to
 *  be. Tied to the size it was invisible by construction — a light that changes
 *  size and brightness together at the same rate reads as ONE change, and the
 *  brightness half of it is doing no work. Given its own faster rate the two
 *  drift in and out of phase, and the ball has a beat instead of a wobble. */
const PULSE = 0.14;
const PULSE_HZ = 0.47;
/** Seconds the light takes to go out once it has been taken, and how far it
 *  swells on the way out. Short, and a swell rather than a snap: a pass should
 *  read as something the world did in answer to the flight. */
const COLLECT_SEC = 0.4;
const COLLECT_SWELL = 0.45;

const ORB_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vPosL;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - world.xyz;
    // Object space, for the stripes. The ball only ever scales uniformly, so a
    // local direction survives the transform and the bands stay painted on the
    // sphere instead of swimming across it as it breathes.
    vPosL = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// `f` is how squarely the shell faces the eye, 1 down the middle and 0 at the
// grazing silhouette; `rim` is the same number read from the other end.
//
// `abs` is load-bearing. The shell is drawn double-sided, and the far wall's
// normal points away from the camera; without it the back half of the ball comes
// out unlit and what is left is a lit hemisphere with a lid.
//
// Everything the shader produces is an INTENSITY, because the blend is additive:
// the number in the alpha channel is how much magenta is added to whatever is
// already on the screen, not how much of it is covered up. That is why the
// middle can sit as high as it does and the gate behind is still perfectly
// readable through it.
//
// The stripes come off the azimuth of the object-space position — the angle round
// the ball's own axis — so they are longitude bands. Adding time to that angle
// turns them, which costs one addition and is the whole of the rotation.
//
// They are fenced in two ways, and without either one the ball is a BASKETBALL
// rather than a sphere:
//
//   - FRONT WALL ONLY. The shell is double-sided, so the far wall's bands show
//     through the near wall's. Two sets of longitude lines crossing at the
//     angles the curvature puts them at is a woven lattice, which is the one
//     thing that reads less like a ball than a flat disc does.
//   - FADED OUT AT THE SILHOUETTE, by the facing term. Round the edge the
//     azimuth swings almost a whole turn across a couple of pixels, so the
//     cosine goes far past what the raster can sample and aliases into moire —
//     a grid of interference that has nothing to do with the bands and cannot
//     be filtered away at this size. Killing them where they alias also leaves
//     the outline clean and unbroken, which is what the silhouette is for.
//
// No tone-mapping include, deliberately. This is a light source, and letting the
// filmic curve pull it back is what greys it off.
const ORB_FRAG = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uRim;
  uniform float uLit;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vPosL;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewW);
    float f = clamp(abs(dot(n, v)), 0.0, 1.0);
    float rim = 1.0 - f;

    float a = ${BODY} + ${BODY_RIM} * pow(rim, ${RIM_POW.toFixed(1)});

    if (gl_FrontFacing) {
      // The epsilon is for the poles, where the position is exactly (0, +-r, 0)
      // and a two-argument atan of two zeroes is undefined.
      float ang = atan(vPosL.z, vPosL.x + 1e-5);
      float stripe = 0.5 + 0.5 * cos(ang * ${BANDS.toFixed(1)} + uTime * ${BAND_SPIN});
      // f, so the bands are strongest looking straight at the ball and gone by
      // the edge, where they would otherwise alias.
      a *= 1.0 - ${BAND_DEPTH} * f * (1.0 - stripe);
    }

    vec3 c = mix(uCore, uRim, pow(rim, 2.0));

    gl_FragColor = vec4(c, uLit * clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/**
 * The halo, painted into a canvas: a radial fall-off peaking at the ball's rim.
 *
 * Drawn rather than fetched — no asset on this project may come off the network,
 * where a strict CSP blocks it and a helper that quietly fetches tears down the
 * whole WebGL tree. One texture for every sphere, built on first use.
 */
let haloTexture: THREE.CanvasTexture | undefined;

function orbHalo(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    // The ball's own rim sits at 1/HALO_W of this radius, and the peak goes just
    // OUTSIDE it: from the rim outward is the only part that is actually spill.
    // The stops below are written against the current HALO_W — change one and
    // the peak has to move with it.
    //
    // Kept modest. The body of the corona is already additive and already spills
    // its own colour over what is behind it, so this is only the falloff that
    // carries on past the silhouette — enough that the ball does not end in a
    // hard cut, and enough to be the whole of the glow on the Low preset, where
    // there is no bloom at all.
    // Stops are placed relative to the rim rather than at fixed fractions, so
    // narrowing HALO_W cannot push a later stop in front of an earlier one.
    const rim = Math.min(0.6, 1 / HALO_W);
    g.addColorStop(0.0, 'rgba(255, 150, 240, 0.03)');
    g.addColorStop(rim, 'rgba(255, 110, 236, 0.06)');
    g.addColorStop(rim + (1 - rim) * 0.22, 'rgba(255, 55, 224, 0.07)');
    g.addColorStop(rim + (1 - rim) * 0.55, 'rgba(255, 25, 205, 0.03)');
    g.addColorStop(1.0, 'rgba(190, 0, 150, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

const tagTextures = new Map<string, THREE.CanvasTexture>();

/**
 * A checkpoint's letter, as a texture for the sprite that rides in the ball.
 *
 * Just the letter. It was a BADGE — a dark disc, a neon pink rim, a white inner
 * rim and the letter inside all three — and a badge is the wrong object here:
 * the ball is already a disc with a rim, so a second disc with a rim hung in the
 * middle of it read as a sticker slapped on the mark rather than as its name.
 * On the triangle, where three of them stand out on the pad at once, A, B and C
 * came back as three little targets and the letters were the smallest thing in
 * them.
 *
 * What is left is the letter and the shadow that keeps it readable. The ball is
 * bright pink and it BREATHES, so white alone flickers in and out of legibility
 * against it; a soft dark drop behind the glyph holds the edge without drawing a
 * shape of its own. Nothing else — no fill behind, no ring around.
 */
export function orbTagTexture(text: string): THREE.CanvasTexture {
  const cached = tagTextures.get(text);
  if (cached) return cached;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;

    // Bigger than it was, because the disc it used to have to fit inside is
    // gone: the letter is now the whole mark, so it gets the whole texture.
    ctx.font = `900 ${text.length > 1 ? 260 : 330}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = 'rgba(10, 6, 20, 0.85)';
    ctx.shadowBlur = size * 0.07;
    ctx.fillStyle = '#ffffff';
    // Twice, so the shadow builds up enough to separate the glyph from the
    // light behind it. Cheaper and softer than an outline, which at this size
    // thickens the strokes until the letter closes up.
    ctx.fillText(text, cx, cy + 6);
    ctx.fillText(text, cx, cy + 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  tagTextures.set(text, texture);
  return texture;
}

export interface CheckpointSphereProps {
  /** Centre of the marker, in world metres. The bob rides on top of this; the
   *  trigger is measured from it. */
  position: readonly [number, number, number];
  /** Radius of the glowing ball, in metres. */
  radius?: number;
  /** How close the drone's centre has to get for the pass to register, in
   *  metres. Defaults to the visual radius, which is the promise the marker
   *  makes by being a ball: what you can see is what you fly into. */
  triggerRadius?: number;
  /** Force the taken state from outside.
   *
   *  For a caller that already scores the pass its own way — a lesson walking a
   *  route cursor, a race counting laps — and does not want two answers to the
   *  same question. It is OR-ed with the sphere's own trigger, so passing it
   *  never stops the ball going out when the drone is visibly inside it. */
  collected?: boolean;
  /** Fired once, on the frame the drone first enters. Re-arms if the sphere is
   *  put back (`collected` returning false while the drone is outside). */
  onCollect?: () => void;
  /** Turn the bob off for a marker that must sit exactly where it is drawn. */
  bob?: boolean;
  /** Metres to draw the BALL above its centre, leaving the trigger where it is.
   *
   *  The same licence the bob already takes, for a different reason. A gate's
   *  checkpoint sits at the height the lesson is judged at — hover height, on a
   *  module flown level in altitude hold — which is well below the middle of the
   *  opening, so a ball drawn honestly on it hangs in the bottom of the frame
   *  and half-buries itself in the bottom bar. Lifting it puts the light where
   *  the pilot is actually looking.
   *
   *  CLAMPED so the whole visible ball still fits inside the trigger sphere:
   *  `lift + radius <= triggerRadius`. That is the promise the marker makes by
   *  being a ball — what you can see is what you fly into — and a lift big
   *  enough to break it would put light outside the volume that scores, which is
   *  the "I flew through it and it did not count" this file exists to avoid. */
  lift?: number;
  /** Optional letter label (e.g. 'A', 'B', 'C') displayed in the middle of the ball. */
  tag?: string;
}

/** Scratch, so the frame loop never allocates. */
const centre = new THREE.Vector3();

/**
 * A neon checkpoint sphere: glowing, bobbing, breathing, and collectable.
 *
 * The TRIGGER is a bounding-sphere test against the live drone transform, run
 * once a frame: `|drone - centre| <= triggerRadius`. It is measured from the
 * marker's fixed centre rather than from its bobbed position, so what counts as
 * a pass never moves — the bob is allowed to be a lie, the collider is not. It
 * fires `onCollect` exactly once on entry and re-arms only after the sphere has
 * been put back and the drone has left, so a drone sitting inside a re-lit
 * marker cannot collect it a second time.
 *
 * A sphere test, not a box: the marker IS a sphere, and an axis-aligned box
 * round it scores the corners — up to 73% further out than the light the pilot
 * was flying at, which is the "I went through it and it did not count" that
 * every checkpoint has to avoid.
 *
 * Both meshes are depth-TESTED and neither writes depth: the world in front
 * hides the ball, and the ball never hides the drone inside it.
 */
export function CheckpointSphere({
  position,
  radius = 1,
  triggerRadius,
  collected,
  onCollect,
  bob = true,
  lift = 0,
  tag,
}: CheckpointSphereProps) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Material>(null);
  const tagMat = useRef<THREE.Material>(null);
  /** How lit it is, 0..1. Driven both ways, so a marker that is put back lights
   *  up again instead of leaving a dark ball hanging in the air.
   *
   *  Seeded from `collected` rather than from 1. A caller that mounts a whole
   *  route at once and lights one ball at a time, which is how a marker avoids
   *  being built and thrown away mid-flight, would otherwise open with every
   *  ball on the route lit and half a second of them all fading out together. */
  const lit = useRef(collected === true ? 0 : 1);
  /** The trigger's own answer, and whether it is armed. */
  const taken = useRef(false);
  const armed = useRef(true);
  /** Held in a ref so a caller passing an inline closure does not have the
   *  callback go stale between renders. */
  const collect = useRef(onCollect);
  collect.current = onCollect;

  const uniforms = useMemo(
    () => ({
      uCore: { value: new THREE.Color(ORB_EDGE) },
      uRim: { value: new THREE.Color(ORB_RIM) },
      uLit: { value: 1 },
      uTime: { value: 0 },
    }),
    [],
  );

  useFrame(({ clock, camera }, dt) => {
    const [x, y, z] = position;
    const reach = triggerRadius ?? radius;
    centre.set(x, y, z);
    // Never far enough to put lit glass outside the volume that scores — see
    // `lift`. With no trigger radius given, `reach` IS the ball, so this is zero
    // and an honest marker cannot be moved off its own checkpoint by accident.
    const raise = Math.min(lift, Math.max(0, reach - radius));

    // --- Trigger ------------------------------------------------------------
    const inside = dronePose.present && dronePose.position.distanceTo(centre) <= reach;
    if (inside && armed.current) {
      armed.current = false;
      taken.current = true;
      collect.current?.();
    }
    // Re-arm only once the marker is back AND the drone is clear of it.
    if (!inside && collected === false) {
      armed.current = true;
      taken.current = false;
    }
    const out = taken.current || collected === true;

    // --- Fade ---------------------------------------------------------------
    // Clamped: a frame lost to a shader compile or a window drag must not put
    // the whole fade through in one step.
    const step = Math.min(dt, 0.1) / COLLECT_SEC;
    const t = (lit.current = out
      ? Math.max(0, lit.current - step)
      : Math.min(1, lit.current + step));

    // --- Animation ----------------------------------------------------------
    const time = clock.elapsedTime;
    const breathe = 1 + BREATHE * Math.sin(time * BREATHE_HZ * Math.PI * 2);
    if (group.current) {
      group.current.visible = t > 0.002;
      group.current.position.set(
        x,
        y + raise + (bob ? BOB_M * Math.sin(time * BOB_HZ * Math.PI * 2) : 0),
        z,
      );
      // The breath, and the swell it goes out on — one scale, so a marker taken
      // mid-breath still swells from wherever it happened to be.
      group.current.scale.setScalar(breathe * (1 + COLLECT_SWELL * (1 - t)));
    }

    // The pulse, on its own clock — see `PULSE`. Deeper than the breath and
    // faster, so the two never sit still together.
    // Close in, pull it right down — see `NEAR_FADE`.
    const near = THREE.MathUtils.clamp(
      camera.position.distanceTo(centre) / (radius * NEAR_FADE),
      NEAR_FLOOR,
      1,
    );
    const glow = t * near * (1 + PULSE * Math.sin(time * PULSE_HZ * Math.PI * 2));
    uniforms.uLit.value = glow;
    uniforms.uTime.value = time;
    if (halo.current) halo.current.opacity = glow;
    if (tagMat.current) tagMat.current.opacity = t;
  });

  return (
    <group ref={group} position={[position[0], position[1], position[2]]}>
      {/* The halo is drawn AFTER the body (`renderOrder`), so the glow sits over
          the ball rather than under it — otherwise which one lands on top is
          decided by a tie-break between two objects at the same distance. */}
      <mesh renderOrder={1}>
        <sphereGeometry args={[radius, 32, 24]} />
        {/* Keyed on the shader SOURCE — see the note on the beacon's materials
            in `training/RouteGuide.tsx`. Three.js compiles a program once and
            never reads the strings again, so without this an edited shader is
            swapped onto a material still running the program it was built with,
            and the marker keeps its old look until the app is restarted. */}
        <shaderMaterial
          key={ORB_FRAG}
          uniforms={uniforms}
          vertexShader={ORB_VERT}
          fragmentShader={ORB_FRAG}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <sprite renderOrder={2} scale={[radius * HALO_W, radius * HALO_W, 1]}>
        <spriteMaterial
          ref={halo}
          map={orbHalo()}
          transparent
          opacity={1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      {tag && (
        <sprite
          renderOrder={10}
          scale={[Math.max(1.8, radius * 1.3), Math.max(1.8, radius * 1.3), 1]}
        >
          <spriteMaterial
            ref={tagMat}
            map={orbTagTexture(tag)}
            transparent
            opacity={1}
            // Depth-TESTED, unlike the rest of the marker's chrome, and it costs
            // nothing: the ball and its halo both write no depth, so the number
            // still reads through the sphere it is sitting inside. What it will
            // not do any more is read through a BUILDING. Ignoring depth put a
            // legible route number on the face of the block that the checkpoint
            // was behind, which is the one place a pilot must not be told there
            // is a way through.
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}
