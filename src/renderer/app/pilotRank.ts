import type { UserProfile } from '@shared/backend/contract';
import { usePilotStore } from '../state/pilotStore';
import { useAccountStore } from '../state/accountStore';

// What the pilot badge, nav card and profile show as the pilot's standing.
//
// Signed in, it is the profile's: the server's level and points. Without
// profiles (a build with no backend) it falls back to the local Flight School
// XP the badge has always shown.

/** Display rank for a level. Cosmetic: the level itself is the server's. */
const RANKS: [number, string][] = [
  [20, 'Legend'],
  [12, 'Elite'],
  [8, 'Ace'],
  [5, 'Pilot'],
  [3, 'Cadet'],
  [1, 'Rookie'],
];

export function rankForLevel(level: number): string {
  return RANKS.find(([min]) => level >= min)?.[1] ?? 'Rookie';
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
