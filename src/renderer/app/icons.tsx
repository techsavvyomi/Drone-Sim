// Compact stroke icon set. Inline SVG keeps them crisp at any size and lets
// them inherit currentColor from the surrounding UI state.

type P = { size?: number };
const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconDrone = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="6" height="6" rx="1.4" />
    <path d="M9.5 9.5 6 6M14.5 9.5 18 6M9.5 14.5 6 18M14.5 14.5 18 18" />
    <circle cx="5" cy="5" r="2.2" />
    <circle cx="19" cy="5" r="2.2" />
    <circle cx="5" cy="19" r="2.2" />
    <circle cx="19" cy="19" r="2.2" />
  </svg>
);

export const IconTarget = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.6" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconArena = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 15a9 9 0 0 1 18 0" />
    <path d="M3 15h18" />
    <circle cx="12" cy="15" r="2" />
  </svg>
);

export const IconCeiling = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 5h18" />
    <path d="M12 9v10M8.5 12.5 12 9l3.5 3.5" />
  </svg>
);
