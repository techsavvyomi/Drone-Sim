import { useUiStore } from '../state/uiStore';

// Full keyboard reference, toggled with H. Kept out of the way by default so it
// doesn't compete with the flight instruments.

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Flight',
    rows: [
      ['W / S', 'Throttle up / down'],
      ['A / D', 'Yaw left / right'],
      ['↑ / ↓', 'Pitch forward / back'],
      ['← / →', 'Roll left / right'],
    ],
  },
  {
    title: 'Aircraft',
    rows: [
      ['Enter', 'Arm / Disarm'],
      ['S then W', 'After arming: throttle down, then up'],
      ['Space', 'Auto take-off / land'],
      ['M', 'Cycle flight mode'],
      ['R', 'Reset to spawn'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['C', 'Cycle camera'],
      ['H', 'Hide this panel'],
    ],
  },
];

export function ControlsPanel() {
  const open = useUiStore((s) => s.showControls);
  const toggle = useUiStore((s) => s.toggleControls);

  if (!open) {
    return (
      <button className="controls-fab" onClick={toggle} title="Show controls (H)">
        <b>H</b> Controls
      </button>
    );
  }

  return (
    <div className="controls-panel">
      <div className="controls-head">
        <span>Controls</span>
        <button onClick={toggle} title="Hide (H)">
          ✕
        </button>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h4>{g.title}</h4>
          {g.rows.map(([k, d]) => (
            <div className="controls-row" key={k}>
              <kbd>{k}</kbd>
              <span>{d}</span>
            </div>
          ))}
        </section>
      ))}
      <p className="controls-note">Mode 2 layout, same stick assignment as a real transmitter.</p>
    </div>
  );
}
