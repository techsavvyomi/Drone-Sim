import type { ReactElement } from 'react';
import type { MissionArt as ArtKey } from '../missions/types';

// ----------------------------------------------------------------------------
// The briefing card's pictures.
//
// DRAWN, not photographed, and that is a constraint rather than a preference:
// this app ships no image assets at all — `src/assets` is drone and map models
// and nothing else — and a strict CSP means nothing can be fetched from
// anywhere either. A briefing card that wanted five screenshots would need five
// files nobody has.
//
// Drawn also stays TRUE. A screenshot of the drop zone is wrong the moment the
// drop zone moves, and silently: nothing in a diff or a typecheck notices that
// the picture on the card is of a mission that no longer exists. These say what
// each beat IS — a package on a lit mark, a drone threading towers, a tank open
// over a fire — which is what the pilot needs from a thumbnail and what does not
// go stale.
//
// Every one of them is inline SVG using the app's own palette, so they cost one
// element each and follow the theme.
// ----------------------------------------------------------------------------

/** One drawn scene, sized to fill whatever box it is put in. */
export function StepArt({ art }: { art: ArtKey }) {
  return (
    <svg
      className="ms-art"
      viewBox="0 0 120 76"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sky-${art}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#101c30" />
          <stop offset="100%" stopColor="#0a1120" />
        </linearGradient>
        <radialGradient id={`glow-${art}`} cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="76" fill={`url(#sky-${art})`} />
      {SCENES[art]()}
    </svg>
  );
}

/** A small quadcopter, seen from the front. Four arms, four discs, a body. */
function Drone({ x, y, s = 1, cargo }: { x: number; y: number; s?: number; cargo?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <line x1="-9" y1="-3" x2="9" y2="-3" stroke="#93a7c4" strokeWidth="1.2" />
      {[-9, 9].map((px) => (
        <ellipse key={px} cx={px} cy="-4" rx="5" ry="1.2" fill="#93a7c4" opacity="0.75" />
      ))}
      <rect x="-4.5" y="-3.5" width="9" height="4.5" rx="1.6" fill="#dbe6f5" />
      {cargo && <rect x="-2.6" y="1" width="5.2" height="4" rx="0.8" fill={cargo} />}
    </g>
  );
}

/** A lit mark on the deck: an ellipse ring with a soft bloom inside it. */
function Mark({ x, y, color, w = 26 }: { x: number; y: number; color: string; w?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w} ry={w * 0.3} fill={color} opacity="0.14" />
      <ellipse
        cx={x}
        cy={y}
        rx={w}
        ry={w * 0.3}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        opacity="0.95"
      />
    </g>
  );
}

/** A block of city, as flat slabs with lit windows. */
function Towers() {
  const bars: [number, number, number][] = [
    [4, 26, 12],
    [20, 16, 9],
    [32, 38, 14],
    [50, 22, 10],
    [64, 46, 13],
    [80, 18, 11],
    [94, 32, 12],
    [108, 24, 10],
  ];
  return (
    <g>
      {bars.map(([x, h, w], i) => (
        <g key={x}>
          <rect x={x} y={76 - h} width={w} height={h} fill={i % 2 ? '#16233a' : '#1b2b45'} />
          {Array.from({ length: Math.floor(h / 7) }, (_, r) => (
            <rect
              key={r}
              x={x + 2}
              y={76 - h + 3 + r * 7}
              width={w - 4}
              height="2"
              fill="#38bdf8"
              opacity={r % 3 === 0 ? 0.5 : 0.2}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

/** A stand of conifers along the bottom. */
function Trees({ dark = false }: { dark?: boolean }) {
  const xs = [6, 18, 29, 41, 52, 66, 78, 90, 102, 113];
  return (
    <g>
      {xs.map((x, i) => {
        const h = 26 + ((i * 7) % 16);
        return (
          <polygon
            key={x}
            points={`${x},${76 - h} ${x - 7},76 ${x + 7},76`}
            fill={dark ? '#0e1a16' : i % 2 ? '#132a20' : '#17352a'}
          />
        );
      })}
      <rect x="0" y="70" width="120" height="6" fill="#0d1712" />
    </g>
  );
}

/** The scenes, one per key. Each returns the contents of the frame. */
const SCENES: Record<ArtKey, () => ReactElement> = {
  // The package on its lit mark, with the drone coming down onto it.
  collect: () => (
    <g>
      <rect x="0" y="58" width="120" height="18" fill="#141d2e" />
      <Mark x={60} y={62} color="#37e08a" w={22} />
      <rect x="54" y="52" width="12" height="10" rx="1.4" fill="#eef3f9" />
      <rect x="59" y="53" width="2" height="8" fill="#e03131" />
      <rect x="55" y="56.5" width="10" height="2" fill="#e03131" />
      <Drone x={60} y={30} s={1.1} />
      <line
        x1="60"
        y1="34"
        x2="60"
        y2="48"
        stroke="#37e08a"
        strokeWidth="0.8"
        strokeDasharray="2 3"
        opacity="0.7"
      />
    </g>
  ),
  // The carry: a drone between the towers, with a ring ahead of it.
  city: () => (
    <g>
      <Towers />
      <circle cx="86" cy="30" r="9" fill="none" stroke="#ff17dd" strokeWidth="2" opacity="0.9" />
      <circle cx="86" cy="30" r="9" fill="#ff17dd" opacity="0.16" />
      <Drone x={42} y={32} s={1.15} cargo="#eef3f9" />
    </g>
  ),
  // The crossing: a drone low between the trunks, canopy overhead.
  forest: () => (
    <g>
      <Trees />
      <circle cx="88" cy="34" r="8" fill="none" stroke="#ff17dd" strokeWidth="2" opacity="0.9" />
      <circle cx="88" cy="34" r="8" fill="#ff17dd" opacity="0.16" />
      <Drone x={40} y={36} s={1.15} cargo="#e03131" />
    </g>
  ),
  // The delivery: the box on the yellow mark, the drone holding over it.
  deliver: () => (
    <g>
      <rect x="0" y="56" width="120" height="20" fill="#141d2e" />
      <Mark x={60} y={60} color="#ffcf4d" w={24} />
      <rect x="54" y="50" width="12" height="10" rx="1.4" fill="#eef3f9" />
      <rect x="59" y="51" width="2" height="8" fill="#e03131" />
      <rect x="55" y="54.5" width="10" height="2" fill="#e03131" />
      <Drone x={60} y={26} s={1.1} />
    </g>
  ),
  // The suppression: the tank open over the fire, smoke going up.
  suppress: () => (
    <g>
      <Trees dark />
      <ellipse cx="60" cy="68" rx="20" ry="6" fill="#140d07" opacity="0.75" />
      <path
        d="M60 70 C 52 62, 55 56, 60 50 C 65 56, 68 62, 60 70 Z"
        fill="#ff4a1a"
        opacity="0.95"
      />
      <path d="M60 70 C 56 64, 58 60, 60 56 C 62 60, 64 64, 60 70 Z" fill="#ffb43a" />
      <path
        d="M56 46 q 6 -8 2 -14"
        stroke="#4a4239"
        strokeWidth="5"
        fill="none"
        opacity="0.45"
        strokeLinecap="round"
      />
      <Drone x={60} y={22} s={1.1} cargo="#e03131" />
      <path d="M60 28 L 52 46 L 68 46 Z" fill="#bfe9ff" opacity="0.35" />
    </g>
  ),
  // Home: the pad, and the drone settling onto it.
  land: () => (
    <g>
      <rect x="0" y="56" width="120" height="20" fill="#141d2e" />
      <Mark x={60} y={62} color="#37e08a" w={26} />
      <text
        x="60"
        y="65"
        textAnchor="middle"
        fontSize="10"
        fontWeight="800"
        fill="#37e08a"
        opacity="0.9"
      >
        H
      </text>
      <Drone x={60} y={36} s={1.1} />
    </g>
  ),
};

/**
 * The big picture down the left of the card: the map the mission is flown on.
 *
 * One per environment, and it falls back to the city rather than to nothing —
 * a briefing with a hole in it is worse than a briefing with a generic skyline.
 */
export function MissionHero({ envId }: { envId: string }) {
  return (
    <svg
      className="ms-hero-art"
      viewBox="0 0 120 200"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f1d33" />
          <stop offset="55%" stopColor="#0b1424" />
          <stop offset="100%" stopColor="#080e1a" />
        </linearGradient>
      </defs>
      <rect width="120" height="200" fill="url(#hero-sky)" />
      {envId === 'forest' ? <ForestHero /> : <CityHero />}
    </svg>
  );
}

function CityHero() {
  const bars: [number, number, number][] = [
    [0, 70, 14],
    [13, 108, 12],
    [24, 86, 16],
    [39, 132, 15],
    [53, 96, 13],
    [65, 150, 18],
    [82, 104, 14],
    [95, 124, 13],
    [107, 82, 15],
  ];
  return (
    <g>
      {bars.map(([x, h, w], i) => (
        <g key={x}>
          <rect x={x} y={200 - h} width={w} height={h} fill={i % 2 ? '#131f34' : '#182740'} />
          {Array.from({ length: Math.floor(h / 9) }, (_, r) => (
            <rect
              key={r}
              x={x + 2.5}
              y={200 - h + 5 + r * 9}
              width={w - 5}
              height="2.4"
              fill="#38bdf8"
              opacity={(i + r) % 4 === 0 ? 0.55 : 0.18}
            />
          ))}
        </g>
      ))}
      <Drone x={62} y={48} s={1.9} cargo="#eef3f9" />
    </g>
  );
}

function ForestHero() {
  const xs = [4, 16, 27, 38, 50, 62, 74, 86, 98, 110, 118];
  return (
    <g>
      {/* The smoke column, which is what the pilot is looking for from the air. */}
      <path
        d="M76 130 q 10 -26 2 -44 q -8 -18 4 -34"
        stroke="#4a4239"
        strokeWidth="16"
        fill="none"
        opacity="0.3"
        strokeLinecap="round"
      />
      {xs.map((x, i) => {
        const h = 62 + ((i * 13) % 44);
        return (
          <polygon
            key={x}
            points={`${x},${200 - h} ${x - 12},200 ${x + 12},200`}
            fill={i % 2 ? '#112a1f' : '#16362a'}
          />
        );
      })}
      {/* The fire itself, small and low, the way it reads from the air. */}
      <ellipse cx="76" cy="150" rx="13" ry="4" fill="#140d07" opacity="0.8" />
      <path d="M76 152 C 68 143, 71 136, 76 129 C 81 136, 84 143, 76 152 Z" fill="#ff4a1a" />
      <path d="M76 152 C 72 145, 74 140, 76 136 C 78 140, 80 145, 76 152 Z" fill="#ffb43a" />
      <Drone x={44} y={62} s={1.9} cargo="#e03131" />
    </g>
  );
}
