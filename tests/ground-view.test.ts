import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { DroneSpec, EnvironmentSpec } from '../src/shared/types';
import {
  PILOT_EYE_HEIGHT,
  aimPitch,
  aimYaw,
  pilotAnchor,
  pilotStandoff,
  wrapAngle,
} from '../src/renderer/scene/groundView';

// The ground view's geometry: the pilot stands still at their own takeoff spot
// and only turns to keep the aircraft in sight. TC-217.

const pluto = { armLength: 0.08 } as DroneSpec;

function env(over: Partial<EnvironmentSpec> = {}): EnvironmentSpec {
  return {
    id: 'test',
    name: 'Test',
    kind: 'outdoor',
    spawn: { position: [0, 0.2, 0], heading: 0 },
    bounds: { min: [-50, 0, -50], max: [50, 60, 50] },
    ...over,
  };
}

/** Where a camera carrying these angles actually points. */
function forward(pitch: number, yaw: number): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

describe('the pilot stands back from their own pad', () => {
  it('stands behind the pad, at eye height', () => {
    const out = pilotAnchor(pluto, env(), new THREE.Vector3());
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(pilotStandoff(pluto), 6);
    expect(out.y).toBeCloseTo(0.2 + PILOT_EYE_HEIGHT, 6);
  });

  it('stands behind the spawn heading, not behind the world axis', () => {
    const out = pilotAnchor(
      pluto,
      env({ spawn: { position: [0, 0.2, 0], heading: 90 } }),
      new THREE.Vector3(),
    );
    expect(out.x).toBeCloseTo(pilotStandoff(pluto), 5);
    expect(out.z).toBeCloseTo(0, 5);
  });

  it('is pulled inside the room indoors, rather than into a wall', () => {
    const classroom = env({
      kind: 'indoor',
      spawn: { position: [0, 0.35, -3.2], heading: 180 },
      bounds: { min: [-4.15, 0, -5.15], max: [4.15, 2.97, 5.15] },
    });
    const out = pilotAnchor(pluto, classroom, new THREE.Vector3());
    expect(out.z).toBeGreaterThanOrEqual(-5.15 + 0.5);
    expect(out.y).toBeLessThanOrEqual(2.97 - 0.2);
  });

  it('keeps its distance sane across airframes', () => {
    expect(pilotStandoff({ armLength: 0.02 } as DroneSpec)).toBeGreaterThanOrEqual(2.5);
    expect(pilotStandoff({ armLength: 3 } as DroneSpec)).toBeLessThanOrEqual(9);
  });
});

describe('the pilot turns to face the drone', () => {
  it('points at the drone from any direction, including behind', () => {
    for (const dir of [
      new THREE.Vector3(0, 0, -12),
      new THREE.Vector3(0, 0, 12),
      new THREE.Vector3(30, 4, -7),
      new THREE.Vector3(-8, 25, 3),
    ]) {
      const aimed = forward(aimPitch(dir), aimYaw(dir));
      expect(aimed.angleTo(dir)).toBeLessThan(1e-6);
    }
  });

  it('looks straight up without rolling the horizon over', () => {
    const overhead = new THREE.Vector3(0, 40, 0);
    const pitch = aimPitch(overhead);
    expect(pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(Number.isNaN(aimYaw(overhead))).toBe(false);
  });

  it('turns the short way when the drone crosses behind the pilot', () => {
    // Just either side of due south: a naive difference is nearly a full turn.
    const step = wrapAngle(-Math.PI + 0.05 - (Math.PI - 0.05));
    expect(Math.abs(step)).toBeLessThan(0.2);
  });
});
