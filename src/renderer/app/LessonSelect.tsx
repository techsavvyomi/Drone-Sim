import { useSettingsStore } from '../state/settingsStore';
import { usePilotStore } from '../state/pilotStore';
import { useTrainingStore } from '../state/trainingStore';
import { LESSONS } from '../training/lessons';
import { playClick } from '../audio/sfx';

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

// Gamified lesson "journey": a winding path of nodes the pilot climbs, each
// showing its lock state and earned stars, with the next lesson pulsing.
export function LessonSelect() {
  const lessonsProgress = useSettingsStore((s) => s.settings.training.lessons);
  const start = useTrainingStore((s) => s.start);
  const rank = usePilotStore((s) => s.rank);
  const xp = usePilotStore((s) => s.xp);
  const xpNext = usePilotStore((s) => s.xpNext);

  const completedCount = LESSONS.filter((l) => lessonsProgress[l.id]?.completed).length;
  const totalStars = LESSONS.reduce((sum, l) => sum + (lessonsProgress[l.id]?.stars ?? 0), 0);
  const pct = Math.round((completedCount / LESSONS.length) * 100);

  return (
    <div className="section-body journey">
      <header className="journey-head">
        <div className="journey-title">
          <h1 className="section-title">Pluto Flight School</h1>
          <p className="section-lede">Climb the path and master every skill from arm to landing.</p>
        </div>
        <div className="journey-stats">
          <div className="jstat">
            <b>{completedCount}</b>
            <span>of {LESSONS.length}</span>
          </div>
          <div className="jstat">
            <b>
              {totalStars}
              <i>★</i>
            </b>
            <span>of {LESSONS.length * 3}</span>
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
        {LESSONS.map((lesson, i) => {
          const prog = lessonsProgress[lesson.id];
          const unlocked = i === 0 || !!lessonsProgress[LESSONS[i - 1].id]?.completed;
          const completed = !!prog?.completed;
          const current = unlocked && !completed;
          const side = i % 2 === 0 ? 'left' : 'right';
          const state = completed ? 'done' : current ? 'current' : unlocked ? 'open' : 'locked';

          return (
            <div key={lesson.id} className={`jnode ${side} ${state}`}>
              <div className="jnode-card">
                <span className="jnode-mod">Module {i + 1}</span>
                <b>{lesson.title}</b>
                <i>{lesson.subtitle}</i>
                {unlocked && <NodeStars value={prog?.stars ?? 0} />}
              </div>
              <button
                className="jnode-dot"
                disabled={!unlocked}
                onClick={() => {
                  if (!unlocked) return;
                  playClick();
                  start(lesson.id);
                }}
                title={unlocked ? lesson.title : 'Complete the previous lesson to unlock'}
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
