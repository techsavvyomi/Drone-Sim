import { create } from 'zustand';
import { GLTFLoader } from 'three-stdlib';

// Progress of the 3D models the app preloads at startup.
//
// Every model is loaded by three-stdlib's GLTFLoader (drei's useGLTF uses it,
// preloads included), so hooking its `load` once sees them all: each file's
// bytes as they arrive, and the moment it has been decrypted and parsed. The
// loading screen after sign-in reads this; nothing has to register a model.

export interface ResourceEntry {
  url: string;
  label: string;
  loadedBytes: number;
  totalBytes: number;
  done: boolean;
  failed: boolean;
}

interface ResourceState {
  entries: Record<string, ResourceEntry>;
}

export const useResourceStore = create<ResourceState>(() => ({ entries: {} }));

const LABELS: [RegExp, string][] = [
  [/new_york/i, 'New York City'],
  [/forest/i, 'Forest'],
  [/classroom/i, 'Classroom'],
  [/site_props/i, 'Construction site'],
  [/tiger/i, 'Wildlife'],
  [/plutoguru|pluto guru/i, 'Pluto Guru drone'],
  [/plutox/i, 'Pluto X drone'],
  [/racing/i, 'Racing drone'],
];

/** "assets/new_york_city.opt-DXjyYpP9.glb" -> "New York City" */
export function labelFor(url: string): string {
  const file = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? url);
  for (const [pattern, label] of LABELS) if (pattern.test(file)) return label;
  return file.replace(/(\.opt)?(-[A-Za-z0-9_-]{8})?\.glb$/i, '').replace(/[_-]+/g, ' ');
}

/** Weight given to a file whose size is not known yet. */
const UNKNOWN_BYTES = 2 * 1048576;
/** Share of a file's progress that is download/decrypt; the rest is parsing. */
const FETCH_SHARE = 0.85;

/** Overall progress 0..1, weighted by file size. */
export function overallProgress(entries: Record<string, ResourceEntry>): number {
  let weight = 0;
  let done = 0;
  for (const e of Object.values(entries)) {
    const w = e.totalBytes > 0 ? e.totalBytes : UNKNOWN_BYTES;
    weight += w;
    if (e.done || e.failed) done += w;
    else if (e.totalBytes > 0) done += w * FETCH_SHARE * Math.min(1, e.loadedBytes / e.totalBytes);
  }
  return weight === 0 ? 1 : done / weight;
}

export function allSettled(entries: Record<string, ResourceEntry>): boolean {
  return Object.values(entries).every((e) => e.done || e.failed);
}

/** The first model still loading, for "Loading New York City…". */
export function currentEntry(entries: Record<string, ResourceEntry>): ResourceEntry | null {
  return Object.values(entries).find((e) => !e.done && !e.failed) ?? null;
}

function patch(url: string, change: Partial<ResourceEntry>): void {
  useResourceStore.setState((s) => {
    const prev = s.entries[url];
    if (!prev) return s;
    return { entries: { ...s.entries, [url]: { ...prev, ...change } } };
  });
}

let installed = false;

type LoadFn = (
  url: string,
  onLoad?: (data: unknown) => void,
  onProgress?: (event: ProgressEvent) => void,
  onError?: (error: unknown) => void,
) => void;

/**
 * Start tracking. Must run before any model starts loading, which is why it is
 * called from assets/bootstrap.ts, the first import of the renderer.
 */
export function trackModelLoads(loaderProto: { load: LoadFn } = GLTFLoader.prototype as unknown as { load: LoadFn }): void {
  if (installed) return;
  installed = true;
  const original = loaderProto.load;

  loaderProto.load = function (url, onLoad, onProgress, onError) {
    const existing = useResourceStore.getState().entries[url];
    // A model already loaded is served from cache; it does not count again.
    if (!existing || existing.failed) {
      useResourceStore.setState((s) => ({
        entries: {
          ...s.entries,
          [url]: { url, label: labelFor(url), loadedBytes: 0, totalBytes: 0, done: false, failed: false },
        },
      }));
    }
    return original.call(
      this,
      url,
      (data) => {
        patch(url, { done: true });
        onLoad?.(data);
      },
      (event) => {
        if (event.lengthComputable) patch(url, { loadedBytes: event.loaded, totalBytes: event.total });
        onProgress?.(event);
      },
      (error) => {
        patch(url, { failed: true });
        onError?.(error);
      },
    );
  };
}

/** Test hook: forget everything tracked. */
export function resetResourceTracking(): void {
  installed = false;
  useResourceStore.setState({ entries: {} });
}
