import { useEffect, useMemo, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { Button, Panel } from '../ds';

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
    const name = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return withSoftwareFlag(String(name));
  } catch {
    return 'Unknown';
  }
}

/** Renderers that draw on the CPU: the GPU driver is blocklisted or missing. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render/i;

/**
 * Marks a software renderer, the one cause of "the sim lags on this laptop"
 * that a packaged build (no DevTools) cannot otherwise show.
 */
export function withSoftwareFlag(name: string): string {
  return SOFTWARE_RENDERER.test(name)
    ? `${name} (software, no GPU. Update the graphics driver)`
    : name;
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
  ];
}

/** The About page (sidebar 8): what build this is, the machine it runs on, and
 *  a way to report a bug with those details filled in. No PDF draws it; it is
 *  the Phase 0 panel and buttons in the classroom register. */
export function AboutScreen() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const gpu = useMemo(graphicsRenderer, []);

  useEffect(() => {
    void window.api.appInfo().then(setInfo);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const rows = info ? aboutRows(info, gpu) : [];
  const details = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const reportBug = () => {
    if (!info) return;
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
    <div className="settings about" data-register="classroom">
      <header className="settings__head">
        <h1 className="ds-h3">About</h1>
        <p className="ds-caption">PlutoSim · Flight Simulator by Drona Aviation</p>
      </header>
      {info && (
        <>
          <Panel title="This copy" meta={`v${info.version}`} className="about__panel">
            <dl className="about__rows">
              {rows.map(([label, value]) => (
                <div className="about__row" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <div className="settings__actions">
            <Button variant="primary" data-primary onClick={reportBug}>
              Report a bug
            </Button>
            <Button icon={copied ? 'check' : undefined} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy details'}
            </Button>
          </div>
          <p className="settings__note">
            Report a bug opens an email to {SUPPORT_EMAIL} with these details filled in. Crashes are
            reported automatically.
          </p>
        </>
      )}
    </div>
  );
}
