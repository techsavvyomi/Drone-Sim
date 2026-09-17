import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useAccountStore } from '../state/accountStore';
import { getDrone, listDrones, listEnvironments } from '../plugins/registry';
import { ChipSelect, type SelectOption } from './ChipSelect';
import { IconArena, IconCeiling, IconDrone, IconGear, IconTarget, IconUser } from './icons';

/** Accent tints for option thumbnails, cycled by index. */
const TINTS = ['#3b82f6', '#22c55e', '#f5a524', '#a855f7', '#38bdf8'];

export function TopBar() {
  const { settings, set } = useSettingsStore();
  const setSection = useUiStore((s) => s.setSection);
  const drone = getDrone(settings.selectedDroneId);
  const profile = useAccountStore((s) => (s.status === 'signedIn' ? s.profile : null));

  // Options come straight from the plugin registries, so new drones and maps
  // appear in these menus with no UI changes.
  const droneOptions: SelectOption[] = listDrones().map((d, i) => ({
    id: d.id,
    name: d.name,
    meta: `${d.frame} · ${Math.round(d.mass * 1000)} g`,
    color: TINTS[i % TINTS.length],
    thumb: <IconDrone size={20} />,
  }));

  const envOptions: SelectOption[] = listEnvironments().map((e, i) => ({
    id: e.id,
    name: e.name,
    meta: e.kind === 'outdoor' ? 'Outdoor' : 'Indoor',
    color: TINTS[(i + 2) % TINTS.length],
    thumb: e.kind === 'outdoor' ? <IconTarget size={20} /> : <IconArena size={20} />,
  }));

  return (
    <header className="topbar">
      <button className="logo" onClick={() => setSection('home')}>
        <span className="logo-mark">
          <IconDrone size={34} />
        </span>
        <span className="logo-text">
          <b>
            Drone<i>SIM</i>
          </b>
          <em>
            Flight Simulator <span className="logo-by">by Drona Aviation</span>
          </em>
        </span>
      </button>

      <div className="topbar-right">
        {/* Signed in, the pilot's own chip takes the status pill's place, so
            the bar stays the width it was designed at. */}
        {profile ? (
          <button className="chip-user" onClick={() => setSection('profile')} title="Your profile">
            <span className="chip-icon">
              <IconUser size={20} />
            </span>
            <span className="chip-body">
              <i>Level {profile.level}</i>
              <b>{profile.name}</b>
            </span>
          </button>
        ) : (
          <div className="pill-connected">
            <span className="dot" />
            Connected
          </div>
        )}

        <div className="chip-group">
          <ChipSelect
            icon={<IconDrone size={20} />}
            label="Drone"
            value={settings.selectedDroneId}
            options={droneOptions}
            onSelect={(id) => set('selectedDroneId', id)}
          />
          <ChipSelect
            icon={<IconArena size={20} />}
            label="Arena"
            value={settings.selectedEnvironmentId}
            options={envOptions}
            onSelect={(id) => set('selectedEnvironmentId', id)}
          />
          <div className="chip chip-static">
            <span className="chip-icon">
              <IconCeiling size={20} />
            </span>
            <span className="chip-body">
              <i>Ceiling</i>
              <b>{drone?.maxAltitude ?? '-'} m</b>
            </span>
          </div>
          <button className="chip-gear" onClick={() => setSection('settings')} title="Settings">
            <IconGear size={22} />
          </button>
        </div>
      </div>
    </header>
  );
}
