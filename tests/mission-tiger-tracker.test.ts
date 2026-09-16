import { describe, expect, it } from 'vitest';
import { tigerTracker } from '../src/renderer/missions/tigerTracker';
import { nightTracking } from '../src/renderer/missions/nightTracking';
import { MISSIONS } from '../src/renderer/missions';

// Mission 5 — Tiger Tracker is Mission 6 with the tiger on the map. These tests
// hold it to exactly that: one flag and the words that describe it.

const M = tigerTracker;

describe('Tiger Tracker', () => {
  it('is the fifth mission, between Logistics Drones and Wildlife Tracker', () => {
    expect(M.order).toBe(5);
    const ids = MISSIONS.map((m) => m.id);
    expect(ids.indexOf(M.id)).toBe(4);
    expect(ids.indexOf(nightTracking.id)).toBe(5);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows the tiger on the map, and Wildlife Tracker does not', () => {
    expect(M.tracking!.showOnMap).toBe(true);
    expect(nightTracking.tracking!.showOnMap).toBeFalsy();
  });

  it('flies exactly like Wildlife Tracker', () => {
    expect({ ...M.tracking!, showOnMap: undefined }).toEqual({
      ...nightTracking.tracking!,
      showOnMap: undefined,
    });
    expect(M.tracking!.routes).toBe(nightTracking.tracking!.routes);
    for (const key of [
      'kind',
      'envId',
      'hour',
      'timeLimitSec',
      'parTimeSec',
      'endsAtDrop',
      'strayRadius',
      'zones',
      'ranks',
      'clues',
      'flow',
      'route',
      'hideGuidanceUntilFound',
    ] as const) {
      expect(M[key]).toBe(nightTracking[key]);
    }
  });

  it('does not promise a search with nothing on the map', () => {
    const text = [...M.rules!, ...M.objectives, M.subtitle, M.mapNote].join(' ');
    expect(text).not.toMatch(/no marker|nothing on the (map|hud)/i);
    expect(text).toMatch(/red dot/i);
  });
});
