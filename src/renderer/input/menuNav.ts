import { useShellStore } from '../state/shellStore';

// ----------------------------------------------------------------------------
// Keyboard and gamepad navigation for the menus (the app shell), per the
// Phase 1 brief. Flight views never see any of it: they own every key.
//
//   arrows / D-pad / left stick   spatial move to the nearest element that way
//   Enter / A                     press the focused element
//   Esc / B                       from content or the top bar: to the active
//                                 sidebar item (App.tsx asks escapeToSidebar)
//   1–9                           open that sidebar item (not in a text field)
//
// The shell marks its three regions with data-nav-region="topbar" | "sidebar"
// | "content"; sidebar items carry data-nav-item and the active one
// aria-current="page"; a page marks its primary action with data-primary.
// ----------------------------------------------------------------------------

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[data-nav-item]',
].join(',');

/** Widgets that use the arrow keys themselves. */
const OWNS_ARROWS =
  '[role="radiogroup"], [role="tablist"], [role="listbox"], [role="menu"], [role="slider"], textarea, select, [contenteditable="true"]';

/** Input types whose arrows move a caret or a value, not the focus. */
const TEXTLIKE = new Set(['text', 'email', 'search', 'password', 'number', 'tel', 'url', 'range']);

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && TEXTLIKE.has(el.type) && el.type !== 'range';
}

/** Whether `el` keeps an arrow key for itself. Exported for tests. */
export function ownsArrows(el: Element | null, dir?: Direction): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement && TEXTLIKE.has(el.type)) return true;
  // A tab row keeps ← → for its tabs; ↑ ↓ move on to the panel and back.
  if ((dir === 'up' || dir === 'down') && el.closest(OWNS_ARROWS)?.getAttribute('role') === 'tablist') {
    return false;
  }
  return !!el.closest(OWNS_ARROWS);
}

/**
 * The candidate nearest `from` in `dir`, or null. Only candidates that lie
 * that way count. Those in its beam — overlapping it across the move, i.e. in
 * the same row for left/right or column for up/down — win over any outside
 * it, so a move stays in its row or column when it can; then the smallest gap.
 */
export function pickNearest<T>(
  from: Box,
  candidates: readonly { item: T; box: Box }[],
  dir: Direction,
): T | null {
  const fcx = (from.left + from.right) / 2;
  const fcy = (from.top + from.bottom) / 2;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const { item, box } of candidates) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    let gap: number;
    let side: number;
    let centre: number;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? cx <= fcx + 1 : cx >= fcx - 1) continue;
      gap = dir === 'right' ? box.left - from.right : from.left - box.right;
      side = Math.max(0, box.top - from.bottom, from.top - box.bottom);
      centre = Math.abs(cy - fcy);
    } else {
      if (dir === 'down' ? cy <= fcy + 1 : cy >= fcy - 1) continue;
      gap = dir === 'down' ? box.top - from.bottom : from.top - box.bottom;
      side = Math.max(0, box.left - from.right, from.left - box.right);
      centre = Math.abs(cx - fcx);
    }
    const outOfBeam = side > 0 ? 1e6 : 0;
    const score = outOfBeam + Math.max(0, gap) + side * 2 + centre * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/** Where navigation happens: inside an open modal if there is one, else the page. */
function navRoot(): ParentNode {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals.length ? modals[modals.length - 1] : document;
}

function visible(el: HTMLElement): boolean {
  // tabindex="-1" means "not a stop" — except a sidebar item, which is part of
  // the one roving stop the whole list makes.
  if (el.tabIndex < 0 && !el.hasAttribute('data-nav-item')) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(root: ParentNode = navRoot()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function region(el: Element | null): string | null {
  return el?.closest<HTMLElement>('[data-nav-region]')?.dataset.navRegion ?? null;
}

export function activeSidebarItem(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      '[data-nav-region="sidebar"] [data-nav-item][aria-current="page"]',
    ) ?? document.querySelector<HTMLElement>('[data-nav-region="sidebar"] [data-nav-item]')
  );
}

let lastInContent: WeakRef<HTMLElement> | null = null;

/** The page's primary action, else its first focusable element. */
export function focusPrimary(): boolean {
  const content = document.querySelector('[data-nav-region="content"]');
  if (!content) return false;
  const el = content.querySelector<HTMLElement>('[data-primary]') ?? focusables(content)[0];
  if (!el) return false;
  el.focus();
  return true;
}

/** Move focus one step in `dir`. Returns false when nothing lies that way. */
export function moveFocus(dir: Direction): boolean {
  const current = document.activeElement as HTMLElement | null;
  const root = navRoot();
  if (!current || current === document.body || !(root as Node).contains(current)) {
    // Nothing focused yet: start where Enter would matter most.
    return focusPrimary() || !!activeSidebarItem()?.focus();
  }
  const from = current.getBoundingClientRect();
  const candidates = focusables(root)
    .filter((el) => el !== current && !current.contains(el))
    .map((el) => ({ item: el, box: el.getBoundingClientRect() }));
  let next = pickNearest(from, candidates, dir);
  if (!next) return false;

  const fromRegion = region(current);
  const toRegion = region(next);
  if (toRegion !== fromRegion) {
    // Entering the sidebar lands on the active item; entering content returns
    // to the element last focused there.
    if (toRegion === 'sidebar') next = activeSidebarItem() ?? next;
    else if (toRegion === 'content') {
      const last = lastInContent?.deref();
      if (last && last.isConnected && visible(last)) next = last;
    }
  }
  next.focus();
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Esc from content or the top bar: focus goes to the active sidebar item.
 *  False when focus is already in the sidebar (or nowhere), so the caller can
 *  do its usual Esc. */
export function escapeToSidebar(): boolean {
  const r = region(document.activeElement);
  if (r !== 'content' && r !== 'topbar') return false;
  const item = activeSidebarItem();
  if (!item) return false;
  item.focus();
  return true;
}

export interface MenuNavOptions {
  /** True while a menu page is showing (no flight, lesson or mission). */
  isMenu: () => boolean;
  /** Open sidebar item n (1–9). */
  jump: (n: number) => void;
}

/** Keyboard side of menu navigation, plus input-device tracking. */
export function attachMenuNav({ isMenu, jump }: MenuNavOptions): () => void {
  const setInput = useShellStore.getState().setInput;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    setInput('keyboard');
    if (!isMenu() || e.defaultPrevented) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const target = document.activeElement;

    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && !isTextField(target) && !e.shiftKey) {
      e.preventDefault();
      jump(Number(digit[1]));
      return;
    }

    const dir = ARROWS[e.key];
    if (dir && !e.shiftKey && !ownsArrows(target, dir)) {
      if (moveFocus(dir)) e.preventDefault();
    }
  };

  const onPointer = (e: PointerEvent) => {
    // A pen or touch counts as a pointer too; a zero-movement event does not.
    if (e.type === 'pointermove' && e.movementX === 0 && e.movementY === 0) return;
    setInput('pointer');
  };

  const onFocusIn = (e: FocusEvent) => {
    const el = e.target as HTMLElement;
    if (region(el) === 'content') lastInContent = new WeakRef(el);
  };

  document.documentElement.dataset.input = useShellStore.getState().input;
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('focusin', onFocusIn);
  };
}

const ARROWS: Record<string, Direction | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
