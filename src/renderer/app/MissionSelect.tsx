import { MISSIONS } from '../missions/catalog';
import { usePilotStore } from '../state/pilotStore';
import { playClick } from '../audio/sfx';

// Progress is empty until Phase 4 playable missions write medals/stars.
// Until then Mission 1 stays current and the rest stay locked — same path UX
// as Flight School.
type MissionProgress = { completed: boolean; stars: number };
const EMPTY: Record<string, MissionProgress> = {};

function NodeStars({ value }: { value: number }) {
  return (
    <span className="jnode-stars">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= value ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

/** Missions journey path — same layout as Pluto Flight School lesson select. */
export function MissionSelect() {
  const progress = EMPTY;
  const rank = usePilotStore((s) => s.rank);
  const xp = usePilotStore((s) => s.xp);
  const xpNext = usePilotStore((s) => s.xpNext);

  const completedCount = MISSIONS.filter((m) => progress[m.id]?.completed).length;
  const totalStars = MISSIONS.reduce((sum, m) => sum + (progress[m.id]?.stars ?? 0), 0);
  const pct = Math.round((completedCount / MISSIONS.length) * 100);

  return (
    <div className="section-body journey">
      <header className="journey-head">
        <div className="journey-title">
          <h1 className="section-title">Missions</h1>
          <p className="section-lede">
            Challenge the path — test every skill from first flight to figure-eight.
          </p>
        </div>
        <div className="journey-stats">
          <div className="jstat">
            <b>{completedCount}</b>
            <span>of {MISSIONS.length}</span>
          </div>
          <div className="jstat">
            <b>
              {totalStars}
              <i>★</i>
            </b>
            <span>of {MISSIONS.length * 3}</span>
          </div>
          <div className="jstat rank">
            <b>{rank}</b>
            <span className="jstat-xp">
              <span style={{ width: `${Math.min(100, (xp / xpNext) * 100)}%` }} />
            </span>
          </div>
        </div>
      </header>

      <div className="journey-progress">
        <div className="journey-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="journey-path">
        {MISSIONS.map((mission, i) => {
          const prog = progress[mission.id];
          const unlocked = i === 0 || !!progress[MISSIONS[i - 1].id]?.completed;
          const completed = !!prog?.completed;
          const current = unlocked && !completed;
          const side = i % 2 === 0 ? 'left' : 'right';
          const state = completed ? 'done' : current ? 'current' : unlocked ? 'open' : 'locked';

          return (
            <div key={mission.id} className={`jnode ${side} ${state}`}>
              <div className="jnode-card">
                <span className="jnode-mod">Mission {i + 1}</span>
                <b>{mission.title}</b>
                <i>{mission.subtitle}</i>
                {unlocked && <NodeStars value={prog?.stars ?? 0} />}
              </div>
              <button
                className="jnode-dot"
                disabled={!unlocked}
                onClick={() => {
                  if (!unlocked) return;
                  playClick();
                  // Playable mission runtime arrives in Phase 4.
                }}
                title={
                  unlocked
                    ? `${mission.title} — playable in Phase 4`
                    : 'Complete the previous mission to unlock'
                }
              >
                {completed ? '✓' : unlocked ? i + 1 : '🔒'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
