import { useEffect, useState } from 'react';
import type { KeyHint } from '../training/lessons/types';

// A row of keycaps for the active lesson's controls. A cap lights up when its
// key is really pressed (Practice) or when the demo flashes it (Demonstration),
// so the pilot always sees which control maps to what.
export function KeyHints({ keys, demoKey }: { keys: KeyHint[]; demoKey: string | null }) {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());

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

  return (
    <div className="tr-keys">
      {keys.map((k) => {
        const active = demoKey === k.code || pressed.has(k.code);
        return (
          <div key={k.code} className={`tr-key ${active ? 'on' : ''}`}>
            <kbd>{k.label}</kbd>
            <span>{k.hint}</span>
          </div>
        );
      })}
    </div>
  );
}
