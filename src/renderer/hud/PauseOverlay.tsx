import { useFlightStore } from '../state/flightStore';
import { useUiStore } from '../state/uiStore';

// Pause menu, opened with Esc while flying. Physics is halted underneath, so
// the drone hangs exactly where you left it rather than falling out of the sky.
export function PauseOverlay() {
  const paused = useFlightStore((s) => s.paused);
  const togglePause = useFlightStore((s) => s.togglePause);
  const setSection = useUiStore((s) => s.setSection);

  if (!paused) return null;

  return (
    <div className="pause-overlay">
      <div className="pause-card">
        <h2>Paused</h2>
        <button className="pause-btn primary" onClick={togglePause}>
          Resume
        </button>
        <button
          className="pause-btn"
          onClick={() => {
            togglePause();
            setSection('settings');
          }}
        >
          Settings
        </button>
        <button
          className="pause-btn"
          onClick={() => {
            togglePause();
            setSection('home');
          }}
        >
          Main Menu
        </button>
        <span className="pause-hint">
          Press <kbd>Esc</kbd> to resume
        </span>
      </div>
    </div>
  );
}
