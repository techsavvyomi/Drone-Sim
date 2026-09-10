import { CapsuleCollider, RigidBody } from '@react-three/rapier';
import { useMissionStore } from '../state/missionStore';
import { zoneGroundY } from './types';
import { CASUALTY_OFFSET } from './CasualtyFigure';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The casualty's body, for the physics.
//
// `CasualtyFigure` is drawn and nothing else, so the drone flew straight through
// the person it was sent to find. This is the solid half: one fixed capsule the
// size of a standing adult WITH their arms up, on the live site's roof.
//
// It has to live inside `<Physics>`, which `FlightScene` owns — so it is handed
// to the scene as a child rather than mounted beside the markers. The drone's
// own `onCollisionEnter` treats it like any other obstacle: a bump or a crash,
// and a collision on the mission's count.
//
// One capsule rather than a limb-by-limb compound: the arms move every frame,
// and a collider chasing them would be a kinematic body per limb for a shape
// the pilot is meant to hover four metres above anyway.
// ----------------------------------------------------------------------------

/** Metres. Wide enough for the arms swinging over the head. */
const RADIUS = 0.32;
/** Metres, feet to fingertips with both arms up. */
const HEIGHT = 2.15;

export function CasualtyCollider({ mission }: { mission: Mission }) {
  const siteIndex = useMissionStore((s) => s.siteIndex);
  const search = mission.search;
  if (!search) return null;
  const site = search.sites[Math.min(Math.max(siteIndex, 0), search.sites.length - 1)];
  const y = zoneGroundY(mission, site.zone);

  return (
    // Keyed on the site: a fixed body's position is read when it is created, so
    // a new attempt on a different roof has to build a new one.
    <RigidBody
      key={site.id}
      type="fixed"
      colliders={false}
      position={[site.at[0] + CASUALTY_OFFSET[0], y, site.at[1] + CASUALTY_OFFSET[1]]}
    >
      <CapsuleCollider args={[HEIGHT / 2 - RADIUS, RADIUS]} position={[0, HEIGHT / 2, 0]} />
    </RigidBody>
  );
}
