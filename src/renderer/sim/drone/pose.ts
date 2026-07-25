import * as THREE from 'three';

// Live drone transform shared from the drone entity to the camera rig without
// going through React state (updated every frame).
export const dronePose = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  present: false,
};
