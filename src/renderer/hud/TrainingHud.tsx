import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, lessonIndex, nextLesson, LESSONS } from '../training/lessons';
import { StickIndicator } from './StickIndicator';
import { KeyHints } from './KeyHints';

const STEPS: { key: TrainingPhase; label: string }[] = [
  { key: 'intro', label: 'Learn' },
  { key: 'demo', label: 'Demo' },
  { key: 'practice', label: 'Fly' },
  { key: 'reward', label: 'Done' },
];

function Stars({ value }: { value: number }) {
  return (
    <div className="tr-stars" aria-label={`${value} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`tr-star ${i <= value ? 'on' : ''}`} style={{ animationDelay: `${i * 0.12}s` }}>
          ★
        </span>
      ))}
    </div>
  );
}

// Minimal, view-first training HUD: a thin top bar with the lesson + phase
// progress, one-line guidance at the bottom, and the 3D scene left clear.
export function TrainingHud() {
  const phase = useTrainingStore((s) => s.phase);
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const demoCaption = useTrainingStore((s) => s.demoCaption);
  const demoRound = useTrainingStore((s) => s.demoRound);
  const demoRounds = useTrainingStore((s) => s.demoRounds);
  const demoKey = useTrainingStore((s) => s.demoKey);
  const hint = useTrainingStore((s) => s.hint);
  const validation = useTrainingStore((s) => s.validation);
  const lastStars = useTrainingStore((s) => s.lastStars);
  const lastXp = useTrainingStore((s) => s.lastXp);
  const start = useTrainingStore((s) => s.start);
  const setPhase = useTrainingStore((s) => s.setPhase);
  const exitLesson = useTrainingStore((s) => s.exitLesson);

  const altitude = useSimStore((s) => s.altitude);
  const throttle = useSimStore((s) => s.throttle);
  const armed = useFlightStore((s) => s.armed);

  const lesson = activeLessonId ? getLesson(activeLessonId) : undefined;
  if (!lesson) return null;

  const num = lessonIndex(lesson.id) + 1;
  const next = nextLesson(lesson.id);
  const hasNext = !!next && isLessonUnlocked(next.id);
  const isLast = lessonIndex(lesson.id) === LESSONS.length - 1;
  const flying = phase === 'demo' || phase === 'practice';
  const activeStep = STEPS.findIndex((s) => s.key === phase);
  const pct = Math.round((validation.progress || 0) * 100);

  return (
    <div className={`tr-hud min phase-${phase}`}>
      {/* Thin top bar */}
      <div className="tr-bar">
        <span className="tr-bar-id">
          <b>M{num}</b> {lesson.title}
        </span>
        <div className="tr-bar-steps">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`${i === activeStep ? 'active' : ''} ${i < activeStep ? 'done' : ''}`}
            >
              {s.label}
            </span>
          ))}
        </div>
        <div className="tr-bar-right">
          {flying && (
            <span className="tr-bar-meta">
              <i className={armed ? 'on' : ''}>{armed ? 'ARMED' : 'IDLE'}</i>
              ALT {altitude.toFixed(1)} · THR {Math.round(throttle * 100)}%
            </span>
          )}
          <button className="tr-bar-exit" onClick={exitLesson} title="Back to lessons">
            ✕
          </button>
        </div>
      </div>

      {/* Step 1 — Introduction (clean card) */}
      {phase === 'intro' && (
        <div className="tr-center">
          <div className="tr-card">
            <span className="tr-kicker">Learn · Module {num}</span>
            <h2>{lesson.explain.title}</h2>
            {lesson.explain.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
            {(lesson.tips?.length || lesson.commonMistakes?.length) && (
              <div className="tr-notes">
                {lesson.tips && lesson.tips.length > 0 && (
                  <div className="tr-note tips">
                    <b>💡 Pilot Tips</b>
                    <ul>
                      {lesson.tips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {lesson.commonMistakes && lesson.commonMistakes.length > 0 && (
                  <div className="tr-note mistakes">
                    <b>⚠ Common Mistakes</b>
                    <ul>
                      {lesson.commonMistakes.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="tr-actions">
              <button className="tr-btn primary" onClick={() => setPhase('demo')}>
                ▶ Watch Demonstration
              </button>
              <button className="tr-btn" onClick={() => setPhase('practice')}>
                Skip to Practice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live joysticks + keycaps (subtle) */}
      {flying && (
        <>
          <div className={phase === 'demo' ? 'tr-demo-sticks' : undefined}>
            <StickIndicator />
          </div>
          {lesson.keys && <KeyHints keys={lesson.keys} demoKey={demoKey} />}
        </>
      )}

      {/* Step 2 — Demonstration: one bottom line */}
      {phase === 'demo' && (
        <div className="tr-line">
          <span className="tr-line-tag">
            DEMO {demoRound}/{demoRounds}
          </span>
          <span className="tr-line-txt">{demoCaption}</span>
          <button className="tr-line-skip" onClick={() => setPhase('practice')}>
            skip ⏭
          </button>
        </div>
      )}

      {/* Step 3/4 — Practice: one bottom line + slim progress */}
      {phase === 'practice' && (
        <div className={`tr-line practice ${validation.failed ? 'fail' : ''}`}>
          <div className="tr-line-row">
            <span className="tr-line-txt">
              {validation.failed ? '⚠ ' : '➤ '}
              {hint || lesson.practice.prompt}
            </span>
            <span className="tr-line-pct">{pct}%</span>
          </div>
          <div className="tr-thinbar">
            <div className={`fill ${validation.failed ? 'fail' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Step 5 — Reward (clean card) */}
      {phase === 'reward' && (
        <div className="tr-center">
          <div className="tr-card reward">
            <span className="tr-check">✓</span>
            <h2>Lesson Complete</h2>
            <Stars value={lastStars} />
            {lastXp > 0 && <span className="tr-xp">+{lastXp} XP</span>}
            <div className="tr-actions">
              {hasNext && next && (
                <button className="tr-btn primary" onClick={() => start(next.id)}>
                  Next: {next.title} →
                </button>
              )}
              <button className="tr-btn" onClick={() => start(lesson.id)}>
                ↻ Replay
              </button>
              <button className="tr-btn" onClick={exitLesson}>
                {isLast ? 'Finish' : 'Menu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
