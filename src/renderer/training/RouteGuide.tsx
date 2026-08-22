import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useTrainingStore } from '../state/trainingStore';
import { getLesson } from './lessons';
import type { Checkpoint } from './lessons/types';

// The route guide.
//
// It draws NO geometry into the arena — no rings, no pylons, no painted path.
// Every checkpoint a lesson names is something already standing on the field: a
// racing gate, a painted landing pad, one of the white markers ringing the
// helipad. All this does is hang a letter over the one the pilot is being sent
// to, so the arena the pilot learns is the arena that is actually there.
//
// Lessons used to draw their own furniture beside the arena's, which taught a
// course that does not exist outside the lesson; the first pass at this guide
// then ringed each target, which put a second circle over gates that are
// already circles. Neither: name the object, do not redraw it.
//
// Cost is one sprite per checkpoint and one shared clock read per frame. No
// per-frame allocation, no React state.

const DONE = '#34d399';
const NEXT = '#ffcf4d';
const LATER = '#94a3b8';

/**
 * A checkpoint's letter, drawn as a sprite.
 *
 * The arena has no text renderer — every marking on the field is geometry — so
 * the letter is painted into a small canvas once per label and cached. A
 * sprite, not a mesh, because it has to stay readable from wherever the chase
 * camera happens to be.
 */
const labelTextures = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string): THREE.CanvasTexture {
  const cached = labelTextures.get(text);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${text.length > 1 ? 54 : 84}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  labelTextures.set(text, texture);
  return texture;
}

/** How far above a checkpoint its letter floats, per kind of arena landmark. */
function labelLift(c: Checkpoint): number {
  switch (c.mark) {
    case 'gate':
      // Clear of the top of the frame.
      return (c.markSize ?? 3) * 0.62 + 0.9;
    case 'pad':
    case 'helipad':
      // Flat on the ground, so the letter stands at eye level above it.
      return 2.2;
    default:
      return 1.4;
  }
}

/**
 * One checkpoint's letter: green once taken, gold for the live target, grey for
 * the ones still to come. Only the live one pulses.
 */
function Marker({ point, state }: { point: Checkpoint; state: 'done' | 'next' | 'later' }) {
  const mat = useRef<THREE.SpriteMaterial>(null);
  const [x, y, z] = point.at;
  const flat = point.mark === 'pad' || point.mark === 'helipad';
  const color = state === 'done' ? DONE : state === 'next' ? NEXT : LATER;
  const opacity = state === 'next' ? 0.95 : state === 'done' ? 0.45 : 0.35;
  const scale = state === 'next' ? 1.9 : 1.4;

  useFrame((s) => {
    if (state !== 'next' || !mat.current) return;
    // Only the live target breathes. Everything else sits still, or the field
    // turns into a christmas tree.
    mat.current.opacity = 0.7 + 0.28 * Math.sin(s.clock.elapsedTime * 2.2);
  });

  return (
    <sprite position={[x, (flat ? 0 : y) + labelLift(point), z]} scale={[scale, scale, scale]}>
      <spriteMaterial
        ref={mat}
        map={labelTexture(point.label)}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        depthTest={false}
      />
    </sprite>
  );
}

export function RouteGuide() {
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const routeIndex = useTrainingStore((s) => s.routeIndex);
  const phase = useTrainingStore((s) => s.phase);

  const lesson = useMemo(
    () => (activeLessonId ? getLesson(activeLessonId) : undefined),
    [activeLessonId],
  );
  if (!lesson) return null;

  // During the demonstration the whole route is shown ahead of the drone; in
  // practice the guide walks along with the pilot.
  const live = phase === 'demo' ? 0 : routeIndex;

  return (
    <>
      {lesson.route?.map((point, i) => (
        <Marker
          key={`${point.label}-${i}`}
          point={point}
          state={i < live ? 'done' : i === live ? 'next' : 'later'}
        />
      ))}
    </>
  );
}
