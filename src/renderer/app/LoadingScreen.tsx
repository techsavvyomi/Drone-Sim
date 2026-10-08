import { useEffect, useRef, useState } from 'react';
import {
  allSettled,
  overallProgress,
  useResourceStore,
  type ResourceEntry,
} from '../assets/resourceTracker';
import { Button, Icon, Progress } from '../ds';
import logoMark from '../../assets/brand/plutosim-mark.svg';

// "Preparing PlutoSim": the models and warm-up work the app does before its
// first menu, each on its own row as it arrives.
//
// Shown on the first launch only, before sign-in (see `resourcesPrepared` and
// App). Later launches load the same models behind the menu instead. It never
// blocks forever: a model that fails to load is shown as such, and after
// LOAD_LIMIT_MS the app opens anyway (the map that needs a missing model reports
// it when it is opened).
//
// The brief's version is "Preparing your flight" with a drone and an arena; on
// the first launch nothing has been chosen yet, so this one names the app.

const LOAD_LIMIT_MS = 90_000;
/** After this, a ▲ note says it is slow but still going. */
export const SLOW_AFTER_MS = 30_000;
const MB = 1048576;

/** True once every preloaded model has loaded (or failed), or time ran out. */
/** How long the first-launch screen stays up at the least. On a fast computer
 *  everything is loaded before the boot splash has gone, and the screen was up
 *  for half a second: too short to read, let alone press Next tip (the user,
 *  2026-10-01). */
export const LOADING_MIN_MS = 4000;

export function useResourcesReady(): boolean {
  const settled = useResourceStore((s) => allSettled(s.entries));
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => setTimedOut(true), LOAD_LIMIT_MS);
    return () => clearTimeout(t);
  }, [settled]);
  return settled || timedOut;
}

export type RowState = 'done' | 'loading' | 'waiting' | 'failed';

export interface LoadingRow {
  key: string;
  label: string;
  state: RowState;
  /** "12.4 MB", or null for warm-up work, which has no real size. */
  size: string | null;
}

export interface LoadingFigures {
  pct: number;
  /** Megabytes of model files arrived / known in all. Warm-up work is not files. */
  loadedMb: number;
  totalMb: number;
  rows: LoadingRow[];
  done: number;
  failed: number;
}

const isTask = (e: ResourceEntry) => e.url.startsWith('task:');

function sentence(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function mb(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
}

export function loadingFigures(entries: Record<string, ResourceEntry>): LoadingFigures {
  const all = Object.values(entries);
  // Warm-up tasks run one at a time: the first unfinished one is the one running.
  const runningTask = all.find((e) => isTask(e) && !e.done && !e.failed);
  let loaded = 0;
  let total = 0;
  const rows = all.map((e): LoadingRow => {
    if (!isTask(e)) {
      total += e.totalBytes;
      loaded += e.done ? e.totalBytes : Math.min(e.loadedBytes, e.totalBytes);
    }
    const state: RowState = e.failed
      ? 'failed'
      : e.done
        ? 'done'
        : (isTask(e) ? e === runningTask : e.loadedBytes > 0)
          ? 'loading'
          : 'waiting';
    return {
      key: e.url,
      label: sentence(e.label),
      state,
      size: isTask(e) || e.totalBytes === 0 ? null : mb(e.totalBytes),
    };
  });
  return {
    pct: Math.floor(overallProgress(entries) * 100),
    loadedMb: Math.round(loaded / MB),
    totalMb: Math.round(total / MB),
    rows,
    done: all.filter((e) => e.done).length,
    failed: all.filter((e) => e.failed).length,
  };
}

/**
 * "about 10 s left", from how long the part done so far took. Nothing until
 * there is enough to go on (5 % and 2 s), so the first guess is not wild.
 */
export function timeLeftText(progress: number, elapsedMs: number): string | null {
  if (progress >= 1) return null;
  if (progress < 0.05 || elapsedMs < 2000) return 'working out the time left';
  const left = (elapsedMs * (1 - progress)) / progress / 1000;
  if (left < 10) return 'a few seconds left';
  if (left < 90) return `about ${Math.round(left / 5) * 5} s left`;
  return `about ${Math.round(left / 60)} min left`;
}

export const TIPS: { title: string; text: string }[] = [
  {
    title: 'Arm, then take off',
    text: 'Press Enter to arm the motors, then Space to take off. Space again lands.',
  },
  {
    title: 'Small stick moves',
    text: 'W and S climb and sink, A and D turn. The arrow keys tilt the drone to move it.',
  },
  {
    title: 'Lost the drone?',
    text: 'C changes the camera, R puts the drone back on its start pad, and P pauses.',
  },
];

const GLYPH: Record<RowState, { icon: 'check' | 'dot' | 'ring' | 'cross'; word: string }> = {
  done: { icon: 'check', word: 'Done' },
  loading: { icon: 'dot', word: 'Loading' },
  waiting: { icon: 'ring', word: 'Waiting' },
  failed: { icon: 'cross', word: 'Failed' },
};

/** `checkingSignIn`: the launch check that this computer is still signed in is out. */
export function LoadingScreen({ checkingSignIn = false }: { checkingSignIn?: boolean }) {
  const entries = useResourceStore((s) => s.entries);
  const f = loadingFigures(entries);
  const started = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState(0);

  // A second's tick for the time left and the slow note; the store only moves
  // while bytes arrive.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - started.current;
  const left = timeLeftText(f.pct / 100, elapsed);
  const slow = elapsed >= SLOW_AFTER_MS && f.pct < 100;

  return (
    <div className="loading" data-register="classroom">
      <div className="loading__left">
        <div className="acct__brand">
          <img src={logoMark} alt="" />
          <span>
            <b>PlutoSim</b>
            <em>Flight Simulator by Drona Aviation</em>
          </span>
        </div>
        <div className="loading__visual" aria-hidden="true">
          <img src={logoMark} alt="" />
        </div>
      </div>

      <main className="loading__card" role="status" aria-live="polite">
        <span className="loading__eyebrow">First launch</span>
        <h1 className="loading__title">Preparing PlutoSim</h1>
        <p className="loading__sub">
          {f.rows.length} maps, drones and parts, made ready once so they open fast later.
        </p>

        <div className="loading__pct">
          <b>{f.pct}%</b>
          <span>
            {f.totalMb > 0
              ? `${f.loadedMb} of ${f.totalMb} MB`
              : `${f.done} of ${f.rows.length} items`}
            {left ? ` · ${left}` : ''}
          </span>
        </div>
        <Progress value={f.pct} max={100} label="Preparing PlutoSim" tone="neutral" />

        <ol className="loading__rows" aria-label="What is being prepared">
          {f.rows.map((r) => (
            <li key={r.key} className={`loading__row is-${r.state}`}>
              <span className="loading__glyph" aria-hidden="true">
                <Icon name={GLYPH[r.state].icon} />
              </span>
              <span className="loading__label">{r.label}</span>
              <span className="loading__state">
                {GLYPH[r.state].word}
                {r.size && r.state !== 'done' ? ` · ${r.size}` : ''}
              </span>
            </li>
          ))}
        </ol>

        {checkingSignIn && f.pct >= 100 && <p className="loading__sub">Checking your sign-in…</p>}
        {slow && (
          <div className="acct-banner acct-banner--caution loading__note">
            <Icon name="warning" />
            <span>
              <b>Slower than usual.</b>
              Loading carries on. A slower computer can need a minute or more the first time.
              PlutoSim opens by itself when this is done.
            </span>
          </div>
        )}

        <div className="loading__tip">
          <div className="loading__tip-head">
            <span className="ds-label">Pilot tip</span>
            <span className="loading__tip-count">
              {tip + 1} of {TIPS.length}
            </span>
            <Button
              variant="secondary"
              iconAfter="chevron"
              onClick={() => setTip((t) => (t + 1) % TIPS.length)}
            >
              Next tip
            </Button>
          </div>
          <b>{TIPS[tip].title}</b>
          <p>{TIPS[tip].text}</p>
        </div>
      </main>
    </div>
  );
}
