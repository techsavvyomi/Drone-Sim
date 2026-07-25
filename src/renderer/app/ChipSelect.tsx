import { useEffect, useRef, useState } from 'react';
import { IconChevron } from './icons';

export interface SelectOption {
  id: string;
  name: string;
  /** Short descriptor shown under the name. */
  meta?: string;
  /** Accent colour for the option's thumbnail tile. */
  color: string;
  /** Glyph rendered inside the thumbnail. */
  thumb: React.ReactNode;
}

/**
 * Top-bar chip that opens a dropdown of options, each with a thumbnail tile.
 *
 * The chip is a FIXED width: the value text is clipped rather than allowed to
 * resize the chip, so switching between short and long names ("Pluto" vs
 * "Drone Academy") can't shove the rest of the bar around.
 */
export function ChipSelect({
  icon,
  label,
  value,
  options,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: SelectOption[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.id === value);

  return (
    <div className="chip-select" ref={root}>
      <button className="chip chip-btn" onClick={() => setOpen((o) => !o)} title={`Change ${label}`}>
        <span className="chip-icon">{icon}</span>
        <span className="chip-body">
          <i>{label}</i>
          <b>{current?.name ?? '—'}</b>
        </span>
        <span className={`chip-caret ${open ? 'open' : ''}`}>
          <IconChevron size={14} />
        </span>
      </button>

      {open && (
        <div className="chip-menu">
          {options.map((o) => (
            <button
              key={o.id}
              className={`chip-option ${o.id === value ? 'active' : ''}`}
              onClick={() => {
                onSelect(o.id);
                setOpen(false);
              }}
            >
              <span className="option-thumb" style={{ ['--tint' as string]: o.color }}>
                {o.thumb}
              </span>
              <span className="option-text">
                <b>{o.name}</b>
                {o.meta && <i>{o.meta}</i>}
              </span>
              {o.id === value && <span className="option-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
