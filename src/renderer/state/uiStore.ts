import { create } from 'zustand';

// Which dashboard section is active. Phase 0 ships the shell; most sections are
// placeholders that later phases fill in (Training, Missions, STEM).
// Studio is gone too (2026-09-29): there is no drone builder, and its item
// only opened a placeholder.
// Practice is gone: it promised free-form drills that Flight School now covers,
// and a nav entry that opens a placeholder is a dead end wearing a label.
export type Section =
  | 'home'
  | 'fly'
  | 'training'
  | 'missions'
  | 'hangar'
  | 'stem'
  | 'profile'
  | 'settings'
  | 'about';

export type CameraMode = 'fpv' | 'chase' | 'orbit';

const CAMERA_CYCLE: CameraMode[] = ['chase', 'fpv', 'orbit'];

interface UiState {
  section: Section;
  /** Where to return to when backing out of a sub-section (Esc / Back). */
  previousSection: Section;
  cameraMode: CameraMode;
  /** The HUD panel (H): widget toggles and the key list, a left column. */
  hudPanelOpen: boolean;
  /** The telemetry dock (T), a right column. Only one of the two is open. */
  panelOpen: boolean;
  setSection: (section: Section) => void;
  /** Return to whatever section we came from. */
  goBack: () => void;
  setCameraMode: (mode: CameraMode) => void;
  cycleCameraMode: () => void;
  toggleHudPanel: () => void;
  togglePanel: () => void;
  /** Close the dock and the HUD panel (leaving the flight view). */
  closePanels: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  section: 'home',
  previousSection: 'home',
  cameraMode: 'chase',
  hudPanelOpen: false,
  panelOpen: false,
  // Opening one side column closes the other: the Phase 6 cockpit has room for
  // the HUD beside one column, not between two.
  toggleHudPanel: () => set((s) => ({ hudPanelOpen: !s.hudPanelOpen, panelOpen: false })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen, hudPanelOpen: false })),
  closePanels: () => set({ panelOpen: false, hudPanelOpen: false }),
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
