import { useFlightStore } from '../state/flightStore';

// Shown after a major impact. Controls stay locked until the drone is reset.
export function CrashOverlay() {
  const crashed = useFlightStore((s) => s.crashed);
  const speed = useFlightStore((s) => s.crashSpeed);

  if (!crashed) return null;

  return (
    <div className="crash-overlay">
      <div className="crash-card">
        <h2>Crashed</h2>
        <p>Impact at {speed.toFixed(1)} m/s</p>
        <span className="crash-hint">
          Press <kbd>R</kbd> to reset
        </span>
      </div>
    </div>
  );
}
