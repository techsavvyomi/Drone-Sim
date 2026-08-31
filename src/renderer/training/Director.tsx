import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { clamp } from '../sim/mathx';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useUiStore } from '../state/uiStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, nextLesson } from './lessons';
import { HOVER } from './lessons/arena';
import { scaleScriptedStick } from './lessons/demoFlight';
import { BEGINNER_CONFIG, configFor } from '../sim/control/flightController';
import { useSettingsStore } from '../state/settingsStore';
import { getDrone } from '../plugins/registry';
import { dronePose } from '../sim/drone/pose';
import { starsFor } from './lessons/types';
import type { Lesson, LessonMemory } from './lessons/types';
import {
  stick,
  resetStick,
  setScripted,
  setScriptedStick,
  runScriptedCommand,
} from '../input/controls';
import { playCollect, playFail, playWhoosh } from '../audio/sfx';
import type { Vec3 } from '@shared/types';

// The Director runs a lesson through Explain -> Demonstrate -> Practice ->
// Validate -> Reward. It is headless (renders nothing) but lives inside the
// training <Canvas>, so its useFrame ticks in lock-step with the sim.
//
// Phase is stored in trainingStore (the HUD's buttons also advance it — "Watch
// Demonstration", "Next Lesson"). The Director detects phase *entry* and runs
// the matching setup, then ticks the active phase each frame.

/*
 * Lessons are authored in WORLD coordinates, because they fly the academy's own
 * furniture: a gate standing at y = 2.6 is at 2.6 in the lesson too. They used
 * to be pad-local — every height quietly measured from the 12 cm helipad slab —
 * which only worked while every target was a prop the lesson drew for itself on
 * that slab. One frame of reference for the arena, the probe and the route
 * guide is the only workable rule now that a route runs to a gate 39 m out.
 */
/** Reused so the per-frame probe does not allocate. */
const _probePos: Vec3 = [0, 0, 0];

/** Mean stick jerk (per second) that maps to zero smoothness. */
const JERK_K = 3.0;
/** Consecutive hard failures before the demo auto-replays. */
const REPLAY_AFTER_FAILS = 2;
/** Seconds the reward panel shows before auto-advancing. */
const REWARD_DWELL = 5.0;
/** Demo playback rate.
 *
 * MUST stay 1. The demo timeline is not a video — its timestamps are what hold
 * the sticks over, so stretching the clock stretches every control input and the
 * drone travels the SQUARE of the stretch further. At 0.55 the demonstrations
 * flew roughly three times past their own markers and off the pad, which is
 * where "the demo does not show what the lesson asks for" came from. To slow a
 * demonstration down, lower the tilt in `demoFlight.ts` — the planner then
 * lengthens the legs to match, and the drone still stops on the marker. */
const DEMO_SPEED = 1;
/** Roughly how long a first viewing should spend watching. Short lessons get
 *  both passes; a four-cornered route gets one, because the cap that matters is
 *  time sitting still, not the number of repeats. */
const DEMO_BUDGET = 34;
/** How many times the demonstration plays before Practice, first time through.
 *  Two: one to watch and one to follow. Three was a third of a minute sitting
 *  still on the short modules, and the pilot has a replay button anyway. */
const DEMO_REPEATS = 2;
/** ...and on every replay after that. Three run to nearly a minute, which is a
 *  long time to sit still when you have already watched it and only got sent
 *  back for running out of practice time. One is a reminder, not a lecture. */
const DEMO_REPLAY_REPEATS = 1;
/** Seconds without progress before the demo replays, for a lesson that sets none. */
const PRACTICE_TIMEOUT = 45;
/** How much the progress bar has to gain to count as "still getting somewhere"
 *  and restart the stall clock. Small enough that real movement registers,
 *  large enough that hovering and jittering does not. */
const PROGRESS_STEP = 0.02;
/** Seconds the success condition must hold before the reward, so the pilot
 *  sees the "✓" confirmation instead of the lesson snapping shut instantly. */
const DONE_HOLD = 1.2;
/** Seconds a one-shot command keycap (ARM, SPACE) stays lit after it fires.
 *  Movement caps are not flashed at all — they follow the sticks, below. */
const KEY_FLASH = 0.8;
/** Stick travel that counts as "the demo is holding this key". */
const KEY_DEADBAND = 0.05;

// Closed-loop yaw, for demo steps that name a heading rather than a stick hold.
// See `DemoStep.yawTo`: a timed hold lands where the yaw controller's ramp
// happens to put it that run, and since the heading is the frame the following
// legs are flown in, a few degrees of error swings the whole rest of the route.
/** Biggest yaw stick the hold will command. */
const YAW_MAX = 0.5;
/** Heading error at which the stick starts easing off, radians (~25 deg). */
const YAW_TAPER = 0.44;
/** Close enough to stop steering, radians (~1.5 deg). */
const YAW_DEADBAND = 0.026;

/** Longest the demo clock will wait on an auto sequence before giving up on it.
 *  Generous — a climb is about two seconds and a descent three or four — but
 *  finite, so a sequence that never completes stalls one demonstration rather
 *  than hanging Flight School. */
const AUTO_WAIT = 9;
/** Longest a demo step will wait for the drone to reach the spot it names. */
const DEMO_WAIT_MAX = 25;

/**
 * Which keycaps the demonstration is holding down, read off the scripted sticks.
 *
 * Flashing `step.key` for a moment was wrong twice over: a leg holds its stick
 * for four seconds, not 0.8, and a diagonal or a braking counter-tilt has no
 * single key to name. Deriving the caps from the sticks means the row always
 * matches what is actually being flown — both arrows light on a diagonal, and
 * the opposite arrow lights while the drone brakes, which is the part of the
 * technique that is hardest to see.
 */
function keysForStick(): string[] {
  const keys: string[] = [];
  if (stick.roll > KEY_DEADBAND) keys.push('ArrowRight');
  if (stick.roll < -KEY_DEADBAND) keys.push('ArrowLeft');
  if (stick.pitch > KEY_DEADBAND) keys.push('ArrowUp');
  if (stick.pitch < -KEY_DEADBAND) keys.push('ArrowDown');
  // Yaw left is negative: `axis(yawLeft, yawRight)` in input/controls.ts.
  if (stick.yaw > KEY_DEADBAND) keys.push('KeyD');
  if (stick.yaw < -KEY_DEADBAND) keys.push('KeyA');
  // Throttle is spring-centred at 0.5 in the altitude-managed modes lessons use.
  if (stick.throttle > 0.5 + KEY_DEADBAND) keys.push('KeyW');
  if (stick.throttle < 0.5 - KEY_DEADBAND) keys.push('KeyS');
  return keys;
}

/** How many times to play this lesson's demonstration before Practice. */
function demoRepeats(lesson: Lesson, seen: boolean): number {
  if (seen) return DEMO_REPLAY_REPEATS;
  const steps = lesson.demo;
  const duration = (steps.length ? steps[steps.length - 1].at : 0) + 1.6;
  return Math.max(1, Math.min(DEMO_REPEATS, Math.floor(DEMO_BUDGET / Math.max(duration, 1))));
}

function resetDrone(lesson: Lesson): void {
  // Ask for the spawn height BEFORE the reset: the drone's reset effect reads it
  // when it places the body. Every module is flown from the pad now, so this
  // clears any lift a previous caller left on the store rather than choosing
  // one — a lesson that opened at a hover is what let a pilot reach Module 11
  // having pressed ENTER once, in Module 1.
  useSimStore.getState().setSpawnLift(0);
  // And how high SPACE should carry it. Every module begins on the pad now, so
  // the take-off has to finish at the height the lesson is actually flown at —
  // the shape circuits run at 3.3 m and hand the pilot no throttle to climb the
  // difference with.
  useSimStore.getState().setTakeoffAlt(lesson.hoverHeight ?? HOVER);
  useSimStore.getState().requestReset();
  const flight = useFlightStore.getState();
  flight.disarm();
  flight.clearCrash();
  if (flight.paused) flight.togglePause();
  resetStick();
}

/**
 * Move the route cursor, and chime if it moved FORWARD.
 *
 * The cursor advancing IS a checkpoint being taken — it is the same number the
 * guide puts its lights out on and the map counts down to — so the sound belongs
 * with the move rather than beside it. Written once because three places move
 * it: the demonstration off its own beats, the attempt off the validator's
 * cursor, and the completion frame, which sets it past the end.
 *
 * Only forward. The cursor is also sent back to zero on a restart, a replay and
 * a retry, and a lesson resetting itself is not something the pilot achieved.
 *
 * `getState` rather than a captured store snapshot: the caller reads the store
 * once at the top of a frame, and by here something else may already have moved
 * the same number.
 */
function advanceRoute(next: number): void {
  const training = useTrainingStore.getState();
  if (next === training.routeTarget) return;
  if (next > training.routeTarget) playCollect();
  training.setRouteTarget(next);
}

function centerSticks(): void {
  setScriptedStick({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 });
}

export function Director() {
  // The envelope the aircraft on the pad actually flies in. A demonstration is
  // planned against the trainer envelope at module load, so every scripted
  // stick is rescaled into this one before it reaches the controller — see
  // `scaleScriptedStick`. Training does not change the drone mid-lesson, so
  // reading it here is enough.
  const droneId = useSettingsStore((st) => st.settings.selectedDroneId);
  const flightCfg = useMemo(() => {
    const spec = getDrone(droneId);
    return spec ? configFor(spec) : BEGINNER_CONFIG;
  }, [droneId]);

  const phaseTime = useRef(0);
  const phaseRef = useRef<TrainingPhase | null>(null);
  const lessonRef = useRef<string | null>(null);

  // Demo playback
  const demoIdx = useRef(0);
  /** Has this lesson's demo already played through once? Drives the shorter
   *  replay above. Cleared when the active lesson changes. */
  const demoSeen = useRef(false);
  /** Which repeat of the demo is currently playing (0-based). */
  const demoLoop = useRef(0);
  /** Heading the demonstration is currently holding, radians; null = free. */
  const yawTarget = useRef<number | null>(null);
  /** Seconds the demo clock has spent waiting for an auto sequence to hand back,
   *  and which sequence it is waiting on. */
  const autoWait = useRef(0);
  /** How long the current demo step has been waiting to arrive somewhere. */
  const stepWait = useRef(0);
  const autoKind = useRef<string>('manual');
  /** The one-shot command cap (ARM / SPACE) and its remaining lit time. */
  const cmdKey = useRef<string | null>(null);
  const keyFlash = useRef(0);
  /** Last keycap set pushed to the store, so the demo does not write state on
   *  every single frame. */
  const lastKeys = useRef('');
  /** Same idea for the practice cue: validators return one every frame, and the
   *  set only changes a handful of times an attempt. */
  const lastCue = useRef('');
  /** Last attempt clock reading published, in tenths. */
  const lastElapsed = useRef(-1);
  /** The sim's reset counter as this Director last left it. */
  const lastResetToken = useRef(0);

  // Practice metrics / scratch
  const mem = useRef<LessonMemory>({});
  const practiceTime = useRef(0);
  const jerkAccum = useRef(0);
  const crashCount = useRef(0);
  const prevCrashed = useRef(false);
  /** The store's lifetime touch count as this attempt began; the attempt's own
   *  is the difference. */
  const touchBase = useRef(0);
  const failCount = useRef(0);
  const prevStick = useRef({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 });
  /** Debounce so a single failure doesn't reset repeatedly across frames. */
  const failCooldown = useRef(0);
  /**
   * An attempt that ended in a crash, waiting on the pilot's R.
   *
   * A crash used to restart the practice on the spot, which put a flying drone
   * back at the hover within a frame of the impact. In Module 3 — where the
   * whole drill is the throttle, and dropping it to the stop IS the mistake the
   * lesson lists — that read as the drone floating back up on its own, with
   * nothing on screen to say it had been wrecked. The wreck stays put now, and
   * the clock stops, until R puts it back on the pad.
   */
  const awaitingRestart = useRef(false);
  /** Seconds the success condition has held, before advancing to the reward. */
  const doneTimer = useRef(0);
  /** Best progress reached this attempt, and how long since it last improved.
   *  The demo replays on a stall, not on a stopwatch: a pilot who is slow but
   *  visibly closing on the target should be left alone to finish. */
  const bestProgress = useRef(0);
  const stallTime = useRef(0);

  // Ensure the pilot regains control if the training view unmounts mid-lesson.
  useEffect(() => {
    return () => {
      setScripted(false);
      resetStick();
      useSimStore.getState().setSpawnLift(0);
    };
  }, []);

  function enterPhase(phase: TrainingPhase, lesson: Lesson): void {
    phaseTime.current = 0;
    const training = useTrainingStore.getState();

    switch (phase) {
      case 'intro':
        setScripted(true);
        resetDrone(lesson);
        centerSticks();
        yawTarget.current = null;
        training.setDemoKeys([]);
        useUiStore.getState().setCameraMode('chase');
        break;

      case 'demo':
        setScripted(true);
        resetDrone(lesson);
        centerSticks();
        demoIdx.current = 0;
        demoLoop.current = 0;
        yawTarget.current = null;
        autoWait.current = 0;
        autoKind.current = 'manual';
        keyFlash.current = 0;
        cmdKey.current = null;
        lastKeys.current = '';
        training.setDemoRound(1, demoRepeats(lesson, demoSeen.current));
        training.setDemoKeys([]);
        training.setRouteIndex(0);
        training.setRouteTarget(0);
        training.setDemoCaption(lesson.demo[0]?.caption ?? '');
        useUiStore.getState().setCameraMode('chase');
        playWhoosh();
        break;

      case 'practice':
        resetDrone(lesson);
        seedResetToken();
        yawTarget.current = null;
        setScripted(false);
        mem.current = {};
        practiceTime.current = 0;
        jerkAccum.current = 0;
        crashCount.current = 0;
        prevCrashed.current = false;
        touchBase.current = useFlightStore.getState().touches;
        failCooldown.current = 0;
        awaitingRestart.current = false;
        doneTimer.current = 0;
        bestProgress.current = 0;
        stallTime.current = 0;
        prevStick.current = { ...stick };
        training.setDemoKeys([]);
        training.setRouteIndex(0);
        training.setRouteTarget(0);
        training.setCue([]);
        lastCue.current = '';
        lesson.setup?.();
        training.setHint(lesson.practice.hint);
        training.setValidation({ progress: 0, failed: false });
        playWhoosh();
        break;

      case 'reward':
        // completeLesson already recorded the result; just let it dwell.
        break;
    }
  }

  function tickDemo(lesson: Lesson, delta: number): void {
    const steps = lesson.demo;
    const training = useTrainingStore.getState();

    // An auto sequence owns the aircraft while it runs, and it hands back only
    // once it has ARRIVED and settled — which takes as long as it takes. Letting
    // the timeline run underneath it was a race the demo lost about half the
    // time: the first leg's throttle step would land mid-climb, read as the
    // pilot grabbing the controls, and abandon the climb at whatever height it
    // had reached, so everything after it flew at the wrong altitude and off
    // the wrong heading.
    //
    // The DESCENT needs exactly the same hold, and for a worse reason. Module 2
    // demonstrates auto-land and then disarms; on a descent that took longer
    // than the gap the script allowed, the disarm arrived while the drone was
    // still in the air and the demonstration ended by dropping it. Hold the
    // clock for either sequence — the next step then plays when the aircraft is
    // really where the caption says it is.
    const auto = useFlightStore.getState().auto;
    if (auto !== autoKind.current) {
      autoKind.current = auto;
      autoWait.current = 0;
    }
    if (auto !== 'manual' && autoWait.current < AUTO_WAIT) {
      autoWait.current += delta;
      phaseTime.current -= delta;
      return;
    }

    // Slowed-down demo clock, so each step lingers long enough to follow.
    const t = phaseTime.current * DEMO_SPEED;

    if (keyFlash.current > 0) {
      keyFlash.current -= delta;
      if (keyFlash.current <= 0) cmdKey.current = null;
    }

    while (demoIdx.current < steps.length && steps[demoIdx.current].at <= t) {
      const step = steps[demoIdx.current];

      // A step that names a place waits for the aircraft to get there. Holding
      // the clock is the same trick the auto sequences use above, and for the
      // same reason: the caption, and the command under it, have to happen
      // where they say they do.
      if (step.waitNear) {
        const near = Math.hypot(
          dronePose.position.x - step.waitNear.x,
          dronePose.position.z - step.waitNear.z,
        );
        if (near > step.waitNear.reach && stepWait.current < DEMO_WAIT_MAX) {
          stepWait.current += delta;
          phaseTime.current -= delta;
          return;
        }
      }
      stepWait.current = 0;

      if (step.cmd) runScriptedCommand(step.cmd);
      if (step.stick) setScriptedStick(scaleScriptedStick(step.stick, flightCfg));
      if (step.yawTo !== undefined) {
        yawTarget.current = step.yawTo;
        if (step.yawTo === null) setScriptedStick({ yaw: 0 });
      }
      if (step.caption) training.setDemoCaption(step.caption);
      // The checkpoint row and the route guide follow the demonstration exactly
      // as they follow the pilot, so the steps promised on the intro card are
      // the steps the pilot then watches being flown.
      if (step.stage !== undefined && step.stage !== training.routeIndex) {
        training.setRouteIndex(step.stage);
      }
      // And the route cursor, which is a different number on a staged lesson
      // and moves at a different moment: this one says a checkpoint is BEHIND
      // the aircraft, and it is what takes the letter off the gate as the demo
      // flies out the far side.
      if (step.rt !== undefined) advanceRoute(step.rt);
      // Only the one-shot commands need a flash; a held stick lights its own cap.
      if (step.key && step.cmd) {
        cmdKey.current = step.key;
        keyFlash.current = KEY_FLASH;
      }
      demoIdx.current += 1;
    }

    // Steer onto the commanded heading, every frame it is held. Full stick
    // until the last few degrees, then ease off — braking a yaw is not a thing,
    // the rate command simply goes to zero.
    if (yawTarget.current !== null) {
      let err = yawTarget.current - useSimStore.getState().yaw;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      // The controller negates the yaw stick, so turning LEFT — the direction of
      // increasing heading — is a negative stick, which is the left key.
      setScriptedStick(
        scaleScriptedStick(
          { yaw: Math.abs(err) < YAW_DEADBAND ? 0 : clamp(-err / YAW_TAPER, -YAW_MAX, YAW_MAX) },
          flightCfg,
        ),
      );
    }

    const keys = keysForStick();
    if (cmdKey.current) keys.push(cmdKey.current);
    const joined = keys.join(' ');
    if (joined !== lastKeys.current) {
      lastKeys.current = joined;
      training.setDemoKeys(keys);
    }

    const lastAt = steps.length ? steps[steps.length - 1].at : 0;
    if (t > lastAt + 1.6) {
      if (demoLoop.current < demoRepeats(lesson, demoSeen.current) - 1) {
        // Replay the demonstration from the top.
        demoLoop.current += 1;
        resetDrone(lesson);
        centerSticks();
        demoIdx.current = 0;
        phaseTime.current = 0;
        yawTarget.current = null;
        autoWait.current = 0;
        autoKind.current = 'manual';
        keyFlash.current = 0;
        cmdKey.current = null;
        lastKeys.current = '';
        training.setDemoRound(demoLoop.current + 1);
        training.setDemoKeys([]);
        training.setRouteIndex(0);
        // Every letter goes back up for the replay; the field has to start the
        // second pass looking the way it started the first.
        training.setRouteTarget(0);
        training.setDemoCaption(steps[0]?.caption ?? '');
      } else {
        demoSeen.current = true;
        training.setPhase('practice');
      }
    }
  }

  /** Remember where the sim's reset counter stands, so the Director's own
   *  resets are not mistaken for the pilot pressing R. */
  function seedResetToken(): void {
    lastResetToken.current = useSimStore.getState().resetToken;
  }

  function softResetPractice(lesson: Lesson): void {
    resetDrone(lesson);
    seedResetToken();
    mem.current = {};
    // A fresh go: whatever the last one hit belongs to the last one.
    touchBase.current = useFlightStore.getState().touches;
    awaitingRestart.current = false;
    practiceTime.current = 0;
    publishElapsed();
    jerkAccum.current = 0;
    doneTimer.current = 0;
    bestProgress.current = 0;
    stallTime.current = 0;
    prevStick.current = { ...stick };
    lesson.setup?.();
  }

  /**
   * Push the attempt clock to the HUD — a tenth of a second at a time.
   *
   * The clock is what answers "how am I doing" while the flight is on, and what
   * the result panel reports afterwards, so every lesson shows it. Published on
   * the tenth rather than every frame: a number that changes 60 times a second
   * is unreadable, and this is a machine with frames to spare for nothing.
   */
  function publishElapsed(): void {
    const tenths = Math.round(practiceTime.current * 10) / 10;
    if (tenths === lastElapsed.current) return;
    lastElapsed.current = tenths;
    useTrainingStore.getState().setElapsed(tenths);
  }

  /** Push the live control cue, only when it actually changes. */
  function publishCue(cue: readonly string[]): void {
    const joined = cue.join(' ');
    if (joined === lastCue.current) return;
    lastCue.current = joined;
    useTrainingStore.getState().setCue(cue);
  }

  function tickPractice(lesson: Lesson, delta: number, lessonId: string): void {
    // R puts the drone back on the pad — so it has to put the ATTEMPT back to
    // the start too. Without this the aircraft respawned but the lesson's
    // scratch pad did not: the square circuit still had Corner 1 ticked and was
    // asking for Corner 2, from a drone sitting on the helipad that had flown
    // nothing. The clock kept running as well, so a reset was a penalty rather
    // than a fresh go.
    const token = useSimStore.getState().resetToken;
    if (token !== lastResetToken.current) {
      // A crash that has been sitting here waiting for this key was already
      // counted as a failed go. If it was one too many, R buys the
      // demonstration rather than another attempt at the same mistake — the
      // escalation the non-crash path takes immediately, deferred to the point
      // where the pilot asked to carry on.
      if (awaitingRestart.current && failCount.current >= REPLAY_AFTER_FAILS) {
        failCount.current = 0;
        awaitingRestart.current = false;
        seedResetToken();
        useTrainingStore.getState().setPhase('demo');
        return;
      }
      softResetPractice(lesson);
      // A deliberate restart, not a recovery from a fail: the crashes and the
      // failed goes belong to the attempt that was thrown away.
      crashCount.current = 0;
      failCount.current = 0;
      touchBase.current = useFlightStore.getState().touches;
      useTrainingStore.getState().setRouteIndex(0);
      useTrainingStore.getState().setRouteTarget(0);
      useTrainingStore.getState().setHint(lesson.practice.hint);
      useTrainingStore.getState().setValidation({ progress: 0, failed: false });
      publishCue([]);
      return;
    }

    // Wrecked and waiting on R: no clock, no validation, no rescue timer. The
    // attempt is over and the pilot is looking at the result of it. The fail
    // debounce still runs down, so the next go starts with a live one rather
    // than a second of immunity carried over from this crash.
    if (awaitingRestart.current) {
      if (failCooldown.current > 0) failCooldown.current -= delta;
      return;
    }

    practiceTime.current += delta;
    publishElapsed();
    if (failCooldown.current > 0) failCooldown.current -= delta;

    const sim = useSimStore.getState();
    const flight = useFlightStore.getState();
    const training = useTrainingStore.getState();

    // Collisions.
    if (flight.crashed && !prevCrashed.current) crashCount.current += 1;
    prevCrashed.current = flight.crashed;

    // A WRECK ENDS THE ATTEMPT, on every module, without the lesson having to
    // say so.
    //
    // This used to be each lesson's own job — `if (p.crashed) return failed` at
    // the top of its validator — and twelve of the fourteen remembered. Modules
    // 7 and 8 did not, and on those the crash card came up over a lesson that
    // was still running underneath it: the clock ticking, the hint still asking
    // for a checkpoint, and the stall timer counting down to replay the
    // demonstration for a drone lying on the concrete. The pilot was being
    // marked on a flight that had already ended.
    //
    // A rule that has to be repeated in fourteen places is a rule that will be
    // missed in one of them, and this one is not about any single exercise: what
    // a crash means is the same in Module 1 as in Module 14, and the same as it
    // is in the Fly view, which is the standard the academy is held to. So it is
    // decided HERE, before the lesson is asked anything, and the per-lesson
    // checks it replaces have been taken out.
    //
    // `awaitingRestart` latches, and the guard above returns on every later
    // frame, so the failure is counted exactly once however long the wreck sits
    // there. The hint stays as plain as the others — asking for R is the crash
    // card's job, and saying it twice in two different words is noise on the one
    // screen that has to read at a glance.
    if (flight.crashed) {
      training.setValidation({ progress: 0, failed: true });
      training.setHint('Crashed. Try again');
      publishCue([]);
      failCount.current += 1;
      // So the next go starts with a live debounce rather than a second of
      // immunity carried over from this crash.
      failCooldown.current = 1.0;
      playFail();
      awaitingRestart.current = true;
      return;
    }

    // Arm/disarm blips are played by DroneAudio now, so the Fly view gets them
    // too rather than only Flight School.

    // Control smoothness — accumulate absolute stick movement.
    jerkAccum.current +=
      Math.abs(stick.roll - prevStick.current.roll) +
      Math.abs(stick.pitch - prevStick.current.pitch) +
      Math.abs(stick.yaw - prevStick.current.yaw) +
      Math.abs(stick.throttle - prevStick.current.throttle);
    prevStick.current = { ...stick };

    _probePos[0] = sim.position[0];
    _probePos[1] = sim.position[1];
    _probePos[2] = sim.position[2];

    const res = lesson.validate(
      {
        armed: flight.armed,
        onGround: flight.onGround,
        crashed: flight.crashed,
        status: flight.status(),
        altitude: sim.altitude,
        position: _probePos,
        yaw: sim.yaw,
        verticalSpeed: sim.verticalSpeed,
        groundSpeed: sim.groundSpeed,
        roll: sim.roll,
        pitch: sim.pitch,
        throttle: sim.sticks.throttle,
        dt: delta,
        elapsed: practiceTime.current,
      },
      mem.current,
    );

    if (res.done) {
      // Hold the success state briefly so the pilot sees the confirmation.
      doneTimer.current += delta;
      training.setValidation({ progress: 1, failed: false });
      training.setHint(`✓ ${res.hint ?? 'Well done!'}`);
      publishCue([]);
      // Tick the last step too. The row is the pilot's record of what they just
      // did, and leaving the final one unticked reads as "not quite".
      const total = lesson.stages?.length ?? lesson.route?.length ?? 0;
      if (total > 0 && training.routeIndex !== total) training.setRouteIndex(total);
      // And take the last checkpoint's mark off the field with it. The route
      // cursor is written further down, which this return never reaches — so
      // the checkpoint that ENDED the flight was the one checkpoint whose mark
      // never went out. On a circuit that closes where it began it is glaring:
      // Module 9 comes back to Corner A, the cursor stopped one short of the
      // end, and the pink column stood lit on A through the result card — on
      // the corner the pilot had just flown into, which is the moment the light
      // exists to acknowledge. Set to the route's LENGTH, the "all done" value
      // (#35), so every mark reads as taken.
      const flown = lesson.route?.length ?? 0;
      if (flown > 0) advanceRoute(flown);
      if (doneTimer.current >= DONE_HOLD) {
        const timeSec = practiceTime.current;
        const meanJerk = timeSec > 0 ? jerkAccum.current / timeSec : 0;
        const smoothness = clamp(1 - meanJerk / JERK_K, 0, 1);
        const stars = starsFor(lesson.stars, {
          timeSec,
          collisions: crashCount.current,
          touches: useFlightStore.getState().touches - touchBase.current,
          smoothness,
          mem: mem.current,
        });
        training.completeLesson(lessonId, stars, stars / 3, timeSec);
      }
      return;
    }
    doneTimer.current = 0;

    training.setValidation({ progress: res.progress ?? 0, failed: !!res.failed });
    training.setHint(res.hint ?? lesson.practice.hint);
    publishCue(res.cue ?? []);
    // Which checkpoint — or stage — is live. `flyRoute` keeps it in `mem.wp`,
    // and a staged validator writes the same field, so this writes state a
    // handful of times an attempt rather than every frame.
    const steps = lesson.stages?.length ?? lesson.route?.length ?? 0;
    if (steps > 0) {
      const reached = Math.min(mem.current.wp ?? 0, steps);
      if (reached !== training.routeIndex) training.setRouteIndex(reached);
    }

    // And which CHECKPOINT that is, for the map. `flyMission` walks the route on
    // a cursor of its own because `mem.wp` is the step row's; every other
    // validator has the two as the same number.
    const legs = lesson.route?.length ?? 0;
    if (legs > 0) {
      // Where the route cursor lives depends on what `mem.wp` is counting. A
      // lesson with STAGES numbers the steps of a flight in it — Arm is 0, Take
      // off is 1 — and walks its route on `rt` instead (#35). Falling back from
      // one to the other was wrong rather than merely approximate: arming
      // Module 7 moved `wp` to 1, which the guide read as "checkpoint 0 is
      // behind you" and took "A" off the gate before the drone had left the pad.
      //
      // Allowed to run one PAST the last checkpoint, and it has to be: that is
      // the "all done" value, and it is what takes the last name off the field
      // when the route is finished.
      const cursor = lesson.stages ? (mem.current.rt ?? 0) : (mem.current.wp ?? 0);
      const goal = Math.min(cursor, legs);
      advanceRoute(goal);
    }

    if (res.failed && failCooldown.current <= 0) {
      failCount.current += 1;
      failCooldown.current = 1.0;
      playFail();
      // A validator can declare that the failure wrecked the aircraft. Raise the
      // real crash for it rather than inventing a second way to fail: the crash
      // card, the star cap and the wait for R all follow from `flight.crashed`.
      //
      // This is the ONLY way a crash reaches here now. A wreck the physics
      // raised has already ended the attempt further up and never gets as far as
      // the validator, so `flight.crashed` is false by the time this runs — the
      // check on it is what stops a validator raising a second crash on top of
      // one already standing.
      if (res.wrecked && !flight.crashed) {
        useFlightStore.getState().crash(Math.abs(sim.verticalSpeed));
        crashCount.current += 1;
        prevCrashed.current = true;
      }
      // A crash is the pilot's to clear. Anything else — flown out of the box,
      // landed off the pad — leaves a drone that is still fit to fly, so those
      // keep restarting on their own.
      if (res.wrecked) {
        awaitingRestart.current = true;
        // The hint stays as the lesson wrote it ("Crashed. Try again"). Asking
        // for R is the crash card's job — TrainingHud renders the same one the
        // free-flight HUD does — and saying it twice, in two different words,
        // is noise on the one screen that has to read at a glance.
        publishCue([]);
        return;
      }
      if (failCount.current >= REPLAY_AFTER_FAILS) {
        failCount.current = 0;
        training.setPhase('demo');
      } else {
        softResetPractice(lesson);
      }
      return;
    }

    // Getting closer? Leave the pilot to it. The clock only runs while the
    // attempt is going nowhere, so the replay is a rescue for someone who is
    // stuck rather than a time limit on someone who is merely careful.
    const progress = res.progress ?? 0;
    if (progress > bestProgress.current + PROGRESS_STEP) {
      bestProgress.current = progress;
      stallTime.current = 0;
    } else {
      stallTime.current += delta;
    }

    // Stalled too long — replay the demonstration.
    if (stallTime.current > (lesson.practiceTimeout ?? PRACTICE_TIMEOUT)) {
      training.setPhase('demo');
    }
  }

  function tickReward(lessonId: string): void {
    if (phaseTime.current < REWARD_DWELL) return;
    const training = useTrainingStore.getState();
    const next = nextLesson(lessonId);
    if (next && isLessonUnlocked(next.id)) training.start(next.id);
    else training.exitLesson();
  }

  useFrame((_state, delta) => {
    const { activeLessonId, phase } = useTrainingStore.getState();
    if (!activeLessonId) return;
    const lesson = getLesson(activeLessonId);
    if (!lesson) return;

    // A new lesson (or first mount) forces the phase-entry logic to re-run.
    if (activeLessonId !== lessonRef.current) {
      lessonRef.current = activeLessonId;
      phaseRef.current = null;
      demoSeen.current = false;
    }

    if (phase !== phaseRef.current) {
      enterPhase(phase, lesson);
      phaseRef.current = phase;
    }
    phaseTime.current += delta;

    switch (phase) {
      case 'demo':
        tickDemo(lesson, delta);
        break;
      case 'practice':
        tickPractice(lesson, delta, activeLessonId);
        break;
      case 'reward':
        tickReward(activeLessonId);
        break;
      case 'intro':
      default:
        break;
    }
  });

  return null;
}
