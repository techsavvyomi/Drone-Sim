import { create } from 'zustand';

// Pilot profile and progression. XP is earned from Flight School lesson scoring
// and persisted in the settings document (settings.training.xp); this store is
// hydrated from that total on boot and kept in sync as lessons are completed.
interface PilotState {
  callsign: string;
  rank: string;
  /** Cumulative lifetime XP — the persisted source of truth. */
  totalXp: number;
  /** XP earned within the current rank (for the progress bar). */
  xp: number;
  /** XP needed to reach the next rank. */
  xpNext: number;
  /** Replace the total (e.g. on hydrate) and re-derive rank/level. */
  syncFromTotal: (totalXp: number) => void;
  /** Add XP and re-derive; returns the new cumulative total for persistence. */
  addXp: (amount: number) => number;
  setCallsign: (callsign: string) => void;
}

const RANKS = ['Rookie', 'Cadet', 'Pilot', 'Ace', 'Instructor'];
/** XP required to clear the first rank; each rank costs 1.6x the previous. */
const BASE_XP_NEXT = 500;

/** Split a cumulative XP total into { rank, xp-within-rank, xpNext }. */
function derive(totalXp: number): { rank: string; xp: number; xpNext: number } {
  let xp = Math.max(0, Math.round(totalXp));
  let xpNext = BASE_XP_NEXT;
  let rankIdx = 0;
  while (xp >= xpNext && rankIdx < RANKS.length - 1) {
    xp -= xpNext;
    xpNext = Math.round(xpNext * 1.6);
    rankIdx += 1;
  }
  return { rank: RANKS[rankIdx], xp, xpNext };
}

export const usePilotStore = create<PilotState>((set, get) => ({
  callsign: 'DronePilot',
  totalXp: 0,
  ...derive(0),

  syncFromTotal: (totalXp) => set({ totalXp, ...derive(totalXp) }),

  addXp: (amount) => {
    const totalXp = get().totalXp + Math.max(0, amount);
    set({ totalXp, ...derive(totalXp) });
    return totalXp;
  },

  setCallsign: (callsign) => set({ callsign }),
}));
