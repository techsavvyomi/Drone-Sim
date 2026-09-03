import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyHint } from '../training/lessons/types';

// Keycaps for the active lesson's controls. A cap lights up while its key is
// really held (Practice) or while the demo is holding it (Demonstration), so the
// pilot always sees which control maps to what.
//
// They are laid out UNDER THE STICK THEY BELONG TO, in the shape they have on a
// keyboard: W/A/S/D under the left gimbal, which is the one carrying throttle
// and yaw, and the arrows under the right, which carries pitch and roll. Arm and
// Take Off are neither — they are commands rather than axes — so they stand on
// their own in the middle, over the status line.
//
// All of it used to be one row across the bottom of the screen. Three things
// were wrong with that. The row sat in the same 24 px band as the status line
// and overlapped it. It put every cap the same distance from both sticks, so
// nothing on screen said which hand a control belonged to — the one thing a
// beginner most needs told. And the space directly under the gimbals, which is
// where the eye already is, was left empty.
//
// The caps a lesson shows are still only the ones that lesson teaches
// (`Lesson.keys`): a side with nothing on it draws nothing at all, so Module 3
// gets a throttle pair under the left stick and bare screen under the right.
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

/** The four codes one gimbal's cluster is built from.
 *
 *  The split is not a new idea to maintain alongside the old one: it is the same
 *  mapping `StickIndicator` already uses to decide which stick a cued key
 *  belongs to. Left gimbal is throttle and yaw, right is pitch and roll. */
interface Pad {
  up: string;
  down: string;
  left: string;
  right: string;
}
const LEFT_PAD: Pad = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
const RIGHT_PAD: Pad = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const inPad = (pad: Pad, code: string): boolean =>
  code === pad.up || code === pad.down || code === pad.left || code === pad.right;

/**
 * Grid slots for whichever of a gimbal's four keys this lesson actually uses.
 *
 * Hardly any lesson carries all four of either set. Module 3 is throttle alone,
 * Module 5 pitch alone, Module 6 roll alone — and a fixed 3x2 cross would hand
 * each of those an arm of empty space on both sides. So a column exists only if
 * something is in it: a vertical pair collapses to one column, a horizontal pair
 * to one row, and either is still the shape those keys have under the hand.
 */
function padSlots(
  pad: Pad,
  codes: readonly string[],
): {
  cols: number;
  slot: (code: string) => { gridColumn: number; gridRow: number };
} {
  const up = codes.includes(pad.up);
  const mid = up || codes.includes(pad.down);
  const left = codes.includes(pad.left);
  const right = codes.includes(pad.right);
  const colLeft = 1;
  const colMid = left ? 2 : 1;
  const colRight = colMid + (mid ? 1 : 0);
  const bottom = up ? 2 : 1;
  return {
    cols: (left ? 1 : 0) + (mid ? 1 : 0) + (right ? 1 : 0),
    slot: (code) => {
      if (code === pad.up) return { gridColumn: colMid, gridRow: 1 };
      if (code === pad.left) return { gridColumn: colLeft, gridRow: bottom };
      if (code === pad.right) return { gridColumn: colRight, gridRow: bottom };
      return { gridColumn: colMid, gridRow: bottom }; // down
    },
  };
}

/**
 * Which keys the pilot is holding right now.
 *
 * One place, so the caps under both gimbals and the two command buttons all read
 * the same truth. It listens on the window rather than on the caps themselves:
 * a cap is a picture of a key, and the key is pressed on the keyboard far more
 * often than on the cap.
 */
function usePressedKeys(): ReadonlySet<string> {
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
  return pressed;
}

/**
 * Pressing a cap with the pointer, as a real key press.
 *
 * `input/controls.ts` reads `code` off the event and does not care who sent it,
 * and it already ignores everything while a demonstration is scripted — so a
 * synthetic event is the whole implementation. Release is watched on the WINDOW,
 * not on the cap, or a pointer that wandered off the button before letting go
 * would leave the control held down.
 */
function usePointerPress(): (code: string) => (e: React.PointerEvent) => void {
  const held = useRef<string | null>(null);

  const release = useCallback(() => {
    const code = held.current;
    if (!code) return;
    held.current = null;
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

  return (code: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    held.current = code;
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  };
}

interface CapProps {
  k: KeyHint;
  demoKeys: readonly string[];
  cue: readonly string[];
  pressed: ReadonlySet<string>;
  press: (code: string) => (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
  /** A command rather than an axis — drawn with the WORD on top and the key
   *  under it, because "Arm" is what the pilot is looking for and ENTER is only
   *  how it is done. */
  action?: boolean;
}

function Cap({ k, demoKeys, cue, pressed, press, style, action }: CapProps) {
  const active = demoKeys.includes(k.code) || pressed.has(k.code);
  // A cap that is being pressed shows as pressed; the breathing hint has done
  // its job by then and would only fight the lit state.
  const asking = !active && cue.includes(k.code);
  return (
    <button
      type="button"
      // Never takes focus: these caps ARE the keyboard, and a focused button
      // would swallow the very key it is standing for.
      tabIndex={-1}
      className={`tr-key ${action ? 'action' : ''} ${active ? 'on' : ''} ${asking ? 'cue' : ''}`}
      style={style}
      onPointerDown={press(k.code)}
      title={`${k.label}: ${k.hint}`}
    >
      <kbd>{k.label}</kbd>
      <span>{k.hint}</span>
    </button>
  );
}

/** One gimbal's cluster, or nothing if this lesson teaches none of its keys. */
function Cluster({
  pad,
  side,
  keys,
  demoKeys,
  cue,
  pressed,
  press,
}: {
  pad: Pad;
  side: 'left' | 'right';
  keys: KeyHint[];
  demoKeys: readonly string[];
  cue: readonly string[];
  pressed: ReadonlySet<string>;
  press: (code: string) => (e: React.PointerEvent) => void;
}) {
  const mine = useMemo(() => keys.filter((k) => inPad(pad, k.code)), [keys, pad]);
  const { cols, slot } = padSlots(
    pad,
    mine.map((k) => k.code),
  );
  if (mine.length === 0) return null;
  return (
    <div
      className={`tr-keypad tr-keypad-${side}`}
      style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}
    >
      {mine.map((k) => (
        <Cap
          key={k.code}
          k={k}
          demoKeys={demoKeys}
          cue={cue}
          pressed={pressed}
          press={press}
          style={slot(k.code)}
        />
      ))}
    </div>
  );
}

/**
 * The two stick clusters, each under the gimbal it belongs to.
 *
 * Positioned by CSS against the same corners `StickIndicator` uses, so the caps
 * sit under the stick that flies them however tall the window is.
 */
export function KeyHints({
  keys,
  demoKeys,
  cue = [],
}: {
  keys: KeyHint[];
  demoKeys: readonly string[];
  cue?: readonly string[];
}) {
  const pressed = usePressedKeys();
  const press = usePointerPress();
  const shared = { keys, demoKeys, cue, pressed, press };
  return (
    <>
      <Cluster pad={LEFT_PAD} side="left" {...shared} />
      <Cluster pad={RIGHT_PAD} side="right" {...shared} />
    </>
  );
}

/**
 * Arm and Take Off, as the two command buttons in the middle.
 *
 * Everything that is not one of the eight stick keys lands here, so a lesson
 * that one day teaches another command gets a button for it without this having
 * to be told about it.
 */
export function KeyActions({
  keys,
  demoKeys,
  cue = [],
}: {
  keys: KeyHint[];
  demoKeys: readonly string[];
  cue?: readonly string[];
}) {
  const pressed = usePressedKeys();
  const press = usePointerPress();
  const actions = useMemo(
    () => keys.filter((k) => !inPad(LEFT_PAD, k.code) && !inPad(RIGHT_PAD, k.code)),
    [keys],
  );
  if (actions.length === 0) return null;
  return (
    <div className="tr-keys-actions">
      {actions.map((k) => (
        <Cap
          key={k.code}
          k={k}
          demoKeys={demoKeys}
          cue={cue}
          pressed={pressed}
          press={press}
          action
        />
      ))}
    </div>
  );
}
