import { create } from 'zustand';

// Which dashboard section is active. Phase 0 ships the shell; most sections are
// placeholders that later phases fill in (Training, Missions, Studio, STEM).
export type Section =
  | 'home'
  | 'fly'
  | 'practice'
  | 'training'
  | 'missions'
  | 'studio'
  | 'stem'
  | 'settings';

export type CameraMode = 'fpv' | 'chase' | 'orbit';

const CAMERA_CYCLE: CameraMode[] = ['chase', 'fpv', 'orbit'];

interface UiState {
  section: Section;
  /** Where to return to when backing out of a sub-section (Esc / Back). */
  previousSection: Section;
  cameraMode: CameraMode;
  /** Whether the full keyboard reference is pinned open in the flight view. */
  showControls: boolean;
  /** Telemetry dock visibility in the flight view (hidden by default). */
  panelOpen: boolean;
  setSection: (section: Section) => void;
  /** Return to whatever section we came from. */
  goBack: () => void;
  setCameraMode: (mode: CameraMode) => void;
  cycleCameraMode: () => void;
  toggleControls: () => void;
  togglePanel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  section: 'home',
  previousSection: 'home',
  cameraMode: 'chase',
  showControls: false,
  panelOpen: false,
  toggleControls: () => set((s) => ({ showControls: !s.showControls })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setSection: (section) =>
    set((s) => (s.section === section ? s : { section, previousSection: s.section })),
  goBack: () =>
    set((s) => ({ section: s.previousSection, previousSection: 'home' })),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  cycleCameraMode: () =>
    set((s) => {
      const i = CAMERA_CYCLE.indexOf(s.cameraMode);
      return { cameraMode: CAMERA_CYCLE[(i + 1) % CAMERA_CYCLE.length] };
    }),
}));
