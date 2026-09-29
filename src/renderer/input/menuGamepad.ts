import { captureState, isCalibrating } from './gamepad';
import { focusPrimary, moveFocus, type Direction } from './menuNav';
import { useShellStore } from '../state/shellStore';

// ----------------------------------------------------------------------------
// A gamepad in the menus: D-pad or left stick moves the focus, A presses, B is
// Esc, LB / RB are Q / E (the Hangar's previous / next drone).
//
// Standard-mapping pads only (Xbox, PlayStation, Switch Pro through the
// browser's standard layout). A radio transmitter reports no standard mapping
// and flies through gamepad.ts as before; it has no buttons worth a menu.
//
// The flight loop in gamepad.ts is separate and untouched. Its button actions
// only have a handler while a flight view is mounted, so the two never both act
// on one press: this one runs only while `isMenu()` says a menu is showing.
// ----------------------------------------------------------------------------

const A = 0;
const B = 1;
const LB = 4;
const RB = 5;
const DPAD: [number, Direction][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
const STICK = 0.6;
/** Held direction: first repeat after this long, then every REPEAT_MS. */
const FIRST_REPEAT_MS = 400;
const REPEAT_MS = 140;

/** One tick's direction from the D-pad or left stick, or null. Exported for tests. */
export function directionOf(pad: Pick<Gamepad, 'buttons' | 'axes'>): Direction | null {
  for (const [i, dir] of DPAD) if (pad.buttons[i]?.pressed) return dir;
  const [x = 0, y = 0] = pad.axes;
  if (Math.abs(x) < STICK && Math.abs(y) < STICK) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

function key(code: string, key: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }),
  );
}

export function attachMenuGamepad(isMenu: () => boolean): () => void {
  let raf = 0;
  let prev: boolean[] = [];
  let heldDir: Direction | null = null;
  let nextRepeat = 0;

  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.mapping === 'standard');
    if (!pad) {
      prev = [];
      heldDir = null;
      return;
    }
    const buttons = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => buttons[i] && !prev[i];
    const dir = directionOf(pad);
    const busy =
      !isMenu() || isCalibrating() || !!captureState().action || !!captureState().channel;

    if (!busy) {
      const setInput = useShellStore.getState().setInput;
      if (dir) {
        if (dir !== heldDir) {
          nextRepeat = now + FIRST_REPEAT_MS;
          setInput('gamepad');
          moveFocus(dir);
        } else if (now >= nextRepeat) {
          nextRepeat = now + REPEAT_MS;
          moveFocus(dir);
        }
      }
      if (edge(A)) {
        setInput('gamepad');
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body) el.click();
        else focusPrimary();
      }
      if (edge(B)) {
        setInput('gamepad');
        key('Escape', 'Escape');
      }
      if (edge(LB)) key('KeyQ', 'q');
      if (edge(RB)) key('KeyE', 'e');
    }
    heldDir = dir;
    prev = buttons;
  };

  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
