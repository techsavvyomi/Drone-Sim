import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceProps<T extends string> {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group ("Flight mode", "Difficulty"). */
  label: string;
  className?: string;
}

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREV = new Set(['ArrowLeft', 'ArrowUp']);

/** Arrow keys walk the options, wrapping; Home / End jump. Selection follows
 *  focus, as radio groups and tab lists do. One Tab stop for the whole group.
 *  A tab row answers ← → only, so ↓ leaves it for the panel below. */
function useRoving<T extends string>(
  options: readonly ChoiceOption<T>[],
  value: T,
  onChange: (v: T) => void,
  horizontal = false,
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const at = options.findIndex((o) => o.value === value);
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    let to = -1;
    if (horizontal && vertical) return;
    if (NEXT.has(e.key)) to = (at + 1) % options.length;
    else if (PREV.has(e.key)) to = (at - 1 + options.length) % options.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = options.length - 1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to].value);
    refs.current[to]?.focus();
  };
  return { refs, onKeyDown };
}

/** Segmented control. Selected = fill + weight + ✓ (the ✓ is dropped in the
 *  cockpit register, where the chips are too short for it). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: ChoiceProps<T>) {
  const { refs, onKeyDown } = useRoving(options, value, onChange);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`ds-seg ${className ?? ''}`}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={on ? 'ds-seg__opt is-selected' : 'ds-seg__opt'}
            onClick={() => onChange(o.value)}
          >
            {on && <Icon name="check" className="ds-seg__check" />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Tabs. The selected tab carries an underline and weight; the panel below is
 *  the caller's. */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: ChoiceProps<T>) {
  const { refs, onKeyDown } = useRoving(options, value, onChange, true);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`ds-tabs ${className ?? ''}`}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={on ? 'ds-tab is-selected' : 'ds-tab'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
