import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { targetMark, targetScreen } from './targetScreen';

// Scratch — one projection per frame, no allocation in it.
const _p = new THREE.Vector3();
const _cam = new THREE.Vector3();

/**
 * How far inside the canvas edge a clamped pointer rides, in pixels.
 *
 * It has to clear the pointer's own label rather than merely the arrow, or a
 * target directly overhead puts the distance readout half off the top of the
 * screen — which is the one direction this thing exists to handle.
 */
const EDGE = 64;

/**
 * Projects the mission's active mark to screen space every frame.
 *
 * Lives inside the Canvas because that is where the camera is, and writes to a
 * plain module singleton because the pointer moves with the camera — i.e. every
 * frame — and the mission HUD is a React tree published at 10 Hz.
 */
export function TargetPointer() {
  useFrame(({ camera, size }) => {
    if (!targetMark.active) {
      targetScreen.visible = false;
      targetScreen.frame++;
      return;
    }

    camera.getWorldPosition(_cam);
    _p.copy(targetMark.at);
    targetScreen.distance = _p.distanceTo(_cam);
    targetScreen.climb = _p.y - _cam.y;

    _p.project(camera);
    // `project` divides by w, and behind the camera w is negative: the point
    // comes back mirrored through the origin and a target directly behind the
    // pilot draws in front of them. Flipping it back makes the clamp below send
    // the chevron to the correct edge.
    const behind = _p.z > 1;
    if (behind) {
      _p.x = -_p.x;
      _p.y = -_p.y;
    }

    let x = (_p.x * 0.5 + 0.5) * size.width;
    let y = (-_p.y * 0.5 + 0.5) * size.height;

    const outside =
      behind || x < EDGE || x > size.width - EDGE || y < EDGE || y > size.height - EDGE;

    if (outside) {
      // Clamp along the line from the centre of the picture, so the chevron
      // stops where the target actually leaves the frame rather than in a
      // corner. The angle it is turned by is that same line — pointing at where
      // the mark is, off the edge.
      const cx = size.width / 2;
      const cy = size.height / 2;
      const dx = x - cx;
      let dy = y - cy;
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1;
      // Scale the ray down until it fits inside the edge band on both axes.
      const sx = Math.abs(dx) > 1e-3 ? (cx - EDGE) / Math.abs(dx) : Infinity;
      const sy = Math.abs(dy) > 1e-3 ? (cy - EDGE) / Math.abs(dy) : Infinity;
      const s = Math.min(sx, sy, 1);
      x = cx + dx * s;
      y = cy + dy * s;
      // 0 is up, and screen Y grows downward — hence the negated dy.
      targetScreen.angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    } else {
      targetScreen.angle = 0;
    }

    targetScreen.x = x;
    targetScreen.y = y;
    targetScreen.offscreen = outside;
    targetScreen.visible = true;
    targetScreen.frame++;
  });

  return null;
}
