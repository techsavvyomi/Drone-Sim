// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@shared/backend/contract';
import {
  BANNER_TITLE,
  ERROR_TEXT,
  KEY_LENGTH,
  KEY_PREFIX,
  NEVER_IN_KEYS,
  errorPlace,
  fullKey,
  keyNote,
  parseKeyInput,
} from '../src/renderer/app/activationKey';
import { TYPE_LABEL, formatNumber, sessionTitle } from '../src/renderer/app/profileFacts';
import { useResourcesReady } from '../src/renderer/app/LoadingScreen';
import { useResourceStore, type ResourceEntry } from '../src/renderer/assets/resourceTracker';

// Phase 2 — launch, sign-in and profile, the parts the account-screens suite
// does not cover: the key's shape end to end, every banner error having a title
// and a fix, the history table's titles and numbers, and the loading screen's
// "never blocks forever".

describe('activation key shape', () => {
  it('PLUTO-SIM- then 8 characters, dash after 4', () => {
    expect(KEY_PREFIX).toBe('PLUTO-SIM-');
    expect(KEY_LENGTH).toBe(8);
    expect(fullKey('7KQ4M2XA')).toBe('PLUTO-SIM-7KQ4-M2XA');
  });

  it('a pasted full key, in any case and spacing, round-trips to the same key', () => {
    for (const raw of ['PLUTO-SIM-7KQ4-M2XA', 'pluto-sim-7kq4-m2xa', ' PLUTO SIM 7KQ4 M2XA ', '7kq4m2xa']) {
      const k = parseKeyInput(raw);
      expect(k.complete).toBe(true);
      expect(k.display).toBe('7KQ4-M2XA');
      expect(fullKey(k.body)).toBe('PLUTO-SIM-7KQ4-M2XA');
      expect(keyNote(k)).toBeNull();
    }
  });

  it('counts up while typing and completes at 8', () => {
    expect(parseKeyInput('7KQ').display).toBe('7KQ');
    expect(parseKeyInput('7KQ4M').display).toBe('7KQ4-M');
    expect(parseKeyInput('7KQ4M2X').complete).toBe(false);
  });

  it('every character keys never use is flagged ▲, and none is rewritten', () => {
    for (const ch of NEVER_IN_KEYS) {
      const k = parseKeyInput(`AB${ch}DEFGH`);
      expect(k.body).toBe(`AB${ch}DEFGH`);
      expect(k.unusual).toEqual([ch]);
      expect(keyNote(k)).toContain(ch);
    }
  });

  it('symbols are removed and named; too many characters are cut and said so', () => {
    const sym = parseKeyInput('7KQ4#M2*XA');
    expect(sym.body).toBe('7KQ4M2XA');
    expect(keyNote(sym)).toBe('Removed # *. Keys use only letters and numbers.');
    const long = parseKeyInput('7KQ4M2XAZZ');
    expect(long.overflow).toBe(true);
    expect(long.body).toHaveLength(8);
    expect(keyNote(long)).toContain('The rest were left out');
  });
});

describe('where an error is reported', () => {
  it('every banner and offline error has a title and a fix that names what to do', () => {
    for (const code of Object.keys(ERROR_TEXT) as (keyof typeof ERROR_TEXT)[]) {
      const place = errorPlace(code);
      expect(ERROR_TEXT[code]!.length).toBeGreaterThan(10);
      if (place === 'banner' || place === 'offline') expect(BANNER_TITLE[code]).toBeTruthy();
    }
  });

  it('key problems sit on the key field; a taken email on the email; offline is its own', () => {
    expect(errorPlace('KEY_NOT_FOUND')).toBe('key');
    expect(errorPlace('INVALID_CREDENTIALS')).toBe('key');
    expect(errorPlace('EMAIL_ALREADY_REGISTERED')).toBe('email');
    expect(errorPlace('NETWORK')).toBe('offline');
    expect(errorPlace('DEVICE_MISMATCH')).toBe('banner');
  });
});

describe('profile history', () => {
  const s = (over: Partial<SessionSummary>): SessionSummary =>
    ({
      sessionId: 's',
      date: '2026-09-29',
      startTime: '10:00',
      flightType: 'FREE_FLIGHT',
      missionId: '',
      missionName: '',
      trainingId: '',
      trainingName: '',
      droneId: 'pluto',
      droneName: 'Pluto',
      duration: 60,
      flightTime: 50,
      score: 0,
      stars: 0,
      pointsEarned: 0,
      result: 'SUCCESS',
      crashCount: 0,
      ...over,
    }) as SessionSummary;

  it('a row is named by its mission or lesson, falling back to the id', () => {
    expect(sessionTitle(s({ flightType: 'MISSION', missionId: 'forest-fire', missionName: 'Forest Fire' }))).toBe('Forest Fire');
    expect(sessionTitle(s({ flightType: 'MISSION', missionId: 'forest-fire' }))).toBe('forest-fire');
    expect(sessionTitle(s({ flightType: 'TRAINING', trainingId: 'yaw', trainingName: 'Yaw Control' }))).toBe('Yaw Control');
    expect(sessionTitle(s({}))).toBe('Free flight');
  });

  it('every flight type has a label', () => {
    expect(TYPE_LABEL).toEqual({ MISSION: 'Mission', TRAINING: 'Lesson', FREE_FLIGHT: 'Free flight' });
  });

  it('numbers are whole and grouped: 1,640', () => {
    expect(formatNumber(1640)).toBe('1,640');
    expect(formatNumber(859.6)).toBe('860');
    expect(formatNumber(0)).toBe('0');
  });
});

describe('loading never blocks forever', () => {
  let root: Root | undefined;
  let host: HTMLElement | undefined;
  let ready: boolean[] = [];
  function Probe() {
    ready.push(useResourcesReady());
    return null;
  }
  const entry = (done: boolean, failed = false): ResourceEntry => ({
    url: 'm.glb',
    label: 'Model',
    loadedBytes: 0,
    totalBytes: 10,
    done,
    failed,
  });

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    ready = [];
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.useRealTimers();
    useResourceStore.setState({ entries: {} });
  });

  it('ready once every model has settled — loaded or failed', () => {
    useResourceStore.setState({ entries: { a: entry(false) } });
    act(() => root!.render(h(Probe)));
    expect(ready.at(-1)).toBe(false);
    act(() => useResourceStore.setState({ entries: { a: entry(true, true) } }));
    expect(ready.at(-1)).toBe(true);
  });

  it('a model that never answers is given 90 s, then the app opens anyway', () => {
    useResourceStore.setState({ entries: { a: entry(false) } });
    act(() => root!.render(h(Probe)));
    act(() => {
      vi.advanceTimersByTime(89_000);
    });
    expect(ready.at(-1)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(ready.at(-1)).toBe(true);
  });
});
