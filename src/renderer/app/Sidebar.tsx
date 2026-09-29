import type { MouseEvent } from 'react';
import { useUiStore, type Section } from '../state/uiStore';
import { useAccountStore } from '../state/accountStore';
import { Keycap } from '../ds';
import { focusPrimary } from '../input/menuNav';

/** The sidebar in order. The number is the 1–8 key that opens it. Items from
 *  SECOND_GROUP on sit under the divider. */
export const NAV: readonly { n: number; id: Section; label: string }[] = [
  { n: 1, id: 'home', label: 'Home' },
  { n: 2, id: 'fly', label: 'Free Flight' },
  { n: 3, id: 'training', label: 'Training' },
  { n: 4, id: 'missions', label: 'Missions' },
  { n: 5, id: 'hangar', label: 'Hangar' },
  { n: 6, id: 'profile', label: 'Profile' },
  { n: 7, id: 'settings', label: 'Settings' },
  { n: 8, id: 'about', label: 'About' },
];

const SECOND_GROUP = 6;

/** The items a pilot can reach: Profile needs a signed-in profile. */
export function navItems(profiles: boolean) {
  return NAV.filter((item) => item.id !== 'profile' || profiles);
}

/** Open a sidebar page; from a key or pad press (not a pointer click) focus
 *  moves on to the page's primary action. */
export function openSection(id: Section, fromKeys: boolean): void {
  useUiStore.getState().setSection(id);
  if (fromKeys) requestAnimationFrame(() => focusPrimary());
}

/**
 * Eight items in two groups. Active is the only filled-light state: txt-hi fill,
 * weight 600, ● and aria-current="page". The list is ONE Tab stop — the active
 * item — and arrows move within it.
 */
export function Sidebar() {
  const section = useUiStore((s) => s.section);
  const profiles = useAccountStore((s) => s.status === 'signedIn');
  const items = navItems(profiles);
  const hasActive = items.some((i) => i.id === section);
  // Profile is hidden when signed out; the divider then sits above Settings.
  const groupStart = items.find((i) => i.n >= SECOND_GROUP)?.id;

  const onClick = (id: Section) => (e: MouseEvent<HTMLButtonElement>) =>
    // A click from Enter / Space / the pad's A has no pointer position.
    openSection(id, e.detail === 0);

  return (
    <nav className="sidenav" aria-label="Main" data-nav-region="sidebar" data-register="classroom">
      <ul className="sidenav__list">
        {items.map((item, i) => {
          const active = item.id === section;
          return (
            <li key={item.id} className={item.id === groupStart ? 'sidenav__group-start' : undefined}>
              <button
                type="button"
                data-nav-item
                className={active ? 'sidenav__item is-active' : 'sidenav__item'}
                aria-current={active ? 'page' : undefined}
                tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
                onClick={onClick(item.id)}
              >
                <Keycap>{item.n}</Keycap>
                <span className="sidenav__label">{item.label}</span>
                {active && (
                  <span className="sidenav__dot" aria-hidden="true">
                    ●
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
