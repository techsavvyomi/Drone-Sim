import { useEffect, useState, useSyncExternalStore } from 'react';
import { devFpsEnabled, useShellStore } from '../state/shellStore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { getDrone, getEnvironment } from '../plugins/registry';
import { ButtonLegend, Icon, type LegendItem } from '../ds';
import { NAV } from './Sidebar';
import { ceilingFor, formatMetres } from './loadout';

const MENU_LEGEND: LegendItem[] = [
  { keys: ['↑↓←→'], pad: { label: 'L', shape: 'stick' }, action: 'Move' },
  { keys: ['Enter'], pad: { label: 'A', shape: 'face' }, action: 'Select' },
  { keys: ['Esc'], pad: { label: 'B', shape: 'face' }, action: 'Back' },
];

const WIDE = '(min-width: 1200px)';

/** True at the wide layout (≥ 1200 CSS px). */
export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const DEV_FPS = devFpsEnabled();

/** Frames the page actually drew in the last second. Counted here rather than
 *  read from the sim store, which only updates while a flight is running —
 *  in a menu it would read 0. */
function DevFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    const tick = () => {
      frames++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const every = window.setInterval(() => {
      setFps(frames);
      frames = 0;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(every);
    };
  }, []);
  return <span className="statusbar__fps">DEV · {fps} FPS</span>;
}

/**
 * Bottom strip of the shell. Left: where you are, plus anything the next flight
 * should know (the arena capping the ceiling). Right: the input legend — both
 * devices at the wide layout, only the last-used one below 1200 px.
 */
export function StatusBar() {
  const section = useUiStore((s) => s.section);
  const context = useShellStore((s) => s.context);
  const contextTag = useShellStore((s) => s.contextTag);
  const legendDevice = useShellStore((s) => s.legendDevice);
  const settings = useSettingsStore((s) => s.settings);
  const wide = useWide();
  const page = NAV.find((n) => n.id === section)?.label ?? '';
  const ceiling = ceilingFor(
    getDrone(settings.selectedDroneId),
    getEnvironment(settings.selectedEnvironmentId),
  );

  return (
    <footer className="statusbar" data-register="classroom">
      <p className="statusbar__where">
        <b>
          {page}
          {contextTag && ` · ${contextTag}`}
        </b>
        {context && <span>{context}</span>}
        {ceiling.cappedBy && (
          <span className="statusbar__note">
            <Icon name="warning" />
            {ceiling.cappedBy} caps the ceiling at {formatMetres(ceiling.metres)}
          </span>
        )}
      </p>
      <div className="statusbar__right">
        {DEV_FPS && <DevFps />}
        <ButtonLegend items={MENU_LEGEND} device={wide ? 'both' : legendDevice} />
      </div>
    </footer>
  );
}
