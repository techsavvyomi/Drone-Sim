import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';

// ----------------------------------------------------------------------------
// The sun, and the box its shadows live in.
//
// A directional light has no position — only a direction — but its SHADOW does:
// three renders the shadow map through an orthographic camera pointed along the
// light, and that camera covers a finite box centred on the light's target.
// Anything outside the box casts nothing at all.
//
// The box used to be ±38 m around the world origin, with the light declared
// statically and no target — and `Object3D.target` defaults to an object at
// (0, 0, 0). The forest's play area is 260 x 215 m and the city's is larger
// again, so on every outdoor map the shadows simply STOPPED about forty metres
// from the spawn pad: fly out and the drone's own shadow, and every tree's,
// blinked out with nothing on screen to explain it. That is the "the shadow
// disappears in some places" report, and it is not "some places" so much as
// "everywhere except where you took off".
//
// The box now follows the aircraft, so the forty metres of coverage are always
// the forty metres the pilot is looking at. Nothing about the LIGHTING changes:
// a directional light is defined by the direction from its position to its
// target, and both move together, so the direction is exactly what it was.
//
// ---- Why the snapping ------------------------------------------------------
//
// Moving a shadow camera by arbitrary sub-texel amounts makes every shadow edge
// in the frame crawl and shimmer as the drone translates, which is worse than
// no shadow at all and is the classic reason a naive "follow the player" is
// abandoned. The centre is therefore quantised to whole shadow-map texels along
// the camera's own axes: the map still moves, but its texel grid is stationary
// in the world, so an edge samples the same texels from frame to frame.
// ----------------------------------------------------------------------------

/** Half the shadow box, metres. The coverage radius around the aircraft. */
const HALF = 38;

/**
 * How far back along the sun the light is placed, metres.
 *
 * It sets nothing but the shadow camera's near plane — an orthographic caster
 * is parallel, so distance does not change the direction or the softness. It
 * has to clear the tallest thing that can stand between the sun and the
 * aircraft, which on the forest map is a 34 m canopy on ground that rises well
 * above the clearing.
 */
const DIST = 120;

/** World up, for the shadow camera's basis. Module scope: nothing allocates in
 *  the frame loop. */
const UP = new THREE.Vector3(0, 1, 0);
/** Fallback up, for the degenerate case of a sun directly overhead. */
const UP_ALT = new THREE.Vector3(0, 0, 1);

const _dir = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _centre = new THREE.Vector3();

export function SunLight({
  sun,
  intensity,
  color,
  shadows,
  shadowMap,
}: {
  /** The preset's sun POSITION, which is read here only as a direction. */
  sun: readonly [number, number, number];
  intensity: number;
  color: string;
  shadows: boolean;
  /** Shadow map resolution, one side. */
  shadowMap: number;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);

  /** Unit vector from the ground towards the sun. */
  const dir = useMemo(() => new THREE.Vector3(sun[0], sun[1], sun[2]).normalize(), [sun]);

  useEffect(() => {
    // The target has to be in the scene graph for three to read its world
    // matrix; it is a sibling below, and this only pairs them.
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(() => {
    const l = light.current;
    const t = target.current;
    if (!l || !t) return;

    // Before the aircraft exists there is nothing to centre on. The light still
    // has to point somewhere sensible, so it falls back to the origin — which
    // is where the pad is, and where the scene is first seen from.
    if (dronePose.present) _centre.copy(dronePose.position);
    else _centre.set(0, 0, 0);

    if (shadows) {
      // The shadow camera's own axes: z along the light, x and y across it.
      _dir.copy(dir);
      _x.crossVectors(Math.abs(_dir.y) > 0.999 ? UP_ALT : UP, _dir).normalize();
      _y.crossVectors(_dir, _x).normalize();

      // Quantise the centre to whole texels on those two axes — see the note
      // above on crawling edges. The map is 2*HALF metres across `shadowMap`
      // texels, so this is the width of one of them.
      const texel = (2 * HALF) / shadowMap;
      const px = _centre.dot(_x);
      const py = _centre.dot(_y);
      _centre.addScaledVector(_x, Math.round(px / texel) * texel - px);
      _centre.addScaledVector(_y, Math.round(py / texel) * texel - py);
    }

    t.position.copy(_centre);
    l.position.copy(_centre).addScaledVector(dir, DIST);
  });

  return (
    <>
      <directionalLight
        ref={light}
        intensity={intensity}
        color={color}
        castShadow={shadows}
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-camera-left={-HALF}
        shadow-camera-right={HALF}
        shadow-camera-top={HALF}
        shadow-camera-bottom={-HALF}
        shadow-camera-near={0.5}
        /* Far enough to reach past the aircraft and onto the ground under it:
           the light stands DIST back, and the deepest terrain on any map is
           another seventy metres below the pad. */
        shadow-camera-far={DIST + 140}
      />
      <object3D ref={target} />
    </>
  );
}
