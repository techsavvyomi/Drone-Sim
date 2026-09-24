import { useFlightStore } from '../state/flightStore';
import { useUiStore } from '../state/uiStore';

// The pause card. P (anywhere the flight controls are mounted) and Esc (Free
// Flight) open it, and the same keys close it. Physics is halted underneath, so
// the drone hangs exactly where you left it rather than falling out of the sky.
//
// `menu` is Free Flight's: Settings and Main Menu are safe there because there
// is nothing to leave. A mission or a lesson has an attempt under way, and
// leaving it is `exit` / `exitLesson`'s job — so those views get the card
// without the menu, and the Exit button they already carry does the leaving.
export function PauseOverlay({ menu = true }: { menu?: boolean }) {
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
        {menu && (
          <>
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
          </>
        )}
        <span className="pause-hint">
          Press <kbd>P</kbd>
          {menu && (
            <>
              {' '}
              or <kbd>Esc</kbd>
            </>
          )}{' '}
          to resume
        </span>
      </div>
    </div>
  );
}
