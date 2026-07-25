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

function Stepper({ phase }: { phase: TrainingPhase }) {
  const active = STEPS.findIndex((s) => s.key === phase);
  return (
    <div className="tr-stepper">
      {STEPS.map((s, i) => (
        <div
          key={s.key}
          className={`tr-stepper-node ${i === active ? 'active' : ''} ${i < active ? 'done' : ''}`}
        >
          <span className="tr-stepper-dot">{i < active ? '✓' : i + 1}</span>
          <span className="tr-stepper-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="tr-stars" aria-label={`${value} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`tr-star ${i <= value ? 'on' : ''}`} style={{ animationDelay: `${i * 0.15}s` }}>
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
  const pct = Math.round((validation.progress || 0) * 100);

  return (
    <div className={`tr-hud phase-${phase}`}>
      {/* Top bar: module badge · phase stepper · exit */}
      <div className="tr-top">
        <div className="tr-badge">
          <span className="tr-badge-num">Module {num}</span>
          <span className="tr-badge-title">{lesson.title}</span>
        </div>
        <Stepper phase={phase} />
        <button className="tr-exit" onClick={exitLesson} title="Back to lessons">
          ✕
        </button>
      </div>

      {/* Big flight gauges — shown once we're flying */}
      {(phase === 'demo' || phase === 'practice') && (
        <div className="tr-gauges">
          <div className={`tr-gauge ${armed ? 'live' : ''}`}>
            <span className="tr-gauge-val">{armed ? 'ARMED' : 'IDLE'}</span>
            <span className="tr-gauge-lbl">Status</span>
          </div>
          <div className="tr-gauge">
            <span className="tr-gauge-val">
              {altitude.toFixed(1)}
              <em>m</em>
            </span>
            <span className="tr-gauge-lbl">Altitude</span>
          </div>
          <div className="tr-gauge">
            <span className="tr-gauge-val">
              {Math.round(throttle * 100)}
              <em>%</em>
            </span>
            <span className="tr-gauge-lbl">Throttle</span>
          </div>
        </div>
      )}

      {/* Step 1 — Introduction */}
      {phase === 'intro' && (
        <div className="tr-center">
          <div className="tr-card">
            <span className="tr-kicker">📖 Learn · Module {num}</span>
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
            🎥 DEMONSTRATION · {demoRound} / {demoRounds}
          </div>
          {demoCaption && <div className="tr-demo-caption">{demoCaption}</div>}
          <button className="tr-btn small" onClick={() => setPhase('practice')}>
            Skip to Practice ⏭
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
          <div className={`tr-objective ${validation.failed ? 'fail' : ''}`}>
            <div className="tr-objective-head">
              <span className="tr-kicker">🎮 Your Mission</span>
              <span className="tr-objective-pct">{pct}%</span>
            </div>
            <h3>{lesson.practice.prompt}</h3>
            <div className="tr-progress">
              <div
                className={`tr-progress-fill ${validation.failed ? 'fail' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {hint && (
              <div className={`tr-hint ${validation.failed ? 'fail' : ''}`}>
                {validation.failed ? '⚠ ' : '➤ '}
                {hint}
              </div>
            )}
          </div>
        </>
      )}

      {/* Step 5 — Reward */}
      {phase === 'reward' && (
        <div className="tr-center">
          <div className="tr-card reward">
            <div className="tr-burst" />
            <span className="tr-check">✓</span>
            <h2>Lesson Complete!</h2>
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
