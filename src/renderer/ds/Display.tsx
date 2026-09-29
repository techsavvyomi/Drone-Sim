import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** What a value means. Colour only ever reports state; each tone is paired with
 *  a glyph and a word by the caller, never colour alone. */
export type Tone = 'neutral' | 'signal' | 'armed' | 'caution' | 'fail';

// ---- Badge -----------------------------------------------------------------

export interface BadgeProps {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}

/** ● ARMED · ▲ LOW BATT · ✕ FAILSAFE · ✓ Completed. */
export function Badge({ tone = 'neutral', icon, children }: BadgeProps) {
  return (
    <span className={`ds-badge ds-tone--${tone}`}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </span>
  );
}

// ---- Keycap ----------------------------------------------------------------

export interface KeycapProps {
  children: ReactNode;
  pressed?: boolean;
  /** Gamepad button shape: face = circle, shoulder = pill (also menu), stick =
   *  rounded square. Omit for a keyboard key. */
  pad?: 'face' | 'shoulder' | 'stick';
}

export function Keycap({ children, pressed, pad }: KeycapProps) {
  const cls = ['ds-key', pad ? `ds-key--${pad}` : '', pressed ? 'is-pressed' : '']
    .filter(Boolean)
    .join(' ');
  return <kbd className={cls}>{children}</kbd>;
}

// ---- Progress --------------------------------------------------------------

export interface ProgressProps {
  value: number;
  max: number;
  /** Accessible name ("XP to Cadet"). */
  label: string;
  tone?: Tone;
}

export function Progress({ value, max, label, tone = 'signal' }: ProgressProps) {
  const pct = max > 0 ? Math.round(Math.max(0, Math.min(100, (value / max) * 100)) * 100) / 100 : 0;
  return (
    <div
      className={`ds-progress ds-tone--${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className="ds-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---- Star rating -----------------------------------------------------------

export interface StarRatingProps {
  earned: number;
  total?: number;
  /** Print "2 of 3 stars" beside the stars (default on) — every value gets a word. */
  showText?: boolean;
}

export function StarRating({ earned, total = 3, showText = true }: StarRatingProps) {
  const n = Math.max(0, Math.min(total, Math.round(earned)));
  const text = `${n} of ${total} stars`;
  return (
    <span className="ds-stars" role="img" aria-label={text}>
      <span className="ds-stars__row" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <Icon
            key={i}
            name={i < n ? 'star' : 'star-empty'}
            className={i < n ? 'is-earned' : undefined}
          />
        ))}
      </span>
      {showText && (
        <span className="ds-stars__text" aria-hidden="true">
          {text}
        </span>
      )}
    </span>
  );
}

// ---- Stat tile -------------------------------------------------------------

export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  /** A state line: glyph + word, in its tone (▲ LOW, ● OK, ▼ 2.1 s faster). */
  status?: { tone: Tone; icon?: IconName; text: string };
  /** A plain line under the value ("this term", "-48 dBm"). */
  note?: string;
}

export function StatTile({ label, value, unit, status, note }: StatTileProps) {
  return (
    <div className="ds-stat">
      <span className="ds-label">{label}</span>
      {status && (
        <span className={`ds-stat__status ds-tone--${status.tone}`}>
          {status.icon && <Icon name={status.icon} />}
          {status.text}
        </span>
      )}
      <span className="ds-stat__value">
        {value}
        {unit && <span className="ds-stat__unit"> {unit}</span>}
      </span>
      {note && <span className="ds-stat__note">{note}</span>}
    </div>
  );
}

// ---- Panel & divider ------------------------------------------------------

export interface PanelProps {
  title?: string;
  /** Right side of the header ("100 Hz"). */
  meta?: string;
  children: ReactNode;
  className?: string;
}

/** A panel wears the one allowed gradient: the ink-800 → ink-900 wash. */
export function Panel({ title, meta, children, className }: PanelProps) {
  return (
    <section className={`ds-panel ${className ?? ''}`}>
      {(title || meta) && (
        <header className="ds-panel__head">
          {title && <h3 className="ds-panel__title">{title}</h3>}
          {meta && <span className="ds-panel__meta">{meta}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Divider() {
  return <hr className="ds-divider" />;
}
