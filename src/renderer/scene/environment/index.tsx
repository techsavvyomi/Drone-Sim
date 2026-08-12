import type { EnvironmentSpec } from '@shared/types';
import { ArenaEnv } from './ArenaEnv';
import { AcademyEnv } from './AcademyEnv';
import { FlightSchoolEnv } from './FlightSchoolEnv';
import { Classroom2Env } from './Classroom2Env';

// Renderer-side lookup from environment id to its scene component.
//
// The EnvironmentSpec in @shared/types stays plain data (it's imported by the
// Electron main process too, so it must not reference React). This map is where
// the visuals get attached — adding a map means one spec file plus one entry.

export type EnvComponent = (props: { env: EnvironmentSpec }) => React.ReactElement | null;

const ENV_COMPONENTS: Record<string, EnvComponent> = {
  'drone-arena': ArenaEnv,
  'drone-academy': AcademyEnv,
  'flight-school': FlightSchoolEnv,
  'classroom-2': Classroom2Env,
};

export function getEnvironmentComponent(id: string): EnvComponent {
  return ENV_COMPONENTS[id] ?? ArenaEnv;
}
