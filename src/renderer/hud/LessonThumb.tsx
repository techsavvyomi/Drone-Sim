import { useMemo } from 'react';
import type { Lesson } from '../training/lessons';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';

// The module list's map thumbnail: the lesson's route from above, as a still.
//
// Same frame as the in-flight LessonMap — the helipad is always in it, the view
// is fitted to the route (or the lap ring), −Z is up — so the picture on the
// list is the picture the pilot then flies. Drawn in SVG with no colours of its
// own: every stroke and fill is a class in styles/training.css.

const MARGIN_M = 4;
const MIN_SPAN_M = 9;
const VIEW = 100;

export function LessonThumb({ lesson }: { lesson: Lesson }) {
  const plan = useMemo(() => {
    const route = lesson.route ?? [];
    const ring = lesson.guideRing?.radius ?? 0;
    const [px, pz] = ACADEMY_PAD.center;
    const xs = [px, ...route.map((c) => c.at[0])];
    const zs = [pz, ...route.map((c) => c.at[2])];
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span =
      Math.max(
        (Math.max(...xs) - Math.min(...xs)) / 2,
        (Math.max(...zs) - Math.min(...zs)) / 2,
        ring,
        MIN_SPAN_M,
      ) + MARGIN_M;
    const k = VIEW / 2 / span;
    const at = (x: number, z: number) => ({
      x: VIEW / 2 + (x - cx) * k,
      y: VIEW / 2 + (z - cz) * k,
    });
    const pad = at(px, pz);
    const points = route.map((c) => at(c.at[0], c.at[2]));
    return {
      pad,
      padR: Math.max(3, ACADEMY_PAD.radius * k),
      points,
      ring: ring > 0 ? { ...at(px, pz), r: ring * k } : null,
      path: [pad, ...points].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    };
  }, [lesson]);

  return (
    <svg className="lthumb" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
      <circle className="lthumb__pad" cx={plan.pad.x} cy={plan.pad.y} r={plan.padR} />
      {plan.ring && (
        <circle className="lthumb__ring" cx={plan.ring.x} cy={plan.ring.y} r={plan.ring.r} />
      )}
      {plan.points.length > 0 && <polyline className="lthumb__route" points={plan.path} />}
      {plan.points.map((p, i) => (
        <circle key={i} className="lthumb__point" cx={p.x} cy={p.y} r={4} />
      ))}
    </svg>
  );
}
