import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { clamp } from '../sim/mathx';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useUiStore } from '../state/uiStore';
import { useTrainingStore, isLessonUnlocked, type TrainingPhase } from '../state/trainingStore';
import { getLesson, nextLesson } from './lessons';
import type { Lesson, LessonMemory } from './lessons/types';
import {
  stick,
  resetStick,
  setScripted,
  setScriptedStick,
  runScriptedCommand,
} from '../input/controls';
import { playFail, playWhoosh } from '../audio/sfx';
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
 *  all three passes; a four-cornered route gets one, because the cap that
 *  matters is time sitting still, not the number of repeats. */
const DEMO_BUDGET = 34;
/** How many times the demonstration plays before Practice, first time through. */
const DEMO_REPEATS = 3;
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

/** Longest the demo clock will wait on auto take-off before giving up on it.
 *  Generous — the climb is about two seconds — but finite, so a take-off that
 *  never completes stalls one demonstration rather than hanging Flight School. */
const TAKEOFF_WAIT = 6;

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

function resetDrone(): void {
  useSimStore.getState().requestReset();
  const flight = useFlightStore.getState();
  flight.disarm();
  flight.clearCrash();
  if (flight.paused) flight.togglePause();
  resetStick();
}

function centerSticks(): void {
  setScriptedStick({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 });
}

export function Director() {
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
  /** Seconds the demo clock has spent waiting for auto take-off to hand back. */
  const takeoffWait = useRef(0);
  /** The one-shot command cap (ARM / SPACE) and its remaining lit time. */
  const cmdKey = useRef<string | null>(null);
  const keyFlash = useRef(0);
  /** Last keycap set pushed to the store, so the demo does not write state on
   *  every single frame. */
  const lastKeys = useRef('');

  // Practice metrics / scratch
  const mem = useRef<LessonMemory>({});
  const practiceTime = useRef(0);
  const jerkAccum = useRef(0);
  const crashCount = useRef(0);
  const prevCrashed = useRef(false);
  const failCount = useRef(0);
  const prevStick = useRef({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 });
  /** Debounce so a single failure doesn't reset repeatedly across frames. */
  const failCooldown = useRef(0);
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
    };
  }, []);

  function enterPhase(phase: TrainingPhase, lesson: Lesson): void {
    phaseTime.current = 0;
    const training = useTrainingStore.getState();

    switch (phase) {
      case 'intro':
        setScripted(true);
        resetDrone();
        centerSticks();
        yawTarget.current = null;
        training.setDemoKeys([]);
        useUiStore.getState().setCameraMode('chase');
        break;

      case 'demo':
        setScripted(true);
        resetDrone();
        centerSticks();
        demoIdx.current = 0;
        demoLoop.current = 0;
        yawTarget.current = null;
        takeoffWait.current = 0;
        keyFlash.current = 0;
        cmdKey.current = null;
        lastKeys.current = '';
        training.setDemoRound(1, demoRepeats(lesson, demoSeen.current));
        training.setDemoKeys([]);
        training.setDemoCaption(lesson.demo[0]?.caption ?? '');
        useUiStore.getState().setCameraMode('chase');
        playWhoosh();
        break;

      case 'practice':
        resetDrone();
        yawTarget.current = null;
        setScripted(false);
        mem.current = {};
        practiceTime.current = 0;
        jerkAccum.current = 0;
        crashCount.current = 0;
        prevCrashed.current = false;
        failCooldown.current = 0;
        doneTimer.current = 0;
        bestProgress.current = 0;
        stallTime.current = 0;
        prevStick.current = { ...stick };
        training.setDemoKeys([]);
        training.setRouteIndex(0);
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

    // Auto take-off owns the aircraft while it climbs, and it hands back only
    // once it has ARRIVED and settled — which takes as long as it takes. Letting
    // the timeline run underneath it was a race the demo lost about half the
    // time: the first leg's throttle step would land mid-climb, read as the
    // pilot grabbing the controls, and abandon the climb at whatever height it
    // had reached, so everything after it flew at the wrong altitude and off
    // the wrong heading. Hold the clock instead — the demo starts when the
    // aircraft is actually at a hover.
    if (useFlightStore.getState().auto === 'takeoff' && takeoffWait.current < TAKEOFF_WAIT) {
      takeoffWait.current += delta;
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
      if (step.cmd) runScriptedCommand(step.cmd);
      if (step.stick) setScriptedStick(step.stick);
      if (step.yawTo !== undefined) {
        yawTarget.current = step.yawTo;
        if (step.yawTo === null) setScriptedStick({ yaw: 0 });
      }
      if (step.caption) training.setDemoCaption(step.caption);
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
      setScriptedStick({
        yaw: Math.abs(err) < YAW_DEADBAND ? 0 : clamp(-err / YAW_TAPER, -YAW_MAX, YAW_MAX),
      });
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
        resetDrone();
        centerSticks();
        demoIdx.current = 0;
        phaseTime.current = 0;
        yawTarget.current = null;
        takeoffWait.current = 0;
        keyFlash.current = 0;
        cmdKey.current = null;
        lastKeys.current = '';
        training.setDemoRound(demoLoop.current + 1);
        training.setDemoKeys([]);
        training.setDemoCaption(steps[0]?.caption ?? '');
      } else {
        demoSeen.current = true;
        training.setPhase('practice');
      }
    }
  }

  function softResetPractice(lesson: Lesson): void {
    resetDrone();
    mem.current = {};
    practiceTime.current = 0;
    jerkAccum.current = 0;
    doneTimer.current = 0;
    bestProgress.current = 0;
    stallTime.current = 0;
    prevStick.current = { ...stick };
    lesson.setup?.();
  }

  function tickPractice(lesson: Lesson, delta: number, lessonId: string): void {
    practiceTime.current += delta;
    if (failCooldown.current > 0) failCooldown.current -= delta;

    const sim = useSimStore.getState();
    const flight = useFlightStore.getState();
    const training = useTrainingStore.getState();

    // Collisions.
    if (flight.crashed && !prevCrashed.current) crashCount.current += 1;
    prevCrashed.current = flight.crashed;

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
      if (doneTimer.current >= DONE_HOLD) {
        const timeSec = practiceTime.current;
        const meanJerk = timeSec > 0 ? jerkAccum.current / timeSec : 0;
        const smoothness = clamp(1 - meanJerk / JERK_K, 0, 1);
        const stars = lesson.score({
          timeSec,
          collisions: crashCount.current,
          smoothness,
          mem: mem.current,
        });
        training.completeLesson(lessonId, stars, stars / 3);
      }
      return;
    }
    doneTimer.current = 0;

    training.setValidation({ progress: res.progress ?? 0, failed: !!res.failed });
    training.setHint(res.hint ?? lesson.practice.hint);
    // Which checkpoint is live. `flyRoute` keeps it in `mem.wp`, and it only
    // moves when one is taken, so this writes state a handful of times an
    // attempt rather than every frame.
    if (lesson.route) {
      const reached = Math.min(mem.current.wp ?? 0, lesson.route.length);
      if (reached !== training.routeIndex) training.setRouteIndex(reached);
    }

    if (res.failed && failCooldown.current <= 0) {
      failCount.current += 1;
      failCooldown.current = 1.0;
      playFail();
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
