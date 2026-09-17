import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { useSimStore } from '../state/simStore';

// Bottom status strip. Confirms the IPC round-trip (app info comes from the main
// process) and the live frame rate.
export function StatusBar() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const fps = useSimStore((s) => s.fps);

  useEffect(() => {
    void window.api.appInfo().then(setInfo);
  }, []);

  return (
    <footer className="statusbar">
      <span>
        {info ? `${info.name} v${info.version}` : 'loading…'}
        {info && (
          <span className="dim">
            {' '}
            · Electron {info.electron} · {info.platform}
          </span>
        )}
      </span>
      <span className="statusbar-right">
        <span className="dim">fps:</span> {fps}
      </span>
    </footer>
  );
}
