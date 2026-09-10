import { useEffect, useMemo, useRef } from 'react';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore } from '../state/missionStore';
import { NYC_PLAN, NYC_PLAN_BOUNDS } from '../scene/environment/NewYorkPlan';
import { planMargin } from '../missions/searchZone';
import type { Mission } from '../missions/types';

// ----------------------------------------------------------------------------
// The city map — a search mission's whole answer to "where do I go".
//
// Every other mission uses `MissionMap`, a drone-centred radar with one dot on
// it: the next thing to fly to. A search mission has no next thing, which left
// that dial drawing an empty disc with a compass rose in it and nothing else —
// an instrument that answered no question at all, on the one mission where the
// pilot most needs a map.
//
// So this is a MAP rather than a radar. The whole city at once, north up and
// fixed: the blocks the pilot can see out of the window, the red zone the
// casualty is somewhere inside, and their own aircraft moving across it. That
// is enough to fly a search with — where have I been, where have I not — and it
// is the piece a heading-up dial can never give, because a plan you can build a
// search pattern on has to hold still.
//
// It is DRAWN, not photographed. A baked picture of the city was tried and is
// the wrong thing twice over: it is a second copy of the map that can fall out
// of step with the real one, and at 150 pixels across a photograph of a city is
// noise. Blocks merged out of the colliders are the same shape the drone
// actually collides with, and they read at this size.
//
// It carries NO compass and no N/E/S/W. The sector clues those served are gone,
// and on a north-up plan of a city the pilot is looking at, they were labelling
// the frame rather than saying anything: the map itself is the direction.
//
// A DISPLAY and nothing else. It reads `dronePose` and the store, and scores
// nothing. The city is rasterised once into an offscreen canvas at mount — 120
// rectangles per frame is not expensive, but it is 120 rectangles that never
// change, and the live layer on top is three shapes.
// ----------------------------------------------------------------------------

/** Across the dial, in CSS pixels. A little larger than the 132 px radar it
 *  replaces, and no more: it holds the whole city rather than 90 m of it, but a
 *  map that takes a fifth of the screen is competing with the window the pilot
 *  is supposed to be searching out of. */
const SIZE = 152;
/** Breathing room inside the rim, so the aircraft at the far edge of the city
 *  is still drawn as a triangle rather than as a clipped edge. */
const PAD = 7;

const CITY = 'rgba(226, 232, 240, 0.3)';
const ZONE_LINE = '#ff4d4d';
const ZONE_FILL = 'rgba(255, 77, 77, 0.16)';
const DRONE = '#e2e8f0';

export function MissionCityMap({ mission }: { mission: Mission }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const zone = useMissionStore((s) => s.searchZone);
  const located = useMissionStore((s) => s.located);

  // World metres to map pixels. One scale for both axes — a plan stretched to
  // fill its frame is a plan of a different city, and the pilot is meant to be
  // able to read distances off it.
  const view = useMemo(() => {
    // The city PLUS the margin a red zone can overhang it by. `planMargin` is
    // the same number `zoneFor` clamps against, imported rather than repeated.
    const m = planMargin(mission.search?.zoneRadius ?? 0);
    const b = NYC_PLAN_BOUNDS;
    const w = b.maxX - b.minX + m * 2;
    const d = b.maxZ - b.minZ + m * 2;
    /*
     * Fitted to the DIAGONAL, not to the wider side.
     *
     * A round frame keeps the disc and throws the corners away, so a plan
     * scaled to fit a square of this size loses its own corners — which on this
     * city is where two of the four sites are, and with them the red zones
     * drawn round them. What has to fit inside the circle is the smallest
     * circle the content fits in, and that is half its diagonal.
     */
    const reach = Math.hypot(w, d) / 2;
    const k = (SIZE / 2 - PAD) / reach;
    const half = SIZE / 2;
    return {
      k,
      ox: half - ((b.minX + b.maxX) / 2) * k,
      oz: half - ((b.minZ + b.maxZ) / 2) * k,
    };
  }, [mission]);

  // The city, drawn once. Nothing in it depends on the attempt.
  const plan = useMemo(() => {
    const off = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    off.width = SIZE * dpr;
    off.height = SIZE * dpr;
    const c = off.getContext('2d');
    if (!c) return off;
    c.scale(dpr, dpr);
    c.fillStyle = CITY;
    for (const [x, z, w, d] of NYC_PLAN) {
      c.fillRect(view.ox + x * view.k, view.oz + z * view.k, w * view.k, d * view.k);
    }
    return off;
  }, [view]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const sx = (x: number) => view.ox + x * view.k;
    const sz = (z: number) => view.oz + z * view.k;

    let raf = 0;
    const draw = (clock: number) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Everything inside the rim. Nothing should ever reach it — the scale is
      // set so it cannot — but a clip is what makes that a fact rather than an
      // intention, and it is what stops a stray shape painting into the corners
      // the round frame does not cover.
      ctx.save();
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 0.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(plan, 0, 0, SIZE, SIZE);

      // --- The red zone ------------------------------------------------------
      //
      // It breathes, slowly. A static red circle on a static plan is furniture
      // and stops being looked at; the pulse is what makes a glance at the
      // corner of the screen land on it. Once the casualty is found it stops —
      // by then the zone has done its job, and a thing still demanding
      // attention after it has been answered is the HUD talking over itself.
      if (zone) {
        const r = zone.radius * view.k;
        const x = sx(zone.at[0]);
        const y = sz(zone.at[1]);
        ctx.fillStyle = ZONE_FILL;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = ZONE_LINE;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = located ? 0.5 : 0.75 + 0.25 * Math.sin((clock / 1000) * Math.PI);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- The aircraft ------------------------------------------------------
      //
      // A triangle pointing where the nose points, on a map that does not turn.
      // The pilot's heading against a fixed city is the one thing that makes a
      // plan flyable: it is how "I have swept this street" becomes a fact
      // rather than a memory.
      const q = dronePose.quaternion;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      const px = sx(dronePose.position.x);
      const py = sz(dronePose.position.z);
      // Heading 0 faces -Z, which is up on a north-up plan.
      const fx = -Math.sin(yaw);
      const fy = -Math.cos(yaw);
      ctx.fillStyle = DRONE;
      ctx.beginPath();
      ctx.moveTo(px + fx * 7, py + fy * 7);
      ctx.lineTo(px - fy * 4.5 - fx * 4, py + fx * 4.5 - fy * 4);
      ctx.lineTo(px + fy * 4.5 - fx * 4, py - fx * 4.5 - fy * 4);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mission, view, plan, zone, located]);

  return (
    <div className="ms-citymap" aria-hidden="true">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
      <span className="ms-citymap-foot">{located ? 'RESCUE LOCATED' : 'SEARCH ZONE'}</span>
    </div>
  );
}
