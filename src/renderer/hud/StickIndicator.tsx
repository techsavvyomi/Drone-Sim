import { useSimStore } from '../state/simStore';

// Mode-2 transmitter sticks, drawn live as large corner gimbals.
//   Left  stick: throttle (vertical) + yaw (horizontal)
//   Right stick: pitch (vertical) + roll (horizontal)
// Seeing your own inputs is the fastest way to understand why the drone did
// what it did — more useful while learning than any static key list.

const R = 100; // viewBox radius
const TRAVEL = 58; // how far the knob moves from centre

function Stick({ x, y, side }: { x: number; y: number; side: 'left' | 'right' }) {
  const cx = R + x * TRAVEL;
  const cy = R - y * TRAVEL;

  return (
    <div className={`vstick vstick-${side}`}>
      <svg viewBox={`0 0 ${R * 2} ${R * 2}`} width="150" height="150">
        <circle cx={R} cy={R} r="94" className="vstick-base" />
        <circle cx={R} cy={R} r="66" className="vstick-inner" />

        {/* Direction chevrons */}
        <g className="vstick-arrow">
          <path d={`M${R - 9} 34 L${R} 25 L${R + 9} 34`} />
          <path d={`M${R - 9} ${R * 2 - 34} L${R} ${R * 2 - 25} L${R + 9} ${R * 2 - 34}`} />
          <path d={`M34 ${R - 9} L25 ${R} L34 ${R + 9}`} />
          <path d={`M${R * 2 - 34} ${R - 9} L${R * 2 - 25} ${R} L${R * 2 - 34} ${R + 9}`} />
        </g>

        {/* Travel line + knob */}
        <line x1={R} y1={R} x2={cx} y2={cy} className="vstick-stem" />
        <circle cx={cx} cy={cy} r="21" className="vstick-knob" />
      </svg>
    </div>
  );
}

export function StickIndicator() {
  const sticks = useSimStore((s) => s.sticks);

  return (
    <>
      {/* Throttle is 0..1; remapped to full travel so centre = mid-throttle. */}
      <Stick side="left" x={sticks.yaw} y={sticks.throttle * 2 - 1} />
      <Stick side="right" x={sticks.roll} y={sticks.pitch} />
    </>
  );
}
