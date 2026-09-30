import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { resetFlight } from '../input/controls';
import { getDrone, getEnvironment, listDrones, listEnvironments } from '../plugins/registry';
import { Button } from '../ds';
import { LoadoutChip, type LoadoutOption } from './LoadoutChip';
import { IconArena, IconCeiling, IconDrone, IconTarget } from './icons';
import { arenaLine, ceilingFor, droneBuild, formatMass, formatMetres } from './loadout';
import logoMark from '../../assets/brand/plutosim-mark.svg';

/**
 * The shell's top bar: brand on the left; on the right the NEXT FLIGHT strip —
 * DRONE › ARENA › CEILING — ending in Fly, the shell's one action.
 *
 * The ceiling is a read-out, not a menu: the flight controller holds the
 * drone's own limit and an indoor arena's roof caps it (see loadout.ts).
 */
export function TopBar() {
  const settings = useSettingsStore((s) => s.settings);
  const set = useSettingsStore((s) => s.set);
  const setSection = useUiStore((s) => s.setSection);
  const drone = getDrone(settings.selectedDroneId);
  const env = getEnvironment(settings.selectedEnvironmentId);
  const ceiling = ceilingFor(drone, env);

  // The top bar is up in Free Flight only on the pause menu. Picking a new drone
  // or arena there is the answer to it: the card goes and the flight starts
  // over on the new loadout's pad. The same pick again leaves the pause alone.
  const pick = (key: 'selectedDroneId' | 'selectedEnvironmentId', id: string) => {
    if (id === settings[key]) return;
    set(key, id);
    if (useUiStore.getState().section === 'fly' && useFlightStore.getState().paused) resetFlight();
  };

  // Straight from the plugin registries, so a new drone or map appears here
  // with no UI change.
  const droneOptions: LoadoutOption[] = listDrones().map((d) => ({
    id: d.id,
    name: d.name,
    meta: formatMass(d.mass),
    // The mass is already beside the name.
    detail: droneBuild(d),
    thumb: <IconDrone size={22} />,
  }));
  const arenaOptions: LoadoutOption[] = listEnvironments().map((e) => ({
    id: e.id,
    name: e.name,
    detail: arenaLine(e),
    thumb: e.kind === 'outdoor' ? <IconTarget size={22} /> : <IconArena size={22} />,
  }));

  return (
    <header className="topbar" data-nav-region="topbar" data-register="classroom">
      {/* A pointer shortcut home. Out of the Tab order: the brief's order
          starts at the loadout chips, and Home is sidebar item 1 / key 1. */}
      <button
        type="button"
        className="topbar__brand"
        tabIndex={-1}
        aria-label="PlutoSim, home"
        onClick={() => setSection('home')}
      >
        <img className="topbar__mark" src={logoMark} alt="" />
        <span className="topbar__names">
          <b className="topbar__name">PlutoSim</b>
          <span className="topbar__tagline">Flight Simulator by Drona Aviation</span>
        </span>
      </button>

      <div className="topbar__loadout" data-loadout>
        <span className="topbar__next">Next flight</span>
        <LoadoutChip
          icon={<IconDrone size={20} />}
          label="Drone"
          value={settings.selectedDroneId}
          options={droneOptions}
          onSelect={(id) => pick('selectedDroneId', id)}
          blurb="Changes mass, thrust and handling. Sets the next flight."
        />
        <span className="topbar__sep" aria-hidden="true">
          ›
        </span>
        <LoadoutChip
          icon={<IconArena size={20} />}
          label="Arena"
          value={settings.selectedEnvironmentId}
          options={arenaOptions}
          onSelect={(id) => pick('selectedEnvironmentId', id)}
          blurb="Where the next free flight takes off."
        />
        <span className="topbar__sep" aria-hidden="true">
          ›
        </span>
        <div
          className="loadout-chip__button is-static"
          role="status"
          aria-label={`Ceiling: ${formatMetres(ceiling.metres)}${
            ceiling.cappedBy ? `, set by ${ceiling.cappedBy}` : ''
          }`}
        >
          <span className="loadout-chip__icon" aria-hidden="true">
            <IconCeiling size={20} />
          </span>
          <span className="loadout-chip__body" aria-hidden="true">
            <span className="loadout-chip__key">Ceiling</span>
            <span className="loadout-chip__value">{formatMetres(ceiling.metres)}</span>
          </span>
        </div>
        <Button
          variant="primary"
          iconAfter="play"
          data-loadout-stop
          onClick={() => setSection('fly')}
        >
          Fly
        </Button>
      </div>
    </header>
  );
}
