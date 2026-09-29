import type { UserProfile } from '@shared/backend/contract';
import { usePilotStore } from '../state/pilotStore';
import { useAccountStore } from '../state/accountStore';

// What the pilot badge, nav card and profile show as the pilot's standing.
//
// Signed in, it is the profile's: the server's level and points. Without
// profiles (a build with no backend) it falls back to the local Flight School
// XP the badge has always shown.

/** The rank ladder, lowest first: each rank starts at a level. Cosmetic: the
 *  level itself is the server's. */
export const RANK_LADDER: readonly { name: string; level: number }[] = [
  { name: 'Rookie', level: 1 },
  { name: 'Cadet', level: 3 },
  { name: 'Pilot', level: 5 },
  { name: 'Ace', level: 8 },
  { name: 'Elite', level: 12 },
  { name: 'Legend', level: 20 },
];

/** The server's default XP per level (setting LEVEL_POINTS). */
const DEFAULT_LEVEL_STEP = 500;

function rankIndex(level: number): number {
  let at = 0;
  RANK_LADDER.forEach((r, i) => {
    if (level >= r.level) at = i;
  });
  return at;
}

export function rankForLevel(level: number): string {
  return RANK_LADDER[rankIndex(level)].name;
}

export interface LadderStep {
  name: string;
  level: number;
  /** Total XP at which this rank starts. */
  xp: number;
  state: 'reached' | 'current' | 'ahead';
}

export interface RankStanding {
  rank: string;
  /** 1-based: "Rank 2 of 6". */
  position: number;
  of: number;
  totalXp: number;
  ladder: LadderStep[];
  /** The next rank up, or null at the top. */
  next: { name: string; xpToGo: number } | null;
  /** XP into the current rank / XP the rank spans, for its progress bar. */
  intoRank: number;
  rankSpan: number;
}

/**
 * Where a profile stands on the ladder. The server's level is
 * 1 + floor(points / step) and it sends `levelPoints` = { points % step, step },
 * so a rank that starts at level L starts at (L − 1) × step XP.
 */
export function rankStanding(p: Pick<UserProfile, 'level' | 'levelPoints'>): RankStanding {
  const step = p.levelPoints.next > 0 ? p.levelPoints.next : DEFAULT_LEVEL_STEP;
  const totalXp = (Math.max(1, p.level) - 1) * step + Math.max(0, p.levelPoints.current);
  const at = rankIndex(p.level);
  const ladder = RANK_LADDER.map(
    (r, i): LadderStep => ({
      name: r.name,
      level: r.level,
      xp: (r.level - 1) * step,
      state: i < at ? 'reached' : i === at ? 'current' : 'ahead',
    }),
  );
  const nextStep = ladder[at + 1] ?? null;
  return {
    rank: ladder[at].name,
    position: at + 1,
    of: ladder.length,
    totalXp,
    ladder,
    next: nextStep ? { name: nextStep.name, xpToGo: nextStep.xp - totalXp } : null,
    intoRank: totalXp - ladder[at].xp,
    rankSpan: nextStep ? nextStep.xp - ladder[at].xp : 0,
  };
}

export interface PilotStanding {
  name: string;
  /** "Level 2 · Rookie", or the local rank name. */
  rank: string;
  current: number;
  next: number;
  unit: string;
}

function fromProfile(p: UserProfile): PilotStanding {
  return {
    name: p.name,
    rank: `Level ${p.level} · ${rankForLevel(p.level)}`,
    current: p.levelPoints.current,
    next: p.levelPoints.next,
    unit: 'XP',
  };
}

export function usePilotStanding(): PilotStanding {
  const pilot = usePilotStore();
  const profile = useAccountStore((s) => (s.status === 'signedIn' ? s.profile : null));
  // The main process only stores whole profiles; this is the last guard, since a
  // throw here takes the whole window down.
  if (profile?.levelPoints) return fromProfile(profile);
  return { name: pilot.callsign, rank: pilot.rank, current: pilot.xp, next: pilot.xpNext, unit: 'XP' };
}
