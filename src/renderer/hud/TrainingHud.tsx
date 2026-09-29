import { useEffect, useRef, type ReactNode } from 'react';
import { useFlightStore } from '../state/flightStore';
import { usePilotStore } from '../state/pilotStore';
import { useSettingsStore } from '../state/settingsStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, lessonIndex, nextLesson, LESSONS } from '../training/lessons';
import type { Lesson } from '../training/lessons';
import { StickIndicator } from './StickIndicator';
import { KeyActions, KeyHints } from './KeyHints';
import { CrashOverlay } from './CrashOverlay';
import { PauseOverlay } from './PauseOverlay';
import { LessonMap } from './LessonMap';
import { playClick, playSuccess, playStar, playRankUp } from '../audio/sfx';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { Badge, Button, Icon, Keycap, StarRating, StatTile } from '../ds';
import {
  BAND_STEPS,
  bandStates,
  blockOf,
  chipWindow,
  demoClockText,
  formatClock,
  formatSeconds,
  gapLine,
  learnMeta,
  clockStatus,
  flyLine,
  personalBestLine,
  registerFor,
  resultTiers,
  stepHeading,
  tiersFor,
  timedTiers,
  yourBestText,
  type StepState,
} from '../app/trainingFacts';

// Pluto Flight School, in a lesson (Phase 4). One step band on top — Learn, Demo,
// Fly, Done — and under it the screen for the step: the Learn card, the demo's
// caption strip, the Fly instruction card and bar, the result card. Learn and
// Done are classroom; Demo and Fly are cockpit, over the live 3D view. Every
// word comes from the lesson itself (trainingFacts.ts); nothing here scores.

function StepMark({ state, n }: { state: StepState; n: number }) {
  return (
    <span className="tband__mark">
      {state === 'done' ? <Icon name="check" /> : state === 'now' ? <Icon name="dot" /> : n}
    </span>
  );
}

/** The band above every lesson screen. Cards live below it, so nothing covers it. */
function StepBand({
  lesson,
  num,
  phase,
  right,
}: {
  lesson: Lesson;
  num: number;
  phase: TrainingPhase;
  right: ReactNode;
}) {
  const states = bandStates(phase);
  return (
    <header className="tband" data-register={registerFor(phase)}>
      <div className="tband__id">
        <b>
          Module {num} · {lesson.title}
        </b>
        <span>{blockOf(num).name}</span>
      </div>
      <ol className="tband__steps" aria-label="Lesson steps">
        {BAND_STEPS.map((s, i) => (
          <li
            key={s.phase}
            className={`tband__step is-${states[i]}`}
            aria-current={states[i] === 'now' ? 'step' : undefined}
          >
            <StepMark state={states[i]} n={i + 1} />
            {s.label}
          </li>
        ))}
      </ol>
      <div className="tband__right">{right}</div>
    </header>
  );
}

/** A keycap and what it does: "Esc Module list". */
function KeyAction({
  cap,
  children,
  onClick,
}: {
  cap: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="tband__key" onClick={onClick}>
      <Keycap>{cap}</Keycap>
      <span>{children}</span>
    </button>
  );
}

function stepLabels(lesson: Lesson): { label: string; cap?: string }[] {
  if (lesson.stages) return lesson.stages.map((s) => ({ label: s.label, cap: s.cap }));
  return lesson.route?.map((c) => ({ label: c.label })) ?? [];
}

// ---- Learn -------------------------------------------------------------------

function LearnCard({ lesson, num }: { lesson: Lesson; num: number }) {
  const setPhase = useTrainingStore((s) => s.setPhase);
  const progress = useSettingsStore((s) => s.settings.training.lessons[lesson.id]);
  const cardRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<HTMLButtonElement>(null);
  const steps = stepLabels(lesson);
  const tiers = tiersFor(lesson.stars);
  const best = yourBestText(progress);

  // Enter watches the demo, S skips to practice. The card's key lock holds every
  // flight key, so the two shortcuts are handed to it rather than to the window.
  useModalKeyLock(true, cardRef, (e) => {
    if (e.code === 'KeyS') {
      playClick();
      setPhase('practice');
      return true;
    }
    const onButton = document.activeElement instanceof HTMLButtonElement;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton) {
      playClick();
      setPhase('demo');
      return true;
    }
    return false;
  });

  useEffect(() => {
    demoRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="tstage" data-register="classroom">
      <div className="tlearn" ref={cardRef} role="dialog" aria-label={`Learn: ${lesson.title}`}>
        <div className="tlearn__main">
          <p className="tlearn__meta">{learnMeta(num, LESSONS.length, lesson)}</p>
          <h1 className="tlearn__title">{lesson.title}</h1>
          <p className="tlearn__goal">{lesson.subtitle}.</p>
          {steps.length > 1 && (
            <div className="tlearn__flow" aria-label="Steps">
              {steps.map((s, i) => (
                <span className="tlearn__flow-step" key={`${s.label}-${i}`}>
                  {i > 0 && steps.length <= 6 && (
                    <span className="tlearn__arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  {s.cap && <Keycap>{s.cap}</Keycap>}
                  <span>{s.label}</span>
                </span>
              ))}
            </div>
          )}
          <div className="tlearn__body">
            {lesson.explain.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>

        <div className="tlearn__side">
          {(lesson.tips?.length || lesson.commonMistakes?.length) && (
            <div className="tlearn__notes">
              {lesson.tips && lesson.tips.length > 0 && (
                <section className="tlearn__note">
                  <h2>Pilot tips</h2>
                  <ul>
                    {lesson.tips.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </section>
              )}
              {lesson.commonMistakes && lesson.commonMistakes.length > 0 && (
                <section className="tlearn__note">
                  <h2>Common mistakes</h2>
                  <ul>
                    {lesson.commonMistakes.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          <section className="tlearn__stars">
            <header>
              <h2>Stars</h2>
              {best && <span>{best}</span>}
            </header>
            {tiers.map((t) => (
              <div className="tlearn__tier" key={t.stars}>
                <StarRating earned={t.stars} showText={false} />
                <span className="tlearn__tier-text">{t.text}</span>
                <span className="tlearn__tier-n">{t.stars} of 3</span>
              </div>
            ))}
            <p className="tlearn__stars-note">
              Time counts from take-off, inside the box only. Leave it and the timer pauses until
              you are back. A crash holds you at one star.
            </p>
          </section>
        </div>

        <footer className="tlearn__actions">
          <button
            type="button"
            className="ds-btn ds-btn--secondary tlearn__skip"
            onClick={() => {
              playClick();
              setPhase('practice');
            }}
          >
            <Keycap>S</Keycap>
            <span>Skip to practice</span>
          </button>
          <Button
            ref={demoRef}
            variant="primary"
            iconAfter="play"
            onClick={() => {
              playClick();
              setPhase('demo');
            }}
          >
            Watch demonstration
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ---- Demo --------------------------------------------------------------------

function DemoStrip({ lesson }: { lesson: Lesson }) {
  const caption = useTrainingStore((s) => s.demoCaption);
  const demoSec = useTrainingStore((s) => s.demoSec);
  const round = useTrainingStore((s) => s.demoRound);
  const rounds = useTrainingStore((s) => s.demoRounds);
  const routeIndex = useTrainingStore((s) => s.routeIndex);
  const setPhase = useTrainingStore((s) => s.setPhase);
  const steps = stepLabels(lesson);
  const at = Math.min(routeIndex, steps.length);
  const [from, to] = chipWindow(steps.length, at);

  // S skips — the demonstration holds the sticks, so S is not a throttle here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyS' || e.repeat) return;
      e.preventDefault();
      playClick();
      setPhase('practice');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPhase]);

  return (
    <div className="tdemo">
      <div className="tdemo__text">
        <span className="tdemo__label">
          Demonstration · {demoClockText(lesson, demoSec)}
          {rounds > 1 && ` · pass ${round} of ${rounds}`}
        </span>
        <p className="tdemo__caption">{caption}</p>
      </div>
      {steps.length > 1 && (
        <ol className="tdemo__chips" aria-label="Steps">
          {steps.slice(from, to).map((s, k) => {
            const i = from + k;
            const state = i < at ? 'done' : i === at ? 'now' : 'todo';
            return (
              <li key={`${s.label}-${i}`} className={`tchip is-${state}`}>
                <Icon name={state === 'done' ? 'check' : state === 'now' ? 'dot' : 'ring'} />
                {i + 1} {s.label}
              </li>
            );
          })}
        </ol>
      )}
      <button
        type="button"
        className="ds-btn ds-btn--primary tdemo__skip"
        onClick={() => {
          playClick();
          setPhase('practice');
        }}
      >
        <Keycap>S</Keycap>
        <span>Skip to practice</span>
        <Icon name="play" />
      </button>
    </div>
  );
}

// ---- Fly ---------------------------------------------------------------------

function FlyCard({ lesson }: { lesson: Lesson }) {
  const hint = useTrainingStore((s) => s.hint);
  const failed = useTrainingStore((s) => s.validation.failed);
  const routeIndex = useTrainingStore((s) => s.routeIndex);
  const cue = useTrainingStore((s) => s.cue);
  const demoKeys = useTrainingStore((s) => s.demoKeys);
  const steps = stepLabels(lesson);
  const heading = stepHeading(
    steps.map((s) => s.label),
    routeIndex,
  );
  const text = hint || lesson.practice.prompt;
  const done = text.startsWith('✓');
  const line = done ? text.replace(/^✓\s*/, '') : text;
  return (
    <div className={`tfly${failed ? ' is-fail' : ''}${done ? ' is-done' : ''}`}>
      <div className="tfly__text">
        {heading && <span className="tfly__step">{heading}</span>}
        <p className="tfly__line">
          {failed && <Icon name="warning" />}
          {done && <Icon name="check" />}
          {line}
        </p>
      </div>
      {lesson.keys && lesson.keys.length > 0 && (
        <KeyActions keys={lesson.keys} demoKeys={demoKeys} cue={cue} />
      )}
    </div>
  );
}

function FlyBar({ lesson }: { lesson: Lesson }) {
  // The flight clock: from take-off, paused outside the box. It is what the
  // stars are judged on (training/flightClock.ts).
  const elapsed = useTrainingStore((s) => s.flightSec);
  const clockState = useTrainingStore((s) => s.clockState);
  const progress = useTrainingStore((s) => s.validation.progress);
  const armed = useFlightStore((s) => s.armed);
  const crashed = useFlightStore((s) => s.crashed);
  const tiers = tiersFor(lesson.stars);
  const timed = timedTiers(tiers);
  const scale = timed.length ? Math.max(...timed.map((t) => t.within as number)) * 1.15 : 0;
  const pct = Math.round((progress || 0) * 100);
  const chip = clockStatus(clockState, armed, crashed);
  const status = (
    <Badge tone={chip.tone} icon={chip.icon}>
      {chip.text}
    </Badge>
  );
  return (
    <div className={`tbar is-${clockState}`}>
      <div className="tbar__top">
        <b className="tbar__clock">{formatSeconds(elapsed)}</b>
        <span className="tbar__line">{flyLine(tiers, clockState, elapsed)}</span>
        <span className="tbar__status">{status}</span>
      </div>
      <div
        className="tbar__track"
        role="progressbar"
        aria-label={timed.length ? 'Time used' : 'Task done'}
        aria-valuemin={0}
        aria-valuemax={timed.length ? Math.round(scale) : 100}
        aria-valuenow={timed.length ? Math.round(elapsed) : pct}
      >
        <span
          className="tbar__fill"
          style={{
            width: `${timed.length ? Math.min(100, (elapsed / scale) * 100) : pct}%`,
          }}
        />
        {timed.map((t) => {
          const lost = elapsed > (t.within as number);
          return (
            <span
              key={t.stars}
              className={`tbar__mark${lost ? ' is-lost' : ''}`}
              style={{ left: `${((t.within as number) / scale) * 100}%` }}
            >
              <span className="tbar__mark-label">
                {lost && <Icon name="cross" />}
                {Array.from({ length: t.stars }, (_, i) => (
                  <Icon key={i} name="star" />
                ))}
                {formatSeconds(t.within as number)}
              </span>
            </span>
          );
        })}
      </div>
      <div className="tbar__foot">
        <span>
          {timed.length ? 'Flight time from take-off · leaving the box pauses it' : 'Task progress'}
        </span>
        <span>Task {pct} %</span>
      </div>
    </div>
  );
}

// ---- Done --------------------------------------------------------------------

function ResultCard({ lesson, num }: { lesson: Lesson; num: number }) {
  const stars = useTrainingStore((s) => s.lastStars);
  const timeSec = useTrainingStore((s) => s.lastTimeSec);
  const xp = useTrainingStore((s) => s.lastXp);
  const rankUp = useTrainingStore((s) => s.lastRankUp);
  const bestBefore = useTrainingStore((s) => s.lastBestBefore);
  const autoAdvance = useTrainingStore((s) => s.autoAdvance);
  const advanceIn = useTrainingStore((s) => s.advanceIn);
  const start = useTrainingStore((s) => s.start);
  const exitLesson = useTrainingStore((s) => s.exitLesson);
  const cancel = useTrainingStore((s) => s.cancelAutoAdvance);
  const rank = usePilotStore((s) => s.rank);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  const next = nextLesson(lesson.id);
  const hasNext = !!next && isLessonUnlocked(next.id);
  const nextNum = next ? lessonIndex(next.id) + 1 : 0;
  const tiers = tiersFor(lesson.stars);
  const rows = resultTiers(tiers, stars, timeSec);
  const pb = personalBestLine(bestBefore, timeSec);

  useModalKeyLock(true, cardRef);

  // The flourish: success chime, a ding per star, a fanfare on a rank-up.
  useEffect(() => {
    const timers: number[] = [];
    playSuccess();
    for (let i = 0; i < stars; i++) {
      timers.push(window.setTimeout(() => playStar(i), 420 + i * 320));
    }
    if (rankUp) timers.push(window.setTimeout(() => playRankUp(), 500 + stars * 320));
    (hasNext ? nextRef : menuRef).current?.focus({ preventScroll: true });
    return () => timers.forEach(clearTimeout);
    // Once, on arrival.
  }, []);

  const go = (fn: () => void) => () => {
    playClick();
    fn();
  };

  return (
    <div className="tstage" data-register="classroom">
      <div className="tresult" ref={cardRef} role="dialog" aria-label={`Result: ${lesson.title}`}>
        <header className="tresult__head">
          <div>
            <p className="tresult__meta">
              Module {num} · {lesson.title}
            </p>
            <h1 className="tresult__title">
              <StarRating earned={stars} showText={false} />
              {stars} of 3 stars
            </h1>
          </div>
          <Badge tone="armed" icon="check">
            Passed
          </Badge>
        </header>

        <div className="tresult__tiles">
          <StatTile
            label="Flight time"
            value={formatSeconds(timeSec)}
            note={`${formatClock(timeSec)} flown`}
          />
          <StatTile
            label="Best time"
            value={formatSeconds(bestBefore === null ? timeSec : Math.min(bestBefore, timeSec))}
            note={pb.isNew ? 'New personal best' : undefined}
          />
          <StatTile
            label="XP"
            value={`+${xp} XP`}
            note={rankUp ? `Rank up · ${rankUp}` : xp === 0 ? 'No new stars on this go' : rank}
          />
        </div>

        <div className="tresult__tiers">
          {rows.map((t) => (
            <div key={t.stars} className={`tresult__tier is-${t.state}`}>
              <StarRating earned={t.stars} showText={false} />
              <span className="tresult__tier-text">{t.text}</span>
              <span className="tresult__tier-note">
                {t.state !== 'missed' && <Icon name="check" />}
                {t.note}
              </span>
            </div>
          ))}
        </div>
        <p className="tresult__gap">{gapLine(tiers, stars, timeSec)}</p>
        <p className={`tresult__pb${pb.isNew ? ' is-new' : ''}`}>
          {pb.isNew && <Icon name="check" />}
          {pb.text}
        </p>

        <footer className="tresult__actions">
          {hasNext && autoAdvance ? (
            <span className="tresult__count">
              Next module in {advanceIn} s
              <Button variant="ghost" onClick={go(cancel)}>
                Cancel
              </Button>
            </span>
          ) : (
            <span />
          )}
          <span className="tresult__buttons">
            <Button ref={menuRef} onClick={go(exitLesson)}>
              Menu
            </Button>
            <Button onClick={go(() => start(lesson.id))}>Replay</Button>
            {hasNext && next && (
              <Button
                ref={nextRef}
                variant="primary"
                iconAfter="play"
                onClick={go(() => start(next.id))}
              >
                Next: Module {nextNum}
              </Button>
            )}
          </span>
        </footer>
      </div>
    </div>
  );
}

// ---- The HUD -----------------------------------------------------------------

export function TrainingHud() {
  const phase = useTrainingStore((s) => s.phase);
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const demoKeys = useTrainingStore((s) => s.demoKeys);
  const cue = useTrainingStore((s) => s.cue);
  const routeTarget = useTrainingStore((s) => s.routeTarget);
  const autoAdvance = useTrainingStore((s) => s.autoAdvance);
  const exitLesson = useTrainingStore((s) => s.exitLesson);
  const cancel = useTrainingStore((s) => s.cancelAutoAdvance);
  const togglePause = useFlightStore((s) => s.togglePause);

  const lesson = activeLessonId ? getLesson(activeLessonId) : undefined;
  if (!lesson) return null;

  const num = lessonIndex(lesson.id) + 1;
  const flying = phase === 'demo' || phase === 'practice';
  const stickKeys = lesson.keys ?? [];
  const next = nextLesson(lesson.id);
  const counting = phase === 'reward' && autoAdvance && !!next && isLessonUnlocked(next.id);

  const right =
    phase === 'practice' ? (
      <>
        <KeyAction cap="P" onClick={togglePause}>
          Pause
        </KeyAction>
        <KeyAction cap="Esc" onClick={exitLesson}>
          Module list
        </KeyAction>
      </>
    ) : counting ? (
      <KeyAction cap="Esc" onClick={cancel}>
        Stop auto-advance
      </KeyAction>
    ) : (
      <KeyAction cap="Esc" onClick={exitLesson}>
        Module list
      </KeyAction>
    );

  return (
    <div className={`thud is-${phase}`}>
      <StepBand lesson={lesson} num={num} phase={phase} right={right} />

      {/* Everything else lives under the band, so no card or scrim covers it. */}
      <div className="thud__area">
        {phase === 'intro' && <LearnCard key={lesson.id} lesson={lesson} num={num} />}

        {flying && (
          <div className="thud__flight" data-register="cockpit">
            <LessonMap lesson={lesson} target={routeTarget} />
            <div className={phase === 'demo' ? 'thud__sticks is-demo' : 'thud__sticks'}>
              <StickIndicator cue={phase === 'practice' ? cue : []} />
            </div>
            {stickKeys.length > 0 && (
              <KeyHints
                keys={stickKeys}
                demoKeys={demoKeys}
                cue={phase === 'practice' ? cue : []}
              />
            )}
            {phase === 'demo' && <DemoStrip lesson={lesson} />}
            {phase === 'practice' && (
              <>
                <FlyCard lesson={lesson} />
                <FlyBar lesson={lesson} />
              </>
            )}
          </div>
        )}

        {/* The crash and pause cards are the free-flight ones: a crash in a lesson
          is the same event as anywhere else. Practice only — the demonstration
          resets itself. */}
        {phase === 'practice' && <CrashOverlay />}
        {phase === 'practice' && <PauseOverlay menu={false} />}

        {phase === 'reward' && <ResultCard key={lesson.id} lesson={lesson} num={num} />}
      </div>
    </div>
  );
}
