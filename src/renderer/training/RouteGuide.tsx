import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Line2, LineMaterial } from 'three-stdlib';
import { useTrainingStore } from '../state/trainingStore';
import { getLesson } from './lessons';
import { HOVER } from './lessons/arena';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';

// The route guide.
//
// It builds NO scenery. Every checkpoint a lesson names is something already
// standing on the field — a racing gate, a painted landing pad, one of the white
// markers ringing the helipad — and all this adds is the ROUTE between them:
// the line to fly, the point being flown to, and which parts are already done.
//
// It has been trimmed twice, both times for the same reason. First it hung a
// letter over every checkpoint at once — the "A B C D everywhere" that made the
// field unreadable. Then a name and a chevron over just the live one: the name
// was a word stuck to an object the pilot was already looking at, and the
// chevron, drawn without depth testing so it could not be hidden, filled the
// screen whenever the target was the pad the drone was sitting on.
//
// What is left is the thing that could not be got from anywhere else: the line
// to fly. Naming the target is the HUD's job, and it does it in the step row.
//
// Cost is one line per leg and a single clock read per frame. No per-frame
// allocation, no React state.

const DONE = '#34d399';
const NEXT = '#ffcf4d';
const LATER = '#64748b';

/** Straight-line distance between two world points. */
function dist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Where a route starts from: the hover over the "H". */
const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  HOVER,
  ACADEMY_PAD.center[1],
];

/** One leg of the route, drawn as a line the pilot can follow. */
function Leg({
  from,
  to,
  state,
}: {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  state: 'done' | 'active' | 'later';
}) {
  const line = useRef<Line2>(null);
  const points = useMemo(() => [new THREE.Vector3(...from), new THREE.Vector3(...to)], [from, to]);

  useFrame((s) => {
    // The live leg's dashes crawl toward the target, so the line reads as a
    // direction to fly rather than as a wire between two points.
    if (state !== 'active' || !line.current) return;
    (line.current.material as LineMaterial).dashOffset = -s.clock.elapsedTime * 0.6;
  });

  return (
    <Line
      ref={line}
      points={points}
      color={state === 'done' ? DONE : state === 'active' ? NEXT : LATER}
      lineWidth={state === 'active' ? 4 : 2}
      transparent
      opacity={state === 'active' ? 0.95 : state === 'done' ? 0.5 : 0.28}
      dashed={state === 'active'}
      dashSize={1.4}
      gapSize={0.9}
      depthTest={false}
    />
  );
}

/** The painted ring the circle lesson flies, drawn as a closed path. */
function Ring({ radius, height }: { radius: number; height: number }) {
  const points = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      out.push(
        new THREE.Vector3(
          ACADEMY_PAD.center[0] + Math.cos(a) * radius,
          height,
          ACADEMY_PAD.center[1] + Math.sin(a) * radius,
        ),
      );
    }
    return out;
  }, [radius, height]);

  return (
    <Line points={points} color={NEXT} lineWidth={3} transparent opacity={0.75} depthTest={false} />
  );
}

export function RouteGuide() {
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const routeIndex = useTrainingStore((s) => s.routeIndex);

  const lesson = useMemo(
    () => (activeLessonId ? getLesson(activeLessonId) : undefined),
    [activeLessonId],
  );
  if (!lesson) return null;

  // The guide walks along with whoever is flying: the demonstration marks its
  // own steps as it plays them, the pilot's validator marks theirs.
  const live = routeIndex;
  const route = lesson.route ?? [];

  return (
    <>
      {lesson.guideRing && (
        <Ring radius={lesson.guideRing.radius} height={lesson.guideRing.height} />
      )}
      {route.map((point, i) => {
        const from = i === 0 ? START : route[i - 1].at;
        // A leg that goes nowhere is not a leg. The single-checkpoint lessons
        // name the pad they are already hovering over, which would otherwise
        // ask the renderer for a line of zero length.
        if (dist(from, point.at) < 0.5) return null;
        return (
          <Leg
            key={`leg-${point.label}-${i}`}
            from={from}
            to={point.at}
            state={i < live ? 'done' : i === live ? 'active' : 'later'}
          />
        );
      })}
    </>
  );
}
