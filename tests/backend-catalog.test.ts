import { describe, expect, it } from 'vitest';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { MISSIONS } from '../src/renderer/missions';
import { maxPointsOf } from '../src/renderer/missions/types';
import { LESSONS } from '../src/renderer/training/lessons';
import { DRONE_IDS, MISSION_IDS, TRAINING_IDS } from '../src/renderer/services/catalog';
import { loadBackend } from './helpers/appsScript';

// The simulator and the backend each hold the catalog: the game maps its keys
// to ids, the backend validates ids and caps scores. A drone added to one and
// not the other is a session the server refuses, silently, forever. These fail
// first instead.

const seeded = () => {
  const be = loadBackend();
  be.fn.setupDatabase();
  return {
    drones: be.ss.sheet('Drones').objects(),
    missions: be.ss.sheet('Missions').objects(),
    training: be.ss.sheet('TrainingModules').objects(),
  };
};

describe('analytics catalog', () => {
  it('gives every drone in the game an id the backend knows', () => {
    const { drones } = seeded();
    // The same three `loadBuiltinPlugins` registers. A new drone added there
    // must be added here too.
    for (const drone of [plutoDrone, guruDrone, racingDrone]) {
      const id = DRONE_IDS[drone.id];
      expect(id, `no catalog id for drone ${drone.id}`).toBeDefined();
      expect(drones.find((d) => d['Drone ID'] === id)?.['Sim Key'], drone.id).toBe(drone.id);
    }
  });

  it('gives every mission an id, and the backend its real maximum score', () => {
    const { missions } = seeded();
    for (const m of MISSIONS) {
      const id = MISSION_IDS[m.id];
      expect(id, `no catalog id for mission ${m.id}`).toBeDefined();
      const row = missions.find((r) => r['Mission ID'] === id);
      expect(row?.['Sim Key'], m.id).toBe(m.id);
      expect(row?.['Max Score'], `${m.id} max score`).toBe(maxPointsOf(m));
    }
  });

  it('gives every Flight School lesson an id', () => {
    const { training } = seeded();
    for (const lesson of LESSONS) {
      const id = TRAINING_IDS[lesson.id];
      expect(id, `no catalog id for lesson ${lesson.id}`).toBeDefined();
      expect(training.find((r) => r['Training ID'] === id)?.['Sim Key'], lesson.id).toBe(lesson.id);
    }
  });

  it('never reuses an id', () => {
    for (const map of [DRONE_IDS, MISSION_IDS, TRAINING_IDS]) {
      const ids = Object.values(map);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
