import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../ds';

export interface LoadoutOption {
  id: string;
  name: string;
  /** Short figure beside the name ("50 g"). */
  meta?: string;
  /** One line under it ("Quad · 55 mm props"). */
  detail?: string;
  thumb?: ReactNode;
}

export interface LoadoutChipProps {
  icon: ReactNode;
  /** The chip's key ("Drone"). Hidden under 1200 px, kept in the aria-label. */
  label: string;
  value: string;
  options: readonly LoadoutOption[];
  onSelect: (id: string) => void;
  /** The open menu's title line ("Changes mass, thrust and handling."). */
  blurb: string;
  /** 'chip' (default): the top bar's icon + key + value chip. 'button': a
   *  secondary pill naming the action ("Change drone"), for Home's picker —
   *  same menu and keys, no neighbouring chips to step to. */
  variant?: 'chip' | 'button';
  /** The 'button' variant's words. */
  buttonText?: string;
}

/**
 * One chip of the top bar's NEXT FLIGHT strip. Opens a listbox on the current
 * value: ↑↓ move, Enter / Space pick and close, Esc closes back to the chip,
 * ← → close and move to the neighbouring chip, Tab closes.
 */
export function LoadoutChip({
  icon,
  label,
  value,
  options,
  onSelect,
  blurb,
  variant = 'chip',
  buttonText,
}: LoadoutChipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const openMenu = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.id === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  /** The next focusable chip (or Fly) along the strip, ±1. */
  const neighbour = (step: 1 | -1) => {
    const strip = rootRef.current?.closest('[data-loadout]');
    if (!strip) return;
    const stops = [...strip.querySelectorAll<HTMLElement>('[data-loadout-stop]')];
    const at = stops.indexOf(buttonRef.current!);
    stops[at + step]?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        setActive((a) => Math.min(options.length - 1, a + 1));
        break;
      case 'ArrowUp':
        setActive((a) => Math.max(0, a - 1));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        onSelect(options[active].id);
        close();
        break;
      case 'Escape':
        e.stopPropagation();
        close();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        setOpen(false);
        neighbour(e.key === 'ArrowRight' ? 1 : -1);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      className="loadout-chip"
      ref={rootRef}
      // Focus leaving the chip closes its menu. A number key or the D-pad could
      // move focus to another page with the menu still open, and it stayed
      // drawn over the flight that page opened.
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-loadout-stop={variant === 'chip' ? true : undefined}
        className={[
          variant === 'chip' ? 'loadout-chip__button' : 'ds-btn ds-btn--secondary loadout-chip__pick',
          open ? 'is-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${variant === 'chip' ? label : (buttonText ?? label)}: ${current?.name ?? 'none'}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {variant === 'chip' ? (
          <>
            <span className="loadout-chip__icon" aria-hidden="true">
              {icon}
            </span>
            <span className="loadout-chip__body" aria-hidden="true">
              <span className="loadout-chip__key">{label}</span>
              <span className="loadout-chip__value">{current?.name ?? '-'}</span>
            </span>
          </>
        ) : (
          <span aria-hidden="true">{buttonText ?? label}</span>
        )}
        <Icon name={open ? 'caret-up' : 'caret-down'} />
      </button>

      {open && (
        <div className="loadout-menu">
          <p className="loadout-menu__head">
            <b id={`${id}-title`}>{label}</b>
            <span>{blurb}</span>
          </p>
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-title`}
            aria-activedescendant={`${id}-opt-${active}`}
            onKeyDown={onListKey}
          >
            {options.map((o, i) => {
              const on = o.id === value;
              return (
                <li
                  key={o.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={on}
                  className={[
                    'loadout-menu__opt',
                    on ? 'is-selected' : '',
                    i === active ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => {
                    onSelect(o.id);
                    close();
                  }}
                >
                  {o.thumb && (
                    <span className="loadout-menu__thumb" aria-hidden="true">
                      {o.thumb}
                    </span>
                  )}
                  <span className="loadout-menu__text">
                    <span className="loadout-menu__name">
                      {o.name}
                      {o.meta && <span className="loadout-menu__meta"> {o.meta}</span>}
                    </span>
                    {o.detail && <span className="loadout-menu__detail">{o.detail}</span>}
                  </span>
                  {on && <Icon name="check" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
