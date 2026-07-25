import { RAD2DEG } from '../sim/mathx';

// Sliding compass ribbon showing the current heading with cardinal points.
// Heading comes from the IMU-derived attitude, not GPS — the simulator has no
// GPS model, so there is no home bearing marker.
const WIDTH = 220;
const PX_PER_DEG = 2;

function normalize(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function Compass({ yaw }: { yaw: number }) {
  const heading = normalize(-yaw * RAD2DEG);

  // Ticks every 15° across the visible span.
  const span = WIDTH / PX_PER_DEG;
  const start = Math.floor((heading - span / 2) / 15) * 15;
  const ticks: { deg: number; x: number }[] = [];
  for (let d = start; d <= heading + span / 2; d += 15) {
    const delta = d - heading;
    ticks.push({ deg: normalize(d), x: WIDTH / 2 + delta * PX_PER_DEG });
  }

  const label = (deg: number) => {
    if (deg === 0) return 'N';
    if (deg === 90) return 'E';
    if (deg === 180) return 'S';
    if (deg === 270) return 'W';
    return deg % 45 === 0 ? String(deg) : null;
  };

  return (
    <svg viewBox={`0 0 ${WIDTH} 34`} width={WIDTH} height={34} className="compass">
      <rect
        x="0"
        y="0"
        width={WIDTH}
        height="34"
        rx="6"
        fill="rgba(11,15,23,0.62)"
        stroke="#223049"
      />
      {ticks.map((t, i) => {
        const l = label(t.deg);
        return (
          <g key={i}>
            <line
              x1={t.x}
              y1={l ? 6 : 10}
              x2={t.x}
              y2={16}
              stroke={l ? '#e6edf7' : '#5d6b82'}
              strokeWidth={l ? 1.4 : 1}
            />
            {l && (
              <text x={t.x} y={28} fill="#cdd8ea" fontSize="10" textAnchor="middle">
                {l}
              </text>
            )}
          </g>
        );
      })}
      <polygon points={`${WIDTH / 2},4 ${WIDTH / 2 - 5},-3 ${WIDTH / 2 + 5},-3`} fill="#ffcf4d" />
      <line x1={WIDTH / 2} y1="2" x2={WIDTH / 2} y2="18" stroke="#ffcf4d" strokeWidth="1.6" />
    </svg>
  );
}
