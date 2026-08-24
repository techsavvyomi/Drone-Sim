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
const SIZE = 210; // drawn size in px — the gimbals are a primary readout, not decoration

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
  // Two gimbals are on screen at once, so every gradient needs its own id.
  const dish = `vstick-dish-${side}`;
  const knob = `vstick-knob-${side}`;

  return (
    <div className={`vstick vstick-${side}`}>
      <svg viewBox={`0 0 ${R * 2} ${R * 2}`} width={SIZE} height={SIZE}>
        <defs>
          {/* Lit from above, like a real gimbal dish: the rim catches light, the
              well below the knob falls away. */}
          <radialGradient id={dish} cx="50%" cy="34%" r="72%">
            <stop offset="0%" stopColor="rgba(30, 45, 70, 0.82)" />
            <stop offset="62%" stopColor="rgba(11, 17, 28, 0.86)" />
            <stop offset="100%" stopColor="rgba(4, 7, 13, 0.92)" />
          </radialGradient>
          <radialGradient id={knob} cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#cfe6fb" />
            <stop offset="100%" stopColor="#6f9dc4" />
          </radialGradient>
        </defs>

        <circle cx={R} cy={R} r="96" className="vstick-rim" />
        <circle cx={R} cy={R} r="90" className="vstick-base" fill={`url(#${dish})`} />
        <circle cx={R} cy={R} r="62" className="vstick-inner" />

        {/* Centre crosshair — where the stick rests, so "off centre" is visible
            at a glance even when the knob is only a little off. */}
        <g className="vstick-cross">
          <path d={`M${R - 12} ${R} L${R + 12} ${R}`} />
          <path d={`M${R} ${R - 12} L${R} ${R + 12}`} />
        </g>

        {/* Direction chevrons — the cued one breathes. */}
        <g className="vstick-arrow">
          <path className={cls('up')} d={`M${R - 11} 38 L${R} 27 L${R + 11} 38`} />
          <path
            className={cls('down')}
            d={`M${R - 11} ${R * 2 - 38} L${R} ${R * 2 - 27} L${R + 11} ${R * 2 - 38}`}
          />
          <path className={cls('left')} d={`M38 ${R - 11} L27 ${R} L38 ${R + 11}`} />
          <path
            className={cls('right')}
            d={`M${R * 2 - 38} ${R - 11} L${R * 2 - 27} ${R} L${R * 2 - 38} ${R + 11}`}
          />
        </g>

        {/* Travel line + knob */}
        <line x1={R} y1={R} x2={cx} y2={cy} className="vstick-stem" />
        <circle cx={cx} cy={cy} r="25" className="vstick-knob" fill={`url(#${knob})`} />
        <circle cx={cx} cy={cy} r="25" className="vstick-knob-ring" />
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
