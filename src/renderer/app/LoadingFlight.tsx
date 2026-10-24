import type { CSSProperties } from 'react';

// The loading screen's picture: the pilot already on the way in. A Pluto seen
// from behind and above, hovering over a grid floor that streams toward the
// camera, race rings flying past it, and a HUD that names what is loading now.
//
// SVG and CSS only. This screen is what loads the 3D models, so it cannot use
// them, and it has to stay light on the integrated GPUs it runs on: every
// animation is a transform or an opacity, and none of it runs under
// prefers-reduced-motion (account.css).

/** Motor centres in the drone's 200 x 200 top view, front first. */
const MOTORS: [number, number][] = [
  [46, 46],
  [154, 46],
  [46, 154],
  [154, 154],
];

function Drone() {
  return (
    <svg className="flight__drone" viewBox="0 0 200 200" aria-hidden="true">
      {MOTORS.map(([x, y]) => (
        <line key={`arm${x}${y}`} className="flight__arm" x1={100} y1={100} x2={x} y2={y} />
      ))}
      <rect className="flight__body" x={74} y={66} width={52} height={68} rx={16} />
      <rect className="flight__canopy" x={84} y={74} width={32} height={30} rx={10} />
      <circle className="flight__led flight__led--front" cx={100} cy={70} r={3} />
      <circle className="flight__led flight__led--rear" cx={100} cy={130} r={3} />
      {MOTORS.map(([x, y], i) => (
        <g key={`m${x}${y}`}>
          <circle className="flight__disc" cx={x} cy={y} r={34} />
          <circle className="flight__motor" cx={x} cy={y} r={9} />
          {/* Diagonal pairs turn opposite ways, as on the real airframe. */}
          <g className={`flight__prop ${i === 0 || i === 3 ? 'is-cw' : 'is-ccw'}`}>
            <rect x={x - 32} y={y - 3} width={64} height={6} rx={3} />
          </g>
        </g>
      ))}
    </svg>
  );
}

export function LoadingFlight({ pct, now }: { pct: number; now: string }) {
  const ready = pct >= 100;
  return (
    <div className="flight" aria-hidden="true">
      <div className="flight__sky" />
      <div className="flight__floor">
        <div className="flight__grid" />
      </div>

      {[0, 1, 2].map((i) => (
        <span key={i} className="flight__ring" style={{ '--i': i } as CSSProperties} />
      ))}

      <div className="flight__craft">
        <span className="flight__shadow" />
        <Drone />
      </div>

      <span className="flight__corner is-tl" />
      <span className="flight__corner is-tr" />
      <span className="flight__corner is-bl" />
      <span className="flight__corner is-br" />

      <div className="flight__link">
        <span className={`flight__dot ${ready ? 'is-ready' : ''}`} />
        {ready ? 'Sim link ready' : 'Sim link'}
      </div>

      <div className="flight__caption">
        <b>{ready ? 'Ready for take-off' : 'Entering the simulator'}</b>
        <span>{ready ? 'Everything is in place' : now}</span>
      </div>
    </div>
  );
}
