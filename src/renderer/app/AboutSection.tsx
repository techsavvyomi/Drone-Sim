import { useUiStore } from '../state/uiStore';

// About. Intentionally empty for now: the content is still to be written.

/** The About page reached from the sidebar. */
export function AboutScreen() {
  return (
    <div className="section-body settings-shell">
      <button className="back-btn" onClick={() => useUiStore.getState().goBack()}>
        ‹ Back
      </button>
      <h1 className="section-title">About</h1>
      <div className="settings-pane">
        <AboutSection />
      </div>
    </div>
  );
}

/** The About content, shared by the About page and Settings → About. */
export function AboutSection() {
  return null;
}
