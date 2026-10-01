import { useEffect, useState } from 'react';
import logoMark from '../../assets/brand/plutosim-mark.svg';

// What the window shows while settings and the account are read from disk: the
// mark, the name, the version and one moving progress line. That read takes a
// few milliseconds, so App holds the splash for SPLASH_MIN_MS: without the hold
// it flashed past before anyone could read it (the user, 2026-10-01).

export const SPLASH_MIN_MS = 2000;

export function BootSplash() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(window.api?.appInfo?.())
      .then((info) => live && info?.version && setVersion(info.version))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="boot" data-register="classroom" role="status" aria-label="Starting PlutoSim">
      <div className="boot__brand">
        <img className="boot__mark" src={logoMark} alt="" />
        <b className="boot__name">PlutoSim</b>
        <span className="boot__tagline">Flight Simulator by Drona Aviation</span>
      </div>
      <div className="boot__line" aria-hidden="true">
        <span />
      </div>
      <span className="boot__version">{version ? `v${version}` : ' '}</span>
    </div>
  );
}
