import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allSettled,
  currentEntry,
  labelFor,
  overallProgress,
  resetResourceTracking,
  trackModelLoads,
  useResourceStore,
} from '../src/renderer/assets/resourceTracker';

// The loading screen after sign-in: it must see every model the app preloads,
// move forward as bytes arrive and files are parsed, and finish even when a
// file fails. And the hooks behind it must be installed before the first model
// is requested, or a packaged build fetches its maps still encrypted.

type LoadCall = {
  url: string;
  onLoad?: (data: unknown) => void;
  onProgress?: (e: ProgressEvent) => void;
  onError?: (e: unknown) => void;
};

function fakeLoader() {
  const calls: LoadCall[] = [];
  const proto = {
    load(url: string, onLoad?: LoadCall['onLoad'], onProgress?: LoadCall['onProgress'], onError?: LoadCall['onError']) {
      calls.push({ url, onLoad, onProgress, onError });
    },
  };
  return { proto, calls };
}

const bytes = (loaded: number, total: number) => ({ lengthComputable: true, loaded, total }) as ProgressEvent;
const entries = () => useResourceStore.getState().entries;

beforeEach(() => resetResourceTracking());

describe('resource loading', () => {
  it('tracks each model from first byte to parsed, weighted by size', () => {
    const { proto, calls } = fakeLoader();
    trackModelLoads(proto as any);
    proto.load('assets/new_york_city.opt-DXjyYpP9.glb');
    proto.load('assets/PlutoX.opt-Cyvp7ImL.glb');

    expect(allSettled(entries())).toBe(false);
    expect(currentEntry(entries())?.label).toBe('New York City');

    calls[0].onProgress!(bytes(11, 22));
    calls[1].onProgress!(bytes(8, 8));
    // 22 MB city half fetched, 8 MB drone fully fetched, nothing parsed yet.
    expect(overallProgress(entries())).toBeCloseTo((22 * 0.85 * 0.5 + 8 * 0.85) / 30);

    calls[1].onLoad!({});
    calls[0].onProgress!(bytes(22, 22));
    calls[0].onLoad!({});
    expect(overallProgress(entries())).toBe(1);
    expect(allSettled(entries())).toBe(true);
    expect(currentEntry(entries())).toBeNull();
  });

  it('settles when a model fails, and still hands the error to the loader', () => {
    const { proto, calls } = fakeLoader();
    trackModelLoads(proto as any);
    let reported: unknown = null;
    proto.load('assets/forest.opt-B03dS8wW.glb', undefined, undefined, (e) => (reported = e));
    calls[0].onError!(new Error('bad file'));
    expect(allSettled(entries())).toBe(true);
    expect(entries()['assets/forest.opt-B03dS8wW.glb'].failed).toBe(true);
    expect(reported).toBeInstanceOf(Error);
  });

  it('does not count a model loaded a second time from cache', () => {
    const { proto, calls } = fakeLoader();
    trackModelLoads(proto as any);
    proto.load('assets/tiger-abc12345.glb');
    calls[0].onLoad!({});
    proto.load('assets/tiger-abc12345.glb');
    expect(allSettled(entries())).toBe(true);
    expect(Object.keys(entries())).toHaveLength(1);
  });

  it('names models the way a pilot would', () => {
    expect(labelFor('./assets/new_york_city.opt-DXjyYpP9.glb')).toBe('New York City');
    expect(labelFor('/src/assets/models/PlutoGuru.opt.glb?import')).toBe('Pluto Guru drone');
    expect(labelFor('assets/site_props.opt-BZqHwzu3.glb')).toBe('Construction site');
    expect(labelFor('assets/something_new-abcdefgh.glb')).toBe('something new');
  });

  it('is ready immediately when nothing is loading', () => {
    expect(allSettled({})).toBe(true);
    expect(overallProgress({})).toBe(1);
  });

  it('installs decryption and tracking before anything that loads a model', () => {
    const main = readFileSync(new URL('../src/renderer/main.tsx', import.meta.url), 'utf8');
    const firstImport = main.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import './assets/bootstrap';");
  });
});
