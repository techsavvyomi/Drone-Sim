import { clamp } from '../sim/mathx';

// Scrolling altitude tape, as on a real flight HUD: the scale slides past a
// fixed centre pointer. Also shows the airframe's ceiling as a red band and a
// climb/descent trend arrow driven by vertical speed.

const W = 62;
const H = 168;
const PX_PER_M = 7; // vertical pixels per metre

export function AltitudeTape({
  altitude,
  verticalSpeed,
  ceiling,
}: {
  altitude: number;
  verticalSpeed: number;
  ceiling: number;
}) {
  const midY = H / 2;
  const spanM = H / PX_PER_M;
  const low = altitude - spanM / 2;
  const high = altitude + spanM / 2;

  const yFor = (m: number) => midY - (m - altitude) * PX_PER_M;

  // Ticks every 1 m, labelled every 5 m.
  const ticks: { m: number; y: number; major: boolean }[] = [];
  for (let m = Math.floor(low); m <= Math.ceil(high); m += 1) {
    if (m < 0) continue;
    ticks.push({ m, y: yFor(m), major: m % 5 === 0 });
  }

  // Ceiling band: everything above the limit is out of bounds.
  const ceilingY = yFor(ceiling);
  const nearCeiling = altitude >= ceiling - 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="alt-tape">
      <rect x="0" y="0" width={W} height={H} rx="6" fill="rgba(11,15,23,0.62)" stroke="#223049" />

      {/* Out-of-bounds region above the ceiling */}
      {ceilingY > 0 && (
        <>
          <rect
            x="1"
            y={Math.max(ceilingY, 1)}
            width={W - 2}
            height={0}
            fill="transparent"
          />
          <rect
            x="1"
            y="1"
            width={W - 2}
            height={clamp(ceilingY - 1, 0, H - 2)}
            fill="rgba(180,60,60,0.16)"
          />
          <line x1="1" y1={ceilingY} x2={W - 1} y2={ceilingY} stroke="#ff5c5c" strokeWidth="1.5" />
          <text x={W - 4} y={ceilingY - 3} fill="#ff8a8a" fontSize="8" textAnchor="end">
            MAX {ceiling}m
          </text>
        </>
      )}

      {/* Ground line */}
      {(() => {
        const gy = yFor(0);
        return gy > 0 && gy < H ? (
          <line x1="1" y1={gy} x2={W - 1} y2={gy} stroke="#8d99ab" strokeWidth="1.5" />
        ) : null;
      })()}

      {ticks.map((t) =>
        t.y < 2 || t.y > H - 2 ? null : (
          <g key={t.m}>
            <line
              x1={t.major ? 4 : 9}
              y1={t.y}
              x2={16}
              y2={t.y}
              stroke={t.major ? '#cdd8ea' : '#5d6b82'}
              strokeWidth={t.major ? 1.3 : 1}
            />
            {t.major && (
              <text x={19} y={t.y + 3} fill="#cdd8ea" fontSize="8.5">
                {t.m}
              </text>
            )}
          </g>
        ),
      )}

      {/* Fixed centre pointer with the live readout */}
      <polygon
        points={`0,${midY} 7,${midY - 8} ${W},${midY - 8} ${W},${midY + 8} 7,${midY + 8}`}
        fill="rgba(11,15,23,0.92)"
        stroke={nearCeiling ? '#ff5c5c' : '#ffcf4d'}
        strokeWidth="1.4"
      />
      <text x={W - 5} y={midY + 4} fill="#ffffff" fontSize="12.5" textAnchor="end" fontWeight="600">
        {altitude.toFixed(1)}
      </text>

      {/* Vertical-speed trend arrow */}
      {Math.abs(verticalSpeed) > 0.15 && (
        <text
          x={W / 2}
          y={verticalSpeed > 0 ? midY - 14 : midY + 22}
          fill={verticalSpeed > 0 ? '#37e08a' : '#ffcf4d'}
          fontSize="11"
          textAnchor="middle"
        >
          {verticalSpeed > 0 ? '▲' : '▼'} {Math.abs(verticalSpeed).toFixed(1)}
        </text>
      )}

      <text x={4} y={11} fill="#8291a8" fontSize="8" letterSpacing="0.08em">
        ALT m
      </text>
    </svg>
  );
}
