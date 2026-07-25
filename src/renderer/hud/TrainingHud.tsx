import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useTrainingStore, isLessonUnlocked } from '../state/trainingStore';
import { getLesson, lessonIndex, nextLesson, LESSONS } from '../training/lessons';
import { StickIndicator } from './StickIndicator';
import { KeyHints } from './KeyHints';

function Stars({ value }: { value: number }) {
  return (
    <div className="tr-stars" aria-label={`${value} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`tr-star ${i <= value ? 'on' : ''}`}>
          ★
        </span>
      ))}
    </div>
  );
}

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

  return (
    <div className="tr-hud">
      {/* Lesson header + exit */}
      <div className="tr-top">
        <div className="tr-badge">
          <span className="tr-badge-num">Lesson {num}</span>
          <span className="tr-badge-title">{lesson.title}</span>
        </div>
        <button className="tr-exit" onClick={exitLesson} title="Back to lessons">
          Exit ✕
        </button>
      </div>

      {/* Compact flight readout — useful once airborne */}
      {(phase === 'demo' || phase === 'practice') && (
        <div className="tr-readout">
          <div className={`tr-chip ${armed ? 'on' : ''}`}>{armed ? 'ARMED' : 'DISARMED'}</div>
          <div className="tr-chip">ALT {altitude.toFixed(1)} m</div>
          <div className="tr-chip">THR {Math.round(throttle * 100)}%</div>
        </div>
      )}

      {/* Step 1 — Introduction */}
      {phase === 'intro' && (
        <div className="tr-center">
          <div className="tr-card">
            <span className="tr-step">Lesson {num} · Introduction</span>
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
            {lesson.explain.durationHint && (
              <span className="tr-duration">⏱ {lesson.explain.durationHint}</span>
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

      {/* Step 2 — Demonstration */}
      {phase === 'demo' && (
        <div className="tr-demo">
          <div className="tr-demo-tag">
            ● DEMONSTRATION · {demoRound} of {demoRounds} — watch the drone
          </div>
          {demoCaption && <div className="tr-demo-caption">{demoCaption}</div>}
          <button className="tr-btn small" onClick={() => setPhase('practice')}>
            Skip ⏭
          </button>
        </div>
      )}

      {/* Live joysticks + keycaps, shown through the demo and practice */}
      {(phase === 'demo' || phase === 'practice') && (
        <>
          <div className={phase === 'demo' ? 'tr-demo-sticks' : undefined}>
            <StickIndicator />
          </div>
          {lesson.keys && <KeyHints keys={lesson.keys} demoKey={demoKey} />}
        </>
      )}

      {/* Step 3/4 — Practice + live validation */}
      {phase === 'practice' && (
        <>
          <div className="tr-practice">
            <span className="tr-step">Your Turn</span>
            <h3>{lesson.practice.prompt}</h3>
            <div className="tr-progress">
              <div
                className={`tr-progress-fill ${validation.failed ? 'fail' : ''}`}
                style={{ width: `${Math.round((validation.progress || 0) * 100)}%` }}
              />
            </div>
          </div>
          {hint && (
            <div className={`tr-hint ${validation.failed ? 'fail' : ''}`}>
              {validation.failed ? '✕ ' : '› '}
              {hint}
            </div>
          )}
        </>
      )}

      {/* Step 5 — Reward */}
      {phase === 'reward' && (
        <div className="tr-center">
          <div className="tr-card reward">
            <span className="tr-check">✓</span>
            <h2>Lesson Complete!</h2>
            <Stars value={lastStars} />
            {lastXp > 0 && <span className="tr-xp">+{lastXp} XP</span>}
            <div className="tr-actions">
              {hasNext && next && (
                <button className="tr-btn primary" onClick={() => start(next.id)}>
                  Next Lesson →
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
