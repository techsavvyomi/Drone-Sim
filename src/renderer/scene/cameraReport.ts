// What the chase camera is doing, for the cockpit's "▲ CHASE PULLED IN TO 0.6 m
// · WALL BEHIND" chip. Written by CameraRig every frame, read by the HUD at its
// 10 Hz — a plain mutable object, so the render loop allocates nothing and
// never touches React.

export const chaseReport = {
  /** How far the camera is held in from its free spot, metres (0 = not held). */
  pulledIn: 0,
  /** The camera's distance from the drone while held in, metres. */
  distance: 0,
};

/** The chip shows once the camera is held in by more than this, metres — a
 *  graze that barely moves it is not worth a line. Chosen by judgement. */
export const PULL_IN_NOTICE = 0.25;
