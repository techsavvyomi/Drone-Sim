import { useSettingsStore } from '../state/settingsStore';
import { usePilotStore } from '../state/pilotStore';
import { useTrainingStore } from '../state/trainingStore';
import { LESSONS } from '../training/lessons';

function CardStars({ value }: { value: number }) {
  return (
    <span className="ls-stars">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= value ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

export function LessonSelect() {
  const lessonsProgress = useSettingsStore((s) => s.settings.training.lessons);
  const start = useTrainingStore((s) => s.start);
  const rank = usePilotStore((s) => s.rank);
  const xp = usePilotStore((s) => s.xp);
  const xpNext = usePilotStore((s) => s.xpNext);

  const completedCount = LESSONS.filter((l) => lessonsProgress[l.id]?.completed).length;
  const totalStars = LESSONS.reduce((sum, l) => sum + (lessonsProgress[l.id]?.stars ?? 0), 0);

  return (
    <div className="section-body lessons">
      <header className="lessons-head">
        <div>
          <h1 className="section-title">Pluto Flight School</h1>
          <p className="section-lede">
            Learn to fly step by step — from arming the motors to a precision landing.
          </p>
        </div>
        <div className="lessons-stats">
          <span>
            <b>{completedCount}</b>/{LESSONS.length} lessons
          </span>
          <span>
            <b>{totalStars}</b>/{LESSONS.length * 3} ★
          </span>
          <span className="lessons-rank">
            {rank} · {xp}/{xpNext} XP
          </span>
        </div>
      </header>

      <div className="lesson-grid">
        {LESSONS.map((lesson, i) => {
          const prog = lessonsProgress[lesson.id];
          const prevDone = i === 0 || !!lessonsProgress[LESSONS[i - 1].id]?.completed;
          const unlocked = prevDone;
          const completed = !!prog?.completed;

          return (
            <button
              key={lesson.id}
              className={`lesson-card ${unlocked ? '' : 'locked'} ${completed ? 'done' : ''}`}
              disabled={!unlocked}
              onClick={() => unlocked && start(lesson.id)}
            >
              <span className="lesson-num">{i + 1}</span>
              <span className="lesson-main">
                <b>{lesson.title}</b>
                <i>{lesson.subtitle}</i>
              </span>
              {unlocked ? (
                <CardStars value={prog?.stars ?? 0} />
              ) : (
                <span className="lesson-lock">🔒</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
