import { useEffect, useRef, useState } from 'react';
import { useMissionStore, objectiveFor } from '../state/missionStore';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { resetForMission } from '../missions/reset';
import { requiredCheckpoints } from '../missions/types';
import { playClick, playStar, playSuccess } from '../audio/sfx';
import { RAD2DEG } from '../sim/mathx';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { MissionMap } from './MissionMap';
import { MissionHero, StepArt } from './MissionArt';
import { getEnvironment } from '../plugins/registry';

// ----------------------------------------------------------------------------
// The mission overlay.
//
// One strip along the bottom and nothing else standing between the pilot and the
// city. It answers, in this order and always: what am I doing, where is it, how
// far, am I carrying the package, how am I scoring, how long have I been out.
//
// The transient layers — the banner, the Mission Control line, the "+1" — are
// driven by `MissionDirector` off the mission clock, so nothing here holds a
// timer of its own that could outlive the attempt.
// ----------------------------------------------------------------------------

/** Beyond this the target is behind the pilot and the arrow says so. */
const OFF_SCREEN_DEG = 42;

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Where the target is, relative to the nose.
 *
 * A bearing rather than a screen-space projection: the arrow has to be right in
 * chase, in FPV and in orbit, and only one of those three has the camera looking
 * where the drone is looking. What never changes is which way the pilot has to
 * turn, so that is what it draws.
 */
function TargetArrow({ bearing, distance }: { bearing: number; distance: number }) {
  const deg = bearing * RAD2DEG;
  const off = Math.abs(deg) > OFF_SCREEN_DEG;
  return (
    <div className={`ms-arrow ${off ? 'off' : ''}`} title="Direction to the active marker">
      <svg viewBox="0 0 24 24" style={{ transform: `rotate(${deg}deg)` }}>
        <path d="M12 2 L19 20 L12 15.6 L5 20 Z" />
      </svg>
      <b>{distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}</b>
    </div>
  );
}

/**
 * What the release is waiting on, while the drone is over the mark.
 *
 * The route is listed FIRST and separately, because it is the one condition the
 * pilot cannot fix from where they are standing. Three green ticks and a hold
 * bar that refuses to fill is the worst thing this HUD could show; naming the
 * checkpoints still owed turns it from a bug into an instruction.
 */
function DeliveryChecklist({ fire }: { fire: boolean }) {
  const checks = useMissionStore((s) => s.checks);
  const gate = useMissionStore((s) => s.gate);
  const suppressing = useMissionStore((s) => s.suppressing);
  // A mission with no required rings has nothing to be blocked ON, so the route
  // row is left off rather than shown as a permanent 0/0 tick.
  const gated = gate.total > 0;
  const blocked = gate.left > 0;
  return (
    <div className={`ms-checks ${blocked ? 'blocked' : ''}`}>
      <span className="ms-checks-head">
        {fire ? (suppressing ? 'SUPPRESSING' : 'SUPPRESSION CONDITIONS') : 'RELEASE CONDITIONS'}
      </span>
      {gated && (
        <span className={blocked ? 'miss' : 'ok'}>
          {blocked ? '✕' : '✓'} Route {gate.total - gate.left}/{gate.total}
        </span>
      )}
      <span className={checks.centred ? 'ok' : ''}>
        {checks.centred ? '✓' : '•'} {fire ? 'Over the fire' : 'Centred'}
      </span>
      <span className={checks.inBand ? 'ok' : ''}>{checks.inBand ? '✓' : '•'} Height</span>
      <span className={checks.steady ? 'ok' : ''}>{checks.steady ? '✓' : '•'} Steady</span>
      <span className="ms-checks-bar">
        <i style={{ width: `${checks.hold * 100}%` }} />
      </span>
      {blocked && (
        <span className="ms-checks-note">
          The package will not release: collect all the pink rings first
        </span>
      )}
      {fire && !suppressing && checks.hold > 0 && checks.hold < 1 && (
        <span className="ms-checks-note">
          Suppression paused. Get back over the fire: nothing you have put out comes back
        </span>
      )}
    </div>
  );
}

/** A star row that lights one star at a time, with a chime for each. */
function StarReveal({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // The one place the HUD does hold timers, and it is bounded, off the result
    // screen, and cleared on unmount — a restart from this card cannot leave a
    // chime queued into the next flight.
    const timers = [1, 2, 3].map((i) =>
      window.setTimeout(
        () => {
          if (i <= value) playStar(i - 1);
          setShown(i);
        },
        260 + i * 380,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [value]);
  return (
    <div className="ms-stars">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`${i <= shown && i <= value ? 'on' : ''} ${i <= shown ? 'in' : ''}`}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export function MissionHud() {
  const mission = useMissionStore((s) => s.mission);
  const phase = useMissionStore((s) => s.phase);
  const leg = useMissionStore((s) => s.leg);
  const payload = useMissionStore((s) => s.payload);
  const points = useMissionStore((s) => s.points);
  const maxPoints = useMissionStore((s) => s.maxPoints);
  const distance = useMissionStore((s) => s.distance);
  const altitude = useMissionStore((s) => s.altitude);
  const bearing = useMissionStore((s) => s.bearing);
  const elapsed = useMissionStore((s) => s.elapsed);
  const banner = useMissionStore((s) => s.banner);
  const radio = useMissionStore((s) => s.radio);
  const pointPop = useMissionStore((s) => s.pointPop);
  const result = useMissionStore((s) => s.result);
  const failReason = useMissionStore((s) => s.failReason);
  const collisions = useMissionStore((s) => s.collisions);
  const fireIntensity = useMissionStore((s) => s.fireIntensity);
  const beginFlight = useMissionStore((s) => s.beginFlight);
  const restart = useMissionStore((s) => s.restart);
  const exit = useMissionStore((s) => s.exit);

  // The same three numbers the training bar carries. A mission is flown on the
  // aircraft, not on the mission logic, and the strip along the bottom answers
  // for the mission only — armed or not, and how much throttle is under the
  // stick, are the two that say whether the drone is about to do anything at
  // all. Kept up here, directly above the radar, so the pilot's eye finds the
  // state and the map in one glance.
  const throttle = useSimStore((s) => s.throttle);
  const armed = useFlightStore((s) => s.armed);

  /** The completion flourish, once. */
  const sang = useRef(false);
  useEffect(() => {
    if (phase === 'complete' && !sang.current) {
      sang.current = true;
      playSuccess();
    }
    if (phase !== 'complete') sang.current = false;
  }, [phase]);

  // The briefing, the result and the failure card each stop the flight dead, and
  // the keyboard has to agree — see `useModalKeyLock`. A mission has no scripted
  // demonstration, so nothing else was holding the sticks back: ENTER armed the
  // drone from behind the briefing the pilot had not read yet. One ref for all
  // three, which are never on screen together.
  const cardRef = useRef<HTMLDivElement>(null);
  // The landing leg counts as "not being flown" too. It is the two seconds
  // between the wheels settling and the result card appearing, the attempt is
  // already scored, and a throttle press in there put the drone back in the air
  // under a SAFE LANDING banner.
  useModalKeyLock(phase !== 'flying' || leg === 'landing', cardRef);

  if (!mission) return null;

  const flying = phase === 'flying';
  const fire = !!mission.fire;
  // On Precision Delivery every ring is required before the package will
  // release, and the briefing has to say so: it is the one number on that card a
  // pilot plans the flight around. Forest Fire's rings gate nothing, so its card
  // says how many there are to collect instead of how many are compulsory.
  const required = requiredCheckpoints(mission).length;
  // The map's name comes from its own spec rather than from the mission, so a
  // renamed environment renames itself on every briefing that flies it.
  const mapName = getEnvironment(mission.envId)?.name ?? mission.envId;
  const remaining = Math.max(0, mission.timeLimitSec - elapsed);
  const lowOnTime = remaining <= 45;

  /** Put the drone back on the pad AND the mission back to the start. The
   *  Director notices the sim's reset token move and tears the attempt down;
   *  this only asks for it, so there is exactly one restart path. */
  const flyAgain = () => {
    playClick();
    restart();
    resetForMission();
  };

  return (
    <div className="ms-hud">
      <div className="ms-top">
        <div className="ms-badge">
          <span className="ms-badge-tag">Mission {mission.order}</span>
          <b>{mission.name}</b>
        </div>
        <div className="ms-top-right">
          {phase === 'flying' && (
            <span className="ms-meta">
              <i className={armed ? 'on' : ''}>{armed ? 'ARMED' : 'IDLE'}</i>
              <b className="ms-meta-clock">{elapsed.toFixed(1)}s</b>
              ALT {altitude.toFixed(1)} · THR {Math.round(throttle * 100)}%
            </span>
          )}
          <button
            className="ms-exit"
            onClick={() => {
              playClick();
              exit();
            }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* Briefing — the only card that stands between the pilot and the city
          before the clock starts.

          Laid out in two columns rather than as one long column of prose. The
          card used to open with four paragraphs stacked over the numbers, which
          made the pilot read to find out what the job even was — and most of
          them will not. The flow row answers that in a glance, the prose sits
          underneath as detail, and the numbers and the rubric stand beside it
          instead of below it, which is what keeps the whole thing on screen
          without scrolling. */}
      {/* The briefing — the only card that stands between the pilot and the map
          before the clock starts, and the only screen in the app that has to
          answer "what am I about to do" from a standing start.

          Four regions, in the order a pilot actually asks for them: WHO/WHAT at
          the top with the story beside it, the JOB as four illustrated beats,
          then the objectives on the left with the numbers and the rubric on the
          right. Everything sits on one screen; nothing has to be scrolled past
          to reach Launch.

          It used to be four paragraphs of prose stacked over a row of numbers,
          which made the pilot read to find out what the job even was — and most
          of them will not. The prose is still here, under the objectives, where
          it is detail rather than the front door. */}
      {phase === 'briefing' && (
        <div className="ms-center">
          <div className="ms-card brief" ref={cardRef}>
            <header className="ms-brief-top">
              <div className="ms-brief-title">
                <span className="ms-card-tag">Mission {mission.order} · Briefing</span>
                <h2>{mission.name}</h2>
                <p className="ms-brief-sub">{mission.subtitle}</p>
              </div>
              {/* The situation, told rather than instructed. The one thing on
                  this card a pilot who reads nothing else should still take in. */}
              <aside className="ms-story">
                <span className="ms-story-icon" aria-hidden="true">
                  {fire ? '🔥' : '✚'}
                </span>
                <div>
                  <b>The story</b>
                  <p>{mission.story}</p>
                </div>
              </aside>
            </header>

            <div className="ms-brief-body">
              {/* The map, drawn rather than photographed — see MissionArt. */}
              <figure className="ms-hero">
                <MissionHero envId={mission.envId} />
                <figcaption>
                  <span className="ms-hero-pin" aria-hidden="true">
                    ◎
                  </span>
                  <span>
                    <i>Map</i>
                    <b>{mapName}</b>
                    <em>{mission.mapNote}</em>
                  </span>
                </figcaption>
              </figure>

              <div className="ms-brief-main">
                {/* The job in four beats, before a word of prose. */}
                <ol className="ms-flow">
                  {mission.flow.map((step, i) => (
                    <li key={step.label}>
                      <span className="ms-flow-num">{i + 1}</span>
                      <b>{step.label}</b>
                      <i>{step.note}</i>
                      <span className="ms-flow-art">
                        <StepArt art={step.art} />
                      </span>
                    </li>
                  ))}
                </ol>

                <div className="ms-brief-cols">
                  <section className="ms-objectives">
                    <b className="ms-panel-head">Mission objectives</b>
                    <ol>
                      {mission.objectives.map((line, i) => (
                        <li key={line}>
                          <span className={`ms-obj-num n${i + 1}`}>{i + 1}</span>
                          {line}
                        </li>
                      ))}
                    </ol>
                    {/* The detail, under the summary rather than in front of it.
                        It carries the rules a pilot cannot work out from the
                        objectives — the release gate, the ceiling, the hold. */}
                    <div className="ms-brief">
                      {mission.briefing.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </section>

                  <aside className="ms-brief-side">
                    <div className="ms-tiles">
                      <div>
                        <b>{maxPoints}</b>
                        <span>Points to collect</span>
                      </div>
                      <div>
                        <b>{clock(mission.timeLimitSec)}</b>
                        <span>Time limit</span>
                      </div>
                      <div>
                        <b>{fire ? mission.route.length : required}</b>
                        <span>{fire ? 'Rings, all optional' : 'Rings, all of them'}</span>
                      </div>
                      <div>
                        <b className="ms-tile-word">{mission.difficulty}</b>
                        <span>Difficulty</span>
                      </div>
                    </div>

                    <div className="ms-rubric">
                      <b>Star rating</b>
                      {mission.ranks.map((r) => (
                        <div key={r.stars} className="ms-rubric-row">
                          <span className="ms-rubric-stars">
                            {[1, 2, 3].map((i) => (
                              <span key={i} className={i <= r.stars ? 'on' : ''}>
                                ★
                              </span>
                            ))}
                          </span>
                          <span>{r.text}</span>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>
              </div>
            </div>

            <footer className="ms-brief-foot">
              <button
                className="ms-btn ghost"
                onClick={() => {
                  playClick();
                  exit();
                }}
              >
                ‹ Back
              </button>
              <button
                className="ms-btn primary wide"
                onClick={() => {
                  playClick();
                  // The aircraft is put back BEFORE the phase changes, not by the
                  // effect that watches the phase. Effects run after the commit,
                  // and the mission's frame loop can tick in between — a pilot who
                  // wrecked the drone while reading the briefing would have the
                  // new attempt fail on its first frame, on a crash flag from
                  // before it started. Same reason the result card's restart does
                  // it in the click rather than leaving it to the effect.
                  resetForMission();
                  beginFlight();
                }}
              >
                ▶ Launch Mission
              </button>
              <span className="ms-brief-hint">
                Press <kbd>Esc</kbd> to leave
              </span>
            </footer>
          </div>
        </div>
      )}

      {/* The banner: one line, centre of the view, gone in under three seconds. */}
      {flying && banner && (
        <div key={banner.id} className={`ms-banner ${banner.kind}`}>
          <b>{banner.title}</b>
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}

      {/* "+1 POINT", floating off the score. The whole feedback a checkpoint
          gets on the HUD — the rest of the answer is in the world, where the
          light it just took has gone out. */}
      {flying && pointPop && (
        <div key={pointPop.id} className="ms-pop">
          +1 POINT
          <i>{pointPop.label}</i>
        </div>
      )}

      {flying && leg === 'toDrop' && <DeliveryChecklist fire={fire} />}

      {/* Mission Control. Along the bottom, above the strip, so it never covers
          the horizon the pilot is flying against. */}
      {flying && radio && (
        <div key={radio.id} className="ms-radio">
          <span className="ms-radio-tag">MISSION CONTROL</span>
          <p>{radio.text}</p>
        </div>
      )}

      {/* The radar. The route, the pickup, the drop and the pad, all in one
          corner dial — the half of "where am I going" that the chase camera
          cannot answer over a city, and the reason the guidance in the world
          can afford to be quiet. */}
      {flying && <MissionMap mission={mission} />}

      {flying && (
        <div className="ms-strip">
          <div className="ms-obj">
            <span>OBJECTIVE</span>
            <b>{objectiveFor(leg, mission.kind)}</b>
          </div>
          <div className={`ms-cell payload ${payload}`}>
            <span>PAYLOAD</span>
            {/* One word each, with the state's colour carried by the dot the
                stylesheet puts in front of them. The emoji and the tick that
                used to sit here were doing the same job as that dot, in two
                more glyphs and at whatever size the platform's font felt like.

                A tank that has been emptied reads 'Empty', not 'Delivered':
                nothing was delivered, it was used up, and the pilot flying home
                needs to know they have nothing left rather than that they
                succeeded — the banner already said that. */}
            <b>
              {payload === 'waiting' ? 'Empty' : null}
              {payload === 'attached' ? (fire ? 'Ready' : 'On board') : null}
              {payload === 'delivered' ? (fire ? 'Empty' : 'Delivered') : null}
            </b>
          </div>
          {/* The fire, while there is one to report. It goes in beside the
              payload rather than replacing the points, because it is the thing
              the whole middle of this mission is about and the pilot should be
              able to watch it fall without looking away from the flying. */}
          {fire && (
            <div className={`ms-cell ${fireIntensity > 0 ? 'warn' : ''}`}>
              <span>FIRE</span>
              <b>{Math.round(fireIntensity * 100)}%</b>
            </div>
          )}
          <div className="ms-cell">
            <span>POINTS</span>
            <b>
              {points} <i>/ {maxPoints}</i>
            </b>
          </div>
          <div className="ms-cell">
            <span>DISTANCE</span>
            <TargetArrow bearing={bearing} distance={distance} />
          </div>
          <div className="ms-cell">
            <span>ALTITUDE</span>
            <b>{Math.round(altitude)} m</b>
          </div>
          <div className={`ms-cell ${lowOnTime ? 'warn' : ''}`}>
            <span>TIME</span>
            <b>{clock(elapsed)}</b>
          </div>
        </div>
      )}

      {/* Result. The stats settle in one at a time and the stars come in last —
          enough to feel like a result screen, short of a fireworks display. */}
      {phase === 'complete' && result && (
        <div className="ms-center">
          <div className="ms-card result" ref={cardRef}>
            <span className="ms-card-tag">MISSION COMPLETE</span>
            <h2>{mission.name}</h2>
            <StarReveal value={result.stars} />
            <p className="ms-signoff">“{mission.radio.complete.text}”</p>
            <div className="ms-sheet">
              {[
                [fire ? 'Payload collected' : 'Payload picked up', '✓', true],
                [fire ? 'Fire suppressed' : 'Payload delivered', '✓', true],
                ['Returned to base', '✓', true],
                ['Safe landing', '✓', true],
                [
                  'Points',
                  `${result.points} / ${result.maxPoints}`,
                  result.points >= mission.medals.gold,
                ],
                ['Time', clock(result.timeSec), result.timeSec <= mission.parTimeSec],
                ['Collisions', String(result.collisions), result.collisions === 0],
              ].map(([label, value, good], i) => (
                <div
                  key={String(label)}
                  className={`ms-sheet-row ${good ? 'good' : ''}`}
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>
            <div className="ms-actions">
              <button className="ms-btn primary" onClick={flyAgain}>
                ↻ Fly it again
              </button>
              <button
                className="ms-btn"
                onClick={() => {
                  playClick();
                  exit();
                }}
              >
                Back to missions
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="ms-center">
          <div className="ms-card failed" ref={cardRef}>
            <span className="ms-card-tag">MISSION FAILED</span>
            <h2>{failReason === 'timeout' ? 'Out of time' : 'Drone destroyed'}</h2>
            <p className="ms-fail-line">
              {failReason === 'timeout'
                ? fire
                  ? 'The fire got away from you. Take the marked line east next time.'
                  : 'The delivery window closed. Take a straighter line through the city.'
                : payload === 'attached'
                  ? fire
                    ? 'The aircraft is wrecked and the suppression tank went down with it.'
                    : 'The aircraft is wrecked and the package went down with it.'
                  : fire
                    ? 'The aircraft is wrecked. A tree is solid all the way up to its own treetop.'
                    : 'The aircraft is wrecked. Watch the street furniture on the approach.'}
            </p>
            <div className="ms-sheet">
              <div className="ms-sheet-row">
                <span>Points</span>
                <b>
                  {points} / {maxPoints}
                </b>
              </div>
              <div className="ms-sheet-row">
                <span>Time</span>
                <b>{clock(elapsed)}</b>
              </div>
              <div className="ms-sheet-row">
                <span>Collisions</span>
                <b>{collisions}</b>
              </div>
            </div>
            <div className="ms-actions">
              <button className="ms-btn primary" onClick={flyAgain}>
                ↻ Try again
              </button>
              <button
                className="ms-btn"
                onClick={() => {
                  playClick();
                  exit();
                }}
              >
                Back to missions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
