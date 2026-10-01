// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AccountResult } from '@shared/backend/ipc';
import type { SessionSummary } from '@shared/backend/contract';
import {
  ERROR_TEXT,
  checkForm,
  errorPlace,
  firstName,
  fullKey,
  initials,
  keyNote,
  parseKeyInput,
} from '../src/renderer/app/activationKey';
import { normaliseActivationKey } from '../src/renderer/services/userService';
import { RANK_LADDER, rankForLevel, rankStanding } from '../src/renderer/app/pilotRank';
import {
  clock,
  dayMonth,
  formatDuration,
  longestFreeFlight,
  progressCounts,
  sessionResult,
  whenText,
} from '../src/renderer/app/profileFacts';
import {
  LoadingScreen,
  SLOW_AFTER_MS,
  TIPS,
  loadingFigures,
  timeLeftText,
} from '../src/renderer/app/LoadingScreen';
import { SignIn } from '../src/renderer/app/SignIn';
import { registerDrone } from '../src/renderer/plugins/registry';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { SignOutDialog } from '../src/renderer/app/ProfileScreen';
import { BootSplash } from '../src/renderer/app/BootSplash';
import { useAccountStore } from '../src/renderer/state/accountStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useResourceStore, type ResourceEntry } from '../src/renderer/assets/resourceTracker';

// Phase 2 of the redesign: boot splash, Activate / Sign in, loading, Profile and
// the sign-out dialog, against the Phase 2 brief and the game's real data.

// The turntable is a WebGL canvas; jsdom has none.
vi.mock('../src/renderer/app/HangarScene', () => ({ HangarScene: () => null }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const $ = (el: ParentNode, sel: string) => el.querySelector(sel) as HTMLElement;
const $$ = (el: ParentNode, sel: string) => [...el.querySelectorAll(sel)] as HTMLElement[];
const byLabel = (el: ParentNode, text: string) =>
  $(el, `#${CSS.escape([...el.querySelectorAll('label')].find((l) => l.textContent === text)!.htmlFor)}`) as HTMLInputElement;
const buttonNamed = (el: ParentNode, text: string) =>
  $$(el, 'button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
function type(input: HTMLInputElement, value: string) {
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function paste(input: HTMLInputElement, text: string) {
  act(() => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
    input.dispatchEvent(ev);
  });
}
async function submit(el: HTMLElement) {
  await act(async () => {
    $(el, 'form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
function key(target: EventTarget, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------

describe('the activation key field', () => {
  it('uppercases and puts the dash in the middle by itself', () => {
    const k = parseKeyInput('7kq4m2xp');
    expect(k).toMatchObject({ body: '7KQ4M2XP', display: '7KQ4-M2XP', complete: true, overflow: false });
    expect(parseKeyInput('7kq4').display).toBe('7KQ4'); // no trailing dash to backspace over
    expect(parseKeyInput('7kq4m').display).toBe('7KQ4-M');
  });

  it('ignores spaces and dashes wherever they are typed', () => {
    expect(parseKeyInput(' 7K-Q4 - M2 XP ').body).toBe('7KQ4M2XP');
    expect(keyNote(parseKeyInput(' 7K-Q4 - M2 XP '))).toBeNull();
  });

  it('takes a pasted whole key, prefix and all', () => {
    for (const raw of ['PLUTO-SIM-7KQ4-M2XP', 'pluto sim 7kq4 m2xp', 'PLUTOSIM7KQ4M2XP']) {
      expect(parseKeyInput(raw).body).toBe('7KQ4M2XP');
    }
  });

  it('removes other symbols and names them in the note', () => {
    const k = parseKeyInput('7K#Q4@M2#XP');
    expect(k.body).toBe('7KQ4M2XP');
    expect(k.removed).toEqual(['#', '@']);
    expect(keyNote(k)).toBe('Removed # @. Keys use only letters and numbers.');
  });

  it('keeps O, 0, I, 1 and L as typed and flags them, since no generated key has them', () => {
    const k = parseKeyInput('7KO4M2X0');
    expect(k.body).toBe('7KO4M2X0'); // not rewritten: a hand-made key may have them
    expect(k.unusual).toEqual(['O', '0']);
    expect(keyNote(k)).toBe('Keys never use O, 0, I, 1 or L. Check the O or 0 on your card.');
    expect(keyNote(parseKeyInput('ABCDEFG1'))).toMatch(/Check the 1 on your card/);
  });

  it('stops at 8 characters and says so', () => {
    const k = parseKeyInput('7KQ4M2XPZZ');
    expect(k.body).toBe('7KQ4M2XP');
    expect(k.overflow).toBe(true);
    expect(keyNote(k)).toMatch(/8 characters after PLUTO-SIM-/);
  });

  it('builds the key the backend expects, and the service normaliser agrees', () => {
    expect(fullKey('7KQ4M2XP')).toBe('PLUTO-SIM-7KQ4-M2XP');
    expect(normaliseActivationKey(fullKey('7KQ4M2XP'))).toBe('PLUTO-SIM-7KQ4-M2XP');
  });
});

describe('where an error is shown', () => {
  it('a wrong key goes under the key, a taken email under the email, offline is caution', () => {
    expect(errorPlace('KEY_NOT_FOUND')).toBe('key');
    expect(errorPlace('INVALID_CREDENTIALS')).toBe('key');
    expect(errorPlace('KEY_ALREADY_USED')).toBe('key');
    expect(errorPlace('EMAIL_ALREADY_REGISTERED')).toBe('email');
    expect(errorPlace('NETWORK')).toBe('offline');
    expect(errorPlace('SERVER_ERROR')).toBe('banner');
    expect(errorPlace('USER_INACTIVE')).toBe('banner');
  });

  it('every message names a fix', () => {
    for (const text of Object.values(ERROR_TEXT)) expect(text).toMatch(/\. [A-Z]|again|this build/);
  });

  it('missing fields are reported in field order', () => {
    expect(checkForm({ mode: 'activate', name: '', email: 'x', keyBody: 'ABC' }).map((p) => p.field)).toEqual([
      'name',
      'email',
      'key',
    ]);
    expect(checkForm({ mode: 'login', name: '', email: 'a@b.co', keyBody: 'ABCDEFGH' })).toEqual([]);
    expect(checkForm({ mode: 'login', name: '', email: 'a@b.co', keyBody: 'ABC' })[0].message).toMatch(
      /3 of 8 so far/,
    );
  });

  it('initials and first name for the avatar and the welcome', () => {
    expect(initials('Asha Rao')).toBe('AR');
    expect(initials('asha')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(firstName('Asha Rao')).toBe('Asha');
  });
});

// ---------------------------------------------------------------------------

type Send = (...args: unknown[]) => Promise<AccountResult>;

describe('the Activate / Sign in screen', () => {
  let activate: ReturnType<typeof vi.fn<Send>>;
  let login: ReturnType<typeof vi.fn<Send>>;

  beforeEach(() => {
    activate = vi.fn<Send>();
    login = vi.fn<Send>();
    useAccountStore.setState({
      status: 'signedOut',
      profile: null,
      needsSignIn: false,
      signInReason: null,
      activate: activate as never,
      login: login as never,
    });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPilot: null } });
  });

  it('always shows the Pluto X on the turntable, whichever drone the pilot has selected', () => {
    registerDrone(plutoDrone);
    registerDrone(guruDrone);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPilot: null, selectedDroneId: 'pluto' } });
    let el = mount(h(SignIn));
    expect($(el, '.acct__caption').textContent).toBe('Pluto X');
    act(() => root?.unmount());
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, lastPilot: null, selectedDroneId: 'pluto-guru' } });
    el = mount(h(SignIn));
    expect($(el, '.acct__caption').textContent).toBe('Pluto X');
  });

  it('starts on Activate with the focus on Name, and the key field shows the fixed prefix', () => {
    const el = mount(h(SignIn));
    expect($(el, '[role="radio"][aria-checked="true"]').textContent).toMatch('Activate');
    expect(document.activeElement).toBe(byLabel(el, 'Name'));
    expect($(el, '.ds-field__prefix').textContent).toBe('PLUTO-SIM-');
    expect(el.textContent).toContain('0 / 8');
  });

  it('counts to 8 and then says Enter activates', () => {
    const el = mount(h(SignIn));
    const k = byLabel(el, 'Activation key');
    type(k, '7kq4m2');
    expect(k.value).toBe('7KQ4-M2');
    expect(el.textContent).toContain('6 / 8');
    type(k, '7KQ4-M2XP');
    expect(el.textContent).toContain('8 / 8');
    expect(el.textContent).toContain('Key complete. Press Enter to activate.');
  });

  it('a pasted whole key replaces what was half typed', () => {
    const el = mount(h(SignIn));
    const k = byLabel(el, 'Activation key');
    type(k, '7K');
    paste(k, 'PLUTO-SIM-ABCD-EFGH');
    expect(k.value).toBe('ABCD-EFGH');
  });

  it('flags an O without changing it', () => {
    const el = mount(h(SignIn));
    const k = byLabel(el, 'Activation key');
    type(k, 'ABCO');
    expect(k.value).toBe('ABCO');
    expect(el.textContent).toContain('Keys never use O, 0, I, 1 or L. Check the O on your card.');
  });

  it('Enter with fields missing focuses the first bad one and sends nothing', async () => {
    const el = mount(h(SignIn));
    type(byLabel(el, 'Name'), 'Asha Rao');
    await submit(el);
    expect(activate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byLabel(el, 'Email'));
    expect(el.textContent).toContain('Enter your email');
  });

  function fillActivate(el: HTMLElement) {
    type(byLabel(el, 'Name'), 'Asha Rao');
    type(byLabel(el, 'Email'), 'asha@school.org');
    type(byLabel(el, 'Activation key'), '7KQ4M2XP');
  }

  it('sends the whole key, and a wrong key comes back under the key field with the focus', async () => {
    activate.mockResolvedValue({ success: false, code: 'KEY_NOT_FOUND', message: 'x' });
    const el = mount(h(SignIn));
    fillActivate(el);
    await submit(el);
    expect(activate).toHaveBeenCalledWith('Asha Rao', 'asha@school.org', 'PLUTO-SIM-7KQ4-M2XP', false);
    const k = byLabel(el, 'Activation key');
    expect(document.activeElement).toBe(k);
    expect(k.getAttribute('aria-invalid')).toBe('true');
    expect(el.textContent).toContain(ERROR_TEXT.KEY_NOT_FOUND);
  });

  it('offline is a caution banner, the values stay, and the button says Try again', async () => {
    activate.mockResolvedValue({ success: false, code: 'NETWORK', message: 'x' });
    const el = mount(h(SignIn));
    fillActivate(el);
    await submit(el);
    expect($(el, '.acct-banner--caution').textContent).toContain('No internet connection');
    expect($(el, '.acct-banner--caution').textContent).toContain('Everything you typed stays filled in');
    expect($(el, '.acct-banner--fail')).toBeNull();
    expect(byLabel(el, 'Email').value).toBe('asha@school.org');
    expect(byLabel(el, 'Activation key').value).toBe('7KQ4-M2XP');
    expect(document.activeElement?.textContent).toContain('Try again');
  });

  it('signed in on another computer: a banner names it, and continuing signs that one out', async () => {
    activate.mockResolvedValueOnce({
      success: false,
      code: 'SIGNED_IN_ELSEWHERE',
      message: 'x',
      deviceName: 'Lab-PC-4 (Windows)',
    });
    const el = mount(h(SignIn));
    fillActivate(el);
    await submit(el);
    expect($(el, '.acct-banner').textContent).toContain('Lab-PC-4 (Windows)');
    expect(document.activeElement?.textContent).toContain('Sign out of all devices');
    activate.mockResolvedValueOnce({ success: false, code: 'SERVER_ERROR', message: 'x' });
    await submit(el);
    expect(activate).toHaveBeenLastCalledWith('Asha Rao', 'asha@school.org', 'PLUTO-SIM-7KQ4-M2XP', true);
  });

  it('← → on the mode switch flips to Sign in, which has no Name field', () => {
    const el = mount(h(SignIn));
    const on = $(el, '[role="radio"][aria-checked="true"]');
    act(() => on.focus());
    key(on, 'ArrowRight');
    expect($(el, '[role="radio"][aria-checked="true"]').textContent).toMatch('Sign in');
    expect([...el.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['Email', 'Activation key']);
  });

  it('welcomes back the last pilot, focus on the key; Not you? brings the email field', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, lastPilot: { name: 'Asha Rao', email: 'asha@school.org' } },
    });
    login.mockResolvedValue({ success: false, code: 'INVALID_CREDENTIALS', message: 'x' });
    const el = mount(h(SignIn));
    expect($(el, 'h1').textContent).toBe('Welcome back, Asha');
    expect(el.textContent).toContain('asha@school.org · last pilot on this computer');
    expect(document.activeElement).toBe(byLabel(el, 'Activation key'));
    type(byLabel(el, 'Activation key'), '7KQ4M2XP');
    await submit(el);
    expect(login).toHaveBeenCalledWith('asha@school.org', 'PLUTO-SIM-7KQ4-M2XP', false);

    vi.useFakeTimers();
    act(() => buttonNamed(el, 'Not you?').click());
    act(() => vi.runAllTimers());
    expect(document.activeElement).toBe(byLabel(el, 'Email'));
    expect(byLabel(el, 'Email').value).toBe('');
  });

  it('a pilot whose sign-in expired is welcomed back too, with the reason', () => {
    useAccountStore.setState({
      status: 'signedIn',
      needsSignIn: true,
      signInReason: 'This profile is now signed in on Lab-PC-4.',
      profile: { name: 'Ravi K', email: 'ravi@x.org' } as never,
    });
    const el = mount(h(SignIn));
    expect($(el, 'h1').textContent).toBe('Welcome back, Ravi');
    expect(el.textContent).toContain('This profile is now signed in on Lab-PC-4.');
  });
});

// ---------------------------------------------------------------------------

describe('the rank ladder (the game’s own six ranks)', () => {
  it('keeps the ranks and their levels as they were', () => {
    expect(RANK_LADDER.map((r) => `${r.name} ${r.level}`)).toEqual([
      'Rookie 1',
      'Cadet 3',
      'Pilot 5',
      'Ace 8',
      'Elite 12',
      'Legend 20',
    ]);
    expect([1, 2, 3, 4, 5, 7, 8, 11, 12, 19, 20, 40].map(rankForLevel)).toEqual([
      'Rookie',
      'Rookie',
      'Cadet',
      'Cadet',
      'Pilot',
      'Pilot',
      'Ace',
      'Ace',
      'Elite',
      'Elite',
      'Legend',
      'Legend',
    ]);
  });

  it('turns levels into XP with the server’s step: level L starts at (L − 1) × step', () => {
    const s = rankStanding({ level: 4, levelPoints: { current: 140, next: 500 } });
    expect(s.totalXp).toBe(1640);
    expect(s).toMatchObject({ rank: 'Cadet', position: 2, of: 6 });
    expect(s.ladder.map((r) => r.xp)).toEqual([0, 1000, 2000, 3500, 5500, 9500]);
    expect(s.ladder.map((r) => r.state)).toEqual(['reached', 'current', 'ahead', 'ahead', 'ahead', 'ahead']);
    expect(s.next).toEqual({ name: 'Pilot', xpToGo: 360 });
    expect([s.intoRank, s.rankSpan]).toEqual([640, 1000]);
  });

  it('a new pilot is Rookie with the whole way to Cadet ahead; the top rank has no next', () => {
    expect(rankStanding({ level: 1, levelPoints: { current: 0, next: 500 } }).next).toEqual({
      name: 'Cadet',
      xpToGo: 1000,
    });
    const top = rankStanding({ level: 23, levelPoints: { current: 10, next: 500 } });
    expect(top).toMatchObject({ rank: 'Legend', position: 6, next: null });
  });

  it('follows a different step set on the server', () => {
    expect(rankStanding({ level: 3, levelPoints: { current: 0, next: 1000 } }).totalXp).toBe(2000);
  });
});

describe('Profile figures', () => {
  const s = (over: Partial<SessionSummary>) =>
    ({ flightType: 'TRAINING', result: 'SUCCESS', crashCount: 0, ...over }) as SessionSummary;

  it('results carry a glyph and a word', () => {
    expect(sessionResult(s({}))).toEqual({ tone: 'armed', icon: 'check', word: 'Passed' });
    expect(sessionResult(s({ result: 'FAILED' }))).toMatchObject({ icon: 'warning', word: 'Not passed' });
    expect(sessionResult(s({ result: 'FAILED', crashCount: 1 }))).toMatchObject({ icon: 'cross', word: 'Crashed' });
    expect(sessionResult(s({ result: 'FAILED', crashCount: 3 })).word).toBe('Crashed 3 times');
    expect(sessionResult(s({ result: 'ABORTED' })).word).toBe('Stopped early');
    expect(sessionResult(s({ result: 'IN_PROGRESS' })).word).toBe('Syncing');
    expect(sessionResult(s({ flightType: 'FREE_FLIGHT' })).word).toBe('Flown');
    expect(sessionResult(s({ flightType: 'FREE_FLIGHT', crashCount: 1 })).word).toBe('Crashed');
  });

  it('stars, lessons and missions are counted out of the real 15 lessons and 10 missions', () => {
    const modules = Array.from({ length: 15 }, (_, i) => ({
      trainingId: `t${i}`,
      trainingName: '',
      order: i + 1,
      sessions: i < 4 ? 1 : 0,
      completed: i < 3,
      bestStars: i < 3 ? i + 1 : 2,
    }));
    const missions = Array.from({ length: 10 }, (_, i) => ({
      missionId: `m${i}`,
      missionName: '',
      attempts: 1,
      sessions: 1,
      completed: i < 2 ? 3 : 0,
      bestScore: 0,
    }));
    // The backend's catalogue listed 6 missions on 2026-09-29; the totals are the game's.
    const sixListed = missions.slice(0, 6);
    expect(progressCounts({ training: { completed: 3, total: 15, modules }, missions: sixListed }, { lessons: 15, missions: 10 }).missionsOf).toBe(10);
    expect(progressCounts({ training: { completed: 3, total: 15, modules }, missions }, { lessons: 15, missions: 10 })).toEqual({
      stars: 6,
      starsOf: 45,
      lessons: 3,
      lessonsOf: 15,
      missions: 2,
      missionsOf: 10,
    });
  });

  it('flight times read as a clock, days as "Today" / "Yesterday" / "2 Sep"', () => {
    expect([48, 192, 340, 3940].map(clock)).toEqual(['0:48', '3:12', '5:40', '1:05:40']);
    const now = new Date(2026, 8, 29, 12, 0);
    expect(whenText(new Date(2026, 8, 29, 10, 42).toISOString(), now)).toBe('Today 10:42');
    expect(whenText(new Date(2026, 8, 28, 14, 5).toISOString(), now)).toBe('Yesterday 14:05');
    expect(whenText(new Date(2026, 8, 2, 9, 0).toISOString(), now)).toBe('2 Sep 09:00');
    expect(dayMonth(new Date(2026, 8, 18))).toBe('18 Sep');
  });

  it('the longest flight is the longest free flight only, by its duration', () => {
    const f = (flightType: SessionSummary['flightType'], duration: number, result: SessionSummary['result'] = 'SUCCESS') =>
      ({ flightType, duration, result }) as SessionSummary;
    expect(
      longestFreeFlight([f('FREE_FLIGHT', 158), f('MISSION', 900), f('FREE_FLIGHT', 334, 'FAILED'), f('TRAINING', 600)]),
    ).toBe(334);
    // A session still syncing does not count yet.
    expect(longestFreeFlight([f('FREE_FLIGHT', 40), f('FREE_FLIGHT', 999, 'IN_PROGRESS')])).toBe(40);
    expect(longestFreeFlight([f('MISSION', 300)])).toBeNull();
    expect(longestFreeFlight([])).toBeNull();
  });

  it('durations read as time', () => {
    expect([45, 600, 3600, 5400].map(formatDuration)).toEqual(['45s', '10m', '1h', '1h 30m']);
  });
});

describe('the sign-out dialog', () => {
  it('opens on Stay signed in; Esc stays', () => {
    const onStay = vi.fn();
    const onSignOut = vi.fn();
    const el = mount(h(SignOutDialog, { name: 'Asha Rao', email: 'asha@school.org', onStay, onSignOut }));
    expect($(el, '[role="dialog"] h2').textContent).toBe('Sign out, Asha?');
    expect(document.activeElement?.textContent).toBe('Stay signed in');
    key(document.activeElement!, 'Escape');
    expect(onStay).toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('keeps the pilot remembered unless Forget is ticked', () => {
    const onSignOut = vi.fn();
    const el = mount(h(SignOutDialog, { name: 'Asha', email: 'asha@school.org', onStay: vi.fn(), onSignOut }));
    const box = $(el, '[role="checkbox"]');
    expect(box.textContent).toContain('Forget asha@school.org on this computer');
    expect(box.getAttribute('aria-checked')).toBe('false');
    act(() => box.click());
    act(() => buttonNamed(el, 'Sign out').click());
    expect(onSignOut).toHaveBeenCalledWith(true);
  });

  it('traps Tab inside the card', () => {
    const el = mount(h(SignOutDialog, { name: 'A', email: 'a@b.co', onStay: vi.fn(), onSignOut: vi.fn() }));
    const buttons = $$(el, '[role="dialog"] button');
    act(() => buttons[buttons.length - 1].focus());
    const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      buttons[buttons.length - 1].dispatchEvent(ev);
    });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

// ---------------------------------------------------------------------------

const MB = 1048576;
const entry = (url: string, over: Partial<ResourceEntry>): ResourceEntry => ({
  url,
  label: url,
  loadedBytes: 0,
  totalBytes: 0,
  done: false,
  failed: false,
  ...over,
});

describe('the loading screen', () => {
  const entries = {
    'a.glb': entry('a.glb', { label: 'New York City', totalBytes: 100 * MB, loadedBytes: 100 * MB, done: true }),
    'b.glb': entry('b.glb', { label: 'Forest', totalBytes: 60 * MB, loadedBytes: 30 * MB }),
    'c.glb': entry('c.glb', { label: 'Classroom' }),
    'd.glb': entry('d.glb', { label: 'Racing drone', totalBytes: 2 * MB, failed: true }),
    'task:audio': entry('task:audio', { label: 'sound engine', totalBytes: 4 * MB }),
    'task:streets': entry('task:streets', { label: 'city streets', totalBytes: 4 * MB }),
  };

  it('each row has a state glyph word and a size; warm-up work has no size', () => {
    const f = loadingFigures(entries);
    expect(f.rows.map((r) => [r.label, r.state, r.size])).toEqual([
      ['New York City', 'done', '100 MB'],
      ['Forest', 'loading', '60 MB'],
      ['Classroom', 'waiting', null],
      ['Racing drone', 'failed', '2.0 MB'],
      ['Sound engine', 'loading', null], // the first unfinished task is the one running
      ['City streets', 'waiting', null],
    ]);
    expect([f.loadedMb, f.totalMb, f.done, f.failed]).toEqual([130, 162, 1, 1]);
  });

  it('the time left waits for enough to go on, then rounds', () => {
    expect(timeLeftText(0.02, 5000)).toBe('working out the time left');
    expect(timeLeftText(0.5, 1000)).toBe('working out the time left');
    expect(timeLeftText(0.5, 4000)).toBe('a few seconds left');
    expect(timeLeftText(0.25, 10_000)).toBe('about 30 s left');
    expect(timeLeftText(0.1, 20_000)).toBe('about 3 min left');
    expect(timeLeftText(1, 20_000)).toBeNull();
  });

  it('shows percent and MB, cycles tips, and adds a ▲ note after 30 s', () => {
    vi.useFakeTimers();
    useResourceStore.setState({ entries });
    const el = mount(h(LoadingScreen));
    expect($(el, 'h1').textContent).toBe('Preparing PlutoSim');
    expect($(el, '.loading__pct').textContent).toMatch(/\d+%130 of 162 MB/);
    expect($$(el, '.loading__row')).toHaveLength(6);
    expect($(el, '.loading__tip-count').textContent).toBe(`1 of ${TIPS.length}`);
    act(() => buttonNamed(el, 'Next tip').click());
    expect(el.textContent).toContain(TIPS[1].text);
    expect($(el, '.loading__note')).toBeNull();
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS + 1000));
    expect($(el, '.loading__note').textContent).toContain('Slower than usual');
  });
});

describe('the boot splash', () => {
  it('names the app and shows the app’s own version', async () => {
    vi.stubGlobal('api', { appInfo: () => Promise.resolve({ version: '1.4.2' }) });
    const el = mount(h(BootSplash));
    await act(async () => {});
    expect(el.textContent).toContain('PlutoSim');
    expect(el.textContent).toContain('Flight Simulator by Drona Aviation');
    expect($(el, '.boot__version').textContent).toBe('v1.4.2');
    expect($(el, '.boot__line')).not.toBeNull();
  });
});

describe('settings', () => {
  it('remember no pilot by default, and never a key', () => {
    expect(DEFAULT_SETTINGS.lastPilot).toBeNull();
  });
});
