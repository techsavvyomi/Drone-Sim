import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useShellStore } from '../state/shellStore';
import { listDrones } from '../plugins/registry';
import { Badge, Button, Icon } from '../ds';
import { isTextField } from '../input/menuNav';
import { HangarScene } from './HangarScene';
import { droneFacts, droneLine } from './loadout';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The Hangar: every drone on a turntable, with its real specs.
 *
 * Viewing a drone is a selection (✓, fill, weight), NOT the loadout — the
 * DRONE chip only changes on "Use for next flight". Q / E (LB / RB on a pad)
 * step through the drones. The turntable starts paused for reduced motion.
 */
export function Hangar() {
  const drones = useMemo(() => listDrones(), []);
  const loadoutId = useSettingsStore((s) => s.settings.selectedDroneId);
  const setSetting = useSettingsStore((s) => s.set);
  const setContext = useShellStore((s) => s.setContext);
  const [viewedId, setViewedId] = useState(loadoutId);
  const [paused, setPaused] = useState(reducedMotion);

  const index = Math.max(
    0,
    drones.findIndex((d) => d.id === viewedId),
  );
  const viewed = drones[index];
  const inLoadout = viewed?.id === loadoutId;

  useEffect(() => {
    if (viewed) setContext(`Drone ${index + 1} of ${drones.length} · ${viewed.name}`);
    return () => setContext('');
  }, [viewed, index, drones.length, setContext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(document.activeElement)) return;
      const step = e.code === 'KeyQ' ? -1 : e.code === 'KeyE' ? 1 : 0;
      if (!step || drones.length === 0) return;
      e.preventDefault();
      setViewedId((id) => {
        const at = drones.findIndex((d) => d.id === id);
        return drones[(at + step + drones.length) % drones.length].id;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drones]);

  if (!viewed) return null;

  return (
    <div className="hangar" data-register="classroom">
      <header className="hangar__head">
        <h1 className="ds-h3">Hangar</h1>
        <p className="ds-caption">{drones.length} drones · Q E or LB RB to step through them</p>
      </header>

      <div className="hangar__body">
        <ul className="hangar__list" aria-label="Drones">
          {drones.map((d) => {
            const on = d.id === viewed.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={on ? 'hangar__drone is-viewed' : 'hangar__drone'}
                  aria-pressed={on}
                  data-primary={on && inLoadout ? true : undefined}
                  onClick={() => setViewedId(d.id)}
                >
                  <span className="hangar__drone-name">
                    {on && <Icon name="check" />}
                    {d.name}
                  </span>
                  <span className="hangar__drone-line">{droneLine(d)}</span>
                  {d.id === loadoutId && <span className="hangar__drone-tag">In your loadout</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <section className="hangar__stage" aria-label={`${viewed.name} on the turntable`}>
          <HangarScene spec={viewed} paused={paused} />
          <p className="hangar__count ds-label">
            Drone {index + 1} of {drones.length}
          </p>
          <Button
            variant="ghost"
            icon={paused ? 'play' : 'pause'}
            className="hangar__pause"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Turn' : 'Pause'}
          </Button>
        </section>

        <aside className="hangar__card" aria-label={`${viewed.name} specifications`}>
          <h2 className="ds-h4">{viewed.name}</h2>
          <dl className="hangar__facts">
            {droneFacts(viewed).map((f) => (
              <div key={f.label} className="hangar__fact">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {inLoadout ? (
            <Badge tone="armed" icon="check">
              Set for next flight
            </Badge>
          ) : (
            <Button
              variant="primary"
              data-primary
              onClick={() => setSetting('selectedDroneId', viewed.id)}
            >
              Use for next flight
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
