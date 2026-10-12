import { describe, expect, it } from 'vitest';
import { bounceVelocity, forgivingFlight } from '../src/renderer/sim/drone/forgiving';

// Acro + FPV (2026-10-09): no crash. A hit bounces the drone back off the
// surface; lying flipped rights it on the spot (Drone.tsx).

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

describe('forgivingFlight', () => {
  it('is Acro through the FPV camera only', () => {
    expect(forgivingFlight('acro', 'fpv')).toBe(true);
    expect(forgivingFlight('acro', 'chase')).toBe(false);
    expect(forgivingFlight('stabilize', 'fpv')).toBe(false);
    expect(forgivingFlight('altitude-hold', 'fpv')).toBe(false);
  });
});

describe('bounceVelocity', () => {
  it('sends a head-on hit back at 0.6 of its speed', () => {
    const out = bounceVelocity({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 1 });
    expect(out.z).toBeCloseTo(6, 9);
    expect(out.x).toBeCloseTo(0, 9);
  });

  it('does not care which way the normal points', () => {
    const a = bounceVelocity({ x: 3, y: 0, z: -10 }, { x: 0, y: 0, z: 1 });
    const b = bounceVelocity({ x: 3, y: 0, z: -10 }, { x: 0, y: 0, z: -1 });
    expect(a).toEqual(b);
  });

  it('keeps the speed along the surface on a glancing hit', () => {
    const out = bounceVelocity({ x: 8, y: 0, z: -2 }, { x: 0, y: 0, z: 1 });
    expect(out.x).toBeCloseTo(8, 9);
    expect(out.z).toBeCloseTo(1.2, 9);
  });

  it('always leaves the surface at least 1 m/s', () => {
    const n = { x: 1, y: 0, z: 0 };
    const out = bounceVelocity({ x: -0.3, y: 0, z: 0 }, n);
    expect(dot(out, n)).toBeCloseTo(1, 9);
  });

  it('reverses the velocity when there is no usable normal', () => {
    const out = bounceVelocity({ x: 0, y: 0, z: -5 }, null);
    expect(out.z).toBeCloseTo(3, 9);
    expect(bounceVelocity({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }).z).toBeCloseTo(1, 9);
  });
});
