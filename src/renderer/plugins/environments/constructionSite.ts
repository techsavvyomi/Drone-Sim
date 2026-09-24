import type { EnvironmentSpec } from '@shared/types';

// Construction Site — a seven-storey concrete frame, topped out but unclad.
//
// Authored from primitives rather than a .glb export, and textured from the
// scanned PBR set in src/assets/textures/site. That is why there is no `model`
// here: ConstructionSiteEnv builds the whole thing, and the only asset it loads
// is site_props.opt.glb for the scanned debris.
//
// The frame is the map. Bays are 6 m clear and storeys 3.6 m, which is a
// comfortable margin for a 25 cm airframe and a tight one at speed — flying a
// level THROUGH the building is the skill this map asks for. The lift core is
// the one solid volume inside it, with a 2.2 m doorway on its east face at
// every level.
export const constructionSite: EnvironmentSpec = {
  id: 'construction-site',
  name: 'Construction Site',
  kind: 'outdoor',
  /**
   * On the hardstanding south of the frame, far enough out that the whole
   * building is in shot on spawn and the first move can be a straight climb.
   * Heading 0 looks down −Z, which is into the frame.
   */
  spawn: { position: [0, 0.25, 40], heading: 0 },
  /**
   * The hoarding is at ±58; containment hard-clamps at `bounds ± 0.1`, so the
   * limit is set just outside it and the collider wall is what you actually
   * meet.
   *
   * The ceiling is 60 m: the crane tops out at 42 m and the roof slab at 25.2,
   * so there is real air above both to climb into and look down from.
   */
  bounds: { min: [-58.1, -1, -58.1], max: [58.1, 60, 58.1] },
  /**
   * The site is one flat poured surface, so the flat-plane under-floor rescue
   * applies here (unlike the Forest, which omits this because its ground is
   * real terrain at many heights).
   */
  groundY: 0,
};
