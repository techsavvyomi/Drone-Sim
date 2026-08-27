import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyHint } from '../training/lessons/types';

// A row of keycaps for the active lesson's controls. A cap lights up while its
// key is really held (Practice) or while the demo is holding it (Demonstration),
// so the pilot always sees which control maps to what.
//
// The four arrow caps are laid out the way they sit under the hand — up over
// left/down/right — instead of running along the row. Flat, the row put PITCH
// FORWARD next to PITCH BACKWARD and ROLL LEFT next to ROLL RIGHT, so the
// picture on screen said nothing about where the fingers actually go.
//
// `cue` is the other half: the cap the lesson is ASKING for right now breathes
// on its own, before the pilot has pressed anything. Lit means "you are doing
// this"; breathing means "do this next".
//
// The caps are also CLICKABLE. Pressing one dispatches the same keyboard event
// the real key would, so the mouse works everywhere the keyboard does — holding
// the button down holds the control, exactly like holding the key. Flight School
// puts a control on screen and then asks for it; a pilot who reaches for it with
// the mouse should not find a picture.

/** The arrow cluster, in the order it is read off a keyboard. */
const PAD = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] as const;
const isPad = (code: string): boolean => (PAD as readonly string[]).includes(code);

/**
 * Grid slots for whichever arrows this lesson actually uses.
 *
 * Only three lessons carry all four. Module 6 is pitch alone and Module 7 roll
 * alone, and a fixed 3x2 cross would hand those an arm of empty space on each
 * side. So a column exists only if something is in it: pitch-only collapses to
 * the vertical pair, roll-only to the horizontal one, and both are still the
 * shape those keys have on the keyboard.
 */
function padSlots(codes: readonly string[]): {
  cols: number;
  slot: (code: string) => { gridColumn: number; gridRow: number };
} {
  const up = codes.includes('ArrowUp');
  const mid = up || codes.includes('ArrowDown');
  const left = codes.includes('ArrowLeft');
  const right = codes.includes('ArrowRight');
  const colLeft = 1;
  const colMid = left ? 2 : 1;
  const colRight = colMid + (mid ? 1 : 0);
  const bottom = up ? 2 : 1;
  return {
    cols: (left ? 1 : 0) + (mid ? 1 : 0) + (right ? 1 : 0),
    slot: (code) => {
      if (code === 'ArrowUp') return { gridColumn: colMid, gridRow: 1 };
      if (code === 'ArrowLeft') return { gridColumn: colLeft, gridRow: bottom };
      if (code === 'ArrowRight') return { gridColumn: colRight, gridRow: bottom };
      return { gridColumn: colMid, gridRow: bottom }; // ArrowDown
    },
  };
}

export function KeyHints({
  keys,
  demoKeys,
  cue = [],
}: {
  keys: KeyHint[];
  demoKeys: readonly string[];
  cue?: readonly string[];
}) {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  /** The cap currently held by the pointer, so releasing anywhere releases it. */
  const heldByPointer = useRef<string | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) =>
      setPressed((p) => {
        if (p.has(e.code)) return p;
        const n = new Set(p);
        n.add(e.code);
        return n;
      });
    const up = (e: KeyboardEvent) =>
      setPressed((p) => {
        if (!p.has(e.code)) return p;
        const n = new Set(p);
        n.delete(e.code);
        return n;
      });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // A click is a real key press as far as the rest of the app is concerned:
  // input/controls.ts reads `code` off the event and does not care who sent it,
  // and it already ignores everything while a demonstration is scripted.
  const release = useCallback(() => {
    const code = heldByPointer.current;
    if (!code) return;
    heldByPointer.current = null;
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }, []);

  useEffect(() => {
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [release]);

  const press = (code: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    heldByPointer.current = code;
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  };

  const cap = (k: KeyHint, style?: React.CSSProperties) => {
    const active = demoKeys.includes(k.code) || pressed.has(k.code);
    // A cap that is being pressed shows as pressed; the breathing hint has
    // done its job by then and would only fight the lit state.
    const asking = !active && cue.includes(k.code);
    return (
      <button
        key={k.code}
        type="button"
        // Never takes focus: these caps ARE the keyboard, and a focused
        // button would swallow the very key it is standing for.
        tabIndex={-1}
        className={`tr-key ${active ? 'on' : ''} ${asking ? 'cue' : ''}`}
        style={style}
        onPointerDown={press(k.code)}
        title={`${k.label} — ${k.hint}`}
      >
        <kbd>{k.label}</kbd>
        <span>{k.hint}</span>
      </button>
    );
  };

  // The arrows come out of the row and into their own cluster, which then takes
  // the place of the FIRST arrow in the lesson's own ordering — so ENTER and
  // SPACE stay ahead of the sticks, exactly where the lessons put them.
  const { arrows, padAt } = useMemo(() => {
    const arrows = keys.filter((k) => isPad(k.code));
    const padAt = keys.findIndex((k) => isPad(k.code));
    return { arrows, padAt };
  }, [keys]);
  const { cols, slot } = padSlots(arrows.map((k) => k.code));

  return (
    <div className="tr-keys">
      {keys.map((k, i) => {
        if (!isPad(k.code)) return cap(k);
        if (i !== padAt) return null;
        return (
          <div
            key="tr-keypad"
            className="tr-keypad"
            style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}
          >
            {arrows.map((a) => cap(a, slot(a.code)))}
          </div>
        );
      })}
    </div>
  );
}
