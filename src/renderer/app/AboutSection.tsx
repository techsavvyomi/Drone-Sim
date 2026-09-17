import { useEffect, useMemo, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { useUiStore } from '../state/uiStore';

// About: the software and the machine it is running on, and a way to report a
// bug with those details already filled in. Everything is read from the running
// app; nothing here is hand-maintained.

const SUPPORT_EMAIL = 'support@plutodrones.com';

const PLATFORM_NAMES: Partial<Record<string, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** The GPU the 3D view is running on, as WebGL reports it. */
function graphicsRenderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'WebGL 2 unavailable';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name);
  } catch {
    return 'Unknown';
  }
}

function formatBuildDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The details, as label/value rows, in display order. */
export function aboutRows(info: AppInfo, gpu: string): [string, string][] {
  return [
    ['Software', 'PlutoSim'],
    ['Version', `v${info.version}`],
    ['Build', `${info.commit} (${info.packaged ? 'release' : 'development'})`],
    ['Built', formatBuildDate(info.builtAt)],
    ['Developed by', 'Drona Aviation'],
    ['Operating system', `${PLATFORM_NAMES[info.platform] ?? info.platform} ${info.osVersion}`],
    ['Architecture', info.arch],
    ['Graphics', gpu],
    ['Electron', info.electron],
    ['Chromium', info.chrome],
    ['Node.js', info.node],
  ];
}

/** The About page reached from the sidebar. */
export function AboutScreen() {
  return (
    <div className="section-body settings-shell">
      <button className="back-btn" onClick={() => useUiStore.getState().goBack()}>
        ‹ Back
      </button>
      <h1 className="section-title">About</h1>
      <div className="settings-pane">
        <AboutSection />
      </div>
    </div>
  );
}

/** The About content, shared by the About page and Settings → About. */
export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const gpu = useMemo(graphicsRenderer, []);

  useEffect(() => {
    void window.api.appInfo().then(setInfo);
  }, []);

  if (!info) return null;
  const rows = aboutRows(info, gpu);
  const details = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const reportBug = () => {
    const subject = `PlutoSim bug report (v${info.version}, build ${info.commit})`;
    const body = [
      'What happened:',
      '',
      '',
      'What you were doing (screen, mission or lesson):',
      '',
      '',
      '---',
      details,
    ].join('\n');
    void window.api.openExternal(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
  };

  return (
    <>
      <div className="about-card">
        {rows.map(([label, value]) => (
          <div className="about-row" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="about-actions">
        <button className="btn-sm" onClick={reportBug}>
          Report a bug
        </button>
        <button className="btn-sm ghost" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
      <p className="about-note">
        Report a bug opens an email to {SUPPORT_EMAIL} with these details filled in. Crashes are reported
        automatically.
      </p>
    </>
  );
}
