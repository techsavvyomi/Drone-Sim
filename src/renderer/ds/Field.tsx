import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

// ---- Slider ----------------------------------------------------------------

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** How the value is printed — it is always printed ("572°", "45%", "0.30"). */
  format?: (value: number) => string;
  /** Words under the two ends ("Gentle" / "Twitchy"). */
  minLabel?: string;
  maxLabel?: string;
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
  minLabel,
  maxLabel,
}: SliderProps) {
  const id = useId();
  const text = format(value);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="ds-slider">
      <div className="ds-slider__head">
        <label htmlFor={id} className="ds-label">
          {label}
        </label>
        <output htmlFor={id} className="ds-slider__value">
          {text}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {(minLabel || maxLabel) && (
        <div className="ds-slider__ends" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---- Checkbox --------------------------------------------------------------

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  /** A second line under the label. */
  hint?: string;
}

/** The ✓ glyph carries the state, not colour alone. */
export function Checkbox({ checked, onChange, children, hint }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={checked ? 'ds-check is-checked' : 'ds-check'}
      onClick={() => onChange(!checked)}
    >
      <span className="ds-check__box" aria-hidden="true">
        {checked && <Icon name="check" />}
      </span>
      <span className="ds-check__text">
        <span className="ds-check__label">{children}</span>
        {hint && <span className="ds-check__hint">{hint}</span>}
      </span>
    </button>
  );
}

// ---- Text input ------------------------------------------------------------

export interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown under the field with ✕. Say what to change, with an example. */
  error?: string;
  /** Neutral help under the field (hidden while there is an error). */
  hint?: ReactNode;
  /** Printed after the value inside the field ("m", "0 / 8"). */
  suffix?: ReactNode;
  /** Fixed text before the value that the user does not type ("PLUTO-SIM-"). */
  prefix?: string;
  /** Printed at the right end of the label's line ("0 / 8"). */
  labelAside?: ReactNode;
  /** Geist Mono — the activation key only. */
  mono?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, value, onChange, error, hint, suffix, prefix, labelAside, mono, id: givenId, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={`ds-field ${error ? 'is-invalid' : ''} ${className ?? ''}`}>
      {labelAside ? (
        <div className="ds-field__labelrow">
          <label htmlFor={id} className="ds-label">
            {label}
          </label>
          <span className="ds-field__aside">{labelAside}</span>
        </div>
      ) : (
        <label htmlFor={id} className="ds-label">
          {label}
        </label>
      )}
      <div
        className="ds-field__box"
        style={prefix ? ({ '--prefix-len': prefix.length } as CSSProperties) : undefined}
      >
        {prefix && (
          <span className={mono ? 'ds-field__prefix ds-input--mono' : 'ds-field__prefix'} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          className={[
            'ds-input',
            mono ? 'ds-input--mono' : '',
            suffix ? 'has-suffix' : '',
            prefix ? 'has-prefix' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {suffix && <span className="ds-field__suffix">{suffix}</span>}
      </div>
      {error ? (
        <p id={noteId} className="ds-field__error" role="alert">
          <Icon name="cross" />
          <span>{error}</span>
        </p>
      ) : (
        hint && (
          <p id={noteId} className="ds-field__hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
});

// ---- Select (dropdown) -----------------------------------------------------

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A one-line description under the label. */
  detail?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Button + listbox. Opening focuses the current value; ↑↓ move, Enter / Space
 *  pick and close, Esc closes, Tab closes. Focus returns to the button. The
 *  selected row carries ✓ and weight. */
export function Select<T extends string>({ label, options, value, onChange }: SelectProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

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

  const openList = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const pick = (i: number) => {
    onChange(options[i].value);
    close();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') {
      // Esc belongs to the menu here, not to whatever screen is behind it.
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className="ds-select" ref={rootRef}>
      <span id={`${id}-label`} className="ds-label">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'ds-select__button is-open' : 'ds-select__button'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
      >
        <span id={`${id}-value`}>{current?.label ?? ''}</span>
        <Icon name={open ? 'caret-up' : 'caret-down'} />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-opt-${active}`}
          className="ds-select__list"
          onKeyDown={onListKey}
        >
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={on}
                className={[
                  'ds-select__opt',
                  on ? 'is-selected' : '',
                  i === active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="ds-select__text">
                  <span className="ds-select__name">{o.label}</span>
                  {o.detail && <span className="ds-select__detail">{o.detail}</span>}
                </span>
                {on && <Icon name="check" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
