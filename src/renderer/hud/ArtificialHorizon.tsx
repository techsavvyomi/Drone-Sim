import { RAD2DEG } from '../sim/mathx';

// Compact attitude indicator. The horizon plate rolls opposite to bank and
// slides with pitch; the aircraft reference (center) stays fixed.
const R = 92;
const PX_PER_DEG = 2.4;

export function ArtificialHorizon({ roll, pitch }: { roll: number; pitch: number }) {
  const rollDeg = roll * RAD2DEG;
  const pitchDeg = pitch * RAD2DEG;

  // Pitch ladder lines every 10°.
  const ladder = [-30, -20, -10, 10, 20, 30];

  return (
    <svg viewBox="0 0 200 200" width="150" height="150" className="adi">
      <defs>
        <clipPath id="adiClip">
          <circle cx="100" cy="100" r={R} />
        </clipPath>
      </defs>

      <circle cx="100" cy="100" r={R} fill="#0d1420" stroke="#223049" strokeWidth="3" />

      <g clipPath="url(#adiClip)">
        {/* Horizon plate: roll then pitch */}
        <g transform={`rotate(${-rollDeg} 100 100) translate(0 ${pitchDeg * PX_PER_DEG})`}>
          <rect x="-100" y="-200" width="400" height="300" fill="#2c6b9e" />
          <rect x="-100" y="100" width="400" height="300" fill="#5a4632" />
          <line x1="-100" y1="100" x2="300" y2="100" stroke="#e6edf7" strokeWidth="2" />
          {ladder.map((d) => (
            <g key={d}>
              <line
                x1={70}
                y1={100 - d * PX_PER_DEG}
                x2={130}
                y2={100 - d * PX_PER_DEG}
                stroke="#cdd8ea"
                strokeWidth="1.2"
              />
              <text
                x={62}
                y={100 - d * PX_PER_DEG + 3}
                fill="#cdd8ea"
                fontSize="8"
                textAnchor="end"
              >
                {Math.abs(d)}
              </text>
            </g>
          ))}
        </g>
      </g>

      {/* Fixed aircraft reference */}
      <g stroke="#ffcf4d" strokeWidth="3" fill="none">
        <line x1="70" y1="100" x2="88" y2="100" />
        <line x1="112" y1="100" x2="130" y2="100" />
        <circle cx="100" cy="100" r="2.5" fill="#ffcf4d" stroke="none" />
      </g>

      {/* Roll pointer */}
      <g transform={`rotate(${-rollDeg} 100 100)`}>
        <polygon points="100,12 95,22 105,22" fill="#ffcf4d" />
      </g>
      <circle cx="100" cy="100" r={R} fill="none" stroke="#223049" strokeWidth="3" />
    </svg>
  );
}
