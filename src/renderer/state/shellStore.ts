import { create } from 'zustand';

// State the app shell keeps about the person at the keyboard, not the flight.

/** The device used last. Hover only shows while it is the pointer, so a stale
 *  hover never reads as a second active item once keys or a pad take over. */
export type InputDevice = 'pointer' | 'keyboard' | 'gamepad';

interface ShellState {
  input: InputDevice;
  /** The legend's device: the pointer counts as keyboard (they share a desk). */
  legendDevice: 'keyboard' | 'gamepad';
  /** One line of page context for the status bar ("Drone 2 of 3 · Pluto Guru"). */
  context: string;
  /** A bold word or two beside the page name ("New pilot"). */
  contextTag: string;
  setInput: (device: InputDevice) => void;
  setContext: (context: string, tag?: string) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  input: 'pointer',
  legendDevice: 'keyboard',
  context: '',
  contextTag: '',
  setInput: (input) =>
    set((s) => {
      const legendDevice = input === 'gamepad' ? 'gamepad' : 'keyboard';
      if (s.input === input && s.legendDevice === legendDevice) return s;
      if (typeof document !== 'undefined') document.documentElement.dataset.input = input;
      return { input, legendDevice };
    }),
  setContext: (context, contextTag = '') =>
    set((s) => (s.context === context && s.contextTag === contextTag ? s : { context, contextTag })),
}));

/** `--dev-fps` on the command line reaches the page as `?devFps=1`. */
export function devFpsEnabled(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return new URLSearchParams(search).get('devFps') === '1';
}
