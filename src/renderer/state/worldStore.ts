import { create } from 'zustand';

// Time of day drives the sky, sun position, light colour/intensity and fog.
// Kept separate from physics settings because it's purely presentation.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'dusk' | 'sunset' | 'night';

export interface TimePreset {
  label: string;
  /** Sun direction (normalised-ish); also used for the directional light. */
  sun: [number, number, number];
  sunIntensity: number;
  sunColor: string;
  ambient: number;
  skyTurbidity: number;
  skyRayleigh: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /**
   * Night: the deepest preset. Shows stars, drops the outdoor hemisphere fill
   * from 0.7 to 0.25, darkens the background behind the sky and turns the city's
   * lamp and window props on.
   *
   * It is a bundle of five things, which is why `dusk` needed `stars` below
   * rather than simply setting this: a preset that wanted the star field but not
   * the 0.25 hemisphere had no way to ask.
   */
  night: boolean;
  /**
   * Draw the star field, independently of `night`.
   *
   * Only `dusk` sets it. The sky at nightfall genuinely has stars in it while
   * there is still light on the ground, and Mission 5 is sold on that moment —
   * but borrowing `night` to get them would have brought the whole of its
   * darkness with it, which is the thing dusk exists to avoid. Unset means "the
   * same as `night`", which is what every other preset means.
   */
  stars?: boolean;
  /**
   * Bloom, per preset rather than per `night` flag.
   *
   * It used to be a binary `night ? 0.55 : 0.95` threshold, which treated a
   * hazy sunset and a clear midday the same. Afternoon is by far the brightest
   * preset — sunIntensity 3.2 and ambient 1.1, against morning's 2.4 / 0.9 —
   * so ordinary lit surfaces cleared the 0.95 threshold and the whole frame
   * bloomed, not just the emissive things bloom exists for.
   */
  bloomThreshold: number;
  bloomIntensity: number;
  /**
   * Multiplier on image-based lighting, which is what drives specular sheen.
   * Turning it down takes the gloss off roads and glass without touching
   * exposure the way sunIntensity or ambient would.
   */
  iblScale: number;
}

export const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  morning: {
    label: 'Morning',
    sun: [40, 22, 60],
    sunIntensity: 2.4,
    sunColor: '#ffe9c8',
    ambient: 0.9,
    skyTurbidity: 4,
    skyRayleigh: 1.4,
    fogColor: '#bcd5ea',
    fogNear: 70,
    fogFar: 460,
    night: false,
    bloomThreshold: 1.1,
    bloomIntensity: 0.22,
    iblScale: 1,
  },
  afternoon: {
    label: 'Afternoon',
    sun: [50, 70, 30],
    sunIntensity: 3.2,
    sunColor: '#ffffff',
    ambient: 1.1,
    skyTurbidity: 2.6,
    skyRayleigh: 0.9,
    fogColor: '#b2d2ee',
    fogNear: 100,
    fogFar: 560,
    night: false,
    bloomThreshold: 1.2,
    bloomIntensity: 0.15,
    iblScale: 0.7,
  },
  /**
   * Evening: the blue half hour, after the colour has gone out of the sunset
   * and before the stars.
   *
   * Not a dimmed afternoon and not a blue sunset. The sun is BELOW the horizon
   * (negative y), so nothing is lit directly and what remains is skylight —
   * which is why the ambient carries the scene while `sunIntensity` is almost
   * nothing, and why the sun colour is a cold blue rather than a warm one.
   * `night` stays false: the stars are not out, the floodlights do not come on,
   * and the city is still perfectly flyable.
   */
  evening: {
    label: 'Evening',
    sun: [30, -4, -45],
    sunIntensity: 0.5,
    sunColor: '#8fa8d8',
    ambient: 0.55,
    // High rayleigh with the sun under the horizon is what makes the whole dome
    // deep blue rather than a bright sky with the lights turned down.
    skyTurbidity: 6,
    skyRayleigh: 3.2,
    fogColor: '#2f4a72',
    fogNear: 50,
    fogFar: 420,
    night: false,
    bloomThreshold: 0.9,
    bloomIntensity: 0.34,
    iblScale: 0.9,
  },
  /**
   * Dusk: nightfall, and the light Mission 5 is flown in.
   *
   * It exists because neither neighbour worked. `night` (ambient 0.22, hemisphere
   * 0.25) is a black screen with a torch in it — the forest floor, the trunks and
   * the animal are all invisible outside the light pool, and a search you cannot
   * see to fly is not a search. `evening` (ambient 0.55, hemisphere 0.7) is the
   * opposite failure: there is enough skylight left in the clearing to fly the
   * whole mission with the spotlight switched OFF, which makes the mission's one
   * instrument decoration.
   *
   * So the numbers sit between them, and they are not a simple average — the two
   * that matter are pulled in opposite directions:
   *
   *   ambient 0.38   Low enough that the light pool is plainly brighter than
   *                  what is around it; high enough to read a trunk you are
   *                  about to fly into.
   *   night: false   Which keeps the outdoor hemisphere at 0.7 rather than 0.25.
   *                  This is where most of the recovered visibility comes from,
   *                  and it is why the preset is not simply `night` with the
   *                  ambient turned up: hemisphere light comes from the sky and
   *                  the ground rather than from a direction, so it lifts the
   *                  shadowed sides of things — exactly what a canopy makes.
   *   stars: true    The sky still reads as nightfall. See the field.
   *
   * The sun is BELOW the horizon, as evening's is, so nothing is lit directly
   * and what remains is skylight. The fog is a deep blue-violet, darker and
   * warmer than evening's slate: the fog colour is also the background behind
   * the sky dome, so it is most of what "how dark is it" looks like from inside
   * the aircraft.
   *
   * Bloom is up, because the spotlight and the tiger's eyeshine are the two
   * emissive things in the frame and this is the preset where they carry the
   * mission.
   */
  dusk: {
    label: 'Dusk',
    sun: [26, -6, -48],
    sunIntensity: 0.3,
    sunColor: '#7e93c4',
    ambient: 0.38,
    skyTurbidity: 8,
    skyRayleigh: 2.4,
    fogColor: '#1b2742',
    fogNear: 40,
    fogFar: 340,
    night: false,
    stars: true,
    bloomThreshold: 0.8,
    bloomIntensity: 0.44,
    iblScale: 0.85,
  },
  sunset: {
    label: 'Sunset',
    sun: [80, 8, 18],
    sunIntensity: 2.2,
    sunColor: '#ffb070',
    ambient: 0.7,
    skyTurbidity: 8,
    skyRayleigh: 3,
    fogColor: '#e0a882',
    fogNear: 55,
    fogFar: 400,
    night: false,
    bloomThreshold: 1.05,
    bloomIntensity: 0.24,
    iblScale: 1,
  },
  night: {
    label: 'Night',
    sun: [-30, -8, -40],
    sunIntensity: 0.12,
    sunColor: '#8ea8d8',
    ambient: 0.22,
    skyTurbidity: 12,
    skyRayleigh: 0.6,
    fogColor: '#080d16',
    fogNear: 30,
    fogFar: 240,
    night: true,
    bloomThreshold: 0.7,
    bloomIntensity: 0.55,
    iblScale: 1,
  },
};

interface WorldState {
  timeOfDay: TimeOfDay;
  /** Slow cloud drift; purely visual. */
  cloudsEnabled: boolean;
  setTimeOfDay: (t: TimeOfDay) => void;
  setClouds: (on: boolean) => void;
}

export const useWorldStore = create<WorldState>((set) => ({
  timeOfDay: 'afternoon',
  cloudsEnabled: true,
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  setClouds: (cloudsEnabled) => set({ cloudsEnabled }),
}));
