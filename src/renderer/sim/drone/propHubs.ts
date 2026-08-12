import * as THREE from 'three';

// Measured propeller hub positions, published by DroneModel once the .glb has
// loaded and consumed by Propellers to place spin-blur discs / synthetic blades.
//
// These cannot be derived from DroneSpec.armLength: that's a nominal figure,
// and the real hubs on the PlutoX sit at x ~= +/-0.046, z ~= -0.043 / +0.049,
// which is ~10 mm inboard of armLength/sqrt(2). Guessing put the discs visibly
// outboard of the blades.

export const propHubs = {
  /** Hub positions in the DRONE BODY frame, ordered FR, FL, BR, BL. */
  positions: [] as THREE.Vector3[],
  ready: false,
  /**
   * True when the .glb has no PROP_ nodes (single-mesh). Propellers then draws
   * black stand-in blades that cover the baked props and spin with the motors.
   */
  synthetic: false,
  /** Blade radius (m) estimated from the model AABB when synthetic. */
  propRadius: 0,
  /**
   * A clonable copy of the real propeller, centred on its hub. Used for crash
   * debris so a detached prop is the actual PlutoX part rather than a stand-in.
   */
  template: null as THREE.Object3D | null,
};
