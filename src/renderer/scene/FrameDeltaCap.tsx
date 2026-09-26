import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

// Caps the time one frame is allowed to simulate.
//
// R3F hands every `useFrame` the delta from `clock.getDelta()`, and Rapier's
// stepper is one of those subscribers: it replays the whole delta at 250 Hz,
// clamping only at 0.5 s — 125 steps in a single frame. Measured in the
// Supermarket store (2026-09-26, `[perf]` log): after one hitch the frames ran
// 108-125 steps each at fps 1-3. Once a step's wall time passes 4 ms a
// simulated second costs more than a real one, every replay makes the next
// frame later, and the sim never catches up — the pilot's "it sticks".
//
// With the cap, a frame longer than MAX_FRAME_DT is dropped rather than
// replayed: the world runs in slow motion through a hitch instead of freezing
// and then lurching. The drone's controller, the missions' clocks and the
// camera all read the same capped delta, so they stay in step with the physics.

/**
 * The most simulated time one frame may carry, in seconds: 12.5 physics steps.
 *
 * Judgement, not measurement: three 60 Hz frames, so an ordinary late frame is
 * still replayed in full and only a real stall is cut.
 */
const MAX_FRAME_DT = 0.05;

export function FrameDeltaCap() {
  const clock = useThree((s) => s.clock);

  useEffect(() => {
    const raw = clock.getDelta;
    clock.getDelta = function getDelta() {
      return Math.min(raw.call(this), MAX_FRAME_DT);
    };
    return () => {
      clock.getDelta = raw;
    };
  }, [clock]);

  return null;
}
