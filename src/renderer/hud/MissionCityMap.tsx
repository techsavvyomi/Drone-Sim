import { useEffect, useRef } from 'react';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore } from '../state/missionStore';
import { NYC_PLAN } from '../scene/environment/NewYorkPlan';
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
// So this is a MAP rather than a radar. NORTH UP — a plan you can build a
// search pattern on must not spin under the pilot, which is the piece a
// heading-up dial can never give — but it SCROLLS with the aircraft.
//
// Both halves of that were arrived at the hard way. The whole city at once put
// three or four blocks inside the red zone at four pixels each: a texture, not
// a plan, and a pilot who cannot tell one block from the next cannot tell where
// in the search area they have already been. Locking the zoom onto the zone
// fixed the blocks and broke everything else — fly a street the other way and
// the map showed a neighbourhood the drone was nowhere near.
//
// Scrolling and north-up together is the combination that works: the blocks
// under the aircraft, at a size they can be told apart, in an orientation that
// holds still while the pilot turns. The red zone is drawn where it is in the
// world, so it slides into frame as they approach; while it is still out of
// sight a red pip rides the rim pointing at it.
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
// nothing, on its own animation frame — routing a position that changes every
// frame through React state would re-render the whole overlay sixty times a
// second for a map that has scrolled two pixels.
// ----------------------------------------------------------------------------

/** Across the dial, in CSS pixels. A little larger than the 132 px radar it
 *  replaces, and no more: a map that takes a fifth of the screen is competing
 *  with the window the pilot is supposed to be searching out of. */
const SIZE = 152;
/** Breathing room inside the rim, so a shape at the edge of the frame is still
 *  drawn rather than sliced by it. */
const PAD = 7;

/**
 * How far the map sees from the aircraft, metres.
 *
 * The one number that decides whether this is a plan or a texture. At 85 m the
 * disc holds about two blocks in every direction — enough that a street the
 * pilot has swept is recognisably that street, and enough that the 45 m red
 * zone fits inside the frame with its surroundings rather than filling it.
 * Wider and the blocks stop being distinguishable, which is the failure the
 * whole-city version had; tighter and the pilot loses the context they navigate
 * into the zone by.
 */
const REACH_M = 85;

const CITY = 'rgba(226, 232, 240, 0.3)';
const ZONE_LINE = '#ff4d4d';
const ZONE_FILL = 'rgba(255, 77, 77, 0.16)';
const DRONE = '#e2e8f0';

export function MissionCityMap({ mission }: { mission: Mission }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const zone = useMissionStore((s) => s.searchZone);
  const located = useMissionStore((s) => s.located);

  /** Pixels per metre. One scale for both axes — a plan stretched to fill its
   *  frame is a plan of a different city, and the pilot is meant to be able to
   *  read distances off it. */
  const k = (SIZE / 2 - PAD) / REACH_M;

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

    let raf = 0;
    const draw = (clock: number) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);
      // Everything inside the rim, and now the clip is doing real work: a
      // scrolling map has blocks crossing its edge in every frame.
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, half - 0.5, 0, Math.PI * 2);
      ctx.clip();

      // The frame is recomputed every frame off the live pose — that is what
      // scrolling IS — so the city is drawn rather than blitted from a
      // pre-rendered plan. 120 rectangles is cheap, and a cached plan would
      // have to be re-cut on every metre the drone moves anyway.
      const ox = half - dronePose.position.x * k;
      const oz = half - dronePose.position.z * k;
      const sx = (x: number) => ox + x * k;
      const sz = (z: number) => oz + z * k;

      ctx.fillStyle = CITY;
      for (const [bx, bz, bw, bd] of NYC_PLAN) {
        const x = sx(bx);
        const y = sz(bz);
        const w = bw * k;
        const d = bd * k;
        // Off the disc entirely: skipped rather than clipped, because at this
        // zoom most of the city is off it most of the time.
        if (x + w < 0 || y + d < 0 || x > SIZE || y > SIZE) continue;
        ctx.fillRect(x, y, w, d);
      }

      // --- The red zone ------------------------------------------------------
      //
      // It breathes, slowly. A static red circle on a static plan is furniture
      // and stops being looked at; the pulse is what makes a glance at the
      // corner of the screen land on it. Once the casualty is found it stops —
      // by then the zone has done its job, and a thing still demanding
      // attention after it has been answered is the HUD talking over itself.
      if (zone) {
        const r = zone.radius * k;
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

        // Out of sight: a pip on the rim pointing at it.
        //
        // A scrolling map earns its blocks by giving up the overview, and the
        // overview is what told the pilot which way the zone was. From the base
        // pad the circle is off the frame entirely, so without this the mission
        // opens on a map of streets with nothing on it to aim at.
        const dx = x - half;
        const dy = y - half;
        const away = Math.hypot(dx, dy);
        if (away - r > half - 8) {
          const px2 = half + (dx / away) * (half - 9);
          const py2 = half + (dy / away) * (half - 9);
          ctx.fillStyle = ZONE_LINE;
          ctx.beginPath();
          ctx.arc(px2, py2, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- The aircraft ------------------------------------------------------
      //
      // A triangle pointing where the nose points, on a map that does not turn.
      // The pilot's heading against a fixed city is the one thing that makes a
      // plan flyable: it is how "I have swept this street" becomes a fact
      // rather than a memory.
      const q = dronePose.quaternion;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      // Dead centre, always: the map is drawn around it.
      const px = half;
      const py = half;
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
  }, [mission, k, zone, located]);

  // No caption. A label under the circle was there to say what the red ring
  // was, and at this zoom it does not need saying: the ring is most of the
  // dial, the drone flies into it, and the briefing has already called it the
  // search zone. What the words were actually doing was covering the southern
  // quarter of the map.
  return (
    <div className="ms-citymap" aria-hidden="true">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
