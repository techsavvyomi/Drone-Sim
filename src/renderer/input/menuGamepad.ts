import { captureState, isCalibrating } from './gamepad';
import { focusPrimary, moveFocus, type Direction } from './menuNav';
import { useShellStore } from '../state/shellStore';

// ----------------------------------------------------------------------------
// A gamepad in the menus: D-pad or left stick moves the focus, A presses, B is
// Esc, LB / RB are Q / E (the Hangar's previous / next drone).
//
// And on the cards a flight stops on (pause, exit question, crash): the D-pad
// or stick steps the card's buttons — sent as arrow keys, which the card's
// modal key lock answers — A presses the focused one, B is Esc. Without this a
// pad could pause a flight but never reach Resume.
//
// Standard-mapping pads only (Xbox, PlayStation, Switch Pro through the
// browser's standard layout). A radio transmitter reports no standard mapping
// and flies through gamepad.ts as before; it has no buttons worth a menu.
//
// The flight loop in gamepad.ts is separate and untouched. Its button actions
// only have a handler while a flight view is mounted, so the two never both act
// on one press: this one runs only while `isMenu()` says a menu is showing, or
// `isCard()` says a flight card is up (a paused flight answers no pad action
// but camera and reset; a crashed one cannot take off).
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

const ARROW: Record<Direction, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

function key(code: string, key: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }),
  );
}

export function attachMenuGamepad(
  isMenu: () => boolean,
  isCard: () => boolean = () => false,
): () => void {
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
    const menu = isMenu();
    const card = !menu && isCard();
    const busy =
      !(menu || card) || isCalibrating() || !!captureState().action || !!captureState().channel;
    const move = (d: Direction) => (card ? key(ARROW[d], ARROW[d]) : moveFocus(d));

    if (!busy) {
      const setInput = useShellStore.getState().setInput;
      if (dir) {
        if (dir !== heldDir) {
          nextRepeat = now + FIRST_REPEAT_MS;
          setInput('gamepad');
          move(dir);
        } else if (now >= nextRepeat) {
          nextRepeat = now + REPEAT_MS;
          move(dir);
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
      if (menu && edge(LB)) key('KeyQ', 'q');
      if (menu && edge(RB)) key('KeyE', 'e');
    }
    heldDir = dir;
    prev = buttons;
  };

  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
