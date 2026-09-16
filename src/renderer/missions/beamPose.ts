// The searchlight's live beam — where it starts and which way it points —
// shared from the lamp to the runtime without going through React state.
//
// The same device `dronePose` and `tigerPose` are, and for a sharper reason
// than speed. The beam is aimed AHEAD of the nose and chases the heading rather
// than snapping to it, so "which way is the light pointing" is a quantity only
// `DroneSpotlight` knows. If the Director rebuilt it from the airframe's pose,
// the cone it judged against would lag or lead the cone on screen through
// every turn — and the one promise this mission makes is that what looks lit
// IS lit. So the lamp publishes the axis it drew with, and the Director tests
// against exactly that.
export const beamPose = {
  /** The lamp, world metres. */
  x: 0,
  y: 0,
  z: 0,
  /** Unit vector along the beam's axis, world space. */
  dx: 0,
  dy: -1,
  dz: 0,
  /** False until the lamp has been placed under a present aircraft. */
  present: false,
};

/** Put it back. The light is not pointing anywhere until the lamp says so. */
export function resetBeamPose(): void {
  beamPose.x = 0;
  beamPose.y = 0;
  beamPose.z = 0;
  beamPose.dx = 0;
  beamPose.dy = -1;
  beamPose.dz = 0;
  beamPose.present = false;
}
