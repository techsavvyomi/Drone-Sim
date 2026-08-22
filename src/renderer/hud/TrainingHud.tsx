import { useEffect, useState } from 'react';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { usePilotStore } from '../state/pilotStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, lessonIndex, nextLesson, LESSONS } from '../training/lessons';
import { StickIndicator } from './StickIndicator';
import { KeyHints } from './KeyHints';
import { playClick, playSuccess, playStar, playRankUp } from '../audio/sfx';

// Deterministic-ish confetti pieces (module scope so they don't reshuffle on
// every render — only the reward mount matters visually).
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 7) * 0.09,
  hue: (i * 47) % 360,
  drift: ((i * 53) % 40) - 20,
}));

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
  const demoKeys = useTrainingStore((s) => s.demoKeys);
  const routeIndex = useTrainingStore((s) => s.routeIndex);
  const hint = useTrainingStore((s) => s.hint);
  const validation = useTrainingStore((s) => s.validation);
  const lastStars = useTrainingStore((s) => s.lastStars);
  const lastXp = useTrainingStore((s) => s.lastXp);
  const lastRankUp = useTrainingStore((s) => s.lastRankUp);
  const start = useTrainingStore((s) => s.start);
  const setPhase = useTrainingStore((s) => s.setPhase);
  const exitLesson = useTrainingStore((s) => s.exitLesson);

  const altitude = useSimStore((s) => s.altitude);
  const throttle = useSimStore((s) => s.throttle);
  const armed = useFlightStore((s) => s.armed);

  const rank = usePilotStore((s) => s.rank);
  const pilotXp = usePilotStore((s) => s.xp);
  const pilotXpNext = usePilotStore((s) => s.xpNext);

  // Reward flourish: success chime, staggered star dings, rank-up fanfare, and
  // an XP bar that animates from empty to the pilot's current level progress.
  const [xpFill, setXpFill] = useState(0);
  useEffect(() => {
    if (phase !== 'reward') {
      setXpFill(0);
      return;
    }
    const timers: number[] = [];
    playSuccess();
    for (let i = 0; i < lastStars; i++) {
      timers.push(window.setTimeout(() => playStar(i), 420 + i * 320));
    }
    if (lastRankUp) timers.push(window.setTimeout(() => playRankUp(), 500 + lastStars * 320));
    timers.push(window.setTimeout(() => setXpFill(1), 350));
    return () => timers.forEach(clearTimeout);
  }, [phase, lastStars, lastRankUp]);

  const clickThen = (fn: () => void) => () => {
    playClick();
    fn();
  };

  const lesson = activeLessonId ? getLesson(activeLessonId) : undefined;
  if (!lesson) return null;

  const num = lessonIndex(lesson.id) + 1;
  const next = nextLesson(lesson.id);
  const hasNext = !!next && isLessonUnlocked(next.id);
  const isLast = lessonIndex(lesson.id) === LESSONS.length - 1;
  const flying = phase === 'demo' || phase === 'practice';
  const activeStep = STEPS.findIndex((s) => s.key === phase);
  const pct = Math.round((validation.progress || 0) * 100);
  // A route lesson counts checkpoints; the stick lessons have nothing to count.
  const route = lesson.route;
  const counted = !!route && route.length > 1;
  const nextTarget = route && routeIndex < route.length ? route[routeIndex].label : null;

  return (
    <div className={`tr-hud min phase-${phase}`}>
      {/* Thin top bar */}
      <div className="tr-bar">
        <span className="tr-bar-id">
          <b>Module {num}</b> {lesson.title}
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
              <button className="tr-btn primary" onClick={clickThen(() => setPhase('demo'))}>
                ▶ Watch Demonstration
              </button>
              <button className="tr-btn" onClick={clickThen(() => setPhase('practice'))}>
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
          {lesson.keys && <KeyHints keys={lesson.keys} demoKeys={demoKeys} />}
        </>
      )}

      {/* Step 2 — Demonstration: one bottom line */}
      {phase === 'demo' && (
        <div className="tr-line">
          <span className="tr-line-tag">
            DEMO {demoRound}/{demoRounds}
          </span>
          <span className="tr-line-txt">{demoCaption}</span>
          <button className="tr-line-skip" onClick={clickThen(() => setPhase('practice'))}>
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
            {counted && nextTarget && (
              <span className="tr-line-next">
                NEXT <b>{nextTarget}</b>
              </span>
            )}
            <span className="tr-line-pct">
              {counted ? `${routeIndex}/${route.length}` : `${pct}%`}
            </span>
          </div>
          <div className="tr-thinbar">
            <div className={`fill ${validation.failed ? 'fail' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Step 5 — Reward (celebration) */}
      {phase === 'reward' && (
        <div className="tr-center">
          <div className="tr-card reward">
            <div className="tr-confetti">
              {CONFETTI.map((c, i) => (
                <span
                  key={i}
                  style={{
                    left: `${c.left}%`,
                    animationDelay: `${c.delay}s`,
                    background: `hsl(${c.hue} 85% 60%)`,
                    ['--drift' as string]: `${c.drift}px`,
                  }}
                />
              ))}
            </div>
            <span className="tr-check">✓</span>
            <h2>Lesson Complete</h2>
            <Stars value={lastStars} />
            {lastXp > 0 && <span className="tr-xp">+{lastXp} XP</span>}

            {lastRankUp && <div className="tr-rankup">★ RANK UP · {lastRankUp} ★</div>}

            <div className="tr-xpbar">
              <div className="tr-xpbar-head">
                <span>{rank}</span>
                <span>
                  {pilotXp} / {pilotXpNext} XP
                </span>
              </div>
              <div className="tr-xpbar-track">
                <div
                  className="tr-xpbar-fill"
                  style={{ width: `${xpFill * Math.min(100, (pilotXp / pilotXpNext) * 100)}%` }}
                />
              </div>
            </div>

            <div className="tr-actions">
              {hasNext && next && (
                <button className="tr-btn primary" onClick={clickThen(() => start(next.id))}>
                  Next: {next.title} →
                </button>
              )}
              <button className="tr-btn" onClick={clickThen(() => start(lesson.id))}>
                ↻ Replay
              </button>
              <button className="tr-btn" onClick={clickThen(exitLesson)}>
                {isLast ? 'Finish' : 'Menu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
