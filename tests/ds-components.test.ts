// @vitest-environment jsdom
import { createElement as h, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  ButtonLegend,
  Checkbox,
  Modal,
  Progress,
  SegmentedControl,
  Select,
  Slider,
  StarRating,
  Tabs,
  TextInput,
} from '../src/renderer/ds';
import { clearTokenCache, token } from '../src/renderer/styles/tokens';

// The design-system components: what the Foundation v0.2 sheet promises about
// each one's states — glyph + word, keyboard paths, focus — checked in a DOM.

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
});

function key(target: Element, k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }),
    );
  });
}

function click(target: Element) {
  act(() => (target as HTMLElement).click());
}

const $ = (el: ParentNode, sel: string) => el.querySelector(sel) as HTMLElement;
const $$ = (el: ParentNode, sel: string) => [...el.querySelectorAll(sel)] as HTMLElement[];

/** A controlled component with its own state, as a screen would hold it. */
function Controlled<T>({
  initial,
  render,
}: {
  initial: T;
  render: (v: T, set: (v: T) => void) => ReactElement;
}) {
  const [v, set] = useState(initial);
  return render(v, set);
}

describe('Button', () => {
  it('renders the variant and the label', () => {
    const el = mount(h(Button, { variant: 'primary', children: 'Start lesson' }));
    expect($(el, 'button').className).toContain('ds-btn--primary');
    expect(el.textContent).toBe('Start lesson');
  });

  it('danger carries the ✕ glyph, not colour alone', () => {
    const el = mount(h(Button, { variant: 'danger', children: 'Delete save' }));
    expect($(el, '[data-icon="cross"]')).not.toBeNull();
  });

  it('locked says what unlocks it, stays focusable, and does nothing', () => {
    const onClick = vi.fn();
    const el = mount(
      h(Button, { locked: 'Finish lesson 2 to unlock', onClick, children: 'Start lesson' }),
    );
    const b = $(el, 'button');
    expect(b.textContent).toBe('Finish lesson 2 to unlock');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.hasAttribute('disabled')).toBe(false);
    click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'acro', label: 'Acro' },
    { value: 'angle', label: 'Angle' },
    { value: 'horizon', label: 'Horizon' },
  ] as const;

  function seg(onChange = vi.fn()) {
    return mount(
      h(Controlled<string>, {
        initial: 'angle',
        render: (v, set) =>
          h(SegmentedControl<string>, {
            label: 'Flight mode',
            options,
            value: v,
            onChange: (x: string) => {
              onChange(x);
              set(x);
            },
          }),
      }),
    );
  }

  it('marks the selected option with aria-checked, weight and ✓, and is one Tab stop', () => {
    const el = seg();
    const radios = $$(el, '[role="radio"]');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect($(radios[1], '[data-icon="check"]')).not.toBeNull();
    expect(radios[1].className).toContain('is-selected');
  });

  it('arrows move the selection and the focus, wrapping at the ends', () => {
    const onChange = vi.fn();
    const el = seg(onChange);
    key($(el, '[aria-checked="true"]'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('horizon');
    expect(document.activeElement?.textContent).toBe('Horizon');
    key(document.activeElement!, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('acro');
    key(document.activeElement!, 'End');
    expect(onChange).toHaveBeenLastCalledWith('horizon');
  });
});

describe('Tabs', () => {
  it('uses tab roles and moves with arrows', () => {
    const onChange = vi.fn();
    const el = mount(
      h(Tabs<string>, {
        label: 'Telemetry',
        options: [
          { value: 'data', label: 'Data' },
          { value: 'graphs', label: 'Graphs' },
        ],
        value: 'data',
        onChange,
      }),
    );
    expect($(el, '[role="tablist"]').getAttribute('aria-label')).toBe('Telemetry');
    expect($$(el, '[role="tab"]').map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
    ]);
    key($(el, '[role="tab"]'), 'ArrowLeft');
    expect(onChange).toHaveBeenCalledWith('graphs');
  });
});

describe('Checkbox', () => {
  it('toggles, and the ✓ glyph carries the state', () => {
    const el = mount(
      h(Controlled<boolean>, {
        initial: false,
        render: (v, set) =>
          h(Checkbox, { checked: v, onChange: set, children: 'Show hints during lessons' }),
      }),
    );
    const box = $(el, '[role="checkbox"]');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect($(el, '[data-icon="check"]')).toBeNull();
    click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect($(el, '[data-icon="check"]')).not.toBeNull();
  });
});

describe('Slider', () => {
  it('always prints its value, and says it to a screen reader the same way', () => {
    const el = mount(
      h(Slider, {
        label: 'Stick sensitivity',
        value: 45,
        onChange: () => {},
        min: 0,
        max: 100,
        format: (v: number) => `${v}%`,
        minLabel: 'Gentle',
        maxLabel: 'Twitchy',
      }),
    );
    expect($(el, 'output').textContent).toBe('45%');
    expect($(el, 'input').getAttribute('aria-valuetext')).toBe('45%');
    expect(el.textContent).toContain('Gentle');
    expect(el.textContent).toContain('Twitchy');
  });
});

describe('TextInput', () => {
  it('an error carries ✕ and a message, and is tied to the field', () => {
    const el = mount(
      h(TextInput, {
        label: 'Age',
        value: '9',
        onChange: () => {},
        error: 'PlutoSim is for ages 13 and up',
      }),
    );
    const input = $(el, 'input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const note = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(note.getAttribute('role')).toBe('alert');
    expect(note.textContent).toBe('PlutoSim is for ages 13 and up');
    expect($(note, '[data-icon="cross"]')).not.toBeNull();
  });

  it('the label names the field', () => {
    const el = mount(
      h(TextInput, {
        label: 'Pilot name',
        value: '',
        onChange: () => {},
        placeholder: 'e.g. Asha',
      }),
    );
    const input = $(el, 'input');
    expect($(el, `label[for="${input.id}"]`).textContent).toBe('Pilot name');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Select', () => {
  const options = [
    { value: 'en', label: 'English' },
    { value: 'hi', label: 'Hindi' },
    { value: 'mr', label: 'Marathi' },
  ];

  function select(onChange = vi.fn()) {
    const el = mount(h(Select<string>, { label: 'Language', options, value: 'en', onChange }));
    return { el, button: $(el, 'button'), onChange };
  }

  it('opens on the current value, marked ✓ and selected', () => {
    const { el, button } = select();
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const list = $(el, '[role="listbox"]');
    expect(document.activeElement).toBe(list);
    const opts = $$(el, '[role="option"]');
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect($(opts[0], '[data-icon="check"]')).not.toBeNull();
    expect(list.getAttribute('aria-activedescendant')).toBe(opts[0].id);
  });

  it('↓ then Enter picks, closes, and hands focus back to the button', () => {
    const { el, button, onChange } = select();
    click(button);
    key($(el, '[role="listbox"]'), 'ArrowDown');
    key($(el, '[role="listbox"]'), 'Enter');
    expect(onChange).toHaveBeenCalledWith('hi');
    expect($(el, '[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Esc closes without changing anything, and does not reach the screen behind', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    const { el, button, onChange } = select();
    click(button);
    key($(el, '[role="listbox"]'), 'ArrowDown');
    key($(el, '[role="listbox"]'), 'Escape');
    window.removeEventListener('keydown', behind);
    expect(onChange).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(behind).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  });
});

describe('StarRating, Progress, Badge', () => {
  it('stars come with words: "2 of 3 stars"', () => {
    const el = mount(h(StarRating, { earned: 2 }));
    expect($(el, '[role="img"]').getAttribute('aria-label')).toBe('2 of 3 stars');
    expect($$(el, '[data-icon="star"]')).toHaveLength(2);
    expect($$(el, '[data-icon="star-empty"]')).toHaveLength(1);
    expect(el.textContent).toBe('2 of 3 stars');
  });

  it('clamps stars to the total', () => {
    const el = mount(h(StarRating, { earned: 7, total: 3 }));
    expect($(el, '[role="img"]').getAttribute('aria-label')).toBe('3 of 3 stars');
  });

  it('progress reports its value', () => {
    const el = mount(h(Progress, { value: 1640, max: 2500, label: 'XP to Senior Pilot' }));
    const bar = $(el, '[role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('1640');
    expect(bar.getAttribute('aria-valuemax')).toBe('2500');
    expect($(el, '.ds-progress__fill').style.width).toBe('65.6%');
  });

  it('a badge pairs its tone with a glyph and a word', () => {
    const el = mount(h(Badge, { tone: 'caution', icon: 'warning', children: 'Low batt' }));
    expect($(el, '.ds-badge').className).toContain('ds-tone--caution');
    expect($(el, '[data-icon="warning"]')).not.toBeNull();
    expect(el.textContent).toBe('Low batt');
  });
});

describe('ButtonLegend', () => {
  const items = [
    { keys: ['Space'], pad: { label: 'A', shape: 'face' as const }, action: 'Arm' },
    { keys: ['W', 'S'], pad: { label: 'L', shape: 'stick' as const }, action: 'Throttle' },
  ];

  it('shows keycap + pad glyph + word', () => {
    const el = mount(h(ButtonLegend, { items }));
    expect($$(el, 'kbd').map((k) => k.textContent)).toEqual(['Space', 'A', 'W', 'S', 'L']);
    expect($(el, '.ds-key--face').textContent).toBe('A');
    expect($(el, '.ds-key--stick').textContent).toBe('L');
  });

  it('shows only the last-used device when asked', () => {
    const el = mount(h(ButtonLegend, { items, device: 'gamepad' }));
    expect($$(el, 'kbd').map((k) => k.textContent)).toEqual(['A', 'L']);
  });
});

describe('Modal', () => {
  function modal() {
    const keep = vi.fn();
    const end = vi.fn();
    const el = mount(
      h(
        Modal,
        {
          title: 'End flight?',
          tone: 'caution',
          safe: { label: 'Keep flying', onClick: keep },
          danger: { label: 'End', onClick: end },
        },
        'Motors stop and the run is not scored.',
      ),
    );
    return { el, keep, end, dialog: $(document.body, '[role="dialog"]') };
  }

  it('is a labelled modal dialog with ▲ on a caution title', () => {
    const { dialog } = modal();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'End flight?',
    );
    expect($(dialog, 'h2 [data-icon="warning"]')).not.toBeNull();
  });

  it('focus starts on the safe action', () => {
    modal();
    expect(document.activeElement?.textContent).toBe('Keep flying');
  });

  it('Esc takes the safe action', () => {
    const { dialog, keep, end } = modal();
    key(dialog, 'Escape', { code: 'Escape' });
    expect(keep).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it('Tab stays inside the card', () => {
    const { dialog } = modal();
    const buttons = $$(dialog, 'button');
    act(() => buttons[buttons.length - 1].focus());
    key(dialog, 'Tab', { code: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    key(dialog, 'Tab', { code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('holds the flight keys while it is up', () => {
    const flight = vi.fn();
    window.addEventListener('keydown', flight);
    modal();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    });
    window.removeEventListener('keydown', flight);
    expect(flight).not.toHaveBeenCalled();
  });

  it('gives focus back where it came from when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    modal();
    expect(document.activeElement).not.toBe(opener);
    act(() => root!.unmount());
    root = undefined;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('token()', () => {
  it('reads a CSS variable from :root, so canvas code shares tokens.css', () => {
    clearTokenCache();
    document.documentElement.style.setProperty('--signal', ' #ff7a1a ');
    expect(token('signal')).toBe('#ff7a1a');
    document.documentElement.style.removeProperty('--signal');
    clearTokenCache();
  });
});
