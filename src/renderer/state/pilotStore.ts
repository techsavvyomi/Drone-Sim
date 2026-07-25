import { create } from 'zustand';

// Pilot profile and progression. Phase 4 will award XP from lesson and mission
// scoring and persist this alongside the settings document; for now it holds
// the starting state so the UI has something real to bind to.
interface PilotState {
  callsign: string;
  rank: string;
  xp: number;
  xpNext: number;
  addXp: (amount: number) => void;
  setCallsign: (callsign: string) => void;
}

const RANKS = ['Rookie', 'Cadet', 'Pilot', 'Ace', 'Instructor'];

export const usePilotStore = create<PilotState>((set) => ({
  callsign: 'DronePilot',
  rank: RANKS[0],
  xp: 120,
  xpNext: 500,

  addXp: (amount) =>
    set((s) => {
      let xp = s.xp + amount;
      let xpNext = s.xpNext;
      let rankIdx = RANKS.indexOf(s.rank);
      while (xp >= xpNext && rankIdx < RANKS.length - 1) {
        xp -= xpNext;
        xpNext = Math.round(xpNext * 1.6);
        rankIdx += 1;
      }
      return { xp, xpNext, rank: RANKS[rankIdx] };
    }),

  setCallsign: (callsign) => set({ callsign }),
}));
