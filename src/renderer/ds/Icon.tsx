// ----------------------------------------------------------------------------
// State glyphs as inline SVG.
//
// The design carries every state with a glyph AND a word (✓ Completed,
// ▲ LOW BATT, ✕ FAILSAFE). Geist has no ✓ ✕ ★ ☆ ▸ ▾ ▴ ◆ ■, and a glyph the font
// lacks is drawn by whatever system font the OS falls back to — a different
// shape on macOS and Windows. Drawing them here keeps one shape everywhere.
// They take `currentColor`, so the surrounding text colour (a token) colours
// them, and they size to the text (1em).
// ----------------------------------------------------------------------------

import type { ReactElement } from 'react';

export type IconName =
  | 'check'
  | 'cross'
  | 'star'
  | 'star-empty'
  | 'play'
  | 'pause'
  | 'caret-down'
  | 'caret-up'
  | 'chevron'
  | 'warning'
  | 'down'
  | 'dot'
  | 'ring'
  | 'diamond'
  | 'square';

const PATHS: Record<IconName, ReactElement> = {
  check: (
    <path
      d="M3 8.5l3.2 3.2L13 4.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  cross: (
    <path
      d="M4 4l8 8M12 4l-8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  star: (
    <path
      d="M8 1.6l1.95 4.1 4.45.55-3.28 3.08.84 4.42L8 11.6l-3.96 2.15.84-4.42L1.6 6.25l4.45-.55z"
      fill="currentColor"
    />
  ),
  'star-empty': (
    <path
      d="M8 1.6l1.95 4.1 4.45.55-3.28 3.08.84 4.42L8 11.6l-3.96 2.15.84-4.42L1.6 6.25l4.45-.55z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  ),
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" />,
  pause: <path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor" />,
  'caret-down': <path d="M4 6h8l-4 5z" fill="currentColor" />,
  'caret-up': <path d="M4 10h8L8 5z" fill="currentColor" />,
  chevron: (
    <path
      d="M6 3.5L10.5 8 6 12.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  warning: <path d="M8 2.5l6 11H2z" fill="currentColor" />,
  down: <path d="M8 13.5l6-11H2z" fill="currentColor" />,
  dot: <circle cx="8" cy="8" r="4" fill="currentColor" />,
  ring: <circle cx="8" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  diamond: <path d="M8 2.5L13.5 8 8 13.5 2.5 8z" fill="currentColor" />,
  square: <rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `ds-icon ${className}` : 'ds-icon'}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
