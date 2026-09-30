// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Divider,
  Icon,
  Keycap,
  Panel,
  Register,
  SegmentedControl,
  StatTile,
  Tabs,
  type IconName,
} from '../src/renderer/ds';
import { COLOR_TOKENS } from '../src/renderer/styles/tokens';

// Phase 0 — Foundation, the parts of the design system the Phase 0 suite
// (ds-components, design-tokens, token-check) does not render yet: keycaps in
// all three pad shapes, stat tiles, panels, the icon set that stands in for the
// glyphs Geist lacks, registers, and Home / End in the choice groups.

let root: Root | undefined;
let host: HTMLElement | undefined;
function mount(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const tokensCss = readFileSync(join(process.cwd(), 'src/renderer/styles/tokens.css'), 'utf8');

describe('tokens', () => {
  it('every colour token the canvas helper knows is defined in tokens.css', () => {
    for (const t of COLOR_TOKENS) expect(tokensCss).toMatch(new RegExp(`--${t}:\\s*#`));
  });

  it('has one type role per brief role, each a full font shorthand on Geist', () => {
    const roles = ['display', 'h1', 'h2', 'h3', 'h4', 'title', 'body-lg', 'body', 'body-sm', 'link', 'label', 'caption'];
    for (const r of roles) expect(tokensCss).toMatch(new RegExp(`--type-${r}:\\s*\\d+ \\d+px/[\\d.]+ var\\(--font-sans\\)`));
  });

  it('spacing is a 4 px scale', () => {
    const steps = [...tokensCss.matchAll(/--space-(\d+):\s*(\d+)px/g)].map((m) => [+m[1], +m[2]]);
    expect(steps.length).toBeGreaterThanOrEqual(8);
    for (const [n, px] of steps) expect(px).toBe(n * 4);
  });
});

describe('Keycap', () => {
  it('a keyboard key is a plain cap; pad buttons take their shape; pressed is marked', () => {
    const el = mount(
      h('div', null, [
        h(Keycap, { key: 'k', children: 'ESC' }),
        h(Keycap, { key: 'f', pad: 'face', children: 'A' }),
        h(Keycap, { key: 's', pad: 'shoulder', children: 'RB' }),
        h(Keycap, { key: 't', pad: 'stick', pressed: true, children: 'L' }),
      ]),
    );
    const caps = [...el.querySelectorAll('kbd')];
    expect(caps.map((c) => c.className)).toEqual([
      'ds-key',
      'ds-key ds-key--face',
      'ds-key ds-key--shoulder',
      'ds-key ds-key--stick is-pressed',
    ]);
    expect(caps.map((c) => c.textContent)).toEqual(['ESC', 'A', 'RB', 'L']);
  });
});

describe('StatTile', () => {
  it('label, value with unit, a status with glyph + word in its tone, and a note', () => {
    const el = mount(
      h(StatTile, {
        label: 'Battery',
        value: '3.52',
        unit: 'V',
        status: { tone: 'caution', icon: 'warning', text: 'LOW' },
        note: 'under load',
      }),
    );
    expect(el.querySelector('.ds-label')!.textContent).toBe('Battery');
    expect(el.querySelector('.ds-stat__value')!.textContent).toBe('3.52 V');
    const st = el.querySelector('.ds-stat__status')!;
    expect(st.className).toContain('ds-tone--caution');
    expect(st.querySelector('[data-icon="warning"]')).not.toBeNull();
    expect(st.textContent).toBe('LOW');
    expect(el.querySelector('.ds-stat__note')!.textContent).toBe('under load');
  });

  it('with no status or note, only label and value', () => {
    const el = mount(h(StatTile, { label: 'Flights', value: 12 }));
    expect(el.querySelector('.ds-stat__status')).toBeNull();
    expect(el.querySelector('.ds-stat__note')).toBeNull();
    expect(el.querySelector('.ds-stat__value')!.textContent).toBe('12');
  });
});

describe('Panel and Divider', () => {
  it('a panel names itself and its rate; without either it has no header', () => {
    let el = mount(h(Panel, { title: 'Attitude', meta: '100 Hz', children: h('p', null, 'body') }));
    expect(el.querySelector('.ds-panel__title')!.textContent).toBe('Attitude');
    expect(el.querySelector('.ds-panel__meta')!.textContent).toBe('100 Hz');
    act(() => root!.unmount());
    el = mount(h(Panel, { children: h('p', null, 'body') }));
    expect(el.querySelector('.ds-panel__head')).toBeNull();
    expect(el.textContent).toBe('body');
  });

  it('a divider is a rule', () => {
    const el = mount(h(Divider));
    expect(el.querySelector('hr.ds-divider')).not.toBeNull();
  });
});

describe('Icon', () => {
  // The glyphs Geist does not have (✓ ✕ ★ ☆ ▸ ▾ ▴ ◆ ■) and the state marks.
  const names: IconName[] = [
    'check', 'cross', 'star', 'star-empty', 'play', 'pause', 'caret-down', 'caret-up',
    'chevron', 'warning', 'down', 'dot', 'ring', 'diamond', 'square',
  ];
  it('draws every glyph as a decorative, currentColor SVG', () => {
    const el = mount(h('div', null, names.map((n) => h(Icon, { key: n, name: n }))));
    const svgs = [...el.querySelectorAll('svg')];
    expect(svgs.map((s) => s.getAttribute('data-icon'))).toEqual(names);
    for (const s of svgs) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.childElementCount).toBeGreaterThan(0);
      expect(s.innerHTML).toContain('currentColor');
      expect(s.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it('keeps a caller class beside its own', () => {
    const el = mount(h(Icon, { name: 'check', className: 'x' }));
    expect(el.querySelector('svg')!.getAttribute('class')).toBe('ds-icon x');
  });
});

describe('Register', () => {
  it('puts a subtree in the cockpit or classroom register', () => {
    const el = mount(h(Register, { kind: 'cockpit', id: 'r', children: 'x' }));
    const div = el.querySelector('#r')!;
    expect(div.getAttribute('data-register')).toBe('cockpit');
    expect(div.className).toContain('ds-register');
  });
});

describe('choice groups: Home and End', () => {
  const options = [
    { value: 'a', label: 'Angle' },
    { value: 'b', label: 'Horizon' },
    { value: 'c', label: 'Acro' },
  ] as const;

  for (const [name, C, role] of [
    ['SegmentedControl', SegmentedControl, 'radiogroup'],
    ['Tabs', Tabs, 'tablist'],
  ] as const) {
    it(`${name}: End picks the last, Home the first`, () => {
      const onChange = vi.fn();
      const el = mount(h(C as typeof SegmentedControl<string>, { options, value: 'b', onChange, label: 'Mode' }));
      const group = el.querySelector(`[role="${role}"]`)!;
      act(() => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
      act(() => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
      expect(onChange.mock.calls.map((c) => c[0])).toEqual(['c', 'a']);
      expect(group.getAttribute('aria-label')).toBe('Mode');
    });
  }
});
