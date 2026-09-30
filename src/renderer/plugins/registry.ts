import type { DroneSpec, EnvironmentSpec, MissionSpec } from '@shared/types';

// The extensibility core (Deliverable #6). Content is registered into typed maps
// at startup. Engine services (scene, HUD, scoring, telemetry) read the active
// spec by id and never hard-code a specific drone/map/mission/lesson.

const drones = new Map<string, DroneSpec>();
const environments = new Map<string, EnvironmentSpec>();
const missions = new Map<string, MissionSpec>();

export function registerDrone(spec: DroneSpec): void {
  drones.set(spec.id, spec);
}
export function registerEnvironment(spec: EnvironmentSpec): void {
  environments.set(spec.id, spec);
}
export function registerMission(spec: MissionSpec): void {
  missions.set(spec.id, spec);
}

export function getDrone(id: string): DroneSpec | undefined {
  return drones.get(id);
}
export function getEnvironment(id: string): EnvironmentSpec | undefined {
  return environments.get(id);
}

export function listDrones(): DroneSpec[] {
  return [...drones.values()];
}
export function listEnvironments(): EnvironmentSpec[] {
  return [...environments.values()];
}
