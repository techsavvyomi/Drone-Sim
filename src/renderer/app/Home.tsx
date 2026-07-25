import { useUiStore, type Section } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { getDrone } from '../plugins/registry';
import { usePilotStore } from '../state/pilotStore';
import { ArenaShowcase } from '../scene/ArenaShowcase';
import { IconChevron, IconDrone, IconMedal, IconSignal, IconTarget, IconCap } from './icons';

/** Compact pilot/progression badge shown in the menu's bottom-left corner. */
function PilotBadge() {
  const pilot = usePilotStore();
  const pct = Math.round((pilot.xp / pilot.xpNext) * 100);

  return (
    <div className="pilot-badge">
      <span className="pilot-badge-avatar">🧑‍✈️</span>
      <span className="pilot-badge-main">
        <b>{pilot.callsign}</b>
        <i>{pilot.rank}</i>
        <span className="pilot-badge-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="pilot-badge-xp">
        {pilot.xp} / {pilot.xpNext} XP
      </span>
    </div>
  );
}

interface ModeCard {
  id: string;
  title: string;
  lines: [string, string];
  cta: string;
  icon: React.ReactNode;
  target: Section;
  accent: string;
}

const CARDS: ModeCard[] = [
  {
    id: 'free-flight',
    title: 'Free Flight',
    lines: ['Fly without limits.', 'Explore and enjoy.'],
    cta: "Let's Fly",
    icon: <IconDrone size={34} />,
    target: 'fly',
    accent: '#3b82f6',
  },
  {
    id: 'practice',
    title: 'Practice',
    lines: ['Master your skills with', 'guided drills.'],
    cta: 'Start Practice',
    icon: <IconTarget size={34} />,
    target: 'practice',
    accent: '#22c55e',
  },
  {
    id: 'training',
    title: 'Training',
    lines: ['Learn step by step.', 'From basics to pro.'],
    cta: 'Start Training',
    icon: <IconCap size={34} />,
    target: 'training',
    accent: '#f5a524',
  },
  {
    id: 'missions',
    title: 'Missions',
    lines: ['Complete challenges.', 'Unlock achievements.'],
    cta: 'View Missions',
    icon: <IconMedal size={34} />,
    target: 'missions',
    accent: '#a855f7',
  },
];

export function Home() {
  const setSection = useUiStore((s) => s.setSection);
  const droneId = useSettingsStore((s) => s.settings.selectedDroneId);
  const drone = getDrone(droneId);

  return (
    <div className="home">
      {/* Live racing arena behind the menu */}
      {drone && <ArenaShowcase spec={drone} />}
      <div className="home-fade" />

      <div className="home-inner">
        <header className="home-hero">
          <h1>
            Ready to
            <br />
            <span>Take Off?</span>
          </h1>
          <span className="hero-rule" />
          <p>Choose your mode and start flying.</p>
        </header>

        <div className="mode-row">
          {CARDS.map((c) => (
            <button
              key={c.id}
              className="mcard"
              style={{ ['--accent' as string]: c.accent }}
              onClick={() => setSection(c.target)}
            >
              <span className="mcard-ico">{c.icon}</span>
              <span className="mcard-title">{c.title}</span>
              <span className="mcard-lines">
                {c.lines[0]}
                <br />
                {c.lines[1]}
              </span>
              <span className="mcard-cta">
                {c.cta}
                <IconChevron size={16} />
              </span>
            </button>
          ))}
        </div>

        <footer className="home-bottom">
          <PilotBadge />

          <div className="keyhints">
            <kbd>Enter</kbd>
            <span>to arm</span>
            <i className="divider" />
            <kbd>Space</kbd>
            <span>to take off</span>
          </div>

          <div className="sysready">
            <span className="sysready-bars">
              <IconSignal size={20} />
            </span>
            <span className="sysready-txt">
              <i>System</i>
              <b>Ready</b>
            </span>
            <span className="sysready-ring" />
          </div>
        </footer>
      </div>
    </div>
  );
}
