import { Keycap } from './Display';

export interface LegendItem {
  /** Keyboard key(s) — several render as separate caps ("W", "S"). */
  keys: string[];
  /** Gamepad button and its shape. */
  pad?: { label: string; shape: 'face' | 'shoulder' | 'stick' };
  /** What it does. */
  action: string;
}

export interface ButtonLegendProps {
  items: readonly LegendItem[];
  /** Which device's glyphs to show. The compact shell shows the last-used one only. */
  device?: 'both' | 'keyboard' | 'gamepad';
  label?: string;
}

/** The key legend pinned to the bottom of a screen: keycap + pad glyph + word. */
export function ButtonLegend({ items, device = 'both', label = 'Controls' }: ButtonLegendProps) {
  return (
    <ul className="ds-legend" aria-label={label}>
      {items.map((it) => (
        <li key={it.action} className="ds-legend__item">
          {device !== 'gamepad' && it.keys.map((k) => <Keycap key={k}>{k}</Keycap>)}
          {device !== 'keyboard' && it.pad && <Keycap pad={it.pad.shape}>{it.pad.label}</Keycap>}
          <span className="ds-legend__action">{it.action}</span>
        </li>
      ))}
    </ul>
  );
}
