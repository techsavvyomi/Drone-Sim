import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import type { Mission } from './types';
import { zoneGroundY } from './types';
import { CASUALTY_OFFSET, CasualtyFigure } from './CasualtyFigure';

// ----------------------------------------------------------------------------
// What is on the roof at the live search site: the casualty, and nothing else.
//
// No ring, no light, no smoke, nothing in a colour the pilot has learned means
// "your destination". The flare, its glow, the red shaft and pool, and then the
// smoke plume were all removed on the maintainer's call: the pilot is looking
// for a PERSON, flies to them, and hovers over them.
//
// The person stands just off the site's centre, where the food box is dropped —
// see `CASUALTY_OFFSET`.
// ----------------------------------------------------------------------------

/**
 * Metres from the site past which the casualty is not drawn at all.
 *
 * A draw budget and nothing else. Set far beyond the signal's own detect radius
 * on purpose: the pilot must always be able to SEE the person before the HUD
 * says anything about them.
 */
const DRAW_RANGE = 220;

export function SearchBeacon({ mission, siteIndex }: { mission: Mission; siteIndex: number }) {
  const group = useRef<THREE.Group>(null);

  const search = mission.search;
  const site = search?.sites[Math.min(Math.max(siteIndex, 0), search.sites.length - 1)];

  useFrame(() => {
    if (!site || !group.current) return;
    const d = Math.hypot(dronePose.position.x - site.at[0], dronePose.position.z - site.at[1]);
    group.current.visible = d <= DRAW_RANGE;
  });

  if (!site) return null;

  return (
    <group ref={group} position={[site.at[0], zoneGroundY(mission, site.zone), site.at[1]]}>
      <CasualtyFigure
        worldX={site.at[0] + CASUALTY_OFFSET[0]}
        worldZ={site.at[1] + CASUALTY_OFFSET[1]}
        position={[CASUALTY_OFFSET[0], 0, CASUALTY_OFFSET[1]]}
      />
    </group>
  );
}
