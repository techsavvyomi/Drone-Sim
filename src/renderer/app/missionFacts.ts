import type { MissionProgress } from '@shared/types';
import type {
  Mission,
  MissionRank,
  MissionResult,
  MissionZoneKind,
} from '../missions/types';
import { deliveryCount, dropZoneOf, nextCheckpointOf, pickupZoneOf } from '../missions/types';
import type { FailReason, LogLine, MissionLeg } from '../state/missionStore';

// What Pluto Field Ops says, as pure functions (Phase 5): the blocks and rows of
// the mission list, the briefing's header, the HUD's clock and star line, and
// the result and failure cards. Everything comes from the missions themselves,
// their limits (missions/limits.ts) and the local progress record. The PDF's
// mission names, places, payload masses and the 83 % / 67 % rule are
// placeholders; the stars here are each mission's own rubric.

type Progress = MissionProgress['missions'];

// ---- Words and numbers --------------------------------------------------------

/** The one pluraliser: "1 delivery", "2 deliveries". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3:00" — minutes and whole seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ---- Blocks ------------------------------------------------------------------

export interface MissionBlockDef {
  name: string;
  /** First and last mission, 1-based and inclusive. */
  from: number;
  to: number;
}

/**
 * The ten missions in four blocks, by the map they are flown on — the user's
 * call over the PDF's City / Forest / Night, which the real list does not fit:
 * 1–4 New York and the forest by day, 5–6 the forest after dark, 7–8 the
 * construction site, 9–10 the supermarket.
 */
export const MISSION_BLOCKS: readonly MissionBlockDef[] = [
  { name: 'City & Forest', from: 1, to: 4 },
  { name: 'Forest at Night', from: 5, to: 6 },
  { name: 'Construction Site', from: 7, to: 8 },
  { name: 'Supermarket', from: 9, to: 10 },
];

export function missionBlockOf(n: number): MissionBlockDef {
  return (
    MISSION_BLOCKS.find((b) => n >= b.from && n <= b.to) ??
    MISSION_BLOCKS[MISSION_BLOCKS.length - 1]
  );
}

// ---- What a mission is --------------------------------------------------------

/** What the drone carries, in a word or two. */
export function payloadName(m: Mission): string {
  if (m.cargo === 'cement') return 'Cement bag';
  if (m.cargo === 'parcel') return 'Parcels';
  switch (m.kind) {
    case 'suppression':
      return 'Water tank';
    case 'search':
      return 'Food box';
    case 'tracking':
      return 'Spotlight';
    case 'inspection':
      return m.inspection?.needsLight === false ? 'Camera' : 'Spotlight';
    default:
      return m.deliveries && m.deliveries.length > 1 ? 'Medical packages' : 'Medical package';
  }
}

/** How much of the job there is: "1 delivery", "5 boxes", "3 zones". */
export function countLine(m: Mission): string {
  const n = deliveryCount(m);
  if (m.yard) return plural(n, 'box', 'boxes');
  if (m.inspection) return plural(n, 'zone', 'zones');
  switch (m.kind) {
    case 'suppression':
      return plural(1, 'fire', 'fires');
    case 'search':
      return plural(1, 'search area', 'search areas');
    case 'tracking':
      return plural(1, 'sighting', 'sightings');
    default:
      return plural(n, 'delivery', 'deliveries');
  }
}

/** The list row's second line: "New York · Medical package · 1 delivery". */
export function rowMeta(m: Mission, mapName: string): string {
  return `${mapName} · ${payloadName(m)} · ${countLine(m)}`;
}

/** What the plan map's grey blocks are, on each map. */
export function mapBlocksWord(envId: string): string {
  switch (envId) {
    case 'forest':
      return 'Trees';
    case 'construction-site':
      return 'Structures';
    case 'supermarket':
      return 'Store and shelves';
    default:
      return 'Buildings';
  }
}

/** The briefing's header lines. */
export function briefHeader(
  m: Mission,
  total: number,
  mapName: string,
): { title: string; sub: string } {
  return {
    title: `Mission ${m.order} of ${total} · ${m.name}`,
    sub: `${missionBlockOf(m.order).name} · ${mapName} · time limit ${clock(m.timeLimitSec)}`,
  };
}

// ---- The list ----------------------------------------------------------------

export type RowStatus = 'done' | 'next' | 'locked';

export interface MissionRow {
  n: number;
  mission: Mission;
  stars: number;
  bestTimeSec: number | null;
  status: RowStatus;
}

/** One row per mission. The game's unlock rule: the first, or the one after a
 *  completed mission. */
export function missionRows(missions: readonly Mission[], progress: Progress): MissionRow[] {
  return missions.map((mission, i) => {
    const p = progress[mission.id];
    const unlocked = i === 0 || !!progress[missions[i - 1].id]?.completed;
    return {
      n: i + 1,
      mission,
      stars: p?.stars ?? 0,
      bestTimeSec: p?.completed ? p.bestTimeSec : null,
      status: p?.completed ? 'done' : unlocked ? 'next' : 'locked',
    };
  });
}

export function rowStatusText(row: MissionRow): string {
  if (row.status === 'done') return 'Completed';
  if (row.status === 'next') return 'Start';
  return `After Mission ${row.n - 1}`;
}

export interface MissionBlockSummary extends MissionBlockDef {
  index: number;
  done: number;
  total: number;
  stars: number;
  locked: boolean;
  /** "● 2 of 4 done · ★ 5 of 12" or "○ Locked · finish City & Forest". */
  line: string;
}

export function missionBlockSummaries(rows: readonly MissionRow[]): MissionBlockSummary[] {
  return MISSION_BLOCKS.map((b, index) => {
    const mine = rows.filter((r) => r.n >= b.from && r.n <= b.to);
    const done = mine.filter((r) => r.status === 'done').length;
    const stars = mine.reduce((sum, r) => sum + r.stars, 0);
    const locked = mine.length === 0 || mine[0].status === 'locked';
    return {
      ...b,
      index,
      done,
      total: mine.length,
      stars,
      locked,
      line: locked
        ? `Locked · finish ${MISSION_BLOCKS[index - 1]?.name ?? 'the block before'}`
        : `${done} of ${mine.length} done · ★ ${stars} of ${mine.length * 3}`,
    };
  });
}

export interface MissionListSummary {
  done: number;
  stars: number;
  next: MissionRow | null;
  /** "2 of 10 missions · ★ 5 of 30". */
  line: string;
  /** "Next: Mission 3, Multi-Point Delivery". */
  nextLine: string;
}

export function missionListSummary(rows: readonly MissionRow[]): MissionListSummary {
  const done = rows.filter((r) => r.status === 'done').length;
  const stars = rows.reduce((sum, r) => sum + r.stars, 0);
  const next = rows.find((r) => r.status === 'next') ?? null;
  return {
    done,
    stars,
    next,
    line: `${done} of ${rows.length} missions · ★ ${stars} of ${rows.length * 3}`,
    nextLine: !next
      ? 'Every mission flown'
      : done === 0
        ? `Start with Mission ${next.n}, ${next.mission.name}`
        : `Next: Mission ${next.n}, ${next.mission.name}`,
  };
}

/** The block the list opens on: the one holding the next mission, else the last. */
export function openingMissionBlock(rows: readonly MissionRow[]): number {
  const next = rows.find((r) => r.status === 'next');
  return MISSION_BLOCKS.indexOf(missionBlockOf(next?.n ?? rows.length));
}

// ---- Star tiers --------------------------------------------------------------

export interface MissionTier {
  stars: 1 | 2 | 3;
  text: string;
  /** Seconds the rung allows, or null when it sets no time of its own. */
  within: number | null;
}

/** The mission's rubric, one star first. The one-star rung is timed by the
 *  limit itself: past it the attempt has failed. */
export function missionTiers(m: Mission): MissionTier[] {
  return [...m.ranks]
    .sort((a, b) => a.stars - b.stars)
    .map((r) => ({
      stars: r.stars,
      text: r.text,
      within: r.within ?? (r.stars === 1 ? m.timeLimitSec : null),
    }));
}

/** The finish that could still be flown now: the job done, home, every point. */
function bestCase(m: Mission, maxPoints: number, timeSec: number, collisions: number): MissionResult {
  return { points: maxPoints, maxPoints, timeSec, collisions, delivered: true, landed: !m.endsAtDrop };
}

/** The best rung a finish right now could still earn, given the collisions so far. */
export function reachableRank(
  m: Mission,
  maxPoints: number,
  elapsed: number,
  collisions: number,
): MissionRank | null {
  const r = bestCase(m, maxPoints, elapsed, collisions);
  return [...m.ranks].sort((a, b) => b.stars - a.stars).find((rank) => rank.test(r)) ?? null;
}

// ---- HUD ---------------------------------------------------------------------

export interface TimeLeft {
  left: number;
  /** "1:48". */
  text: string;
  /** The last 30 seconds: the clock turns caution. */
  caution: boolean;
}

export function timeLeft(limitSec: number, elapsed: number): TimeLeft {
  const left = Math.max(0, limitSec - elapsed);
  // Rounded up, so the clock reads 0:01 until the last second is really gone.
  return { left, text: clock(Math.ceil(left)), caution: left <= 30 };
}

/**
 * The line under the HUD's bar: "3 stars if you finish in the next 0:48 · 1:12
 * used of 8:00". It names the best rung still in reach — a collision can take
 * the top one away before its time does.
 */
export function hudStarLine(
  m: Mission,
  maxPoints: number,
  elapsed: number,
  collisions: number,
): string {
  const used = `${clock(elapsed)} used of ${clock(m.timeLimitSec)}`;
  const rank = reachableRank(m, maxPoints, elapsed, collisions);
  if (!rank) return used;
  const within = rank.within ?? (rank.stars === 1 ? m.timeLimitSec : null);
  const stars = plural(rank.stars, 'star', 'stars');
  return within !== null
    ? `${stars} if you finish in the next ${clock(Math.max(0, within - elapsed))} · ${used}`
    : `${stars} if you finish within the limit · ${used}`;
}

/** The objective band's label: "Objective · 1 delivery", "Objective 2 of 3 · 3 deliveries". */
export function objectiveLabel(m: Mission, doneCount: number): string {
  const total = deliveryCount(m);
  if (total > 1) return `Objective ${Math.min(doneCount + 1, total)} of ${total} · ${countLine(m)}`;
  return `Objective · ${countLine(m)}`;
}

/** "111 m · 18° right", "40 m · ahead". Bearing in radians, positive right. */
export function directionText(bearing: number, distance: number): string {
  const dist = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
  const deg = Math.round((bearing * 180) / Math.PI);
  if (Math.abs(deg) <= 4) return `${dist} · ahead`;
  if (Math.abs(deg) >= 150) return `${dist} · behind`;
  return `${dist} · ${Math.abs(deg)}° ${deg > 0 ? 'right' : 'left'}`;
}

/** Which ground mark the live leg is headed for. */
function zoneFor(leg: MissionLeg): MissionZoneKind | null {
  if (leg === 'toPickup') return 'pickup';
  if (leg === 'carrying' || leg === 'toDrop' || leg === 'confirming') return 'drop';
  if (leg === 'delivered' || leg === 'returning' || leg === 'landing') return 'base';
  return null;
}

/** The strip's "TO …" cell: the next ring when a leg has one, else the mark. */
export function targetLabel(
  m: Mission,
  leg: MissionLeg,
  runIndex: number,
  collected: Record<string, true>,
): string {
  const routeLeg =
    leg === 'toPickup'
      ? 'toPickup'
      : leg === 'carrying' || leg === 'toDrop'
        ? 'toDrop'
        : leg === 'delivered' || leg === 'returning'
          ? 'toBase'
          : null;
  const ring = nextCheckpointOf(m, routeLeg, collected);
  if (ring) return `Ring ${ring.label}`;
  const kind = zoneFor(leg);
  if (kind === 'pickup') return pickupZoneOf(m, runIndex).label;
  if (kind === 'drop') return dropZoneOf(m, runIndex).label;
  if (kind === 'base') return m.zones.base.label;
  return 'Target';
}

/** The latest `n` log lines, newest last — the HUD's "RADIO · LATEST". */
export function latestLog(log: readonly LogLine[], n = 2): LogLine[] {
  return log.slice(Math.max(0, log.length - n));
}

// ---- Result and failure ---------------------------------------------------------

/** What the job is called on an objective row. */
export function jobLabel(m: Mission): string {
  const n = deliveryCount(m);
  if (m.yard) {
    return m.yard.mode === 'load'
      ? `Load all ${n} boxes into the truck`
      : `Unload all ${n} boxes into the store`;
  }
  if (m.inspection) return `Inspect all ${n} zones`;
  switch (m.kind) {
    case 'suppression':
      return 'Put the fire out';
    case 'search':
      return 'Get the food box to them';
    case 'tracking':
      return 'Log the sighting';
    default:
      if (n > 1) return `Deliver all ${n} packages`;
      return m.cargo === 'cement' ? 'Deliver the cement bag' : 'Deliver the package';
  }
}

function doneVerb(m: Mission): string {
  if (m.kind === 'suppression') return 'Fire out';
  if (m.kind === 'tracking') return 'Logged';
  if (m.inspection) return 'Inspected';
  if (m.yard) return m.yard.mode === 'load' ? 'Loaded' : 'Unloaded';
  return 'Delivered';
}

function doneNoun(m: Mission): [string, string] {
  if (m.yard) return ['box', 'boxes'];
  if (m.inspection) return ['zone', 'zones'];
  return ['delivery', 'deliveries'];
}

/** What the attempt did, as the cards read it. */
export interface AttemptFacts {
  /** The job finished (the finish's `delivered`, or false on a failure). */
  delivered: boolean;
  landed: boolean;
  deliveredCount: number;
  deliveredAt: readonly number[];
  landedAt: number | null;
  checkpoints: number;
  collisions: number;
  collisionAt: readonly number[];
}

export interface ObjectiveRow {
  label: string;
  ok: boolean;
  /** The measured value: "Delivered at 5:02", "12 of 13", "First at 1:34". */
  value: string;
}

/**
 * The card's objective rows, each with its own ✓ / ✕ and what was measured —
 * the job, the checkpoints (on a mission that has any), the landing (on a
 * mission that comes home) and collisions.
 */
export function objectiveRows(m: Mission, f: AttemptFacts): ObjectiveRow[] {
  const total = deliveryCount(m);
  const [one, many] = doneNoun(m);
  const last = f.deliveredAt[f.deliveredAt.length - 1];
  const rows: ObjectiveRow[] = [
    {
      label: jobLabel(m),
      ok: f.delivered,
      value: f.delivered
        ? `${doneVerb(m)} at ${clock(last ?? 0)}`
        : total > 1
          ? `Not done · ${f.deliveredCount} of ${plural(total, one, many)}`
          : 'Not done',
    },
  ];
  if (m.route.length > 0) {
    rows.push({
      label: 'Fly the checkpoints',
      ok: f.checkpoints >= m.route.length,
      value: `${f.checkpoints} of ${m.route.length}`,
    });
  }
  if (!m.endsAtDrop) {
    rows.push({
      label: `Land at the ${lowerFirst(m.zones.base.label)}`,
      ok: f.landed,
      value: f.landed && f.landedAt !== null ? `Landed at ${clock(f.landedAt)}` : 'Not landed',
    });
  }
  rows.push({
    label: 'No collisions',
    ok: f.collisions === 0,
    value:
      f.collisions === 0
        ? 'None'
        : f.collisionAt.length > 0
          ? `${plural(f.collisions, 'collision', 'collisions')} · first at ${clock(f.collisionAt[0])}`
          : plural(f.collisions, 'collision', 'collisions'),
  });
  return rows;
}

/**
 * Why a rung was missed, in the result's own numbers: "0:21 over",
 * "1 collision", "2 points short". Worked out by asking the rung's own test —
 * a reason is one the rung still fails without, every other shortfall fixed.
 */
export function missReasons(rank: MissionRank, r: MissionResult, limitSec: number): string[] {
  const within = rank.within ?? (rank.stars === 1 ? limitSec : null);
  const fixes: { fix: Partial<MissionResult>; text: string }[] = [];
  if (within !== null && r.timeSec > within) {
    fixes.push({ fix: { timeSec: within }, text: `${clock(r.timeSec - within)} over` });
  } else if (within === null) {
    fixes.push({ fix: { timeSec: 0 }, text: 'Too slow' });
  }
  if (r.collisions > 0) {
    fixes.push({ fix: { collisions: 0 }, text: plural(r.collisions, 'collision', 'collisions') });
  }
  if (r.points < r.maxPoints) {
    const short = r.maxPoints - r.points;
    fixes.push({ fix: { points: r.maxPoints }, text: `${plural(short, 'point', 'points')} short` });
  }
  if (!r.delivered || !r.landed) {
    fixes.push({ fix: { delivered: true, landed: true }, text: 'Not finished' });
  }
  const all = fixes.reduce<MissionResult>((acc, f) => ({ ...acc, ...f.fix }), { ...r });
  if (!rank.test(all)) return ['Not reached'];
  const needed = fixes.filter((_f, i) => {
    const without = fixes.reduce<MissionResult>(
      (acc, g, j) => (j === i ? acc : { ...acc, ...g.fix }),
      { ...r },
    );
    return !rank.test(without);
  });
  return (needed.length > 0 ? needed : fixes).map((f) => f.text);
}

export type TierState = 'earned' | 'result' | 'missed';

export interface MissionTierRow extends MissionTier {
  state: TierState;
  /** "Earned" / "Your result" / "0:21 over · 1 collision". */
  note: string;
}

export function missionResultTiers(
  m: Mission,
  earned: number,
  r: MissionResult,
): MissionTierRow[] {
  return missionTiers(m).map((t) => {
    if (t.stars === earned) return { ...t, state: 'result', note: 'Your result' };
    if (t.stars < earned) return { ...t, state: 'earned', note: 'Earned' };
    const rank = m.ranks.find((x) => x.stars === t.stars);
    const note = rank ? missReasons(rank, r, m.timeLimitSec).join(' · ') : 'Not reached';
    return { ...t, state: 'missed', note };
  });
}

/** The one line under the tiers: what the next star takes. */
export function missionGapLine(m: Mission, earned: number, timeSec: number): string {
  const next = missionTiers(m).find((t) => t.stars === earned + 1);
  if (!next) return 'Every star earned. Replay it to beat your time.';
  return `${clock(timeSec)} — ${plural(next.stars, 'star', 'stars')} needs ${lowerFirst(next.text)}.`;
}

/** The Best tile: the faster of the saved best and this finish. */
export function bestTimeText(before: number | null, timeSec: number): { value: string; isNew: boolean } {
  if (before === null) return { value: clock(timeSec), isNew: true };
  return timeSec < before
    ? { value: clock(timeSec), isNew: true }
    : { value: clock(before), isNew: false };
}

/** The failure card's heading. */
export function failHeadline(reason: FailReason | null): string {
  switch (reason) {
    case 'timeout':
      return 'Out of time';
    case 'strayed':
      return 'Left the mission area';
    case 'payload':
      return 'Payload lost';
    case 'disturbed':
      return 'Animal disturbed';
    default:
      return 'Drone crashed';
  }
}

/** "At 1:34, 3.6 m up." — or, out of time, when the clock ran out. */
export function failWhere(
  reason: FailReason | null,
  endedAt: { sec: number; altitude: number } | null,
  limitSec: number,
): string {
  if (reason === 'timeout') return `The clock ran out at ${clock(limitSec)}.`;
  if (!endedAt) return '';
  return `At ${clock(endedAt.sec)}, ${Math.max(0, endedAt.altitude).toFixed(1)} m up.`;
}

/** The failure card's one fix — the lines the mission HUD has always given. */
export function failFix(m: Mission, reason: FailReason | null, carrying: boolean): string {
  const fire = !!m.fire;
  const track = !!m.tracking;
  switch (reason) {
    case 'disturbed':
      return 'You had the tiger and then flew down onto it, and it broke off into the trees. Give it room and pick it up again: within 9 m to count, but never on top of the animal.';
    case 'payload':
      return 'The drone dropped into the flames and the tank went with it. Hold the hover above the fire: the height band on the checklist is where the spray reaches from.';
    case 'strayed':
      if (fire) {
        return 'The drone flew out of the response area and did not come back. The arrow on the strip points at the fire the whole way.';
      }
      return track
        ? 'The drone flew out of the survey area and did not come back. The tiger is inside it. The clues say where.'
        : 'The drone flew out of the delivery area and did not come back. The arrow on the strip points at your next target.';
    case 'timeout':
      if (m.timeoutLine) return m.timeoutLine;
      if (fire) return 'The fire got away from you. Take the marked line east next time.';
      return track
        ? 'The survey window closed without a sighting. Read the clues before you launch and fly straight to the line the tiger is walking.'
        : 'The delivery window closed. Take a straighter line through the city.';
    default:
      if (m.crashLine) return m.crashLine;
      if (carrying) {
        return fire
          ? 'The aircraft is wrecked and the suppression tank went down with it.'
          : 'The aircraft is wrecked and the package went down with it.';
      }
      return fire || track
        ? 'The aircraft is wrecked. A tree is solid all the way up to its own treetop.'
        : 'The aircraft is wrecked. Watch the street furniture on the approach.';
  }
}
