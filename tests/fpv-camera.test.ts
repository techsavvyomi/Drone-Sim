import { describe, expect, it } from 'vitest';
import { FPV_HFOV_DEG, fpvVerticalFov } from '../src/renderer/scene/CameraRig';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { racingDrone } from '../src/renderer/plugins/drones/racer';

// FPV (2026-10-09): a 110-degree lens, and an uptilt that keeps the horizon in
// frame in a level hover. On the chase camera's 60-degree lens the 30-degree
// uptilt put the horizon on the bottom edge.

describe('FPV lens', () => {
  it('is 110 degrees across at any aspect', () => {
    expect(FPV_HFOV_DEG).toBe(110);
    for (const aspect of [16 / 9, 16 / 10, 4 / 3, 21 / 9]) {
      const v = fpvVerticalFov(aspect) * (Math.PI / 180);
      const h = 2 * Math.atan(Math.tan(v / 2) * aspect) * (180 / Math.PI);
      expect(h).toBeCloseTo(110, 6);
    }
    expect(fpvVerticalFov(16 / 9)).toBeCloseTo(77.6, 1);
  });

  it.each([plutoDrone, guruDrone, racingDrone])(
    '$id: the horizon is in the lower half, well clear of the edge, in a hover at 16:9',
    (spec) => {
      const half = fpvVerticalFov(16 / 9, spec.cameraMount.hfovDeg) / 2;
      const tilt = spec.cameraMount.tiltDeg;
      expect(tilt).toBeGreaterThan(0); // uptilt, as on a real FPV quad
      expect(half - tilt).toBeGreaterThanOrEqual(13);
    },
  );

  it('tilts more on the faster trainer', () => {
    expect(plutoDrone.cameraMount.tiltDeg).toBe(20);
    expect(guruDrone.cameraMount.tiltDeg).toBe(25);
  });

  // 2026-10-13: the racer's props sit beside its nose, so it flies a top-plate
  // HD cam on a wider lens to get them into the shot (see racer.ts).
  it('racer: near-level top cam on its own 130-degree lens', () => {
    expect(racingDrone.cameraMount.tiltDeg).toBe(5);
    expect(racingDrone.cameraMount.hfovDeg).toBe(130);
    const v = fpvVerticalFov(16 / 9, 130) * (Math.PI / 180);
    expect(2 * Math.atan(Math.tan(v / 2) * (16 / 9)) * (180 / Math.PI)).toBeCloseTo(130, 6);
  });
});
