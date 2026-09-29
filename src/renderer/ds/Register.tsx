import type { HTMLAttributes, ReactNode } from 'react';

/** Puts a subtree in one of the two registers. Everything inside takes its
 *  control height, corners, label case and surface from tokens.css. */
export function Register({
  kind,
  children,
  className,
  ...rest
}: { kind: 'cockpit' | 'classroom'; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-register={kind} className={`ds-register ${className ?? ''}`} {...rest}>
      {children}
    </div>
  );
}
