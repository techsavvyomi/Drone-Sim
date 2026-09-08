import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { useSimStore } from '../state/simStore';
import { useSettingsStore } from '../state/settingsStore';

// Bottom status strip. Confirms the IPC round-trip (app info comes from the main
// process) and mirrors a couple of live values.
export function StatusBar() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const fps = useSimStore((s) => s.fps);
  const perf = useSimStore((s) => s.perf);
  const graphics = useSettingsStore((s) => s.settings.graphics);

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
        <span className="dim">graphics:</span> {graphics}
        <span className="sep">|</span>
        <span className="dim">fps:</span> {fps}
        <span className="sep">|</span>
        {/* The three numbers that separate "this machine cannot draw this many
            pixels" from "this scene is too many draw calls". Only meaningful
            while a scene is mounted, so they stay out of the way until one is. */}
        <span className="dim">dpr:</span> {perf.dpr}
        <span className="sep">|</span>
        <span className="dim">calls:</span> {perf.calls}
        <span className="sep">|</span>
        <span className="dim">tris:</span>{' '}
        {perf.tris > 1000 ? `${Math.round(perf.tris / 1000)}k` : perf.tris}
      </span>
    </footer>
  );
}
