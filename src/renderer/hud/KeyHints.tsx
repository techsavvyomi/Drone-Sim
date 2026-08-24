import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyHint } from '../training/lessons/types';

// A row of keycaps for the active lesson's controls. A cap lights up while its
// key is really held (Practice) or while the demo is holding it (Demonstration),
// so the pilot always sees which control maps to what.
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

  return (
    <div className="tr-keys">
      {keys.map((k) => {
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
            onPointerDown={press(k.code)}
            title={`${k.label} — ${k.hint}`}
          >
            <kbd>{k.label}</kbd>
            <span>{k.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
