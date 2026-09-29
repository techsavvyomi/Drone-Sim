import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { Button } from './Button';
import { Icon } from './Icon';
import type { Tone } from './Display';

export interface ModalAction {
  label: string;
  onClick: () => void;
}

export interface ModalProps {
  title: string;
  /** caution puts ▲ before the title, fail puts ✕. */
  tone?: Extract<Tone, 'neutral' | 'caution' | 'fail'>;
  children?: ReactNode;
  /** The safe choice ("Keep flying", "Stay signed in"). Focus starts on it, and
   *  Esc takes it. */
  safe: ModalAction;
  /** The consequential choice, drawn as danger ("End", "Sign out"). */
  danger?: ModalAction;
  /** A non-destructive primary choice instead of `danger` ("Next lesson"). */
  primary?: ModalAction;
}

/** Modal card over a flat 80 % ink-950 scrim. Focus is trapped inside, flight
 *  keys are held by the modal key lock, and focus returns where it came from on
 *  close. Render it only while open. */
export function Modal({ title, tone = 'neutral', children, safe, danger, primary }: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);

  useModalKeyLock(true, cardRef);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    safeRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  // Tab and Escape are the two keys the lock lets through, and all this needs.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      safe.onClick();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex="0"]',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ds-scrim">
      <div
        ref={cardRef}
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={`ds-modal__title ds-tone--${tone}`}>
          {tone === 'caution' && <Icon name="warning" />}
          {tone === 'fail' && <Icon name="cross" />}
          <span>{title}</span>
        </h2>
        {children && <div className="ds-modal__body">{children}</div>}
        <div className="ds-modal__actions">
          <Button ref={safeRef} variant="secondary" onClick={safe.onClick}>
            {safe.label}
          </Button>
          {danger && (
            <Button variant="danger" onClick={danger.onClick}>
              {danger.label}
            </Button>
          )}
          {primary && (
            <Button variant="primary" onClick={primary.onClick}>
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
