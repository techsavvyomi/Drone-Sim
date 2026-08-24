import { useEffect, useMemo, useRef } from 'react';
import type { Lesson } from '../training/lessons';
import { dronePose } from '../sim/drone/pose';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';

// ----------------------------------------------------------------------------
// The lesson map — a small top-down plan of the exercise, under the status bar.
//
// It exists because the chase camera cannot answer one question: WHERE AM I
// GOING. The camera sits behind the nose, and the training circuits are flown
// nose-forward the whole way round — so the moment a side is flown backwards or
// sideways, the corner being flown to is off the edge of the screen, or behind
// the lens entirely. The pilot is left steering at something they cannot see.
//
// Looked at from above, that problem disappears. The corner is a dot, the drone
// is an arrow, and the line between them is the answer. It is also the only
// place the whole shape is visible at once, which is what a circuit lesson is
// actually asking the pilot to fly.
//
// It runs during the DEMONSTRATION too. Watching the demo is where the shape is
// learned, and the plan view is the only place the shape exists as a shape — a
// lap in particular is a thing you have to see from above to see at all. Nothing
// is being scored then, so nothing is marked done and no line is drawn to a
// "next" that the demonstration is not being asked to fly: the dial shows the
// course and the aircraft moving over it, which is the whole of what a
// demonstration has to say.
//
// Drawn on a canvas from `dronePose` in an animation frame of its own — the
// drone's position changes every frame, and routing that through React state
// would re-render the HUD sixty times a second for the sake of a moving dot.
// ----------------------------------------------------------------------------

/** Across the dial, in CSS pixels. Round rather than square, and small: it is
 *  glanced at between corners, not read. A square box the size of the first one
 *  took a bite out of the flying view it is meant to help with. */
const SIZE = 116;
/** Metres of clear space kept around the outermost point of the exercise. */
const MARGIN_M = 4;
/** Smallest half-width the map will scale to, in metres. A one-checkpoint
 *  lesson would otherwise zoom until the pad filled the box. */
const MIN_SPAN_M = 9;

const DONE = '#34d399';
const LIVE = '#ffcf4d';
const LATER = '#64748b';
const DRONE = '#e2e8f0';
const DECK = '#334155';
/** The lap line, in the same red it is painted on the deck. */
const RING = '#ff2b4d';

export function LessonMap({
  lesson,
  target,
  tracking,
}: {
  lesson: Lesson;
  target: number;
  /** Whether the pilot's own progress is being followed. False during the
   *  demonstration, where nothing is done and nothing is next. */
  tracking: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const trackRef = useRef(tracking);
  trackRef.current = tracking;

  const route = useMemo(() => lesson.route ?? [], [lesson]);
  const ring = lesson.guideRing?.radius;
  const band = lesson.guideRing?.band;

  // Where the map looks and how far it reaches. Fixed for the lesson: a frame
  // that rescaled as the drone moved would slide the corners around under the
  // pilot, which is the opposite of what a plan view is for. The helipad is
  // always in it — every lesson starts there.
  const view = useMemo(() => {
    const xs = [ACADEMY_PAD.center[0], ...route.map((c) => c.at[0])];
    const zs = [ACADEMY_PAD.center[1], ...route.map((c) => c.at[2])];
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(
      (Math.max(...xs) - Math.min(...xs)) / 2,
      (Math.max(...zs) - Math.min(...zs)) / 2,
      // A lap has no checkpoints to measure — the ring IS the exercise, so it is
      // what the dial has to hold. Module 10 was the one lesson the map never
      // appeared on, for want of a list of points to draw.
      ring ?? 0,
      MIN_SPAN_M,
    );
    return { cx, cz, span: span + MARGIN_M };
  }, [route, ring]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const half = SIZE / 2;
    const k = half / view.span;
    /** World XZ to map pixels. North is -Z, which is the way every lesson faces. */
    const sx = (x: number) => half + (x - view.cx) * k;
    const sz = (z: number) => half + (z - view.cz) * k;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Everything is drawn inside the dial. Without the clip a checkpoint just
      // off the edge paints into the corners the round frame does not cover,
      // and the dial grows square patches.
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, half - 0.5, 0, Math.PI * 2);
      ctx.clip();

      // The helipad, for a sense of where the middle of the world is.
      ctx.strokeStyle = DECK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        sx(ACADEMY_PAD.center[0]),
        sz(ACADEMY_PAD.center[1]),
        ACADEMY_PAD.radius * k,
        0,
        Math.PI * 2,
      );
      ctx.stroke();

      // The lap line, where there is one — the same red as the paint it stands
      // for, so the dial and the deck are showing the same circle.
      if (ring) {
        const rx = sx(ACADEMY_PAD.center[0]);
        const rz = sz(ACADEMY_PAD.center[1]);
        // The lane first, as a band the line runs down the middle of. "On the
        // ring" is a place with a WIDTH, and a lap is flown by staying inside
        // it — a bare line says where to be and nothing about how close is
        // close enough, which on a 43 m lap is most of the question.
        if (band) {
          ctx.strokeStyle = RING;
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = band * 2 * k;
          ctx.beginPath();
          ctx.arc(rx, rz, ring * k, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = RING;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rx, rz, ring * k, 0, Math.PI * 2);
        ctx.stroke();
      }

      const follow = trackRef.current;
      const live = Math.min(targetRef.current, Math.max(route.length - 1, 0));
      const [dx, , dz] = [dronePose.position.x, 0, dronePose.position.z];
      const px = sx(dx);
      const pz = sz(dz);

      // The line to fly next. This is the whole point of the map: whatever the
      // camera is showing, THIS is the way to the thing being asked for.
      const goal = follow ? route[live] : undefined;
      if (goal) {
        ctx.strokeStyle = LIVE;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, pz);
        ctx.lineTo(sx(goal.at[0]), sz(goal.at[2]));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // The checkpoints. One dot per PLACE — a circuit closes on the corner it
      // started from, and two dots on one spot is a smudge, not a route.
      route.forEach((c, i) => {
        const first =
          route.findIndex(
            (d) => Math.abs(d.at[0] - c.at[0]) < 0.2 && Math.abs(d.at[2] - c.at[2]) < 0.2,
          ) === i;
        if (!first) return;

        const state = !follow ? LIVE : i < live ? DONE : i === live ? LIVE : LATER;
        const x = sx(c.at[0]);
        const z = sz(c.at[2]);
        ctx.fillStyle = state;
        ctx.beginPath();
        ctx.arc(x, z, follow && i === live ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        const tag = c.tag;
        if (tag) {
          ctx.fillStyle = state;
          ctx.font = '700 10px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, x, z - 10);
        }
      });

      // The drone, as an arrow pointing where its NOSE is — not where it is
      // travelling. Which way it is facing is the frame the sticks work in, and
      // on these lessons it never changes; seeing it stay put while the arrow
      // slides sideways is the plan view teaching what "roll" means.
      const q = dronePose.quaternion;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      // Heading 0 faces -Z, which is up on the map.
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      ctx.fillStyle = DRONE;
      ctx.beginPath();
      ctx.moveTo(px + fx * 7, pz + fz * 7);
      ctx.lineTo(px - fz * 4.5 - fx * 4, pz + fx * 4.5 - fz * 4);
      ctx.lineTo(px + fz * 4.5 - fx * 4, pz - fx * 4.5 - fz * 4);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [route, view, ring, band]);

  if (route.length === 0 && ring === undefined) return null;
  return (
    <div className="tr-map" aria-hidden="true">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
