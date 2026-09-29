import type { Mission } from '../missions/types';
import { getEnvironment } from '../plugins/registry';
import { StepArt, missionImage } from './MissionArt';

/** The map's name from its own spec, so a renamed map renames every row. */
export function mapNameOf(m: Mission): string {
  return getEnvironment(m.envId)?.name ?? m.envId;
}

/** The mission's own picture: its hero, else its first step's, else the drawn
 *  scene for its first step. The list row and the briefing both use it. */
export function MissionPicture({ mission }: { mission: Mission }) {
  const src = missionImage(mission.id, 'hero') ?? missionImage(mission.id, 1);
  return <StepArt art={mission.flow[0]?.art ?? 'city'} src={src} />;
}
