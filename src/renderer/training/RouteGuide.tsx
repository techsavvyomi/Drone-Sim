import { useMemo } from 'react';
import * as THREE from 'three';
import { useTrainingStore } from '../state/trainingStore';
import { getLesson } from './lessons';
import type { Checkpoint } from './lessons/types';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';

// The route guide.
//
// It builds NO scenery. Every checkpoint a lesson names is something already
// standing on the field — a racing gate, a painted landing pad, one of the white
// markers ringing the helipad — and the pilot flies to THAT.
//
// It has been trimmed repeatedly, always for the same reason: something drawn
// over the arena that could not be hidden. A letter over every checkpoint at
// once — the "A B C D everywhere" that made the field unreadable. A chevron
// drawn with `depthTest` off, which filled the screen whenever the target was
// underneath the drone. Route lines drawn the same way, which stopped being
// lines hanging in the air and became a yellow stripe painted flat across the
// arena floor.
//
// Two things are left, and both are opt-in, so a lesson gets neither by simply
// naming two points.
//
//   - A NAME on the target, for a lesson that calls its checkpoint something
//     the field does not say by itself. Module 7 sends the pilot through the
//     blue square gate and calls it "A"; nothing is painted on that gate, so
//     without this the instruction names a thing the pilot cannot pick out.
//     Depth-tested, so the frame in front of it hides it like anything else.
//
//   - Module 11's RING, the one shape that is not an arena object at all: there
//     is nothing standing on the field to fly around, so without it the lesson
//     is "fly a circle of some radius somewhere near the pad".
/** The circle lesson's painted lap line. Red, so it cannot be taken for one of
 *  the pad's own white markings — it is the one thing on that deck the pilot is
 *  being asked to fly. */
const RING = '#ff2b4d';
/** Half the width of that painted stripe, in metres. */
const RING_W = 0.2;
/** One colour for every name on the field, and one brightness.
 *
 *  Red, matching the lap line: these are the marks the pilot is being sent to,
 *  and the arena's own paint is white and its own furniture is blue and green.
 *
 *  They used to breathe on the live one and sit at 40% on the rest, which meant
 *  a letter could be on the field and barely readable, and a glance had to work
 *  out which of two half-lit letters was meant. What is still to do is what is
 *  still THERE — a name comes off the field the moment its place is behind the
 *  pilot — so the state is already being told, and telling it twice in fading
 *  paint only made the paint harder to read. */
const LABEL = '#ff2b4d';
/** How wide a number painted on the ground is, in metres. */
const PAINT_M = 2.4;

/**
 * A checkpoint's name, painted into a canvas.
 *
 * The arena has no text renderer — every marking on the field is geometry — so
 * the text is drawn once per label and cached.
 *
 * `ground` is the version that goes on the FLOOR, and it is a different picture,
 * not the same one turned flat: it carries its own dark disc, because a bare
 * white glyph lying on white pad paint is not a number, it is a scuff.
 */
const labelTextures = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string, ground = false): THREE.CanvasTexture {
  const key = ground ? `g:${text}` : text;
  const cached = labelTextures.get(key);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (ground) {
      ctx.fillStyle = 'rgba(12, 16, 24, 0.72)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = size * 0.045;
      ctx.strokeStyle = LABEL;
      ctx.stroke();
    }
    ctx.fillStyle = ground ? LABEL : '#ffffff';
    ctx.font = `700 ${text.length > 1 ? 108 : 176}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  labelTextures.set(key, texture);
  return texture;
}

/**
 * The height the floor sits at under a point, in world Y.
 *
 * The helipad is a slab standing 0.12 m proud of the field, and the markers
 * these numbers go on ring its edge — paint dropped at y = 0 there disappears
 * inside the concrete.
 */
function floorY(x: number, z: number): number {
  const onPad =
    Math.hypot(x - ACADEMY_PAD.center[0], z - ACADEMY_PAD.center[1]) <= ACADEMY_PAD.radius;
  return (onPad ? ACADEMY_PAD.surfaceY : 0) + 0.02;
}

/**
 * A checkpoint's name, PAINTED ON THE GROUND under it.
 *
 * For anything standing on the floor — the ring markers, the pads, the "H" —
 * this is where the number belongs. Sprites hanging over them floated in the
 * middle of the flying space, in front of the very corners they were labelling,
 * and read as clutter; on the deck they read as a marked-out course, and the
 * pilot looks DOWN at the shape they are being asked to fly. It is a marking
 * like any other marking in the arena, so it is drawn like one: flat, offset out
 * of the concrete, and depth-tested.
 *
 * The text points down the field (its top toward -Z), which is the way the
 * chase camera reads it on every lesson that uses this — none of them turn.
 */
function GroundLabel({ point }: { point: Checkpoint }) {
  const [px, , pz] = point.at;
  // Pulled in far enough to sit WHOLLY on the concrete. The ring markers stand
  // 6.8 m out on a 7 m slab, so a 2.4 m disc centred on one would hang most of
  // its far half over the grass — and the slab is 0.12 m proud, so that half
  // would be floating.
  const [x, z] = useMemo(() => {
    const [cx, cz] = ACADEMY_PAD.center;
    const r = Math.hypot(px - cx, pz - cz);
    const max = ACADEMY_PAD.radius - PAINT_M / 2;
    if (r <= max || r < 1e-6) return [px, pz];
    return [cx + ((px - cx) / r) * max, cz + ((pz - cz) / r) * max];
  }, [px, pz]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, floorY(x, z), z]}>
      <planeGeometry args={[PAINT_M, PAINT_M]} />
      <meshBasicMaterial
        map={labelTexture(point.tag ?? '', true)}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  );
}

/**
 * A checkpoint's name IN a gate, as a sprite hanging in the opening.
 *
 * A gate is the one landmark that is not on the floor, and it is met head-on
 * from tens of metres away: paint under it would be looked at edge-on and read
 * as nothing at all.
 *
 * It sits on the checkpoint itself — the middle of the hole, at the height the
 * lesson is actually judged at — rather than perched above the frame. Above it,
 * the letter named the gate; in it, the letter IS the thing to fly at, and the
 * pilot lines up on the letter and goes through it.
 */
function GateLabel({ point }: { point: Checkpoint }) {
  const [x, y, z] = point.at;
  return (
    <sprite position={[x, y, z]} scale={[2.2, 2.2, 2.2]}>
      <spriteMaterial
        map={labelTexture(point.tag ?? '')}
        color={LABEL}
        transparent
        opacity={1}
        depthWrite={false}
      />
    </sprite>
  );
}

/**
 * The lap the circle lesson flies, PAINTED ON THE DECK.
 *
 * The one piece of geometry the guide adds, because it is the one shape with
 * nothing standing on the field to fly around — the ring of white markers is
 * sixteen dots, not a line, and Module 11 is judged on how evenly the radius was
 * held between them.
 *
 * On the deck rather than hanging at flying height, for the same reason the
 * corner letters are: a stripe in the air sits in the middle of the space the
 * drone is trying to occupy, and to be seen through the pad at all it had to
 * skip depth testing, which put it over everything. Painted, it is a lap line
 * like the ones on a running track, and the pilot flies above it and looks down.
 *
 * The outer edge is held inside the slab, so the stripe never leaves the
 * concrete for the grass 0.12 m below it.
 */
function Ring({ radius }: { radius: number }) {
  const [cx, cz] = ACADEMY_PAD.center;
  const outer = Math.min(radius + RING_W, ACADEMY_PAD.radius);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, floorY(cx + radius, cz), cz]}>
      <ringGeometry args={[Math.max(outer - RING_W * 2, 0.1), outer, 96]} />
      <meshBasicMaterial
        color={RING}
        transparent
        opacity={0.9}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  );
}

/** Two checkpoints are the same PLACE if they are the same spot on the field. */
function samePlace(a: Checkpoint, b: Checkpoint): boolean {
  return Math.abs(a.at[0] - b.at[0]) < 0.2 && Math.abs(a.at[2] - b.at[2]) < 0.2;
}

export function RouteGuide() {
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const routeTarget = useTrainingStore((s) => s.routeTarget);
  const phase = useTrainingStore((s) => s.phase);

  const lesson = useMemo(
    () => (activeLessonId ? getLesson(activeLessonId) : undefined),
    [activeLessonId],
  );

  // A name goes up once per PLACE, and comes DOWN once that place is behind the
  // pilot. Flying to the gate and back is the whole of Module 5, and the letter
  // going out is what says so: it is there while there is still something to do
  // at it, and gone when there is not. A circuit's closing leg returns to the
  // corner it started from, so a place is only finished when the LAST of its
  // checkpoints is — otherwise Corner A would vanish on the way past and leave
  // nothing to close the loop on.
  //
  // In the demonstration too, and for the same reason: the demo is the pilot's
  // picture of the flight they are about to make, so a field that keeps every
  // letter standing while the drone flies past them teaches the wrong shape.
  // The timeline advances the same cursor the validator does (`rt`), so the
  // letters come off in the demo exactly where they come off in practice.
  // Outside those two phases nothing is being flown, so every name stands.
  const named = useMemo(() => {
    const route = lesson?.route ?? [];
    return route
      .map((c, i) => ({
        point: c,
        first: route.findIndex((d) => samePlace(d, c)) === i,
        last: route.reduce((n, d, j) => (samePlace(d, c) ? j : n), i),
      }))
      .filter((e) => e.first && e.point.tag !== undefined);
  }, [lesson]);

  if (!lesson) return null;
  const tracking = phase === 'practice' || phase === 'demo';

  return (
    <>
      {lesson.guideRing && <Ring radius={lesson.guideRing.radius} />}
      {named.map((e, i) => {
        if (tracking && routeTarget > e.last) return null;
        return e.point.mark === 'gate' ? (
          <GateLabel key={`label-${e.point.label}-${i}`} point={e.point} />
        ) : (
          <GroundLabel key={`label-${e.point.label}-${i}`} point={e.point} />
        );
      })}
    </>
  );
}
