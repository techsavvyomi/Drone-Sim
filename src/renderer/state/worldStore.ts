import { create } from 'zustand';

// Time of day drives the sky, sun position, light colour/intensity and fog.
// Kept separate from physics settings because it's purely presentation.

export type TimeOfDay = 'morning' | 'afternoon' | 'sunset' | 'night';

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
  /** Night shows stars and lights the pad with floodlights instead. */
  night: boolean;
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
    fogColor: '#cfe0ee',
    fogNear: 70,
    fogFar: 460,
    night: false,
  },
  afternoon: {
    label: 'Afternoon',
    sun: [50, 70, 30],
    sunIntensity: 3.2,
    sunColor: '#ffffff',
    ambient: 1.1,
    skyTurbidity: 2.6,
    skyRayleigh: 0.9,
    fogColor: '#dceaf5',
    fogNear: 100,
    fogFar: 560,
    night: false,
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
