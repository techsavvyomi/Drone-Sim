import { useEffect, useState } from 'react';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { usePilotStore } from '../state/pilotStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, lessonIndex, nextLesson, LESSONS } from '../training/lessons';
import type { Lesson } from '../training/lessons';
import { StickIndicator } from './StickIndicator';
import { KeyHints } from './KeyHints';
import { playClick, playSuccess, playStar, playRankUp } from '../audio/sfx';
import { LessonMap } from './LessonMap';

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

/**
 * The lesson's steps, as a row that walks forward.
 *
 * Shown in the demonstration AND in practice, deliberately: the demo marks its
 * own steps as it flies them, so what the intro card promised is what the pilot
 * watches, and then the same row is what they work through themselves.
 */
function StepChips({ steps, index }: { steps: { label: string; cap?: string }[]; index: number }) {
  return (
    <div className="tr-chips">
      {steps.map((s, i) => (
        <span
          key={`${s.label}-${i}`}
          className={`tr-chip ${i < index ? 'done' : i === index ? 'now' : 'todo'}`}
        >
          {i < index ? '✓ ' : ''}
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * What the stars take, straight from the lesson's rubric.
 *
 * The same objects that score the attempt, so the promise and the marking can
 * never disagree. `earned` highlights the rung an attempt actually reached.
 */
/** A rung of the rubric, as three stars with the unlit ones left in place.
 *
 *  Printing one, two and three stars literally made a ragged left edge and a
 *  column of three different widths, and said nothing about what the top of the
 *  scale was. The placeholders answer both: every row is the same shape, and
 *  three is visibly the most there is. */
function RubricStars({ stars }: { stars: number }) {
  return (
    <span className="tr-rubric-stars" aria-label={`${stars} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= stars ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

function Rubric({ rules, earned }: { rules: Lesson['stars']; earned?: number }) {
  return (
    <div className="tr-rubric">
      <b>How the stars are earned</b>
      {rules.map((r) => (
        <div key={r.stars} className={`tr-rubric-row ${earned === r.stars ? 'earned' : ''}`}>
          <RubricStars stars={r.stars} />
          <span>{r.text}</span>
        </div>
      ))}
      <div className={`tr-rubric-row ${earned === 1 ? 'earned' : ''}`}>
        <RubricStars stars={1} />
        <span>Finish the lesson. A crash caps the attempt here.</span>
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="tr-stars" aria-label={`${value} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`tr-star ${i <= value ? 'on' : ''}`}
          style={{ animationDelay: `${i * 0.12}s` }}
        >
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
  const cue = useTrainingStore((s) => s.cue);
  const hint = useTrainingStore((s) => s.hint);
  const validation = useTrainingStore((s) => s.validation);
  const elapsed = useTrainingStore((s) => s.elapsed);
  const routeTarget = useTrainingStore((s) => s.routeTarget);
  const lastStars = useTrainingStore((s) => s.lastStars);
  const lastTimeSec = useTrainingStore((s) => s.lastTimeSec);
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
  // The checkpoint row: one chip per point on the route, plus a final "Land"
  // chip for the lessons that finish on the pad. It is the answer to "how much
  // is left" that a percentage alone does not give — the pilot can see which
  // points are cleared, which one is live, and what is still to come.
  const route = lesson.route;
  const steps: { label: string; cap?: string }[] = lesson.stages
    ? lesson.stages.map((s) => ({ label: s.label, cap: s.cap }))
    : (route?.map((c) => ({ label: c.label })) ?? []);
  // Allowed to run one PAST the last step: that is the "all done" state, where
  // every chip carries its tick instead of the last one still sitting live.
  const stepIndex = Math.min(routeIndex, steps.length);
  // Every control this lesson uses, shown from the start. A lesson lists only
  // the controls it teaches — two of them, in the first modules — and the cue
  // highlight is what says which one is wanted right now. Making caps appear
  // partway through was worse: the row moved under the pilot's hand.
  const liveKeys = lesson.keys ?? [];
  const nextTarget = steps.length > 1 ? (steps[stepIndex]?.label ?? null) : null;

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
              {/* The attempt clock, on every lesson. It is the one number that
                  says how a go is going while it is still going, and the one the
                  result panel reports afterwards. */}
              {phase === 'practice' && <b className="tr-bar-clock">{elapsed.toFixed(1)}s</b>}
              ALT {altitude.toFixed(1)} · THR {Math.round(throttle * 100)}%
            </span>
          )}
          <button className="tr-bar-exit" onClick={exitLesson} title="Back to lessons">
            ✕
          </button>
        </div>
      </div>

      {/* The plan view, under the status bar. Up for the demonstration as well as
          the attempt, and behaving identically in both — the demo is where the
          shape is learned, and from above is the only place a shape is a shape. */}
      {flying && <LessonMap lesson={lesson} target={routeTarget} />}

      {/* Step 1 — Introduction (clean card) */}
      {phase === 'intro' && (
        <div className="tr-center">
          <div className="tr-card">
            <span className="tr-kicker">Learn · Module {num}</span>
            <h2>{lesson.explain.title}</h2>

            {/* What this lesson is, as a flow: the steps in order, each with the
                key that performs it. It is the first thing on the card because
                it is the thing a pilot can act on without reading. */}
            {steps.length > 1 && (
              <div className="tr-flow">
                {steps.map((s, i) => (
                  // The arrow travels WITH the step it points at, so a flow that
                  // wraps never leaves an arrow dangling at the end of a line.
                  <span className="tr-flow-item" key={`${s.label}-${i}`}>
                    {i > 0 && <span className="tr-flow-arrow" aria-hidden="true" />}
                    <span className="tr-flow-step">
                      <span className="tr-flow-num">{i + 1}</span>
                      {s.cap && <kbd>{s.cap}</kbd>}
                      <span className="tr-flow-label">{s.label}</span>
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="tr-body">
              {lesson.explain.body.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
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
            <Rubric rules={lesson.stars} />

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
            <StickIndicator cue={phase === 'practice' ? cue : []} />
          </div>
          {liveKeys.length > 0 && (
            <KeyHints keys={liveKeys} demoKeys={demoKeys} cue={phase === 'practice' ? cue : []} />
          )}
        </>
      )}

      {/* Step 2 — Demonstration: the same step row the pilot will fly, walking
          along with the demo, over the caption for the leg being shown. */}
      {phase === 'demo' && (
        <div className="tr-line demo">
          {steps.length > 1 && <StepChips steps={steps} index={stepIndex} />}
          <div className="tr-line-row">
            <span className="tr-line-tag">
              DEMO
              {/* Which pass is playing, as pips. It used to read "DEMO 2/3",
                  which sat directly under a row of two steps and was read as
                  "step 2 of 3" — a lesson with two steps does not have three. */}
              <span className="tr-demo-pips" aria-label={`Pass ${demoRound} of ${demoRounds}`}>
                {Array.from({ length: demoRounds }, (_, i) => (
                  <i key={i} className={i < demoRound ? 'on' : ''} />
                ))}
              </span>
            </span>
            <span className="tr-line-txt">{demoCaption}</span>
            <button className="tr-line-skip" onClick={clickThen(() => setPhase('practice'))}>
              skip ⏭
            </button>
          </div>
        </div>
      )}

      {/* Step 3/4 — Practice: one bottom line, the checkpoint row, slim progress */}
      {phase === 'practice' && (
        <div className={`tr-line practice ${validation.failed ? 'fail' : ''}`}>
          <div className="tr-line-row">
            <span className="tr-line-txt">
              {validation.failed ? '⚠ ' : '➤ '}
              {hint || lesson.practice.prompt}
            </span>
            {nextTarget && (
              <span className="tr-line-next">
                NEXT <b>{nextTarget}</b>
              </span>
            )}
            <span className="tr-line-pct">{pct}%</span>
          </div>
          {steps.length > 1 && <StepChips steps={steps} index={stepIndex} />}
          <div className="tr-thinbar">
            <div
              className={`fill ${validation.failed ? 'fail' : ''}`}
              style={{ width: `${pct}%` }}
            />
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
            <span className="tr-time">Flown in {lastTimeSec.toFixed(1)}s</span>
            <Stars value={lastStars} />
            {lastXp > 0 && <span className="tr-xp">+{lastXp} XP</span>}

            {/* Why that many, and what the next one up would take. */}
            <Rubric rules={lesson.stars} earned={lastStars} />

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
