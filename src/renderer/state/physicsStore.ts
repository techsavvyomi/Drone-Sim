import { create } from 'zustand';
import { CALM_WIND, type WindSettings } from '../sim/dynamics/environment';

// Live-tunable physics parameters. Changes take effect on the next physics step
// — no restart — which is the "changes immediately affect flight" requirement.
interface PhysicsState {
  wind: WindSettings;
  groundEffectEnabled: boolean;
  batteryEnabled: boolean;
  /** Gentle outdoor air movement, so a hover is never perfectly still. */
  ambientDriftEnabled: boolean;
  setWind: <K extends keyof WindSettings>(key: K, value: WindSettings[K]) => void;
  setGroundEffect: (on: boolean) => void;
  setBattery: (on: boolean) => void;
  setAmbientDrift: (on: boolean) => void;
}

export const usePhysicsStore = create<PhysicsState>((set) => ({
  wind: { ...CALM_WIND },
  groundEffectEnabled: true,
  batteryEnabled: true,
  ambientDriftEnabled: true,
  setWind: (key, value) => set((s) => ({ wind: { ...s.wind, [key]: value } })),
  setGroundEffect: (groundEffectEnabled) => set({ groundEffectEnabled }),
  setBattery: (batteryEnabled) => set({ batteryEnabled }),
  setAmbientDrift: (ambientDriftEnabled) => set({ ambientDriftEnabled }),
}));
