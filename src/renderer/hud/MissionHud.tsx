import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  useMissionStore,
  guidanceHidden,
  objectiveFor,
  runContextOf,
  isMissionUnlocked,
} from '../state/missionStore';
import { useFlightStore } from '../state/flightStore';
import { resetForMission } from '../missions/reset';
import { playClick, playStar, playSuccess } from '../audio/sfx';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { MissionMap } from './MissionMap';
import { PauseOverlay } from './PauseOverlay';
import { MissionCityMap } from './MissionCityMap';
import { StepArt, missionImage } from './MissionArt';
import { MISSIONS } from '../missions';
import { targetScreen } from '../missions/targetScreen';
import type { Mission } from '../missions/types';
import { Badge, Button, Icon, Keycap, StarRating, StatTile } from '../ds';
import { MissionPicture, mapNameOf } from './MissionPicture';
import {
  bestTimeText,
  briefHeader,
  clock,
  countLine,
  directionText,
  failFix,
  failHeadline,
  failWhere,
  hudStarLine,
  latestLog,
  mapBlocksWord,
  missionGapLine,
  missionResultTiers,
  missionTiers,
  objectiveLabel,
  objectiveRows,
  payloadName,
  targetLabel,
  timeLeft,
  type AttemptFacts,
  type ObjectiveRow,
} from '../app/missionFacts';

// ----------------------------------------------------------------------------
// The mission overlay (Phase 5, Pluto Field Ops).
//
// Classroom cards before and after the flight — the briefing, the result and
// the failure card, each under a header band ("Mission 1 of 10 · …", Esc
// Mission list) — and in flight the cockpit: an objective band with the time
// left and the star marks, the radio (L opens the log), the plan map, and one
// strip along the bottom. Every word comes from missionFacts.ts; nothing here
// scores.
//
// The transient layers — the banner, the Mission Control line, the "+1" — are
// driven by `MissionDirector` off the mission clock, so nothing here holds a
// timer of its own that could outlive the attempt.
// ----------------------------------------------------------------------------

/** Height difference, in metres, under which the marker counts as being on the
 *  pilot's own level and the climb note stays off. Roughly a storey. */
const CLIMB_DEADBAND = 3;

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
}: {
  fire: boolean;
  pickup?: boolean;
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

/**
 * The tracking lock: the five seconds of light, drawn as a ring that fills.
 *
 * Its own card rather than the delivery checklist with different words, and the
 * difference is not cosmetic. That card lists three conditions the pilot can
 * fix — centred, height, steady — because the thing being held over is not
 * going anywhere. Here there is ONE condition, the light is on the animal or it
 * is not, and it is the animal that decides half of it. Three rows, two of them
 * permanently ticked, would be a card lying about how much control the pilot
 * has.
 *
 * The ring rather than the bar, and this is the question that was asked when the
 * mission was specified: a bar or an audio cue. A five second hold with no
 * feedback is a pilot guessing whether they are doing it at all, so there has to
 * be something; and it is a ring because it sits in the top centre where the
 * eye already is, reads as a fraction at a glance without being measured against
 * its own ends, and — unlike a bar — is unmistakable while DRAINING, which is
 * the state this mission spends most of its time in.
 */
function TrackingLock({ seconds }: { seconds: number }) {
  const lock = useMissionStore((s) => s.lock);
  const lit = useMissionStore((s) => s.lit);
  const tooClose = useMissionStore((s) => s.tooClose);
  /** Circumference of the r=26 ring below, so the dash offset is a fraction. */
  const C = 2 * Math.PI * 26;
  const left = Math.max(0, seconds - lock * seconds);
  return (
    <div className={`ms-checks track ${tooClose ? 'blocked' : lit ? 'armed' : ''}`}>
      <span className="ms-checks-head">
        {tooClose ? 'TOO CLOSE' : lit ? 'TRACKING' : 'LIGHT LOST'}
        <em>{left.toFixed(1)}s</em>
      </span>
      <svg className="ms-lock-ring" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="26" className="ms-lock-track" />
        <circle
          cx="30"
          cy="30"
          r="26"
          className="ms-lock-fill"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - lock)}
        />
      </svg>
      <span className="ms-checks-note">
        {tooClose
          ? 'Back off, you are disturbing the animal'
          : lit
            ? 'Hold it. Stay above it and keep your distance'
            : 'Out of the light. Find it again. The lock drains, it does not reset'}
      </span>
    </div>
  );
}

/**
 * The inspection hold, in the brief's own layout:
 *
 *     NIGHT INSPECTION
 *     ZONE 2 / 3
 *     INSPECTION ███████░░░ 70%
 *
 * with the five things the hold is watching underneath. Two more than the
 * delivery checklist — the light and the clearance — because at night those
 * are the two a pilot loses without noticing, and a bar that stops filling
 * with no row going red is a pilot guessing which of five things broke.
 */
function InspectionCard({ mission }: { mission: Mission }) {
  const checks = useMissionStore((s) => s.checks);
  const runIndex = useMissionStore((s) => s.runIndex);
  const points = mission.inspection?.points ?? [];
  if (points.length === 0) return null;
  const i = Math.min(runIndex, points.length - 1);
  const point = points[i];
  const clear = checks.clear !== false;
  // A daylight patrol has no lamp to aim, so no light row and nothing to wait on.
  const needsLight = mission.inspection?.needsLight !== false;
  const lit = !needsLight || checks.lit === true;
  const armed = checks.centred && checks.inBand && checks.steady && lit && clear;
  const filled = Math.round(checks.hold * 10);
  return (
    <div className={`ms-checks inspect ${clear ? '' : 'blocked'} ${armed ? 'armed' : ''}`}>
      <span className="ms-checks-head">
        {mission.inspection?.cardTitle ?? 'NIGHT INSPECTION'}
        <em>
          ZONE {i + 1} / {points.length}
        </em>
      </span>
      <span className="ms-checks-sub">{point.label}</span>
      <span
        className="ms-inspect-meter"
        aria-label={`Inspection ${Math.round(checks.hold * 100)}%`}
      >
        <b>INSPECTION</b>
        <span>
          {'█'.repeat(filled)}
          <i>{'░'.repeat(10 - filled)}</i>
        </span>
        <em>{Math.round(checks.hold * 100)}%</em>
      </span>
      <span className={`ms-check ${checks.centred ? 'ok' : ''}`}>
        <i />
        <b>In position</b>
      </span>
      <span className={`ms-check ${checks.inBand ? 'ok' : ''}`}>
        <i />
        <b>Height</b>
      </span>
      {needsLight && (
        <span className={`ms-check ${lit ? 'ok' : ''}`}>
          <i />
          <b>Light on marker</b>
        </span>
      )}
      <span className={`ms-check ${checks.steady ? 'ok' : ''}`}>
        <i />
        <b>Steady</b>
      </span>
      <span className={`ms-check ${clear ? 'ok' : 'miss'}`}>
        <i />
        <b>Clear of structure</b>
      </span>
      {!clear && (
        <span className="ms-checks-note">Obstacle too close. Back away from the structure</span>
      )}
      {clear && checks.hold > 0 && checks.hold < 1 && (
        <span className="ms-checks-note">Hold it. Move away and the inspection restarts</span>
      )}
    </div>
  );
}

/** The environments `MissionCityMap` can draw a plan of. */
const PLANNED_ENVS = new Set(['new-york', 'forest', 'construction-site', 'supermarket']);

/** The plan map, or the radar on a map with no plan. */
function PlanMap({ mission }: { mission: Mission }) {
  return PLANNED_ENVS.has(mission.envId) ? (
    <MissionCityMap mission={mission} />
  ) : (
    <MissionMap mission={mission} />
  );
}

/** A keycap and what it does: "Esc Mission list". */
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

/** The band over the briefing, result and failure cards. */
function MissionBand({ mission, onExit }: { mission: Mission; onExit: () => void }) {
  const head = briefHeader(mission, MISSIONS.length, mapNameOf(mission));
  return (
    <header className="tband mband" data-register="classroom">
      <div className="tband__id">
        <b>{head.title}</b>
        <span>{head.sub}</span>
      </div>
      <span />
      <div className="tband__right">
        <KeyAction cap="Esc" onClick={onExit}>
          Mission list
        </KeyAction>
      </div>
    </header>
  );
}

// ---- Briefing ------------------------------------------------------------------

function Briefing({
  mission,
  cardRef,
}: {
  mission: Mission;
  cardRef: RefObject<HTMLDivElement | null>;
}) {
  const beginFlight = useMissionStore((s) => s.beginFlight);
  const launchRef = useRef<HTMLButtonElement>(null);
  const mapName = mapNameOf(mission);
  const tiers = missionTiers(mission);

  /*
   * ENTER LAUNCHES THE MISSION by being the focused button rather than by a key
   * listener: the card's key lock swallows Enter (the ARM key) unless focus is
   * on one of the card's own buttons, and then it presses that button.
   */
  useEffect(() => {
    launchRef.current?.focus({ preventScroll: true });
  }, []);

  const launch = () => {
    playClick();
    // The aircraft is put back BEFORE the phase changes: the mission's frame
    // loop can tick between a commit and its effects, and a crash flag from
    // before the attempt would fail it on its first frame.
    resetForMission();
    beginFlight();
  };

  return (
    <div className="mstage" data-register="classroom">
      <div className="mbrief" ref={cardRef} role="dialog" aria-label={`Briefing: ${mission.name}`}>
        <section className="mbrief__main">
          <figure className="mbrief__hero">
            <MissionPicture mission={mission} />
            <figcaption>
              {mapName} · {mission.mapNote}
            </figcaption>
          </figure>
          <h1 className="mbrief__title">{mission.name}</h1>
          <p className="mbrief__story">{mission.story}</p>
          <ol className="mbrief__steps">
            {mission.flow.map((step, i) => (
              <li key={step.label}>
                <span className="mbrief__step-pic">
                  <StepArt art={step.art} src={missionImage(mission.id, i + 1)} />
                  <span className="mbrief__step-n">{i + 1}</span>
                </span>
                <span className="mbrief__step-text">
                  <b>
                    {i + 1}. {step.label}.
                  </b>{' '}
                  {step.note}.
                </span>
              </li>
            ))}
          </ol>
          {/* Clues and rules sit under the steps: the side column keeps the
              objectives, stars, map and Launch, so Launch stays on screen. */}
          {mission.clues && mission.clues.length > 0 && (
            <section className="mbrief__panel">
              <h2>Search clues</h2>
              <ul className="mbrief__notes">
                {mission.clues.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}
          {mission.rules && mission.rules.length > 0 && (
            <section className="mbrief__panel">
              <h2>Mission rules</h2>
              <ul className="mbrief__notes is-rules">
                {mission.rules.map((line) => (
                  <li key={line}>
                    <Icon name="warning" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </section>

        <aside className="mbrief__side">
          <section className="mbrief__panel">
            <h2>Objectives</h2>
            <ol className="mbrief__objs">
              {mission.objectives.map((line, i) => (
                <li key={line}>
                  <span className="mbrief__obj-n">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="mbrief__panel">
            <h2>Stars</h2>
            {tiers.map((t) => (
              <div key={t.stars} className="mbrief__tier">
                <StarRating earned={t.stars} showText={false} />
                <span>{t.text}</span>
              </div>
            ))}
          </section>

          <section className="mbrief__mapcard">
            <div className="mbrief__plan">
              <PlanMap mission={mission} />
              <span className="mbrief__north" aria-hidden="true">
                N ▲
              </span>
            </div>
            <div className="mbrief__limit">
              <span className="ds-label">Time limit</span>
              <b>{clock(mission.timeLimitSec)}</b>
              <span>
                {mapName} · {payloadName(mission)} · {countLine(mission)}
              </span>
              <span className="mbrief__legend">
                <span>
                  <Icon name="ring" /> {mission.zones.base.label}
                </span>
                <span>
                  <Icon name="diamond" /> Targets
                </span>
                <span>
                  <Icon name="square" /> {mapBlocksWord(mission.envId)}
                </span>
              </span>
            </div>
          </section>

          <div className="mbrief__launch">
            <Button ref={launchRef} variant="primary" iconAfter="play" onClick={launch}>
              Launch mission
            </Button>
            <p className="mbrief__hint">
              <Keycap>Enter</Keycap> launches · <Keycap>Esc</Keycap> Mission list
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---- In flight -----------------------------------------------------------------

/** The top band: objective, time left and the star marks. */
function ObjectiveBand({ mission }: { mission: Mission }) {
  const leg = useMissionStore((s) => s.leg);
  const runIndex = useMissionStore((s) => s.runIndex);
  const deliveredCount = useMissionStore((s) => s.deliveredCount);
  const elapsed = useMissionStore((s) => s.elapsed);
  const collisions = useMissionStore((s) => s.collisions);
  const maxPoints = useMissionStore((s) => s.maxPoints);
  const run = runContextOf(mission, runIndex);
  const left = timeLeft(mission.timeLimitSec, elapsed);
  const limit = mission.timeLimitSec;
  const timed = missionTiers(mission).filter((t) => t.within !== null);
  return (
    <div className={`mobj${left.caution ? ' is-caution' : ''}`}>
      <div className="mobj__top">
        <div className="mobj__text">
          <span className="mobj__label">{objectiveLabel(mission, deliveredCount)}</span>
          <b>{objectiveFor(leg, mission.kind, run)}</b>
        </div>
        <div className="mobj__clock" role="timer" aria-label={`${left.text} left`}>
          {left.caution && <Icon name="warning" />}
          <b>{left.text}</b>
          <span>Left</span>
        </div>
      </div>
      <div className="mobj__track" aria-hidden="true">
        <span className="mobj__fill" style={{ width: `${Math.min(100, (elapsed / limit) * 100)}%` }} />
        {timed.map((t) => {
          const lost = elapsed > (t.within as number);
          return (
            <span
              key={t.stars}
              className={`mobj__mark${lost ? ' is-lost' : ''}`}
              style={{ left: `${((t.within as number) / limit) * 100}%` }}
            >
              <span className="mobj__mark-label">
                {lost && <Icon name="cross" />}
                {Array.from({ length: t.stars }, (_, i) => (
                  <Icon key={i} name="star" />
                ))}
                {clock(t.within as number)}
              </span>
            </span>
          );
        })}
      </div>
      <p className="mobj__line">{hudStarLine(mission, maxPoints, elapsed, collisions)}</p>
    </div>
  );
}

/** RADIO · LATEST, or the whole log with L. */
function RadioPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const log = useMissionStore((s) => s.log);
  const lines = open ? log : latestLog(log, 2);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, open]);
  return (
    <div className={`mradio${open ? ' is-open' : ''}`}>
      <header className="mradio__head">
        <span>{open ? `Radio log · ${log.length} messages` : 'Radio · latest'}</span>
        <KeyAction cap="L" onClick={onToggle}>
          {open ? 'Less' : 'Log'}
        </KeyAction>
      </header>
      {lines.length === 0 ? (
        <p className="mradio__empty">No messages yet</p>
      ) : (
        <ol className="mradio__lines" ref={listRef}>
          {lines.map((line) => (
            <li key={line.id} className={`is-${line.kind}`}>
              <span className="mradio__at">{clock(line.at)}</span>
              <Icon
                name={
                  line.kind === 'warn' ? 'warning' : line.kind === 'good' ? 'check' : 'dot'
                }
              />
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The bottom strip: payload, points, direction, altitude, and the keys. */
function MissionStrip({ mission, onExit }: { mission: Mission; onExit: () => void }) {
  const leg = useMissionStore((s) => s.leg);
  const payload = useMissionStore((s) => s.payload);
  const points = useMissionStore((s) => s.points);
  const maxPoints = useMissionStore((s) => s.maxPoints);
  const distance = useMissionStore((s) => s.distance);
  const altitude = useMissionStore((s) => s.altitude);
  const climb = useMissionStore((s) => s.climb);
  const bearing = useMissionStore((s) => s.bearing);
  const runIndex = useMissionStore((s) => s.runIndex);
  const deliveredCount = useMissionStore((s) => s.deliveredCount);
  const collected = useMissionStore((s) => s.collected);
  const located = useMissionStore((s) => s.located);
  const signal = useMissionStore((s) => s.signal);
  const lock = useMissionStore((s) => s.lock);
  const lit = useMissionStore((s) => s.lit);
  const tooClose = useMissionStore((s) => s.tooClose);
  const fireIntensity = useMissionStore((s) => s.fireIntensity);
  const armed = useFlightStore((s) => s.armed);
  const togglePause = useFlightStore((s) => s.togglePause);

  const fire = !!mission.fire;
  const track = !!mission.tracking;
  const inspect = !!mission.inspection;
  const carriesDispatch = !!mission.inspection?.points.some((p) => p.dispatch);
  const hidden = guidanceHidden(mission, located, leg);
  const run = runContextOf(mission, runIndex);
  const vertical = Math.abs(climb) >= CLIMB_DEADBAND;

  // A survey carries nothing: a cell reading 'Empty' for the whole flight is a
  // cell the pilot learns to ignore.
  const showPayload = !track && (!inspect || carriesDispatch);
  const payloadWord =
    payload === 'waiting'
      ? 'Empty'
      : payload === 'attached'
        ? fire
          ? 'Ready'
          : (run?.name ?? mission.wording?.onBoard ?? 'On board')
        : fire
          ? 'Empty'
          : 'Delivered';

  return (
    <div className="mstrip">
      {showPayload && (
        <div className={`mstrip__cell is-${payload}`}>
          <span className="mstrip__label">Payload</span>
          <b>
            {payloadWord}
            {payload === 'attached' && (
              <i className="mstrip__ok">
                <Icon name="dot" /> held
              </i>
            )}
          </b>
        </div>
      )}
      {run && (
        <div className="mstrip__cell">
          <span className="mstrip__label">Progress</span>
          <b>
            {deliveredCount}
            <i>
              {' '}
              of {run.total} {inspect ? 'inspected' : 'done'}
            </i>
          </b>
        </div>
      )}
      {fire && (
        <div className={`mstrip__cell${fireIntensity > 0 ? ' is-warn' : ''}`}>
          <span className="mstrip__label">Fire</span>
          <b>{Math.round(fireIntensity * 100)} %</b>
        </div>
      )}
      <div className="mstrip__cell">
        <span className="mstrip__label">Points</span>
        <b>
          {points}
          <i> of {maxPoints}</i>
        </b>
      </div>
      {hidden && track ? (
        <div className={`mstrip__cell${tooClose ? ' is-warn' : lit ? ' is-good' : ''}`}>
          <span className="mstrip__label">{tooClose ? 'Too close' : 'Lock'}</span>
          <b>{lit || lock > 0 ? `${Math.round(lock * 100)} %` : '- - -'}</b>
        </div>
      ) : hidden ? (
        <div className={`mstrip__cell${signal > 0 ? ' is-warn' : ''}`}>
          <span className="mstrip__label">Signal</span>
          <b>{signal > 0 ? `${Math.round(signal * 100)} %` : '- - -'}</b>
        </div>
      ) : (
        <div className="mstrip__cell mstrip__to">
          <span className="mstrip__label">To {targetLabel(mission, leg, runIndex, collected)}</span>
          <b>
            {directionText(bearing, distance)}
            {vertical && (
              <i className="mstrip__climb">
                {climb > 0 ? '▲' : '▼'} {Math.round(Math.abs(climb))} m
              </i>
            )}
          </b>
        </div>
      )}
      <div className="mstrip__cell">
        <span className="mstrip__label">Altitude</span>
        <b>{altitude.toFixed(1)} m</b>
      </div>
      <div className="mstrip__keys">
        <Badge tone={armed ? 'armed' : 'neutral'} icon={armed ? 'dot' : 'ring'}>
          {armed ? 'Armed' : 'Disarmed'}
        </Badge>
        <KeyAction cap="P" onClick={togglePause}>
          Pause
        </KeyAction>
        <KeyAction cap="Esc" onClick={onExit}>
          Mission list
        </KeyAction>
      </div>
    </div>
  );
}

// ---- Result and failure ----------------------------------------------------------

function ObjectiveList({ rows }: { rows: readonly ObjectiveRow[] }) {
  return (
    <section className="mresult__objs">
      <h2>Objectives</h2>
      {rows.map((row) => (
        <div key={row.label} className={`mresult__obj${row.ok ? ' is-ok' : ' is-miss'}`}>
          <Icon name={row.ok ? 'check' : 'cross'} />
          <span className="mresult__obj-label">{row.label}</span>
          <span className="mresult__obj-value">{row.value}</span>
        </div>
      ))}
    </section>
  );
}

function useAttemptFacts(delivered: boolean, landed: boolean): AttemptFacts {
  const deliveredCount = useMissionStore((s) => s.deliveredCount);
  const deliveredAt = useMissionStore((s) => s.deliveredAt);
  const landedAt = useMissionStore((s) => s.landedAt);
  const collected = useMissionStore((s) => s.collected);
  const collisions = useMissionStore((s) => s.collisions);
  const collisionAt = useMissionStore((s) => s.collisionAt);
  return {
    delivered,
    landed,
    deliveredCount,
    deliveredAt,
    landedAt,
    checkpoints: Object.keys(collected).length,
    collisions,
    collisionAt,
  };
}

function ResultCard({
  mission,
  cardRef,
  onExit,
  onReplay,
}: {
  mission: Mission;
  cardRef: RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onReplay: () => void;
}) {
  const result = useMissionStore((s) => s.result)!;
  const bestBefore = useMissionStore((s) => s.bestBefore);
  const start = useMissionStore((s) => s.start);
  const facts = useAttemptFacts(result.delivered, result.landed);
  const nextRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLButtonElement>(null);

  const i = MISSIONS.findIndex((m) => m.id === mission.id);
  const next = i >= 0 ? (MISSIONS[i + 1] ?? null) : null;
  // `finish` recorded the result before this card, so the next one is open.
  const hasNext = !!next && isMissionUnlocked(MISSIONS, next.id);
  const tiers = missionResultTiers(mission, result.stars, result);
  const best = bestTimeText(bestBefore?.timeSec ?? null, result.timeSec);

  // The flourish, once: the success chime and a ding per star.
  useEffect(() => {
    const timers: number[] = [];
    playSuccess();
    for (let s = 0; s < result.stars; s++) {
      timers.push(window.setTimeout(() => playStar(s), 420 + s * 320));
    }
    (hasNext ? nextRef : listRef).current?.focus({ preventScroll: true });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="mstage" data-register="classroom">
      <div
        className="tresult mresult"
        ref={cardRef}
        role="dialog"
        aria-label={`Result: ${mission.name}`}
      >
        <header className="tresult__head">
          <div>
            <p className="tresult__meta">
              Mission {mission.order} · {mission.name}
            </p>
            <h1 className="tresult__title">
              <StarRating earned={result.stars} showText={false} />
              {result.stars} of 3 stars
            </h1>
          </div>
          <Badge tone="armed" icon="check">
            Complete
          </Badge>
        </header>

        <div className="tresult__tiles">
          <StatTile
            label="Time"
            value={clock(result.timeSec)}
            note={`of ${clock(mission.timeLimitSec)}`}
          />
          <StatTile label="Points" value={`${result.points}`} note={`of ${result.maxPoints}`} />
          <StatTile
            label="Best time"
            value={best.value}
            note={best.isNew ? (bestBefore ? 'New best' : 'First finish') : undefined}
          />
        </div>

        <ObjectiveList rows={objectiveRows(mission, facts)} />

        <div className="tresult__tiers">
          {tiers.map((t) => (
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
        <p className="tresult__gap">{missionGapLine(mission, result.stars, result.timeSec)}</p>

        <footer className="tresult__actions">
          <p className="mresult__signoff">“{mission.radio.complete.text}”</p>
          <span className="tresult__buttons">
            <Button ref={listRef} onClick={onExit}>
              Mission list
            </Button>
            <Button onClick={onReplay}>Replay</Button>
            {hasNext && next && (
              <Button
                ref={nextRef}
                variant="primary"
                iconAfter="play"
                onClick={() => {
                  playClick();
                  // Opens the next mission's BRIEFING, never the flight.
                  start(next);
                }}
              >
                Next: Mission {next.order}
              </Button>
            )}
          </span>
        </footer>
      </div>
    </div>
  );
}

function FailureCard({
  mission,
  cardRef,
  onExit,
  onReplay,
}: {
  mission: Mission;
  cardRef: RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onReplay: () => void;
}) {
  const failReason = useMissionStore((s) => s.failReason);
  const endedAt = useMissionStore((s) => s.endedAt);
  const payload = useMissionStore((s) => s.payload);
  const start = useMissionStore((s) => s.start);
  const facts = useAttemptFacts(false, false);
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    retryRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="mstage" data-register="classroom">
      <div
        className="tresult mresult is-failed"
        ref={cardRef}
        role="dialog"
        aria-label={`Mission failed: ${mission.name}`}
      >
        <header className="tresult__head">
          <div>
            <p className="tresult__meta">
              Mission {mission.order} · {mission.name}
            </p>
            <h1 className="mresult__fail-title">
              <Icon name="cross" />
              {failHeadline(failReason)}
            </h1>
            <p className="mresult__where">
              {failWhere(failReason, endedAt, mission.timeLimitSec)}
            </p>
          </div>
          <Badge tone="fail" icon="cross">
            Mission failed
          </Badge>
        </header>

        <div className="mresult__place">
          <div className="mresult__plan">
            <PlanMap mission={mission} />
            <span className="mresult__x" aria-hidden="true">
              <Icon name="cross" />
            </span>
            <span className="mbrief__north" aria-hidden="true">
              N ▲
            </span>
          </div>
          <p>
            Where it ended: the drone is in the red ring
            {endedAt ? `, ${clock(endedAt.sec)} into the flight` : ''}.
          </p>
        </div>

        <ObjectiveList rows={objectiveRows(mission, facts)} />

        <p className="tresult__gap">{failFix(mission, failReason, payload === 'attached')}</p>

        <footer className="tresult__actions">
          <span />
          <span className="tresult__buttons">
            <Button onClick={onExit}>Mission list</Button>
            <Button
              onClick={() => {
                playClick();
                start(mission);
              }}
            >
              Briefing
            </Button>
            <Button ref={retryRef} variant="primary" onClick={onReplay}>
              Try again
            </Button>
          </span>
        </footer>
      </div>
    </div>
  );
}

// ---- The HUD ----------------------------------------------------------------------

export function MissionHud() {
  const mission = useMissionStore((s) => s.mission);
  const phase = useMissionStore((s) => s.phase);
  const leg = useMissionStore((s) => s.leg);
  const atPickup = useMissionStore((s) => s.atPickup);
  const banner = useMissionStore((s) => s.banner);
  const pointPop = useMissionStore((s) => s.pointPop);
  const runIndex = useMissionStore((s) => s.runIndex);
  const restart = useMissionStore((s) => s.restart);
  const exit = useMissionStore((s) => s.exit);
  const [logOpen, setLogOpen] = useState(false);

  // The briefing, the result and the failure card each stop the flight dead,
  // and the keyboard has to agree — see `useModalKeyLock`. The landing leg
  // counts too: the attempt is already scored, and a throttle press in there
  // put the drone back in the air.
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyLock(phase !== 'flying' || leg === 'landing', cardRef);

  // L opens and closes the radio log while flying. Not a flight key.
  useEffect(() => {
    if (phase !== 'flying') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyL' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      setLogOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (!mission) return null;

  const flying = phase === 'flying';
  const fire = !!mission.fire;
  const inspect = !!mission.inspection;
  const run = runContextOf(mission, runIndex);

  const leave = () => {
    playClick();
    exit();
  };
  /** Put the drone back on the pad AND the mission back to the start. The
   *  Director notices the sim's reset token move and tears the attempt down;
   *  this only asks for it, so there is exactly one restart path. */
  const flyAgain = () => {
    playClick();
    restart();
    resetForMission();
  };

  return (
    <div className="ms-hud mhud">
      {flying && <PauseOverlay menu={false} />}

      {!flying && <MissionBand mission={mission} onExit={leave} />}

      {phase === 'briefing' && <Briefing mission={mission} cardRef={cardRef} />}

      {flying && (
        <div className="mhud__flight" data-register="cockpit">
          <RadioPanel open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
          <ObjectiveBand mission={mission} />
          <div className="mhud__map">
            <PlanMap mission={mission} />
          </div>

          {/* The banner: one line, centre of the view, gone in under three seconds.
              It is also written to the log. */}
          {banner && (
            <div key={banner.id} className={`ms-banner ${banner.kind}`}>
              <b>{banner.title}</b>
              {banner.sub && <span>{banner.sub}</span>}
            </div>
          )}

          {/* "+1 POINT", floating off the score. */}
          {pointPop && (
            <div key={pointPop.id} className="ms-pop">
              +1 POINT
              <i>{pointPop.label}</i>
            </div>
          )}

          <TargetPointerHud />

          {/* A patrol's dispatch is a delivery, and gets the delivery's card. */}
          {leg === 'toDrop' && (!inspect || run?.dispatch) && <DeliveryChecklist fire={fire} />}
          {leg === 'toDrop' && inspect && !run?.dispatch && <InspectionCard mission={mission} />}
          {leg === 'confirming' && mission.tracking && (
            <TrackingLock seconds={mission.tracking.lockSeconds} />
          )}
          {leg === 'confirming' && !mission.tracking && (
            <DeliveryChecklist fire={false} rescue />
          )}
          {leg === 'toPickup' && atPickup && <DeliveryChecklist fire={fire} pickup />}

          <MissionStrip mission={mission} onExit={leave} />
        </div>
      )}

      {phase === 'complete' && (
        <ResultCard mission={mission} cardRef={cardRef} onExit={leave} onReplay={flyAgain} />
      )}
      {phase === 'failed' && (
        <FailureCard mission={mission} cardRef={cardRef} onExit={leave} onReplay={flyAgain} />
      )}
    </div>
  );
}
