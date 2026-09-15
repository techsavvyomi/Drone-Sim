// Live tiger transform, shared from the animal to the runtime without going
// through React state.
//
// The same device `dronePose` is, and for the same reason: `Tiger` moves it
// sixty times a second and `MissionDirector` tests against it sixty times a
// second, and routing that through a store would re-render the whole HUD on
// every step of a walk. `present` is what tells the Director the animal is
// actually mounted — a tracking mission whose tiger has not mounted yet must
// not report a lock against a position of (0, 0, 0), which is the launch pad.
export const tigerPose = {
  x: 0,
  y: 0,
  z: 0,
  /** Yaw, radians. Three.js convention: 0 faces −Z. */
  heading: 0,
  present: false,
};

/** Put it back. Called when an attempt arms, so a restart never judges the
 *  first frame against where the animal had walked to on the last go. */
export function resetTigerPose(): void {
  tigerPose.x = 0;
  tigerPose.y = 0;
  tigerPose.z = 0;
  tigerPose.heading = 0;
  tigerPose.present = false;
}
