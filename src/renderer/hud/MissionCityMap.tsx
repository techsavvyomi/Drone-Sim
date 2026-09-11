import { useEffect, useRef } from 'react';
import { dronePose } from '../sim/drone/pose';
import { activeZone, legOf, useMissionStore } from '../state/missionStore';
import type { MissionLeg } from '../state/missionStore';
import {
  NYC_EDGES,
  NYC_GRASS,
  NYC_LANES,
  NYC_PLAN_TALLEST,
  NYC_PROPS,
  NYC_ROOFS,
  NYC_TREES,
  NYC_WALKS,
} from '../scene/environment/NewYorkPlan';
import type { Mission } from '../missions/types';
import { getEnvironment } from '../plugins/registry';
import { nextTargetOf, requiredCheckpoints } from '../missions/types';

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
// of step with the real one, and at this size a photograph of a city is noise.
//
// What it draws is every ROOF, shaded by height, with a dark line wherever one
// roof steps to another — rebuilt from the colliders by
// `generate-nyc-plan.mjs`. An earlier version fused each block into a single
// grey silhouette, and the city came out as nine blobs: a search area with
// nothing in it to search. A block of this city is a dozen buildings, and the
// search is harder and more honest when the map says so.
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

/** Across the dial, in CSS pixels. Smaller than the 132 px radar it replaces:
 *  the map is glanced at, and every pixel of it is a pixel of the window the
 *  pilot is supposed to be searching out of. */
const SIZE = 120;
/** Breathing room inside the rim, so a shape at the edge of the frame is still
 *  drawn rather than sliced by it. */
const PAD = 7;

/**
 * How far the map sees from the aircraft, metres.
 *
 * The one number that decides whether this is a plan or a texture, and it came
 * down with the dial: shrinking the frame without shrinking the reach would
 * have shrunk every block with it, which is the failure this map was rebuilt to
 * fix. 66 m keeps the scale the 152 px dial had. That holds a block and a half
 * in every direction — enough that a street the pilot has swept is
 * recognisably that street. The 22 m red zone takes about a third of the disc once
 * the drone is inside it, which is the right moment for it to: that is when the
 * pilot is searching it. Wider and the blocks stop being distinguishable, which
 * is the failure the whole-city version had; tighter and the pilot loses the
 * context they navigate into the zone by.
 */
const REACH_M = 66;

/**
 * Roofs shade from dark to light with height.
 *
 * This is what turns a block back into buildings. Seen from straight above,
 * every roof is the same flat shape; what tells a tower from the four-storey
 * block beside it is that it is taller, and a light ramp says taller without a
 * number. Kept low in contrast overall so the red zone is still the loudest
 * thing on the dial.
 */
const ROOF_LOW = [70, 78, 90];
const ROOF_HIGH = [196, 205, 216];
/** The line where one roof steps to another. Dark, and thin enough that a block
 *  of twelve buildings reads as twelve rather than as a grid. */
const EDGE = 'rgba(6, 10, 17, 0.75)';

/*
 * The ground, in the order it is laid: asphalt under everything, then paint,
 * sidewalks, grass, canopies, and the props standing on top. Muted, all of it —
 * the ground is context, and the two things on this dial that have to be found
 * at a glance are the aircraft and the red zone.
 */
const ROAD = '#1b1f26';
/**
 * Past the edge of the world: nothing, drawn as nothing.
 *
 * The map used to lay road over its whole disc, so a drone at the edge of the
 * city saw streets and a grid carrying on under it while the window showed open
 * sky and no ground at all — the map describing a city that is not there. The
 * ground is only as big as the model's own road plane, and outside it the dial
 * is this, with a faint line where the land stops.
 */
const VOID = '#07090d';
const LAND_EDGE = 'rgba(148, 163, 184, 0.45)';
const LANE = 'rgba(214, 180, 90, 0.45)';
const WALK = '#3a3f48';
const GRASS = '#3f5c34';
const TREE = 'rgba(60, 104, 52, 0.85)';
const PROP = 'rgba(150, 160, 172, 0.7)';
/**
 * The mesh: a faint grid, one line every ten metres, laid over the ground.
 *
 * It does two jobs. It gives the map a scale — ten metres is a cell, so the
 * pilot can judge how far a street runs without a number — and it shows the
 * map MOVING when the drone flies down a long road where nothing else on the
 * dial changes, which otherwise reads as the map having frozen.
 */
const GRID = 'rgba(148, 163, 184, 0.07)';
const GRID_M = 10;
const ZONE_LINE = '#ff4d4d';
const ZONE_FILL = 'rgba(255, 77, 77, 0.16)';
const DRONE = '#e2e8f0';
/*
 * A delivery's marks, on Multi-Point Delivery — the city map is not only the
 * search's any more. The same colours the marks wear in the world: green for
 * the collection, amber for a destination, and a pale blue for the pad home so
 * it never reads as a second pickup.
 */
const MARK_PICKUP = '#37e08a';
const MARK_DROP = '#ffcf4d';
const MARK_BASE = '#7dd3fc';
const MARK_DONE = 'rgba(148, 163, 184, 0.6)';
/** The next ring on a route, in the pink the rings wear in the world. */
const MARK_RING = '#ff5fa2';

export function MissionCityMap({ mission }: { mission: Mission }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const zone = useMissionStore((s) => s.searchZone);
  const located = useMissionStore((s) => s.located);
  /** Which leg and which package, read on the map's own frame rather than
   *  through React: they change a handful of times a flight, and a selector
   *  would re-run the whole draw effect on each. */
  const live = useRef<{
    leg: MissionLeg;
    runIndex: number;
    deliveredCount: number;
    collected: Record<string, true>;
  }>({
    leg: useMissionStore.getState().leg,
    runIndex: useMissionStore.getState().runIndex,
    deliveredCount: useMissionStore.getState().deliveredCount,
    collected: useMissionStore.getState().collected,
  });
  useEffect(
    () =>
      useMissionStore.subscribe((s) => {
        live.current = {
          leg: s.leg,
          runIndex: s.runIndex,
          deliveredCount: s.deliveredCount,
          collected: s.collected,
        };
      }),
    [],
  );

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

    // The land, from the environment's own bounds. Those are the measured edge
    // of the road plane plus the 0.1 m the containment clamps inside, so taking
    // the 0.1 back off gives the ground exactly.
    const env = getEnvironment(mission.envId);
    const land = env
      ? {
          x0: env.bounds.min[0] + 0.1,
          x1: env.bounds.max[0] - 0.1,
          z0: env.bounds.min[2] + 0.1,
          z1: env.bounds.max[2] - 0.1,
        }
      : null;

    /** The rings the drop waits on, looked up once rather than filtered every
     *  frame. Empty on a mission with no route. */
    const required = new Set(requiredCheckpoints(mission).map((c) => c.id));

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

      // --- The ground ----------------------------------------------------------
      ctx.fillStyle = VOID;
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Everything from the road to the props is clipped to the land, so the
      // grid in particular stops where the ground does.
      if (land) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx(land.x0), sz(land.z0), (land.x1 - land.x0) * k, (land.z1 - land.z0) * k);
        ctx.clip();
      }
      ctx.fillStyle = ROAD;
      ctx.fillRect(0, 0, SIZE, SIZE);
      const rects = (list: readonly number[], colour: string) => {
        ctx.fillStyle = colour;
        for (let i = 0; i < list.length; i += 4) {
          const x = sx(list[i]);
          const y = sz(list[i + 1]);
          const w = list[i + 2] * k;
          const d = list[i + 3] * k;
          if (x + w < 0 || y + d < 0 || x > SIZE || y > SIZE) continue;
          ctx.fillRect(x, y, w, d);
        }
      };
      rects(NYC_WALKS, WALK);
      rects(NYC_LANES, LANE);
      rects(NYC_GRASS, GRASS);

      // The grid, in world metres so it scrolls with the city rather than
      // sitting still over it.
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const g = GRID_M * k;
      for (let x = ((ox % g) + g) % g; x < SIZE; x += g) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, SIZE);
      }
      for (let y = ((oz % g) + g) % g; y < SIZE; y += g) {
        ctx.moveTo(0, y);
        ctx.lineTo(SIZE, y);
      }
      ctx.stroke();

      // Roofs first, then the edges over them. Off the disc entirely is skipped
      // rather than clipped: at this zoom most of the city is off it most of
      // the time, and there are well over a thousand roofs.
      for (let i = 0; i < NYC_ROOFS.length; i += 5) {
        const x = sx(NYC_ROOFS[i]);
        const y = sz(NYC_ROOFS[i + 1]);
        const w = NYC_ROOFS[i + 2] * k;
        const d = NYC_ROOFS[i + 3] * k;
        if (x + w < 0 || y + d < 0 || x > SIZE || y > SIZE) continue;
        ctx.fillStyle = roofColour(NYC_ROOFS[i + 4]);
        // Half a pixel of overdraw each way, so neighbouring roofs of the same
        // shade meet instead of leaving a hairline of background between them.
        ctx.fillRect(x - 0.25, y - 0.25, w + 0.5, d + 0.5);
      }
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i < NYC_EDGES.length; i += 4) {
        const x1 = sx(NYC_EDGES[i]);
        const y1 = sz(NYC_EDGES[i + 1]);
        const x2 = sx(NYC_EDGES[i + 2]);
        const y2 = sz(NYC_EDGES[i + 3]);
        if (Math.max(x1, x2) < 0 || Math.max(y1, y2) < 0) continue;
        if (Math.min(x1, x2) > SIZE || Math.min(y1, y2) > SIZE) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      // Canopies over the roofs they overhang, and props over everything: seen
      // from above a tree covers the sidewalk and a lamp stands clear of both.
      rects(NYC_TREES, TREE);
      ctx.fillStyle = PROP;
      for (let i = 0; i < NYC_PROPS.length; i += 2) {
        const x = sx(NYC_PROPS[i]);
        const y = sz(NYC_PROPS[i + 1]);
        if (x < 0 || y < 0 || x > SIZE || y > SIZE) continue;
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
      }

      if (land) {
        ctx.restore();
        ctx.strokeStyle = LAND_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          sx(land.x0),
          sz(land.z0),
          (land.x1 - land.x0) * k,
          (land.z1 - land.z0) * k,
        );
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

      // --- A delivery's marks -------------------------------------------------
      //
      // Only on a mission that is not a search: the search draws nothing but its
      // red zone, and that rule lives above. Here every mark is on the plan —
      // the pharmacy in green, the destinations in amber, the pad home in blue —
      // because a delivery pilot is TOLD where everything is. Dots only, no
      // letters: the one being flown to breathes, a package already placed goes
      // grey, the rest are outlines. The live one rides the rim when it is off
      // the frame, the same way the red zone's pip does.
      if (!mission.search) {
        const { leg, runIndex, deliveredCount, collected } = live.current;
        // A route's next ring comes first, exactly as on the radar: while one is
        // owed it is the thing being flown to, and no zone is lit over it.
        const cp = nextTargetOf(mission, legOf(leg), collected);
        const here = cp ? null : activeZone(leg);
        const beat = 0.5 + 0.5 * Math.sin((clock / 1000) * Math.PI * 1.4);
        const drops = mission.deliveries ?? [{ id: 'd', zone: mission.zones.drop }];
        const marks = [
          {
            at: mission.zones.pickup.at,
            colour: MARK_PICKUP,
            active: here === 'pickup',
            done: false,
          },
          ...drops.map((d, i) => ({
            at: d.zone.at,
            colour: MARK_DROP,
            active: here === 'drop' && i === runIndex,
            done: i < deliveredCount,
          })),
          {
            at: mission.zones.base.at,
            colour: MARK_BASE,
            active: here === 'base',
            done: false,
          },
        ];

        for (const m of marks) {
          const x = sx(m.at[0]);
          const y = sz(m.at[1]);
          const dx = x - half;
          const dy = y - half;
          const away = Math.hypot(dx, dy);
          const onFrame = away <= half - 6;

          if (!onFrame) {
            if (!m.active) continue;
            const px2 = half + (dx / away) * (half - 9);
            const py2 = half + (dy / away) * (half - 9);
            ctx.fillStyle = m.colour;
            ctx.beginPath();
            ctx.arc(px2, py2, 3.5, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }

          if (m.active) {
            ctx.strokeStyle = m.colour;
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.35 + 0.45 * beat;
            ctx.beginPath();
            ctx.arc(x, y, 6.5 + beat * 3.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = m.colour;
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          } else if (m.done) {
            ctx.fillStyle = MARK_DONE;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = m.colour;
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        // The next ring, over the zones: it is what the pilot flies to next.
        if (cp) {
          const x = sx(cp[0]);
          const y = sz(cp[2]);
          const dx = x - half;
          const dy = y - half;
          const away = Math.hypot(dx, dy);
          ctx.fillStyle = MARK_RING;
          if (away > half - 6) {
            ctx.beginPath();
            ctx.arc(half + (dx / away) * (half - 9), half + (dy / away) * (half - 9), 3.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = MARK_RING;
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.35 + 0.45 * beat;
            ctx.beginPath();
            ctx.arc(x, y, 6.5 + beat * 3.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // How many rings the drop is still waiting on, while they are in the way.
        let owed = 0;
        for (const id of required) if (!collected[id]) owed++;
        if (owed > 0 && (leg === 'carrying' || leg === 'toDrop')) {
          ctx.font = '800 9px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = 'rgba(6, 10, 17, 0.85)';
          ctx.fillText(`${owed} left`, half + 0.7, SIZE - 8 + 0.7);
          ctx.fillStyle = MARK_RING;
          ctx.fillText(`${owed} left`, half, SIZE - 8);
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

/** A roof's shade, cached per whole metre — there are only ever ~120 distinct
 *  heights, and building a colour string for every roof every frame would be
 *  a thousand small allocations a frame for the same few answers. */
const shades = new Map<number, string>();
function roofColour(h: number): string {
  let c = shades.get(h);
  if (c) return c;
  // Square root rather than linear: most of this city is under 40 m and a
  // linear ramp spends its whole range on the few towers, leaving every
  // ordinary block the same dark grey.
  const f = Math.sqrt(Math.min(1, Math.max(0, h / NYC_PLAN_TALLEST)));
  const ch = (i: number) => Math.round(ROOF_LOW[i] + (ROOF_HIGH[i] - ROOF_LOW[i]) * f);
  c = `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
  shades.set(h, c);
  return c;
}
