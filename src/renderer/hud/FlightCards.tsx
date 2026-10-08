import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useFlightStore } from '../state/flightStore';
import { useModalKeyLock } from '../input/useModalKeyLock';
import { playClick } from '../audio/sfx';
import { Button, Icon, Keycap } from '../ds';
import { crashLine, crashTip, exitAsk, pauseLines, type PauseContext } from './cockpitFacts';
import { useSettingsStore } from '../state/settingsStore';
import { activeInputSource } from '../input/controls';
import { gamepadConnected } from '../input/gamepad';

// ----------------------------------------------------------------------------
// The cards a flight stops on (Phase 6): one pause card for Free Flight, lessons
// and missions — only its context line changes — the exit question behind its
// Exit, and the crash card. Each holds the modal key lock while it is up, so
// nothing behind it is flown, and keeps focus inside itself (Tab, ↑ ↓ ← →; a
// pad's D-pad arrives as the same arrows, see menuGamepad.ts).
//
// Esc is not handled here: App's one Esc handler resumes a paused flight, which
// is also what "Keep flying" does, so the key means the same thing on the pause
// card and on the question.
// ----------------------------------------------------------------------------

function focusables(card: HTMLElement | null): HTMLElement[] {
  return Array.from(card?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
}

/** Move focus `by` buttons inside the card, wrapping. */
function stepFocus(card: HTMLElement | null, by: number): void {
  const list = focusables(card);
  if (list.length === 0) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  list[(at + by + list.length) % list.length].focus();
}

const ARROW_STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** Arrows for the key lock's `onKey`. The lock is a capture listener on the
 *  window and stops every key but Esc and Tab before it reaches the card, so
 *  the arrows have to be answered there, not by the card's own onKeyDown.
 *  ← → too: the crash card and the exit question set their buttons in a row. */
function arrowKeys(card: RefObject<HTMLElement | null>, e: KeyboardEvent): boolean {
  const by = ARROW_STEP[e.key];
  if (!by) return false;
  stepFocus(card.current, by);
  return true;
}

/** Tab stays inside the card (the lock lets Tab through to here). */
function trapKeys(card: RefObject<HTMLElement | null>, e: ReactKeyboardEvent) {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  stepFocus(card.current, e.shiftKey ? -1 : 1);
}

/** Focus `ref` while the card shows; hand focus back where it was after. */
function useFocusOnShow(ref: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, [ref, key]);
}

export interface PauseCardProps {
  context: PauseContext;
  /** Back to the start: R in Free Flight and lessons, the mission's restart. */
  onRestart: () => void;
  /** Free Flight only — leaving the view would end a lesson or a mission. */
  onSettings?: () => void;
  onExit: () => void;
}

/** Shown while the flight is paused. */
export function PauseCard({ context, onRestart, onSettings, onExit }: PauseCardProps) {
  const paused = useFlightStore((s) => s.paused);
  if (!paused) return null;
  return (
    <PauseCardBody
      context={context}
      onRestart={onRestart}
      onSettings={onSettings}
      onExit={onExit}
    />
  );
}

function PauseCardBody({ context, onRestart, onSettings, onExit }: PauseCardProps) {
  const asking = useFlightStore((s) => s.exitAsk);
  const cardRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const lines = pauseLines(context);
  // Free Flight has nothing to lose, so its Exit leaves at once.
  const ask = context.kind === 'free' ? null : exitAsk(context.kind);

  const resume = () => {
    playClick();
    useFlightStore.getState().togglePause();
  };

  // P resumes, as it paused; R restarts, as it does in flight; ↑ ↓ move.
  useModalKeyLock(true, cardRef, (e) => {
    if (arrowKeys(cardRef, e)) return true;
    if (e.code === 'KeyP') {
      resume();
      return true;
    }
    if (e.code === 'KeyR' && !asking) {
      onRestart();
      return true;
    }
    return false;
  });
  useFocusOnShow(firstRef, asking);

  const exit = () => {
    playClick();
    if (ask && !asking) useFlightStore.getState().setExitAsk(true);
    else onExit();
  };

  return (
    <div className="fcard-scrim" data-register="classroom">
      <div
        ref={cardRef}
        className="fcard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fcard-title"
        onKeyDown={(e) => trapKeys(cardRef, e)}
      >
        <p className="fcard__context">{lines.context}</p>
        {asking && ask ? (
          <>
            <h2 id="fcard-title" className="fcard__title">
              {ask.title}
            </h2>
            <p className="fcard__line">{ask.body}</p>
            <div className="fcard__row">
              <Button ref={firstRef} onClick={resume}>
                Keep flying <Keycap>Esc</Keycap>
              </Button>
              <button type="button" className="fcard__exit" onClick={onExit}>
                Exit
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="fcard-title" className="fcard__title">
              Paused
            </h2>
            <p className="fcard__line">{lines.line}</p>
            <div className="fcard__list">
              <Button ref={firstRef} variant="primary" onClick={resume}>
                Resume <Keycap>Esc</Keycap>
              </Button>
              <Button
                onClick={() => {
                  playClick();
                  onRestart();
                }}
              >
                Restart
              </Button>
              {onSettings && (
                <Button
                  onClick={() => {
                    playClick();
                    onSettings();
                  }}
                >
                  Settings
                </Button>
              )}
              <Button onClick={exit}>Exit Menu</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export interface CrashCardProps {
  /** "Free Flight · Classroom · Pluto", "Module 3 · Hover · Fly step". */
  context: string;
  /** When it happened, as the view's clock reads: "3:12", "12.4 s". */
  when: string;
  onReset: () => void;
}

/** Shown after a crash, until the drone is reset. */
export function CrashCard({ context, when, onReset }: CrashCardProps) {
  const crashed = useFlightStore((s) => s.crashed);
  const paused = useFlightStore((s) => s.paused);
  // The pause card goes over it when both are up; one card at a time.
  if (!crashed || paused) return null;
  return <CrashCardBody context={context} when={when} onReset={onReset} />;
}

function CrashCardBody({ context, when, onReset }: CrashCardProps) {
  const gamepad = useSettingsStore((s) => s.settings.gamepad);
  const controller = activeInputSource() === 'gamepad' && gamepadConnected() && gamepad.enabled;
  const binding = controller ? gamepad.bindings.reset : undefined;
  const resetLabel = binding
    ? binding.t === 'b'
      ? `Button ${binding.i}`
      : `Axis ${binding.a} ${binding.p === 'hi' ? 'high' : binding.p === 'lo' ? 'low' : 'centre'}`
    : 'R';
  const speed = useFlightStore((s) => s.crashSpeed);
  const at = useFlightStore((s) => s.crashAt);
  const cardRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  useModalKeyLock(true, cardRef, (e) => {
    if (arrowKeys(cardRef, e)) return true;
    if (e.code === 'KeyR') {
      onReset();
      return true;
    }
    if (e.code === 'KeyP') {
      useFlightStore.getState().togglePause();
      return true;
    }
    return false;
  });
  useFocusOnShow(resetRef, null);

  return (
    <div className="fcard-scrim" data-register="classroom">
      <div
        ref={cardRef}
        className="fcard fcard--crash"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fcard-crash"
        onKeyDown={(e) => trapKeys(cardRef, e)}
      >
        <p className="fcard__context">{context}</p>
        <h2 id="fcard-crash" className="fcard__title fcard__title--fail">
          <Icon name="cross" />
          <span>Drone crashed</span>
        </h2>
        <p className="fcard__line">
          {crashLine({ when, altitude: at?.altitude ?? 0, speed })} The drone is on the ground.
          Reset puts it back on its start pad.
        </p>
        <p className="fcard__tip">{crashTip(speed)}</p>
        {controller && (
          <div className="fcard__respawn" role="status">
            <div>
              Press <Keycap>{resetLabel}</Keycap> to respawn
            </div>
            {!binding && <small>No controller reset button assigned. Use keyboard R.</small>}
          </div>
        )}
        <div className="fcard__row">
          <Button
            onClick={() => {
              playClick();
              useFlightStore.getState().togglePause();
            }}
          >
            Pause menu
          </Button>
          <Button
            ref={resetRef}
            variant="primary"
            onClick={() => {
              playClick();
              onReset();
            }}
          >
            Reset to start pad <Keycap>{resetLabel}</Keycap>
          </Button>
        </div>
      </div>
    </div>
  );
}
