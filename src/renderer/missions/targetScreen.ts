import * as THREE from 'three';

// ----------------------------------------------------------------------------
// The pointer that sits ON the target, in the picture.
//
// The strip already says which way to turn and how far, and the climb chip says
// the mark is not on this level. What none of them can do is put a mark where
// the pilot is actually looking: a rooftop fifty metres down the street is a
// place in the view, and everything the HUD had was a number in a corner.
//
// Two module singletons rather than store state, because this updates every
// frame and a zustand write per frame is a React render per frame for a HUD
// that is otherwise published at 10 Hz. The Director writes the world point it
// has already worked out; the projector inside the Canvas turns it into a screen
// position against the live camera; the DOM element reads that on its own rAF.
// Nothing in the chain re-renders.
// ----------------------------------------------------------------------------

/** The world point the pointer is aimed at, written by MissionDirector. */
export const targetMark = {
  at: new THREE.Vector3(),
  /** False whenever there is nothing to point at — briefing, result, no leg. */
  active: false,
};

/** Where that point lands on screen, written by the projector every frame. */
export const targetScreen = {
  /** Pixels from the top-left of the canvas. Already clamped to the edge band
   *  when the target is outside the view. */
  x: 0,
  y: 0,
  /** True when the target is off the picture (or behind the camera) and `x`/`y`
   *  are a clamped edge position rather than the mark itself. */
  offscreen: false,
  /** Which way to turn the chevron when clamped, in degrees, 0 = up. */
  angle: 0,
  /** Metres, straight-line — the label the pointer carries. */
  distance: 0,
  /** Metres the mark sits above the camera. Drives the pointer's arrow glyph. */
  climb: 0,
  visible: false,
  /** Bumped every write, so the DOM side can tell a stalled projector (the
   *  Canvas unmounted under it) from a pointer that is legitimately still. */
  frame: 0,
};
