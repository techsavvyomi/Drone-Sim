// Fixed-timestep accumulator. Physics/control advance in constant `dt` slices
// regardless of render framerate, which is what makes PID stability, replays,
// and scoring reproducible. Render interpolates between the last two states
// using the returned alpha.
//
// In Phase 1 the `onStep` callback runs the flight-mode controller + mixer and
// steps the drone dynamics. In Phase 0 it advances a simulation clock so the
// HUD can display deterministic tick/time counters over the Rapier scene.

export type StepFn = (dt: number, tick: number, time: number) => void;

export class FixedLoop {
  /** Fixed step duration in seconds. */
  readonly dt: number;
  /** Total fixed steps executed since start. */
  tick = 0;
  /** Accumulated simulation time in seconds. */
  time = 0;

  private accumulator = 0;
  private readonly maxStepsPerFrame: number;
  private readonly maxFrameDt: number;

  constructor(
    private readonly onStep: StepFn,
    hz = 250,
    maxStepsPerFrame = 500,
  ) {
    this.dt = 1 / hz;
    this.maxStepsPerFrame = maxStepsPerFrame;
    // Clamp huge frame gaps (tab was backgrounded, breakpoint hit) so we never
    // try to catch up thousands of steps — the "spiral of death" guard.
    this.maxFrameDt = 0.25;
  }

  /**
   * Advance the simulation by one render frame's worth of real time.
   * @returns interpolation alpha in [0,1) between the previous and current step.
   */
  advance(frameDt: number): number {
    this.accumulator += Math.min(frameDt, this.maxFrameDt);

    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      this.onStep(this.dt, this.tick, this.time);
      this.tick += 1;
      this.time += this.dt;
      this.accumulator -= this.dt;
      steps += 1;
    }

    return this.accumulator / this.dt;
  }

  reset(): void {
    this.tick = 0;
    this.time = 0;
    this.accumulator = 0;
  }
}
