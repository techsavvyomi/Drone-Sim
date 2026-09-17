import { useEffect, useState } from 'react';
import {
  allSettled,
  currentEntry,
  overallProgress,
  useResourceStore,
} from '../assets/resourceTracker';
import logoMark from '../../assets/brand/plutosim-logo-mark.webp';

// "Loading resources": the models the app preloads, shown as they arrive.
//
// Loading starts the moment the app opens, so by the time someone has typed
// their email and key most of it is often done, and a returning pilot sees this
// only for the seconds it actually takes. It never blocks forever: a model that
// fails to load is shown as such, and after LOAD_LIMIT_MS the app opens anyway
// (the map that needs a missing model reports it when it is opened).

const LOAD_LIMIT_MS = 90_000;
const SEGMENTS = 32;

/** True once every preloaded model has loaded (or failed), or time ran out. */
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

export function LoadingScreen() {
  const entries = useResourceStore((s) => s.entries);
  const progress = overallProgress(entries);
  const current = currentEntry(entries);
  const all = Object.values(entries);
  const done = all.filter((e) => e.done).length;
  const failed = all.filter((e) => e.failed).length;
  const pct = Math.floor(progress * 100);
  const lit = Math.floor(progress * SEGMENTS);

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-grid" aria-hidden="true" />
      <div className="loading-center">
        <img className="loading-logo" src={logoMark} alt="" />
        <h1 className="loading-title">
          Pluto<i>Sim</i>
        </h1>
      </div>

      <div className="loading-footer">
        <div className="loading-row">
          <span className="loading-label">Loading resources</span>
          <span className="loading-pct">{pct}%</span>
        </div>
        <div
          className="loading-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Loading resources"
        >
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className={i < lit ? 'on' : ''} />
          ))}
        </div>
        <div className="loading-row loading-detail">
          <span>{current ? `Preparing ${current.label}…` : 'Ready'}</span>
          <span>
            {done} / {all.length}
            {failed > 0 ? ` · ${failed} failed` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
