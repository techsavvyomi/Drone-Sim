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

export const IconHome = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-6h5v6" />
  </svg>
);

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

export const IconCap = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z" />
    <path d="M6.5 11v4.6c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V11" />
  </svg>
);

export const IconMedal = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3 4.5 6v5.2c0 4.3 3.1 7.7 7.5 9.3 4.4-1.6 7.5-5 7.5-9.3V6L12 3Z" />
    <path d="m9.6 11.8 1.8 1.8 3.4-3.4" />
  </svg>
);

export const IconTools = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14.2 6.4a3.6 3.6 0 0 0 4.8 4.6l2.2 2.2-3 3-2.2-2.2a3.6 3.6 0 0 0-4.6-4.8" />
    <path d="m10.4 13.6-6 6 2.6 2.6" opacity="0.9" />
    <path d="M3.5 4.5 8 9" />
  </svg>
);

export const IconGear = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.7 7.5l2 1.2M17.3 15.3l2 1.2M4.7 16.5l2-1.2M17.3 8.7l2-1.2" />
  </svg>
);

export const IconChevron = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconSignal = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 20v-4M9 20v-8M14 20v-12M19 20V4" />
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
