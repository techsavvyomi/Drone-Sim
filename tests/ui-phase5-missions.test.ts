// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/renderer/missions';
import { registerEnvironment } from '../src/renderer/plugins/registry';
import { newYork } from '../src/renderer/plugins/environments/newYork';
import { forest } from '../src/renderer/plugins/environments/forest';
import { constructionSite } from '../src/renderer/plugins/environments/constructionSite';
import { supermarket } from '../src/renderer/plugins/environments/supermarket';
import {
  failFix,
  jobLabel,
  mapBlocksWord,
  payloadName,
  reachableRank,
  rowMeta,
} from '../src/renderer/app/missionFacts';
import { MissionPicture, mapNameOf } from '../src/renderer/hud/MissionPicture';
import { missionImage } from '../src/renderer/hud/MissionArt';
import { maxPointsOf } from '../src/renderer/missions/types';
import type { FailReason } from '../src/renderer/state/missionStore';

// Phase 5 — Pluto Field Ops, the parts the mission-screens suite does not name:
// what each mission carries and is asked to do, the list row's second line, the
// map legend's word, the star still in reach, the failure card's one fix, and
// the picture every row and briefing shows.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const e of [newYork, forest, constructionSite, supermarket]) registerEnvironment(e);
});

const each = MISSIONS.map((m, i) => [`${i + 1} ${m.name}`, m] as const);

describe('what a mission is', () => {
  it.each(each)('%s: a payload, a job, a map and a row line built from them', (_n, m) => {
    const payload = payloadName(m);
    expect(payload.length).toBeGreaterThan(2);
    expect(jobLabel(m).length).toBeGreaterThan(5);
    const map = mapNameOf(m);
    expect(map).not.toBe(m.envId); // a real, registered arena name
    const meta = rowMeta(m, map);
    expect(meta.startsWith(`${map} · ${payload} · `)).toBe(true);
    // One pluraliser: "1 delivery", never "1 deliveries".
    expect(meta).not.toMatch(/\b1 \w+ies\b/);
  });

  it('the map legend names what the grey blocks are on each map', () => {
    expect(mapBlocksWord('new-york')).toBe('Buildings');
    expect(mapBlocksWord('forest')).toBe('Trees');
    expect(mapBlocksWord('construction-site')).toBe('Structures');
    expect(mapBlocksWord('supermarket')).toBe('Store and shelves');
  });
});

describe('the star still in reach', () => {
  it.each(each)('%s: at the start, clean, the top rung is reachable; after the limit only lower ones', (_n, m) => {
    // The same full score the store starts every attempt with.
    const max = maxPointsOf(m);
    const start = reachableRank(m, max, 0, 0);
    expect(start?.stars).toBe(3);
    const late = reachableRank(m, max, m.timeLimitSec * 2, 5);
    expect(late === null || late.stars < 3).toBe(true);
  });
});

describe('failure fix line', () => {
  const reasons: (FailReason | null)[] = ['crash', 'timeout', 'strayed', 'payload', 'disturbed', null];
  it.each(each)('%s: every reason has one sentence that says what to do', (_n, m) => {
    for (const r of reasons) {
      for (const carrying of [false, true]) {
        const line = failFix(m, r, carrying);
        expect(line.length).toBeGreaterThan(20);
        expect(line.trim().endsWith('.')).toBe(true);
      }
    }
  });
});

describe('mission pictures', () => {
  it.each(each)('%s: a hero or a first step picture, or the drawn scene', (_n, m) => {
    const src = missionImage(m.id, 'hero') ?? missionImage(m.id, 1);
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(h(MissionPicture, { mission: m })));
    if (src) expect(host.querySelector('img')?.getAttribute('src')).toBe(src);
    else expect(host.querySelector('svg')).not.toBeNull();
    act(() => root.unmount());
  });

  it('unknown slots have no picture', () => {
    expect(missionImage('no-such-mission', 'hero')).toBeUndefined();
    expect(missionImage(MISSIONS[0].id, 99)).toBeUndefined();
  });
});
