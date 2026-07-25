import { useUiStore, type Section } from '../state/uiStore';
import { usePilotStore } from '../state/pilotStore';
import {
  IconCap,
  IconChevron,
  IconDrone,
  IconGear,
  IconHome,
  IconMedal,
  IconTarget,
  IconTools,
} from './icons';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'fly', label: 'Free Flight', icon: <IconDrone /> },
  { id: 'practice', label: 'Practice', icon: <IconTarget /> },
  { id: 'training', label: 'Training', icon: <IconCap /> },
  { id: 'missions', label: 'Missions', icon: <IconMedal /> },
  { id: 'studio', label: 'Studio', icon: <IconTools /> },
  { id: 'settings', label: 'Settings', icon: <IconGear /> },
];

export function Sidebar({ compact = false }: { compact?: boolean }) {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const pilot = usePilotStore();

  const pct = Math.round((pilot.xp / pilot.xpNext) * 100);

  return (
    <nav className={`sidenav ${compact ? 'compact' : ''}`}>
      <ul className="nav-list">
        {NAV.map((item) => (
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
      <div className="pilot-card">
        <div className="pilot-avatar">🧑‍✈️</div>
        <div className="pilot-info">
          <b>{pilot.callsign}</b>
          <i>{pilot.rank}</i>
        </div>
        <div className="pilot-xp">
          <div className="pilot-xp-bar">
            <div className="pilot-xp-fill" style={{ width: `${pct}%` }} />
          </div>
          <span>
            {pilot.xp} / {pilot.xpNext} XP
          </span>
        </div>
      </div>

      )}

      {!compact && <span className="app-version">v0.1.0</span>}
    </nav>
  );
}
