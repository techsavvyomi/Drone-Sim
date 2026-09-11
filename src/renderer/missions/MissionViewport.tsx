import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FlightScene } from '../scene/FlightScene';
import { SceneBoundary } from '../scene/Viewport';
import { qualityFor } from '../scene/quality';
import { SceneReady, SceneVeil } from '../scene/SceneReady';
import { useSettingsStore } from '../state/settingsStore';
import { useWorldStore } from '../state/worldStore';
import { useControls } from '../input/useControls';
import { setCommandScale } from '../input/controls';
import { MissionHud } from '../hud/MissionHud';
import { MissionDirector } from './MissionDirector';
import { MissionMarkers } from './MissionMarkers';
import { CasualtyCollider } from './CasualtyCollider';
import { RooftopPadCollider } from './RooftopPadCollider';
import { Storefront } from './Storefront';
import { HydrantFillPoint } from './HydrantFillPoint';
import { LaunchPad } from './LaunchPad';
import { LAKE_CITY_PHARMACY, LOTUS_KITCHEN } from './pickupStorefront';
import { TargetPointer } from './TargetPointer';
import { FireZone } from './FireZone';
import { Spray } from './Spray';
import { Payload } from './Payload';
import type { Mission } from './types';

// The mission flight view: the same 3D scene as free flight, pinned to the
// mission's own map, with the runtime, the markers and the package layered in
// and the mission overlay on top.
//
// Nothing here is built for the mission except its markers and its cargo. The
// city, the drone, the physics, the camera and the audio are the ones the Fly
// view already flies — a mission is a set of rules over the simulator, not a
// second simulator.
/** Every mission is flown on the Guru, whatever is selected elsewhere. */
const MISSION_DRONE = 'pluto-guru';
/** And in the evening: the city at the blue half hour, which is the light this
 *  mission was built to look like. */
const MISSION_HOUR = 'evening' as const;
/** How much of the stick a mission gives the pilot.
 *
 *  A mission is flown to a metre, not to a corner: the pickup, the corridor and
 *  the drop zone all reward a slow, placed approach, and at full rate the Guru
 *  crosses the whole drop zone in the time it takes to notice it is inside it.
 *  Softening the commands here rather than retuning the aircraft keeps free
 *  flight and Flight School exactly as they were tuned. */
const MISSION_COMMAND_SCALE = 0.55;

export function MissionViewport({ mission }: { mission: Mission }) {
  useControls();

  // The aircraft is part of the mission, not a preference.
  //
  // A mission is tuned against ONE airframe: the route's clearances, the
  // corridor widths, the height band and the eight minute limit were all
  // measured with the Guru's span and its speed. Opening a mission on the
  // racer, or on whatever was last flown in the Fly view, is a different
  // mission with the same numbers on the card.
  //
  // The pilot's own choice is put back on the way out, so visiting a mission
  // does not quietly change what the Fly view is flying afterwards.
  useEffect(() => {
    const store = useSettingsStore.getState();
    const chosen = store.settings.selectedDroneId;
    if (chosen !== MISSION_DRONE) store.set('selectedDroneId', MISSION_DRONE);

    const world = useWorldStore.getState();
    const hour = world.timeOfDay;
    if (hour !== MISSION_HOUR) world.setTimeOfDay(MISSION_HOUR);

    // Missions fly a gentler stick. Only here: put it back on the way out.
    //
    // The throttle can opt out of that softening on its own — see
    // `Mission.throttleScale`. A mission whose job is coming down onto marks
    // wants a stick that answers, and slowing the throttle axis never made a
    // descent gentler, only later.
    setCommandScale(MISSION_COMMAND_SCALE, mission.throttleScale ?? MISSION_COMMAND_SCALE);

    return () => {
      setCommandScale(1);
      if (chosen !== MISSION_DRONE) {
        useSettingsStore.getState().set('selectedDroneId', chosen);
      }
      if (hour !== MISSION_HOUR) useWorldStore.getState().setTimeOfDay(hour);
    };
    // The mission is torn down and rebuilt when it changes, so this only has to
    // re-run if the number itself does.
  }, [mission.throttleScale]);

  const graphics = useSettingsStore((s) => s.settings.graphics);
  const q = qualityFor(graphics);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <div className="viewport">
      <SceneBoundary>
        <Canvas
          shadows={q.shadows ? { type: THREE.PCFShadowMap } : false}
          dpr={q.dpr}
          gl={{
            antialias: q.msaa,
            powerPreference: 'high-performance',
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          camera={{ position: [8, 5, 9], fov: 60, near: 0.15, far: 700 }}
        >
          <FlightScene envIdOverride={mission.envId} ceilingOverride={mission.ceiling}>
            {/* The person on the roof is solid. Inside the scene because that is
                where `<Physics>` is. */}
            {mission.search && <CasualtyCollider mission={mission} />}
            {/* The rooftop delivery platforms are solid too. */}
            {mission.deliveries && <RooftopPadCollider mission={mission} />}
            {/* The shop the cargo is collected from. Solid, so it is in here
                too: the restaurant for the food box, the pharmacy for the
                medical packages of missions 1 and 3. */}
            {mission.search && <Storefront site={LOTUS_KITCHEN} kind="restaurant" />}
            {(mission.deliveries || mission.id === 'precision-delivery') && (
              <Storefront site={LAKE_CITY_PHARMACY} kind="pharmacy" />
            )}
            {/* The hydrant fill point the suppression tank waits at. */}
            {mission.fire && <HydrantFillPoint mission={mission} />}
          </FlightScene>
          <MissionMarkers mission={mission} />
          {/* The helipad the drone takes off from, under the spawn. */}
          <LaunchPad mission={mission} />
          {/* Only a suppression mission carries these, and they mount with the
              mission rather than with the leg: a fire that appeared when the
              pilot arrived would be a fire nobody could see on the way. */}
          {mission.fire && <FireZone mission={mission} />}
          {mission.fire && <Spray />}
          {/* Every mission carries something now — the search carries a food box
              to the person on the roof. */}
          <Payload mission={mission} />
          <MissionDirector />
          {/* Projects the Director's target into screen space every frame, for
              the chevron the HUD draws over it. Inside the Canvas because that
              is where the camera is. */}
          <TargetPointer />
          <SceneReady onReady={onReady} />
        </Canvas>
      </SceneBoundary>
      <MissionHud />
      {/* The map is named, not assumed. "Getting the city ready" over a forest
          was the one line in the mission view that could be plainly wrong. */}
      {!ready && (
        <SceneVeil
          label={
            mission.envId === 'new-york' ? 'Getting the city ready' : 'Getting the forest ready'
          }
        />
      )}
    </div>
  );
}
