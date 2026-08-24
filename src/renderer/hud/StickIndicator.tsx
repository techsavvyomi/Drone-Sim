import { useSimStore } from '../state/simStore';

// Mode-2 transmitter sticks, drawn live as large corner gimbals.
//   Left  stick: throttle (vertical) + yaw (horizontal)
//   Right stick: pitch (vertical) + roll (horizontal)
// Seeing your own inputs is the fastest way to understand why the drone did
// what it did — more useful while learning than any static key list.
//
// A lesson can also ASK for a direction (`cue`): that chevron then breathes, so
// "move the right stick forward" is something the pilot sees on the stick rather
// than reads in a sentence. The mapping is the keyboard's, because the keycap
// row under the sticks names the same controls.

const R = 100; // viewBox radius
const TRAVEL = 58; // how far the knob moves from centre

type Dir = 'up' | 'down' | 'left' | 'right';

/** Which chevron a cued key belongs to, per stick. */
const CUE_MAP: Record<string, { side: 'left' | 'right'; dir: Dir }> = {
  KeyW: { side: 'left', dir: 'up' },
  KeyS: { side: 'left', dir: 'down' },
  KeyA: { side: 'left', dir: 'left' },
  KeyD: { side: 'left', dir: 'right' },
  ArrowUp: { side: 'right', dir: 'up' },
  ArrowDown: { side: 'right', dir: 'down' },
  ArrowLeft: { side: 'right', dir: 'left' },
  ArrowRight: { side: 'right', dir: 'right' },
};

function Stick({
  x,
  y,
  side,
  cued,
}: {
  x: number;
  y: number;
  side: 'left' | 'right';
  cued: ReadonlySet<Dir>;
}) {
  const cx = R + x * TRAVEL;
  const cy = R - y * TRAVEL;
  const cls = (dir: Dir) => (cued.has(dir) ? 'vstick-cue' : undefined);

  return (
    <div className={`vstick vstick-${side}`}>
      <svg viewBox={`0 0 ${R * 2} ${R * 2}`} width="150" height="150">
        <circle cx={R} cy={R} r="94" className="vstick-base" />
        <circle cx={R} cy={R} r="66" className="vstick-inner" />

        {/* Direction chevrons — the cued one breathes. */}
        <g className="vstick-arrow">
          <path className={cls('up')} d={`M${R - 9} 34 L${R} 25 L${R + 9} 34`} />
          <path
            className={cls('down')}
            d={`M${R - 9} ${R * 2 - 34} L${R} ${R * 2 - 25} L${R + 9} ${R * 2 - 34}`}
          />
          <path className={cls('left')} d={`M34 ${R - 9} L25 ${R} L34 ${R + 9}`} />
          <path
            className={cls('right')}
            d={`M${R * 2 - 34} ${R - 9} L${R * 2 - 25} ${R} L${R * 2 - 34} ${R + 9}`}
          />
        </g>

        {/* Travel line + knob */}
        <line x1={R} y1={R} x2={cx} y2={cy} className="vstick-stem" />
        <circle cx={cx} cy={cy} r="21" className="vstick-knob" />
      </svg>
    </div>
  );
}

export function StickIndicator({ cue = [] }: { cue?: readonly string[] }) {
  const sticks = useSimStore((s) => s.sticks);

  const left = new Set<Dir>();
  const right = new Set<Dir>();
  for (const code of cue) {
    const m = CUE_MAP[code];
    if (m) (m.side === 'left' ? left : right).add(m.dir);
  }

  return (
    <>
      {/* Throttle is 0..1; remapped to full travel so centre = mid-throttle. */}
      <Stick side="left" x={sticks.yaw} y={sticks.throttle * 2 - 1} cued={left} />
      <Stick side="right" x={sticks.roll} y={sticks.pitch} cued={right} />
    </>
  );
}
