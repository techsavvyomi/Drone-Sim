import { useSettingsStore } from '../state/settingsStore';
import { useMissionStore } from '../state/missionStore';
import { MissionViewport } from '../missions/MissionViewport';
import { MISSIONS } from '../missions';
import { maxPointsOf } from '../missions/types';
import { playClick } from '../audio/sfx';

// Top-level Missions section: the mission path when nothing is active, otherwise
// the live mission (flight view + runtime + mission HUD).
//
// The path is the SAME shape Flight School's is, and it reuses its markup and
// its styles rather than growing a second one: a numbered node you work along,
// each card carrying what you scored on it. A mission is a module of the same
// kind — pick it, and you are inside the map with the briefing over it.
//
// What differs is what the number means. A lesson's order is a syllabus; a
// mission's is a list that will grow, so mission 1 is simply the first one and
// the next unlocks behind it.

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

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MissionScreen() {
  const mission = useMissionStore((s) => s.mission);
  const start = useMissionStore((s) => s.start);
  const progress = useSettingsStore((s) => s.settings.missions.missions);

  if (mission) return <MissionViewport mission={mission} />;

  const flown = MISSIONS.filter((m) => progress[m.id]?.completed).length;
  const stars = MISSIONS.reduce((sum, m) => sum + (progress[m.id]?.stars ?? 0), 0);
  const pct = Math.round((flown / MISSIONS.length) * 100);

  return (
    <div className="section-body journey">
      <header className="journey-head">
        <div className="journey-title">
          {/* The section has a NAME, the way Training is "Pluto Flight School"
              rather than "Training". The nav rail and the menu card stay the
              plain word — that is the door — and this is the room. "Field Ops"
              is the other half of the school: the same aircraft, out of the
              classroom, doing a job with a clock on it. */}
          <h1 className="section-title">Pluto Field Ops</h1>
          <p className="section-lede">
            Real jobs, over a real city and out in the woods. Fly them however you like. The
            checkpoints pay, they do not steer.
          </p>
        </div>
        <div className="journey-stats">
          <div className="jstat">
            <b>{flown}</b>
            <span>of {MISSIONS.length}</span>
          </div>
          <div className="jstat">
            <b>
              {stars}
              <i>★</i>
            </b>
            <span>of {MISSIONS.length * 3}</span>
          </div>
        </div>
      </header>

      <div className="journey-progress">
        <div className="journey-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="journey-path">
        {MISSIONS.map((m, i) => {
          const done = progress[m.id];
          // Same rule as the school's: the first is open, the rest wait on the
          // one before.
          const unlocked = i === 0 || !!progress[MISSIONS[i - 1].id]?.completed;
          const completed = !!done?.completed;
          const state = completed ? 'done' : unlocked ? 'current' : 'locked';
          const side = i % 2 === 0 ? 'left' : 'right';

          return (
            <div key={m.id} className={`jnode ${side} ${state}`}>
              <div className="jnode-card">
                <span className="jnode-mod">Mission {m.order}</span>
                <b>{m.name}</b>
                <i>{m.subtitle}</i>
                {unlocked && <NodeStars value={done?.stars ?? 0} />}
                <span className="jnode-facts">
                  {completed ? (
                    <>
                      Best {done.bestPoints} / {maxPointsOf(m)} · {clock(done.bestTimeSec)}
                    </>
                  ) : (
                    <>
                      {maxPointsOf(m)} points · {m.route.length} checkpoints ·{' '}
                      {Math.round(m.timeLimitSec / 60)} min
                    </>
                  )}
                </span>
              </div>
              <button
                className="jnode-dot"
                disabled={!unlocked}
                onClick={() => {
                  if (!unlocked) return;
                  playClick();
                  start(m);
                }}
                title={unlocked ? m.name : 'Finish the previous mission to unlock'}
              >
                {completed ? '✓' : unlocked ? m.order : '🔒'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
