import type { Mission, MissionDelivery, MissionYard, RadioLine } from './types';

// ----------------------------------------------------------------------------
// The loading yard: the runs, the radio, and where each box stands.
//
// Missions 9 and 10 move five boxes, one at a time, between the stock pallet
// inside the store and a pallet inside Truck 1. Every box is a run of a
// multi-point delivery; this writes those runs, and says where in each stack a
// box waits and where it is put down.
//
// Pure data in, data out — no store, no three.js — so the missions, the scene
// and the tests all see the same yard.
// ----------------------------------------------------------------------------

/**
 * The mission with a run per box.
 *
 * A copy: the mission file's own fields are not changed. The runs, `zones.pickup`
 * and `zones.drop` (each the FIRST run's own object, as a multi-point
 * delivery's always is), and the radio lines that count the boxes are all
 * written here, from the yard.
 */
export function withYardRuns(m: Mission): Mission {
  const yard = m.yard;
  if (!yard) return m;
  const load = yard.mode === 'load';
  const deliveries: MissionDelivery[] = Array.from({ length: yard.boxes }, (_, i) => ({
    id: `b${i + 1}`,
    name: `Box ${i + 1}`,
    cargo: 'Stock carton',
    zone: load ? yard.truck.bay : yard.warehouse,
    ...(!load && { pickup: yard.truck.bay }),
  }));
  return {
    ...m,
    deliveries,
    zones: {
      ...m.zones,
      pickup: deliveries[0].pickup ?? yard.warehouse,
      drop: deliveries[0].zone,
    },
    radio: { ...m.radio, ...yardRadio(yard) },
  };
}

/** The lines that count the boxes, one set per box. */
function yardRadio(yard: MissionYard): Record<string, RadioLine> {
  const out: Record<string, RadioLine> = {};
  const line = (id: string, text: string) => (out[id] = { id, text });
  const n = yard.boxes;
  const left = (i: number) =>
    n - i - 1 === 0 ? '' : n - i - 1 === 1 ? ' One to go.' : ` ${n - i - 1} to go.`;
  if (yard.mode === 'load') {
    line(
      'start',
      `${n} stock cartons go out on the truck today. They are stacked on the pallet inside the store, by the self-checkouts: in through the right entrance. Collect Box 1 and hold steady over the pallet.`,
    );
    for (let i = 0; i < n; i++) {
      line(
        `pickup-b${i + 1}`,
        i === 0
          ? 'Box 1 on board. Out through the right entrance. The truck in the car park is open along its side: fly in and set the box down on the pallet inside.'
          : `Box ${i + 1} on board. Out through the door and into the truck with it, onto the pallet inside.`,
      );
      line(`delivered-b${i + 1}`, `Box ${i + 1} is in the truck.${left(i)}`);
      if (i + 1 < n) line(`back-b${i + 1}`, `Back into the store for Box ${i + 2}.`);
    }
  } else {
    line(
      'start',
      `${n} stock cartons have come in on the truck in the car park, stacked on a pallet inside it. It is open along its side: fly in, collect Box 1 and hold steady.`,
    );
    for (let i = 0; i < n; i++) {
      line(
        `pickup-b${i + 1}`,
        `Box ${i + 1} is out of the truck. Take it into the store through the right entrance, to the stock pallet by the self-checkouts.`,
      );
      line(`delivered-b${i + 1}`, `Box ${i + 1} is on the store's pallet.${left(i)}`);
      if (i + 1 < n) line(`back-b${i + 1}`, `Back out and into the truck for Box ${i + 2}.`);
    }
  }
  return out;
}

/**
 * Where on a pallet a box stands, as a place in the stack: `slot` 0 to 3 are
 * the four corners of the bottom layer, 4 is the middle of the second, and
 * anything above that goes round the corners again one layer up.
 *
 * Returned in BOX SIZES, so the stack keeps its shape under any airframe's
 * cargo: `[x, layer, z]`, x and z from the pallet's centre.
 */
export function slotOffset(slot: number): [number, number, number] {
  const CORNERS: readonly (readonly [number, number])[] = [
    [-0.55, -0.55],
    [0.55, -0.55],
    [-0.55, 0.55],
    [0.55, 0.55],
  ];
  if (slot < 4) return [CORNERS[slot][0], 0, CORNERS[slot][1]];
  if (slot === 4) return [0, 1, 0];
  const k = (slot - 5) % 4;
  return [CORNERS[k][0], 1 + Math.floor((slot - 5) / 4) + 1, CORNERS[k][1]];
}

/**
 * Where each box of a yard mission stands, before and after it is moved.
 *
 * `from[i]` is box i's place in the stack it waits in, and `to[i]` its place in
 * the stack it is put down on. Taken off the TOP first: the stack is built so
 * box 1 is the highest, and a delivered box goes on the next free place.
 */
export function yardSlots(m: Mission): { from: number[]; to: number[] } {
  const n = (m.deliveries ?? []).length;
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < n; i++) {
    from.push(n - 1 - i);
    to.push(i);
  }
  return { from, to };
}
