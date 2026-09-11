import { CylinderCollider, RigidBody } from '@react-three/rapier';
import { PAD_MARGIN } from './MissionMarkers';
import { zoneGroundY } from './types';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The delivery platforms on the roofs, for the physics.
//
// `RooftopPad` is drawn and nothing else. It was built to fill the gap between a
// roof slab and the collider over it, which used to be solid up to the parapet —
// so the platform only LOOKED solid because the city collider under it was. The
// colliders are now fitted to the slab, and without this the drone would sink
// through a platform it can plainly see and deliver onto the roof beneath.
//
// One fixed cylinder per platform, the drawn platform's own footprint, from the
// roof it stands on (`padBase`) up to the deck the zone declares (`groundY`).
// It lives inside `<Physics>`, so `MissionViewport` hands it to the scene as a
// child, the same way `CasualtyCollider` is.
// ----------------------------------------------------------------------------

export function RooftopPadCollider({ mission }: { mission: Mission }) {
  const pads = (mission.deliveries ?? []).filter((d) => d.zone.padBase !== undefined);
  if (pads.length === 0) return null;

  return (
    <RigidBody type="fixed" colliders={false} name="mission-rooftop-pads">
      {pads.map((d) => {
        const base = d.zone.padBase!;
        const deck = zoneGroundY(mission, d.zone);
        const half = (deck - base) / 2;
        if (half <= 0.01) return null;
        return (
          <CylinderCollider
            key={d.id}
            args={[half, d.zone.radius + PAD_MARGIN]}
            position={[d.zone.at[0], base + half, d.zone.at[1]]}
            friction={0.8}
            restitution={0}
          />
        );
      })}
    </RigidBody>
  );
}
