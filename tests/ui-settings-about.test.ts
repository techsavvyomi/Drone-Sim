// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAMEPAD, DEFAULT_SETTINGS, HUD_WIDGETS } from '@shared/types';
import { SETTINGS_TABS, SettingsPanel, zoomText } from '../src/renderer/app/SettingsPanel';
import { GamepadSetup } from '../src/renderer/app/GamepadSetup';
import { AboutScreen } from '../src/renderer/app/AboutScreen';
import { Tabs } from '../src/renderer/ds';
import { ownsArrows } from '../src/renderer/input/menuNav';
import { beginBindAction, cancelCapture, gamepadLive } from '../src/renderer/input/gamepad';
import { KEY_GROUPS } from '../src/renderer/hud/cockpitFacts';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { useShellStore } from '../src/renderer/state/shellStore';
import { declsFor, parseCss, stylesheet } from './helpers/css';

// Settings and About on the design system. No PDF draws either page, so these
// pin what was decided (2026-09-30): five tabs (Video · Audio · Controls · Rates ·
// Interface), About only as its own sidebar page, every control a Phase 0
// part writing the same setting it always did, the key list = KEY_GROUPS, the
// HUD list = HUD_WIDGETS, and the old index.css rules gone.

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const $$ = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const byText = (root: ParentNode, sel: string, text: string) =>
  $$(root, sel).find((e) => e.textContent?.trim() === text)!;
const press = (code: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(-1).toLowerCase(), bubbles: true, cancelable: true, ...init }));
  });
/** A range input's value, set the way a drag does, so React's onChange fires. */
function slide(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** The slider whose label reads `label`, and its printed value. */
function slider(el: ParentNode, label: string) {
  const box = $$(el, '.ds-slider').find((s) => s.querySelector('label')?.textContent === label)!;
  return { input: box.querySelector('input')!, value: () => box.querySelector('output')!.textContent };
}
/** Let the monitor's requestAnimationFrame loop run a few frames. */
const frames = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
const tab = (el: ParentNode, name: string) => click(byText(el, '[role="tab"]', name));
const settings = () => useSettingsStore.getState().settings;
const save = vi.fn(async () => {});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  save.mockClear();
  (window as unknown as { api: unknown }).api = { saveSettings: save };
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      hud: { ...DEFAULT_SETTINGS.hud },
      gamepad: { ...DEFAULT_GAMEPAD, axes: { ...DEFAULT_GAMEPAD.axes }, bindings: { ...DEFAULT_GAMEPAD.bindings } },
    },
  });
  useShellStore.getState().setContext('');
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  document.body.innerHTML = '';
  cancelCapture();
});

describe('Settings: five tabs, About not among them', () => {
  it('Video · Audio · Controls · Rates · Interface, Video first, in the classroom register', () => {
    const el = mount(h(SettingsPanel));
    expect($$(el, '[role="tab"]').map((t) => t.textContent)).toEqual(['Video', 'Audio', 'Controls', 'Rates', 'Interface']);
    expect(SETTINGS_TABS.map((t) => t.value)).toEqual(['video', 'audio', 'controls', 'rates', 'interface']);
    expect(el.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Video');
    expect(el.querySelector('.settings')!.getAttribute('data-register')).toBe('classroom');
    expect(el.querySelector('h1')!.textContent).toBe('Settings');
  });

  it('no About tab and no About content inside Settings', () => {
    const el = mount(h(SettingsPanel));
    for (const t of SETTINGS_TABS) {
      tab(el, t.label);
      expect(el.querySelector('.about__rows')).toBeNull();
    }
    const src = readFileSync(join(process.cwd(), 'src/renderer/app/SettingsPanel.tsx'), 'utf8');
    expect(src).not.toMatch(/from '\.\/About/);
  });

  it('no emoji icons on any tab, and no back button (Esc / B belong to the shell)', () => {
    const el = mount(h(SettingsPanel));
    for (const t of SETTINGS_TABS) {
      tab(el, t.label);
      expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(byText(el, 'button', '‹ Back')).toBeUndefined();
  });

  it('the status bar names the open tab, and is cleared on leaving', () => {
    const el = mount(h(SettingsPanel));
    expect(useShellStore.getState().context).toBe('Settings · Video');
    tab(el, 'Controls');
    expect(useShellStore.getState().context).toBe('Settings · Controls');
    act(() => root!.unmount());
    root = undefined;
    expect(useShellStore.getState().context).toBe('');
  });

  it('Q / E (LB / RB on a pad) step the tabs, wrapping', () => {
    const el = mount(h(SettingsPanel));
    const current = () => el.querySelector('[role="tab"][aria-selected="true"]')!.textContent;
    press('KeyE');
    expect(current()).toBe('Audio');
    press('KeyQ');
    press('KeyQ');
    expect(current()).toBe('Interface');
    press('KeyE');
    expect(current()).toBe('Video');
    press('KeyE', { metaKey: true });
    expect(current()).toBe('Video');
  });

  it('Q / E leave the tab alone while a pad bind is listening (it would end the bind)', () => {
    const el = mount(h(SettingsPanel));
    tab(el, 'Controls');
    act(() => beginBindAction('arm'));
    press('KeyE');
    expect(el.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Controls');
  });

  it('the tab row answers ← → only; ↑ ↓ go on to the panel (menu navigation)', () => {
    const onChange = vi.fn();
    const el = mount(
      h(Tabs<string>, {
        label: 'Settings',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        value: 'a',
        onChange,
      }),
    );
    const first = el.querySelector<HTMLElement>('[role="tab"]')!;
    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(onChange).not.toHaveBeenCalled();
    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(ownsArrows(first, 'down')).toBe(false);
    expect(ownsArrows(first, 'up')).toBe(false);
    expect(ownsArrows(first, 'left')).toBe(true);
    // A radio group (segmented control) still keeps every arrow.
    const radio = document.createElement('div');
    radio.setAttribute('role', 'radiogroup');
    radio.appendChild(document.createElement('button'));
    document.body.appendChild(radio);
    expect(ownsArrows(radio.firstElementChild, 'down')).toBe(true);
  });
});

describe('Settings → Video', () => {
  it('graphics quality is a segmented control writing `graphics`, with a line per preset', () => {
    const el = mount(h(SettingsPanel));
    const group = el.querySelector('[role="radiogroup"][aria-label="Graphics quality"]')!;
    expect($$(group, '[role="radio"]').map((r) => r.textContent)).toEqual(['Low', 'Medium', 'High']);
    const note = () => el.querySelector('.settings__note')!.textContent;
    expect(note()).toMatch(/Bloom and vignette/);
    click(byText(group, '[role="radio"]', 'High'));
    expect(settings().graphics).toBe('high');
    expect(group.querySelector('[aria-checked="true"]')!.textContent).toBe('High');
    expect(group.querySelector('[aria-checked="true"] [data-icon="check"]')).not.toBeNull();
    expect(note()).toMatch(/SMAA/);
    click(byText(group, '[role="radio"]', 'Low'));
    expect(settings().graphics).toBe('low');
    expect(save).toHaveBeenCalled();
  });

  it('autoGraphics is a ✓ checkbox writing `autoGraphics`', () => {
    const el = mount(h(SettingsPanel));
    const box = $$(el, '[role="checkbox"]').find((b) => /automatically/.test(b.textContent ?? ''))!;
    expect(box.getAttribute('aria-checked')).toBe(String(DEFAULT_SETTINGS.autoGraphics));
    click(box);
    expect(settings().autoGraphics).toBe(!DEFAULT_SETTINGS.autoGraphics);
    expect(box.getAttribute('aria-checked')).toBe(String(!DEFAULT_SETTINGS.autoGraphics));
  });

  it('camera distance is a slider writing `cameraZoom`, its value printed in words and ×', () => {
    const el = mount(h(SettingsPanel));
    const s = slider(el, 'Chase camera distance');
    expect(s.input.min).toBe('0.5');
    expect(s.input.max).toBe('2.5');
    slide(s.input, 2.2);
    expect(settings().cameraZoom).toBe(2.2);
    expect(s.value()).toBe('Very far · 2.20×');
    expect(zoomText(0.8)).toBe('Close · 0.80×');
    expect(zoomText(1)).toBe('Medium · 1.00×');
    expect(zoomText(1.8)).toBe('Far · 1.80×');
  });
});

describe('Settings → Audio', () => {
  it('master and motor volume write `volume` / `engineVolume`, printed as %', () => {
    const el = mount(h(SettingsPanel));
    tab(el, 'Audio');
    const master = slider(el, 'Master volume');
    const motor = slider(el, 'Motor volume');
    slide(master.input, 0.45);
    slide(motor.input, 0.3);
    expect(settings().volume).toBe(0.45);
    expect(settings().engineVolume).toBe(0.3);
    expect(master.value()).toBe('45 %');
    expect(motor.value()).toBe('30 %');
  });
});

describe('Settings → Controls', () => {
  it('has no physics difficulty control: nothing ever read it', () => {
    const el = mount(h(SettingsPanel));
    tab(el, 'Controls');
    expect(el.querySelector('[aria-label="Physics difficulty"]')).toBeNull();
    expect(el.textContent).not.toContain('Physics difficulty');
  });

  it('the key list is KEY_GROUPS, group by group, on keycaps', () => {
    const el = mount(h(SettingsPanel));
    tab(el, 'Controls');
    const groups = $$(el, '.settings__keygroup');
    expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual(KEY_GROUPS.map((g) => g.title));
    groups.forEach((g, i) => {
      const rows = $$(g, '.settings__key').map((r) => [r.querySelector('kbd.ds-key')!.textContent, r.querySelector('span')!.textContent]);
      expect(rows).toEqual(KEY_GROUPS[i].rows.map(([k, d]) => [k, d]));
    });
  });

  it('the gamepad setup sits inside Controls', () => {
    const el = mount(h(SettingsPanel));
    expect(el.querySelector('.gp')).toBeNull();
    tab(el, 'Controls');
    expect(el.querySelector('.gp')).not.toBeNull();
  });
});

describe('Settings → Interface', () => {
  it('every HUD widget, where it sits, and "n of 13 on" that follows the switches', () => {
    const el = mount(h(SettingsPanel));
    tab(el, 'Interface');
    const boxes = $$(el, '.settings__widgets [role="checkbox"]');
    expect(boxes.map((b) => b.querySelector('.ds-check__label')!.textContent)).toEqual(HUD_WIDGETS.map((w) => w.label));
    expect(boxes.map((b) => b.querySelector('.ds-check__hint')!.textContent)).toEqual(HUD_WIDGETS.map((w) => w.where));
    const meta = () => el.querySelector('.settings__card-meta')!.textContent;
    const on = HUD_WIDGETS.filter((w) => DEFAULT_SETTINGS.hud[w.key]).length;
    expect(meta()).toBe(`${on} of ${HUD_WIDGETS.length} on`);
    const first = HUD_WIDGETS[0].key;
    click(boxes[0]);
    expect(settings().hud[first]).toBe(!DEFAULT_SETTINGS.hud[first]);
    expect(meta()).not.toBe(`${on} of ${HUD_WIDGETS.length} on`);
    click(byText(el, 'button', 'Reset to default'));
    expect(settings().hud).toEqual(DEFAULT_SETTINGS.hud);
    expect(meta()).toBe(`${on} of ${HUD_WIDGETS.length} on`);
  });
});

describe('Gamepad setup on the design system (logic unchanged)', () => {
  beforeEach(() => {
    gamepadLive.index = null;
    gamepadLive.axes = [];
    gamepadLive.buttons = [];
  });

  it('input On / Off is a segmented control writing `gamepad.enabled`', () => {
    const el = mount(h(GamepadSetup));
    const group = el.querySelector('[role="radiogroup"][aria-label="Gamepad input"]')!;
    click(byText(group, '[role="radio"]', 'Off'));
    expect(settings().gamepad.enabled).toBe(false);
    click(byText(group, '[role="radio"]', 'On'));
    expect(settings().gamepad.enabled).toBe(true);
  });

  it('with no controller: "Searching", and Detect / Bind / Calibrate need one', () => {
    const el = mount(h(GamepadSetup));
    expect(el.querySelector('.gp__device .ds-badge')!.textContent).toBe('Searching');
    for (const b of [...$$(el, 'button').filter((b) => ['Detect', 'Bind', 'Calibrate'].includes(b.textContent ?? ''))]) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('Invert flips the channel, with aria-pressed and ✓ carrying the state', () => {
    const el = mount(h(GamepadSetup));
    const row = $$(el, '.gp__axis')[0];
    const channel = (Object.keys(DEFAULT_GAMEPAD.axes) as (keyof typeof DEFAULT_GAMEPAD.axes)[])[0];
    const was = DEFAULT_GAMEPAD.axes[channel].invert ?? false;
    const invert = () => byText(row, 'button', 'Invert');
    click(invert());
    expect(settings().gamepad.axes[channel].invert).toBe(!was);
    expect(invert().getAttribute('aria-pressed')).toBe(String(!was));
    expect(!!invert().querySelector('[data-icon="check"]')).toBe(!was);
  });

  it('deadzone, expo and sensitivity write the gamepad config and print their value', () => {
    const el = mount(h(GamepadSetup));
    const dz = slider(el, 'Deadzone');
    const expo = slider(el, 'Expo');
    const sens = slider(el, 'Sensitivity');
    slide(dz.input, 0.12);
    slide(expo.input, 0);
    slide(sens.input, 1.25);
    expect(settings().gamepad).toMatchObject({ deadzone: 0.12, expo: 0, sensitivity: 1.25 });
    expect(dz.value()).toBe('12 %');
    expect(expo.value()).toBe('Linear');
    expect(sens.value()).toBe('1.25×');
  });

  it('Bind listens (caution, "Press or flick…"), a second press cancels, Clear removes it', async () => {
    gamepadLive.index = 0;
    gamepadLive.axes = [0, 0, 0, 0];
    const el = mount(h(GamepadSetup));
    await frames();
    const row = () => $$(el, '.gp__bind')[0];
    click(byText(row(), 'button', 'Bind'));
    const listening = byText(row(), 'button', 'Press or flick…');
    expect(listening.classList.contains('is-listening')).toBe(true);
    click(listening);
    expect(byText(row(), 'button', 'Bind').classList.contains('is-listening')).toBe(false);
    click(byText(row(), 'button', 'Clear'));
    expect(row().querySelector('.gp__binding')!.textContent).toBe('-');
  });

  it('the monitor lights the pressed button through the keycap state', async () => {
    gamepadLive.index = 0;
    gamepadLive.id = 'Test pad';
    gamepadLive.axes = [0, 0, 0, 0];
    gamepadLive.buttons = [false, true, false];
    const el = mount(h(GamepadSetup));
    await frames(); // the monitor sees 3 buttons; React renders the keycaps
    await frames(); // the next frames light the pressed one
    const caps = $$(el, '.gp__buttons .ds-key');
    expect(caps.map((c) => c.textContent)).toEqual(['0', '1', '2']);
    expect(caps.map((c) => c.classList.contains('is-pressed'))).toEqual([false, true, false]);
    expect(el.querySelector('.gp__device .ds-badge')!.textContent).toBe('Connected');
  });
});

describe('About: its own page', () => {
  const info = {
    name: 'PlutoSim',
    version: '0.2.0',
    platform: 'darwin' as const,
    electron: '43.2.0',
    commit: 'abc1234',
    builtAt: '2026-09-30T09:00:00.000Z',
    packaged: false,
    osVersion: '15.0',
    arch: 'arm64',
    chrome: '140.0.1',
    node: '22.20.0',
  };
  let openExternal: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openExternal = vi.fn(async () => {});
    writeText = vi.fn(async () => {});
    (window as unknown as { api: unknown }).api = { appInfo: async () => info, openExternal, saveSettings: save };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  async function mountAbout() {
    const el = mount(h(AboutScreen));
    await act(async () => {});
    return el;
  }

  it('a panel of the build and system details, in the classroom register', async () => {
    const el = await mountAbout();
    expect(el.querySelector('h1')!.textContent).toBe('About');
    expect(el.querySelector('[data-register="classroom"]')).not.toBeNull();
    const rows = Object.fromEntries($$(el, '.about__row').map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent]));
    expect(rows).toMatchObject({ Software: 'PlutoSim', Version: 'v0.2.0', Build: 'abc1234 (development)', 'Operating system': 'macOS 15.0' });
    expect(el.querySelector('.ds-panel__meta')!.textContent).toBe('v0.2.0');
  });

  it('Report a bug is the primary action and opens the support email with the details', async () => {
    const el = await mountAbout();
    const report = byText(el, 'button', 'Report a bug');
    expect(report.classList.contains('ds-btn--primary')).toBe(true);
    expect(report.hasAttribute('data-primary')).toBe(true);
    click(report);
    const url = openExternal.mock.calls[0][0] as string;
    expect(url).toMatch(/^mailto:support@plutodrones\.com\?subject=/);
    expect(decodeURIComponent(url)).toMatch(/Version: v0\.2\.0/);
  });

  it('no Electron, Chromium or Node.js row — on the page, in the copy, in the email', async () => {
    const el = await mountAbout();
    const labels = $$(el, '.about__row dt').map((d) => d.textContent);
    for (const gone of ['Electron', 'Chromium', 'Node.js']) expect(labels).not.toContain(gone);
    expect(labels[labels.length - 1]).toBe('Graphics');
    await act(async () => byText(el, 'button', 'Copy details').click());
    expect(writeText.mock.calls[0][0]).not.toMatch(/Electron|Chromium|Node\.js/);
    click(byText(el, 'button', 'Report a bug'));
    expect(decodeURIComponent(openExternal.mock.calls[0][0] as string)).not.toMatch(/Electron|Chromium|Node\.js/);
  });

  it('Copy details copies the rows and reads "✓ Copied"', async () => {
    const el = await mountAbout();
    await act(async () => byText(el, 'button', 'Copy details').click());
    expect(writeText.mock.calls[0][0]).toMatch(/^Software: PlutoSim\nVersion: v0\.2\.0/);
    const done = byText(el, 'button', 'Copied');
    expect(done.querySelector('[data-icon="check"]')).not.toBeNull();
  });
});

describe('Styling: settings.css on tokens, the old index.css rules gone', () => {
  const index = readFileSync(join(process.cwd(), 'src/renderer/index.css'), 'utf8');
  const css = stylesheet('settings.css');

  it('settings.css is loaded, and writes no colour value or font name of its own', () => {
    const main = readFileSync(join(process.cwd(), 'src/renderer/main.tsx'), 'utf8');
    expect(main).toMatch(/import '\.\/styles\/settings\.css';/);
    const raw = readFileSync(join(process.cwd(), 'src/renderer/styles/settings.css'), 'utf8');
    expect(raw).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(raw).not.toMatch(/Geist|Saira|system-ui|sans-serif/);
  });

  it('pages sit in the shell padding, cards wear the panel wash', () => {
    expect(declsFor(css, '.settings').padding).toBe('var(--shell-pad)');
    expect(declsFor(css, '.settings__card').background).toBe('var(--wash)');
    expect(declsFor(css, '.settings__card')['border-radius']).toBe('var(--radius-card)');
  });

  it('the listening pulse stops for reduced motion', () => {
    const reduced = parseCss(readFileSync(join(process.cwd(), 'src/renderer/styles/settings.css'), 'utf8'));
    const media = reduced.find((r) => r.media.includes('prefers-reduced-motion') && r.selectors.includes('.gp .ds-btn.is-listening'));
    expect(media?.decls.animation).toBe('none');
  });

  it('no old settings / about / gamepad rules left in index.css', () => {
    for (const cls of [
      'settings-shell',
      'settings-tab',
      'settings-pane',
      'settings-h3',
      'setting-row',
      'setting-value',
      'segmented',
      'hud-toggle',
      'key-grid',
      'key-row',
      'about-card',
      'about-row',
      'about-actions',
      'about-note',
      'back-btn',
      'btn-sm',
      'gp-',
      'section-note',
    ]) {
      expect(index, cls).not.toContain(`.${cls}`);
    }
  });
});
