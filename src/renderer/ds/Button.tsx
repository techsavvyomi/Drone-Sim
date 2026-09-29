import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** primary = signal fill, the one action on a screen · secondary = ink-700 ·
   *  ghost = text only · danger = fail outline with ✕. */
  variant?: ButtonVariant;
  /** Locked: the button stays focusable but does nothing, and shows this text
   *  instead of its label — it says what unlocks it ("Finish lesson 2 to unlock"). */
  locked?: string;
  icon?: IconName;
  iconAfter?: IconName;
  type?: 'button' | 'submit';
  children: ReactNode;
}

/** Height, corners and case come from the register (cockpit 30 px / classroom
 *  44 px pill), not from a prop. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    locked,
    icon,
    iconAfter,
    type = 'button',
    className,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  const lead = icon ?? (variant === 'danger' ? 'cross' : undefined);
  const classes = ['ds-btn', `ds-btn--${variant}`, locked ? 'is-locked' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-disabled={locked ? true : undefined}
      onClick={locked ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {locked ? (
        <span>{locked}</span>
      ) : (
        <>
          {lead && <Icon name={lead} />}
          <span>{children}</span>
          {iconAfter && <Icon name={iconAfter} />}
        </>
      )}
    </button>
  );
});
