import { beforeEach, describe, expect, it } from 'vitest';
import { usePilotStore } from '../src/renderer/state/pilotStore';

// Pilot rank and XP. The cumulative total is the persisted truth; the rank and
// the bar shown on the badge are derived from it, so the derivation has to be
// stable in both directions.

const RANKS = ['Rookie', 'Cadet', 'Pilot', 'Ace', 'Instructor'];

beforeEach(() => {
  usePilotStore.getState().syncFromTotal(0);
});

describe('rank derivation', () => {
  it('TC-133 a new pilot is a Rookie with an empty bar', () => {
    const p = usePilotStore.getState();

    expect(p.rank).toBe('Rookie');
    expect(p.xp).toBe(0);
    expect(p.xpNext).toBe(500);
  });

  it('TC-133 clearing the first rank promotes and resets the bar', () => {
    usePilotStore.getState().syncFromTotal(500);

    const p = usePilotStore.getState();
    expect(p.rank).toBe('Cadet');
    expect(p.xp).toBe(0);
    // Each rank costs 1.6x the one before it.
    expect(p.xpNext).toBe(800);
  });

  it('TC-133 XP inside a rank is what the bar shows', () => {
    usePilotStore.getState().syncFromTotal(700);

    const p = usePilotStore.getState();
    expect(p.rank).toBe('Cadet');
    expect(p.xp).toBe(200);
    expect(p.xpNext).toBe(800);
  });

  it('TC-133 the rank never runs off the end of the list', () => {
    usePilotStore.getState().syncFromTotal(10_000_000);

    const p = usePilotStore.getState();
    expect(p.rank).toBe('Instructor');
    expect(RANKS).toContain(p.rank);
  });

  it('TC-133 the bar is never over-full at any total', () => {
    for (let total = 0; total <= 20_000; total += 137) {
      usePilotStore.getState().syncFromTotal(total);
      const p = usePilotStore.getState();
      expect(p.xp).toBeGreaterThanOrEqual(0);
      // Only the final rank is allowed to bank XP past its own bar.
      if (p.rank !== 'Instructor') expect(p.xp).toBeLessThan(p.xpNext);
    }
  });
});

describe('earning XP', () => {
  it('TC-155 adding XP returns the new cumulative total', () => {
    const total = usePilotStore.getState().addXp(180);

    expect(total).toBe(180);
    expect(usePilotStore.getState().totalXp).toBe(180);
    expect(usePilotStore.getState().xp).toBe(180);
  });

  it('TC-156 crossing the threshold changes the rank', () => {
    usePilotStore.getState().syncFromTotal(480);
    expect(usePilotStore.getState().rank).toBe('Rookie');

    usePilotStore.getState().addXp(40);

    expect(usePilotStore.getState().rank).toBe('Cadet');
  });

  it('TC-155 a negative award cannot take XP away', () => {
    usePilotStore.getState().syncFromTotal(300);

    usePilotStore.getState().addXp(-500);

    expect(usePilotStore.getState().totalXp).toBe(300);
  });
});
