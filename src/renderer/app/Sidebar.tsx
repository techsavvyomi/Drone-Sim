import { useUiStore, type Section } from '../state/uiStore';
import { usePilotStanding } from './pilotRank';
import { useAccountStore } from '../state/accountStore';
import {
  IconCap,
  IconChevron,
  IconDrone,
  IconGear,
  IconHome,
  IconMedal,
  IconTools,
  IconUser,
} from './icons';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'fly', label: 'Free Flight', icon: <IconDrone /> },
  { id: 'training', label: 'Training', icon: <IconCap /> },
  { id: 'missions', label: 'Missions', icon: <IconMedal /> },
  { id: 'studio', label: 'Studio', icon: <IconTools /> },
  { id: 'profile', label: 'Profile', icon: <IconUser /> },
  { id: 'settings', label: 'Settings', icon: <IconGear /> },
];

export function Sidebar({ compact = false }: { compact?: boolean }) {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const pilot = usePilotStanding();
  // Profiles only exist when this build has a backend.
  const profiles = useAccountStore((s) => s.status === 'signedIn');
  const nav = NAV.filter((item) => item.id !== 'profile' || profiles);

  const pct = pilot.next > 0 ? Math.round((pilot.current / pilot.next) * 100) : 0;

  return (
    <nav className={`sidenav ${compact ? 'compact' : ''}`}>
      <ul className="nav-list">
        {nav.map((item) => (
          <li key={item.id}>
            <button
              className={`nav-btn ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <span className="nav-ico">{item.icon}</span>
              <span className="nav-txt">{item.label}</span>
              {section === item.id && (
                <span className="nav-arrow">
                  <IconChevron size={16} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {!compact && (
      <button
        className={`pilot-card ${profiles ? 'is-link' : ''}`}
        onClick={profiles ? () => setSection('profile') : undefined}
        disabled={!profiles}
        title={profiles ? 'View your profile' : undefined}
      >
        <div className="pilot-avatar">🧑‍✈️</div>
        <div className="pilot-info">
          <b>{pilot.name}</b>
          <i>{pilot.rank}</i>
        </div>
        <div className="pilot-xp">
          <div className="pilot-xp-bar">
            <div className="pilot-xp-fill" style={{ width: `${pct}%` }} />
          </div>
          <span>
            {pilot.current} / {pilot.next} {pilot.unit}
          </span>
        </div>
      </button>

      )}

      {!compact && <span className="app-version">v0.1.0</span>}
    </nav>
  );
}
