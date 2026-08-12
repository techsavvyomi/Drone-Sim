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

// The Director runs a lesson through Explain -> Demonstrate -> Practice ->
// Validate -> Reward. It is headless (renders nothing) but lives inside the
// training <Canvas>, so its useFrame ticks in lock-step with the sim.
//
// Phase is stored in trainingStore (the HUD's buttons also advance it — "Watch
// Demonstration", "Next Lesson"). The Director detects phase *entry* and runs
// the matching setup, then ticks the active phase each frame.

/** Mean stick jerk (per second) that maps to zero smoothness. */
const JERK_K = 3.0;
/** Consecutive hard failures before the demo auto-replays. */
const REPLAY_AFTER_FAILS = 2;
/** Seconds the reward panel shows before auto-advancing. */
const REWARD_DWELL = 5.0;
/** Demo playback rate. Below 1 slows the demonstration down for clarity. */
const DEMO_SPEED = 0.55;
/** How many times the demonstration plays before Practice. */
const DEMO_REPEATS = 3;
/** Seconds the success condition must hold before the reward, so the pilot
 *  sees the "✓" confirmation instead of the lesson snapping shut instantly. */
const DONE_HOLD = 1.2;
/** Seconds a demo keycap stays lit after its step fires. */
const KEY_FLASH = 0.8;

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
  /** Which repeat of the demo is currently playing (0-based). */
  const demoLoop = useRef(0);
  /** Countdown for how long the current demo keycap stays lit. */
  const keyFlash = useRef(0);

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
        training.setDemoKey(null);
        useUiStore.getState().setCameraMode('chase');
        break;

      case 'demo':
        setScripted(true);
        resetDrone();
        centerSticks();
        demoIdx.current = 0;
        demoLoop.current = 0;
        keyFlash.current = 0;
        training.setDemoRound(1);
        training.setDemoKey(null);
        training.setDemoCaption(lesson.demo[0]?.caption ?? '');
        useUiStore.getState().setCameraMode('chase');
        playWhoosh();
        break;

      case 'practice':
        resetDrone();
        setScripted(false);
        mem.current = {};
        practiceTime.current = 0;
        jerkAccum.current = 0;
        crashCount.current = 0;
        prevCrashed.current = false;
        failCooldown.current = 0;
        doneTimer.current = 0;
        prevStick.current = { ...stick };
        training.setDemoKey(null);
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
    // Slowed-down demo clock, so each step lingers long enough to follow.
    const t = phaseTime.current * DEMO_SPEED;
    const steps = lesson.demo;
    const training = useTrainingStore.getState();

    // Fade the keycap highlight out after each step.
    if (keyFlash.current > 0) {
      keyFlash.current -= delta;
      if (keyFlash.current <= 0) training.setDemoKey(null);
    }

    while (demoIdx.current < steps.length && steps[demoIdx.current].at <= t) {
      const step = steps[demoIdx.current];
      if (step.cmd) runScriptedCommand(step.cmd);
      if (step.stick) setScriptedStick(step.stick);
      if (step.caption) training.setDemoCaption(step.caption);
      if (step.key) {
        training.setDemoKey(step.key);
        keyFlash.current = KEY_FLASH;
      }
      demoIdx.current += 1;
    }

    const lastAt = steps.length ? steps[steps.length - 1].at : 0;
    if (t > lastAt + 1.6) {
      if (demoLoop.current < DEMO_REPEATS - 1) {
        // Replay the demonstration from the top.
        demoLoop.current += 1;
        resetDrone();
        centerSticks();
        demoIdx.current = 0;
        phaseTime.current = 0;
        keyFlash.current = 0;
        training.setDemoRound(demoLoop.current + 1);
        training.setDemoKey(null);
        training.setDemoCaption(steps[0]?.caption ?? '');
      } else {
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

    const res = lesson.validate(
      {
        armed: flight.armed,
        onGround: flight.onGround,
        crashed: flight.crashed,
        status: flight.status(),
        altitude: sim.altitude,
        position: sim.position,
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

    // Stuck too long — replay the demonstration.
    if (practiceTime.current > (lesson.practiceTimeout ?? 20)) {
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
