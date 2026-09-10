import { useEffect, useRef, useState } from 'react';
import { useMissionStore, guidanceHidden, objectiveFor, runContextOf } from '../state/missionStore';
import { rescueZoneOf } from '../missions/types';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { resetForMission } from '../missions/reset';
import { playClick, playStar, playSuccess } from '../audio/sfx';
import { RAD2DEG } from '../sim/mathx';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { MissionMap } from './MissionMap';
import { MissionCityMap } from './MissionCityMap';
import { MissionHero, StepArt, missionImage } from './MissionArt';
import { getEnvironment } from '../plugins/registry';
import { MISSIONS } from '../missions';
import { targetScreen } from '../missions/targetScreen';

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

/** Height difference, in metres, under which the marker counts as being on the
 *  pilot's own level and the climb chip stays off. Roughly a storey: less than
 *  that is trim, not a destination on another deck. */
const CLIMB_DEADBAND = 3;

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
function TargetArrow({
  bearing,
  distance,
  climb,
}: {
  bearing: number;
  distance: number;
  climb: number;
}) {
  const deg = bearing * RAD2DEG;
  const off = Math.abs(deg) > OFF_SCREEN_DEG;
  // Below CLIMB_DEADBAND the marker is on the pilot's own level and saying so
  // every frame would just be a number twitching in the corner. Above it, the
  // target is somewhere the flat arrow cannot point — a roof, or a street the
  // drone is flying over — and that is the whole reason this chip exists.
  const vertical = Math.abs(climb) >= CLIMB_DEADBAND;
  return (
    <div className={`ms-arrow ${off ? 'off' : ''}`} title="Direction to the active marker">
      <svg viewBox="0 0 24 24" style={{ transform: `rotate(${deg}deg)` }}>
        <path d="M12 2 L19 20 L12 15.6 L5 20 Z" />
      </svg>
      <b>{distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}</b>
      {vertical && (
        <i
          className={`ms-climb ${climb > 0 ? 'up' : 'down'}`}
          title={
            climb > 0
              ? 'The marker is ABOVE you — climb this far'
              : 'The marker is BELOW you — descend this far'
          }
        >
          {climb > 0 ? '▲' : '▼'} {Math.round(Math.abs(climb))} m
        </i>
      )}
    </div>
  );
}

/**
 * The pointer that rides ON the target, in the picture.
 *
 * The strip answers "which way" and "how far", and the climb chip answers "not
 * on this level". None of them can answer WHERE — a rooftop fifty metres down
 * the street is a place in the view, and a pilot looking at the city was being
 * handed three numbers in a corner instead of a mark on the building.
 *
 * Driven off `targetScreen`, a module singleton the Canvas writes every frame,
 * and updated here on its own rAF rather than through state: this moves with the
 * camera, and a store write per frame would re-render the whole overlay at frame
 * rate for a HUD that is otherwise published at 10 Hz.
 */
function TargetPointerHud() {
  const host = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLElement>(null);
  const glyph = useRef<HTMLElement>(null);

  useEffect(() => {
    let raf = 0;
    let lastText = '';
    let lastOff: boolean | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = host.current;
      if (!el) return;
      const t = targetScreen;
      if (!t.visible) {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = '1';
      el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) translate(-50%, -50%)`;

      if (t.offscreen !== lastOff) {
        lastOff = t.offscreen;
        el.classList.toggle('off', t.offscreen);
      }
      // Clamped, the chevron turns to point off the edge at where the mark is.
      // On screen it points straight down, at the mark under it, so it reads as
      // a pin dropped on the target rather than an arrow leading away from it.
      if (glyph.current) {
        glyph.current.style.transform = `rotate(${t.offscreen ? t.angle : 180}deg)`;
      }

      // The label is the expensive half — it touches the DOM's text — so it is
      // only written when it actually changes, which at metre resolution is a
      // few times a second rather than sixty.
      // Distance only. The pointer is already ON the mark in the picture, so a
      // climb chevron beside the number was saying, in text, what the pilot can
      // see: the pin is above or below them.
      const text = `${Math.round(t.distance)} m`;
      if (text !== lastText && label.current) {
        lastText = text;
        label.current.textContent = text;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="ms-pointer" ref={host} aria-hidden="true">
      <i className="ms-pointer-glyph" ref={glyph}>
        <svg viewBox="0 0 24 24">
          <path d="M12 2 L19 20 L12 15.6 L5 20 Z" />
        </svg>
      </i>
      <b className="ms-pointer-dist" ref={label} />
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
function DeliveryChecklist({
  fire,
  pickup,
  rescue,
  band,
}: {
  fire: boolean;
  pickup?: boolean;
  /**
   * The height the row is actually asking for, metres above the deck.
   *
   * 'Height' with a dot beside it names the failing condition and not the fix.
   * On a delivery that is survivable — the band opens at the ground, so 'lower'
   * is the only direction there is. The rescue hover is 12 to 22 m up a canyon,
   * where 'Height' unticked is equally consistent with too high and too low,
   * and the pilot has no way to tell which. The numbers say it in a glance.
   */
  band?: { min: number; max: number };
  /** The five second hover that confirms a rescue location. The same three
   *  conditions and the same bar — what changes is only what the holding is
   *  FOR, so it gets the wording rather than a second component. */
  rescue?: boolean;
}) {
  const checks = useMissionStore((s) => s.checks);
  const gate = useMissionStore((s) => s.gate);
  const suppressing = useMissionStore((s) => s.suppressing);
  // A mission with no required rings has nothing to be blocked ON, so the route
  // row is left off rather than shown as a permanent 0/0 tick. The rings gate
  // the RELEASE, never the collection, so the row is off on the pickup as well.
  const gated = gate.total > 0 && !pickup;
  const blocked = gate.left > 0;
  const title = rescue
    ? 'RESCUE CONFIRMATION'
    : pickup
      ? 'PICKUP CONDITIONS'
      : fire
        ? suppressing
          ? 'SUPPRESSING'
          : 'SUPPRESSION CONDITIONS'
        : 'RELEASE CONDITIONS';
  // Every condition met and the bar filling. Worth its own class: the card is
  // read out of the corner of the eye while the pilot is flying the hover, and
  // "everything is right, keep doing that" is the one state it has to be able to
  // say without being read.
  const armed = !blocked && checks.centred && checks.inBand && checks.steady;
  return (
    <div className={`ms-checks ${blocked ? 'blocked' : ''} ${armed ? 'armed' : ''}`}>
      <span className="ms-checks-head">
        {title}
        {/* The hold, as a number, beside the title rather than under the bar.
            A bar answers "nearly" and a pilot holding a five second hover wants
            "how much longer". */}
        {checks.hold > 0 && <em>{Math.round(checks.hold * 100)}%</em>}
      </span>
      {gated && (
        <span className={`ms-check ${blocked ? 'miss' : 'ok'}`}>
          <i />
          <b>Route</b>
          <em>
            {gate.total - gate.left}/{gate.total}
          </em>
        </span>
      )}
      <span className={`ms-check ${checks.centred ? 'ok' : ''}`}>
        <i />
        <b>
          {rescue
            ? 'Over the casualty'
            : pickup
              ? 'Over the package'
              : fire
                ? 'Over the fire'
                : 'Centred'}
        </b>
      </span>
      <span className={`ms-check ${checks.inBand ? 'ok' : ''}`}>
        <i />
        <b>Height</b>
        {band && (
          <em>
            {band.min}–{band.max} m
          </em>
        )}
      </span>
      <span className={`ms-check ${checks.steady ? 'ok' : ''}`}>
        <i />
        <b>Steady</b>
      </span>
      <span className="ms-checks-bar">
        <i style={{ width: `${checks.hold * 100}%` }} />
      </span>
      {blocked && (
        <span className="ms-checks-note">
          The package will not release: collect all the pink rings first
        </span>
      )}
      {rescue && checks.hold > 0 && checks.hold < 1 && (
        <span className="ms-checks-note">
          Hold it. Drift out of the zone and the confirmation starts again
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
  const atPickup = useMissionStore((s) => s.atPickup);
  const payload = useMissionStore((s) => s.payload);
  const points = useMissionStore((s) => s.points);
  const maxPoints = useMissionStore((s) => s.maxPoints);
  const distance = useMissionStore((s) => s.distance);
  const altitude = useMissionStore((s) => s.altitude);
  const climb = useMissionStore((s) => s.climb);
  const bearing = useMissionStore((s) => s.bearing);
  const elapsed = useMissionStore((s) => s.elapsed);
  const banner = useMissionStore((s) => s.banner);
  const radio = useMissionStore((s) => s.radio);
  const pointPop = useMissionStore((s) => s.pointPop);
  const result = useMissionStore((s) => s.result);
  const failReason = useMissionStore((s) => s.failReason);
  const collisions = useMissionStore((s) => s.collisions);
  const runIndex = useMissionStore((s) => s.runIndex);
  const deliveredCount = useMissionStore((s) => s.deliveredCount);
  const fireIntensity = useMissionStore((s) => s.fireIntensity);
  const siteIndex = useMissionStore((s) => s.siteIndex);
  const located = useMissionStore((s) => s.located);
  const signal = useMissionStore((s) => s.signal);
  const beginFlight = useMissionStore((s) => s.beginFlight);
  const start = useMissionStore((s) => s.start);
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
  /**
   * ENTER LAUNCHES THE MISSION, and it does it by being the focused button
   * rather than by listening for a key.
   *
   * The briefing holds a modal key lock, and that lock swallows Enter on
   * purpose: Enter is the ARM key, and it used to arm the drone from behind a
   * briefing the pilot had not read yet. A second listener racing the lock would
   * be re-opening exactly that hole.
   *
   * But the lock already draws the distinction this needs. It stops PROPAGATION
   * for every key, always — nothing in the flight controls ever sees one — and
   * only prevents the DEFAULT ACTION when focus is off the card. With focus on
   * one of the card's own buttons, Enter pressing that button is left alone,
   * because that is what the pilot is asking for. So the whole feature is: put
   * the focus where the answer is.
   */
  const launchRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase !== 'briefing') return;
    // After the commit, so the button the ref points at actually exists.
    launchRef.current?.focus();
  }, [phase]);
  // The landing leg counts as "not being flown" too. It is the two seconds
  // between the wheels settling and the result card appearing, the attempt is
  // already scored, and a throttle press in there put the drone back in the air
  // under a SAFE LANDING banner.
  useModalKeyLock(phase !== 'flying' || leg === 'landing', cardRef);

  if (!mission) return null;

  const flying = phase === 'flying';
  const fire = !!mission.fire;
  /** Every piece of target guidance is off while this is true — see the store.
   *  One answer, read by the strip here and by the map and the pointer. */
  const hidden = guidanceHidden(mission, located, leg);
  // The map's name comes from its own spec rather than from the mission, so a
  // renamed environment renames itself on every briefing that flies it.
  const mapName = getEnvironment(mission.envId)?.name ?? mission.envId;
  /** The package being flown, on a multi-point delivery. Null everywhere else,
   *  which is what leaves the single-delivery strip exactly as it was. */
  const run = runContextOf(mission, runIndex);
  const remaining = Math.max(0, mission.timeLimitSec - elapsed);
  const lowOnTime = remaining <= 45;

  /**
   * The next mission on the list, if this was not the last one.
   *
   * Only ever offered from the COMPLETE card. `finish` has already recorded the
   * result by the time this card is on screen, so the one behind it is unlocked
   * — but a pilot who failed has unlocked nothing, and a "next" button on the
   * failure card would be an invitation to skip the mission they just lost.
   */
  const nextMission = (() => {
    const i = MISSIONS.findIndex((m) => m.id === mission.id);
    return i >= 0 ? (MISSIONS[i + 1] ?? null) : null;
  })();

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
                <MissionHero envId={mission.envId} src={missionImage(mission.id, 'hero')} />
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
                        <StepArt art={step.art} src={missionImage(mission.id, i + 1)} />
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
                  </section>

                  <aside className="ms-brief-side">
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
                ref={launchRef}
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
                {/* Enter is named first because it is now the one that starts
                    the flight, and a key that does something has to be findable
                    before the key that backs out of it. */}
                <kbd>Enter</kbd> to launch · <kbd>Esc</kbd> to leave
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

      {flying && <TargetPointerHud />}

      {flying && leg === 'toDrop' && <DeliveryChecklist fire={fire} />}

      {/* The five second hover that confirms the rescue location. */}
      {flying && leg === 'confirming' && (
        <DeliveryChecklist fire={false} rescue band={rescueZoneOf(mission, siteIndex).band} />
      )}

      {/* The same card on the collection: the latch asks for the same hover the
          release does, and the pilot was being told so only at the drop. */}
      {flying && leg === 'toPickup' && atPickup && <DeliveryChecklist fire={fire} pickup />}

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
      {/* A search mission gets a MAP — the whole city, north up, with the red
          zone on it. Every other mission gets the drone-centred radar, which
          answers 'where now' with one dot and has nothing to say when the whole
          point is that nothing may answer that. */}
      {flying &&
        (mission.search ? <MissionCityMap mission={mission} /> : <MissionMap mission={mission} />)}

      {flying && (
        <div className="ms-strip">
          <div className="ms-obj">
            <span>OBJECTIVE</span>
            <b>{objectiveFor(leg, mission.kind, run)}</b>
          </div>
          {/* PAYLOAD. Every mission carries something, the search included — its
              food box. */}
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
              {/* Named while it is on board, on a mission that carries three of
                  them. 'On board' answers "am I holding something"; only the
                  name answers "which one", and on this mission that is the
                  question the pilot is actually asking. */}
              {payload === 'attached' ? (fire ? 'Ready' : (run?.name ?? 'On board')) : null}
              {payload === 'delivered' ? (fire ? 'Empty' : 'Delivered') : null}
            </b>
          </div>
          {/* How far through the job. Beside the payload rather than instead of
              the points, because it is the number this mission is about: a pilot
              two deliveries in wants to know there is one left, and the score
              says 3 / 4 for two different reasons. */}
          {run && (
            <div className="ms-cell">
              <span>PROGRESS</span>
              <b>
                {deliveredCount} <i>/ {run.total} delivered</i>
              </b>
            </div>
          )}
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
          {/* DISTANCE, or the SIGNAL that replaces it.

              Replaced rather than hidden, and rather than sitting beside it. The
              distance cell is the pilot's answer to "where now", and on a search
              mission the honest answer is "we do not know, but you are this warm"
              — two cells would let the pilot read the one that was switched off.
              Below the detect radius the cell says nothing at all: a signal
              reading 0% across the whole map is a detector that works at any
              range, because it can be flown against as a grid. */}
          {hidden ? (
            <div className={`ms-cell ${signal > 0 ? 'warn' : ''}`}>
              <span>SIGNAL</span>
              <b>{signal > 0 ? `${Math.round(signal * 100)}%` : '— — —'}</b>
            </div>
          ) : (
            <div className="ms-cell">
              <span>DISTANCE</span>
              <TargetArrow bearing={bearing} distance={distance} climb={climb} />
            </div>
          )}
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
                // A multi-point delivery reports each package by name. One
                // 'Payload delivered' tick for three separate flights would be
                // the result card summarising away most of the mission.
                ...(mission.deliveries
                  ? mission.deliveries.map((d) => [`${d.name} delivered`, '✓', true] as const)
                  : mission.kind === 'search'
                    ? // A search reports its own beats: the box, the find, the drop.
                      ([
                        ['Food box collected', '✓', true],
                        ['Person found', '✓', true],
                        ['Food box delivered', '✓', true],
                      ] as const)
                    : ([
                        [fire ? 'Payload collected' : 'Payload picked up', '✓', true],
                        [fire ? 'Fire suppressed' : 'Payload delivered', '✓', true],
                      ] as const)),
                // A mission that ends at the drop has no homeward leg to report.
                // Rows that always read '✓' are noise; rows for a leg that was
                // never flown are worse than noise.
                ...(mission.endsAtDrop
                  ? []
                  : ([
                      ['Returned to base', '✓', true],
                      ['Safe landing', '✓', true],
                    ] as const)),
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
              {/* The next mission leads, and 'Fly it again' steps back to being
                  the alternative.
                  
                  A pilot who has just been told the flight was clean is being
                  asked what to do next, and the card's answer was "do that
                  again" or "go back to a list and find it yourself". The list
                  is still there for picking a different one; this is the one
                  they are most likely to want. */}
              {nextMission && (
                <button
                  className="ms-btn primary"
                  onClick={() => {
                    playClick();
                    // `start` loads the mission and opens its BRIEFING rather
                    // than launching it. The next mission is a different map, a
                    // different job and a different rubric, and dropping the
                    // pilot into it mid-air with none of that read would be a
                    // worse welcome than the list they came from.
                    start(nextMission);
                  }}
                >
                  Next mission ›
                </button>
              )}
              <button className={`ms-btn ${nextMission ? '' : 'primary'}`} onClick={flyAgain}>
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
            <h2>
              {failReason === 'timeout'
                ? 'Out of time'
                : failReason === 'strayed'
                  ? 'Left the mission area'
                  : failReason === 'payload'
                    ? 'Payload lost'
                    : 'Drone destroyed'}
            </h2>
            <p className="ms-fail-line">
              {failReason === 'payload'
                ? 'The drone dropped into the flames and the tank went with it. Hold the hover above the fire: the height band on the checklist is where the spray reaches from.'
                : failReason === 'strayed'
                  ? fire
                    ? 'The drone flew out of the response area and did not come back. The arrow on the strip points at the fire the whole way.'
                    : 'The drone flew out of the delivery area and did not come back. The arrow on the strip points at your next target.'
                  : failReason === 'timeout'
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
