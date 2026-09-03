import { useEffect, useMemo, useRef } from 'react';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore, legOf, activeZone } from '../state/missionStore';
import { requiredCheckpoints, nextTargetOf } from '../missions/types';
import type { Mission } from '../missions/types';

// ----------------------------------------------------------------------------
// The mission radar — a top-down plan of the whole delivery, in the corner.
//
// Flight School answers "where am I going" with `LessonMap`, and a city needs it
// far more than an arena does: the drop is ninety metres away with a hundred
// buildings between, and the chase camera can only ever show what is in front of
// the nose. The answer used to be given entirely in the world — a lit ball for
// every checkpoint and a ring round the aircraft — which put a large glowing
// object over the flying view for every point on the route.
//
// From above the same question is a dot. ONE dot: the next thing to fly to, and
// nothing else. The dial used to carry the whole delivery at once — every
// checkpoint, all three marks, the line between them — and a pilot halfway
// through their first mission had to work out which of eleven dots was theirs
// before the dial helped at all. A green dot that moves on as each mark is taken
// answers "where now" without being read.
//
// This is a DISPLAY and nothing else. It reads `dronePose` and the mission, it
// scores nothing, and every checkpoint on it is the same checkpoint the world
// draws at the same place. Drawn on a canvas in an animation frame of its own —
// routing a position that changes every frame through React state would
// re-render the whole overlay sixty times a second for a moving dot.
// ----------------------------------------------------------------------------

/** Across the dial, in CSS pixels. A little larger than the academy's, because
 *  it is holding a hundred metres of city rather than a training box. */
const SIZE = 132;
/** How far the dial reaches, in metres from the aircraft. Wide enough that the
 *  next mark is usually on it, tight enough that a dot near the rim still means
 *  something. Beyond it the target rides the rim, which reads as "keep going". */
const RANGE_M = 90;

/** One colour per meaning, and they are the ones the world uses for the same
 *  things: the pilot should never have to learn the dial separately. */
const PICKUP = '#37e08a';
const DROP = '#ffcf4d';
const BASE = '#37e08a';
/** The one dot the dial is for: wherever the pilot has to go next. */
const NEXT = '#37e08a';
const OWED = '#ff6ee0';
const DRONE = '#e2e8f0';

type Zone = { at: readonly [number, number]; color: string; kind: string };

export function MissionMap({ mission }: { mission: Mission }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  // The live state is read through refs rather than props, so a checkpoint being
  // taken repaints the dial on its own frame instead of re-running this effect
  // and rebuilding the canvas.
  const state = useRef({
    leg: useMissionStore.getState().leg,
    collected: useMissionStore.getState().collected,
  });
  useEffect(
    () =>
      useMissionStore.subscribe((s) => {
        state.current = { leg: s.leg, collected: s.collected };
      }),
    [],
  );

  const zones = useMemo<readonly Zone[]>(
    () => [
      { at: mission.zones.pickup.at, color: PICKUP, kind: 'pickup' },
      { at: mission.zones.drop.at, color: DROP, kind: 'drop' },
      { at: mission.zones.base.at, color: BASE, kind: 'base' },
    ],
    [mission],
  );

  const required = useMemo(() => new Set(requiredCheckpoints(mission).map((c) => c.id)), [mission]);

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
    /** Pixels per metre. The dial is drone-centred and north-up: the aircraft
     *  sits in the middle and the city slides under it, which is how every
     *  radar the pilot has ever seen behaves. The old fixed frame had the drone
     *  wandering around a static plan, and on a mission that spans a hundred
     *  metres that left it as a speck in a corner half the time. */
    const k = (half - 10) / RANGE_M;

    let raf = 0;
    const draw = (clock: number) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Everything is drawn inside the dial. Without the clip a mark just off
      // the edge paints into the corners the round frame does not cover.
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, half - 0.5, 0, Math.PI * 2);
      ctx.clip();

      const { leg, collected } = state.current;
      const liveLeg = legOf(leg as never);
      const here = activeZone(leg as never);
      const owed = mission.route.filter((c) => required.has(c.id) && !collected[c.id]);

      const q = dronePose.quaternion;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      /** World XZ to dial pixels, relative to the aircraft. */
      const sx = (x: number) => half + (x - dronePose.position.x) * k;
      const sz = (z: number) => half + (z - dronePose.position.z) * k;

      // --- The compass ------------------------------------------------------
      //
      // A four point star and four ticks on the rim, both faint. They carry no
      // information the dots do not, and that is the point: they give the dial
      // a face, so a glance lands on something that reads as an instrument
      // rather than on an empty disc with one dot floating in it.
      ctx.save();
      ctx.translate(half, half);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.06)';
      const R = half * 0.62;
      const r = half * 0.16;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const rad = i % 2 === 0 ? R : r;
        const px2 = Math.cos(a) * rad;
        const py2 = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px2, py2);
        else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(226, 232, 240, 0.14)';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 - Math.PI / 2;
        ctx.save();
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -(half - 7));
        ctx.lineTo(5, -(half - 14));
        ctx.lineTo(-5, -(half - 14));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      /** Pull a point back onto the rim rather than losing it off the edge. A
       *  mark that vanishes when it is furthest away is a radar that goes quiet
       *  exactly when it is needed; on the rim it still reads as "that way". */
      const onDial = (x: number, y: number) => {
        const dx = x - half;
        const dy = y - half;
        const d = Math.hypot(dx, dy);
        const edge = half - 9;
        if (d <= edge || d < 0.001) return { x, y, far: false };
        return { x: half + (dx / d) * edge, y: half + (dy / d) * edge, far: true };
      };

      // --- The next thing, and only the next thing ---------------------------
      //
      // `nextTargetOf` decides it, and the ring's arrow and the DISTANCE
      // readout come from the same call: the nearest checkpoint this leg still
      // owes, and once they are all taken the mark itself. The dial and the
      // arrow point the same way because they are the same point.
      const cp = nextTargetOf(mission, liveLeg, collected);
      const zone = zones.find((z) => z.kind === here);
      const at = cp
        ? { x: sx(cp[0]), y: sz(cp[2]) }
        : zone
          ? { x: sx(zone.at[0]), y: sz(zone.at[1]) }
          : null;

      // --- The pickup, when it is not the thing being flown to ---------------
      //
      // The package's own mark, lettered P, so the pilot can see where the thing
      // they were sent for actually is while the dot is sending them at a ring
      // on the way. A hollow circle, so it never competes with the solid dot.
      //
      // It is skipped once the pickup IS the target: the two marks then sit on
      // the same spot, and what the dial showed was a hollow circle with a
      // filled one budged up against it, reading as two places to go.
      const pickupIsTarget = !cp && here === 'pickup';
      if (leg === 'toPickup' && !pickupIsTarget) {
        const pickup = mission.zones.pickup;
        const at0 = onDial(sx(pickup.at[0]), sz(pickup.at[1]));
        ctx.strokeStyle = PICKUP;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = at0.far ? 0.55 : 0.9;
        ctx.beginPath();
        ctx.arc(at0.x, at0.y, 5.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '800 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(6, 10, 17, 0.85)';
        ctx.fillText('P', at0.x + 0.7, at0.y - 11 + 0.7);
        ctx.fillStyle = PICKUP;
        ctx.fillText('P', at0.x, at0.y - 11);
        ctx.globalAlpha = 1;
      }

      if (at) {
        const { x, y } = onDial(at.x, at.y);

        const t = (clock % 1400) / 1400;
        ctx.strokeStyle = NEXT;
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6 + t * 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = NEXT;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // One mark, one letter: when the pickup is the target the P rides the
        // pulsing dot rather than a second circle beside it.
        if (pickupIsTarget) {
          ctx.font = '800 9px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(6, 10, 17, 0.85)';
          ctx.fillText('P', x + 0.7, y - 11 + 0.7);
          ctx.fillStyle = NEXT;
          ctx.fillText('P', x, y - 11);
        }
      }

      // --- The aircraft, dead centre -----------------------------------------
      const px = half;
      const py = half;
      // Heading 0 faces -Z, which is up on the dial.
      const fx = -Math.sin(yaw);
      const fy = -Math.cos(yaw);
      ctx.fillStyle = DRONE;
      ctx.beginPath();
      ctx.moveTo(px + fx * 8, py + fy * 8);
      ctx.lineTo(px - fy * 5 - fx * 4.5, py + fx * 5 - fy * 4.5);
      ctx.lineTo(px + fy * 5 - fx * 4.5, py - fx * 5 - fy * 4.5);
      ctx.closePath();
      ctx.fill();

      // --- How much is still owed -------------------------------------------
      //
      // Along the bottom, and only while it is the thing in the way. The drop
      // refuses until this is zero, so it is the one number that changes what
      // the pilot should do next.
      if (owed.length > 0 && (leg === 'carrying' || leg === 'toDrop')) {
        ctx.font = '800 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(6, 10, 17, 0.8)';
        ctx.fillText(`${owed.length} left`, half + 0.7, SIZE - 7 + 0.7);
        ctx.fillStyle = OWED;
        ctx.fillText(`${owed.length} left`, half, SIZE - 7);
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mission, zones, required]);

  return (
    <div className="ms-map" aria-hidden="true">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
