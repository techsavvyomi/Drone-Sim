import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// tokens.css against the manager's Foundation v0.2 sheet (Phase 0 PDF).
//
// The colours are checked by value, and every contrast ratio the sheet prints
// is recomputed from them with the WCAG 2.x formula — so a colour edited in
// tokens.css that breaks a text-contrast promise fails here, not in a
// classroom on a projector.

const CSS = readFileSync(new URL('../src/renderer/styles/tokens.css', import.meta.url), 'utf8');

/** The declarations of the first block that `selector` opens. */
function block(selector: string): Record<string, string> {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  const body = CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('\n}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const root = block(':root');

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(root[a]), luminance(root[b])].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The sheet prints two decimals; allow its rounding. */
function expectRatio(fg: string, bg: string, printed: number) {
  expect(Math.abs(contrast(fg, bg) - printed), `${fg} on ${bg}`).toBeLessThanOrEqual(0.011);
}

describe('colour tokens', () => {
  it('match the Foundation v0.2 palette', () => {
    expect(root).toMatchObject({
      'ink-950': '#0e0f0e',
      'ink-900': '#141614',
      'ink-800': '#1c1f1d',
      'ink-700': '#262a27',
      line: '#343935',
      'txt-hi': '#f2f4f1',
      'txt-mid': '#b9bfb8',
      'txt-low': '#8a918a',
      signal: '#ff7a1a',
      'signal-d': '#d9620e',
      armed: '#3adb8a',
      caution: '#ffc24b',
      fail: '#ff5a5f',
      plot: '#6fc3ff',
    });
  });

  it.each([
    ['txt-hi', 16.44, 15.03],
    ['txt-mid', 9.71, 8.87],
    ['txt-low', 5.63, 5.14],
    ['signal', 6.97, 6.37],
    ['signal-d', 4.94, 4.52],
    ['armed', 10.12, 9.25],
    ['caution', 11.32, 10.35],
    ['fail', 5.96, 5.45],
    ['plot', 9.46, 8.65],
    ['line', 1.54, 1.41],
  ])('%s has the printed contrast on ink-900 and ink-800', (tok, on900, on800) => {
    expectRatio(tok, 'ink-900', on900);
    expectRatio(tok, 'ink-800', on800);
  });

  it('every text and state colour reads at 4.5:1 or better on both panels', () => {
    for (const tok of [
      'txt-hi',
      'txt-mid',
      'txt-low',
      'signal',
      'signal-d',
      'armed',
      'caution',
      'fail',
      'plot',
    ]) {
      expect(contrast(tok, 'ink-900'), tok).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tok, 'ink-800'), tok).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on a fill is ink-950 and meets the printed ratios', () => {
    expect(root['on-fill']).toBe('var(--ink-950)');
    expectRatio('ink-950', 'signal', 7.36);
    expectRatio('ink-950', 'signal-d', 5.22);
    expectRatio('ink-950', 'fail', 6.29);
    expectRatio('ink-950', 'armed', 10.68);
  });

  it('keeps the borderline the sheet warns about: txt-low on ink-700 is exactly 4.50', () => {
    expectRatio('txt-low', 'ink-700', 4.5);
  });

  it('derives the scrim and the quiet bar from ink-950, not a copy of it', () => {
    expect(root.scrim).toBe('color-mix(in srgb, var(--ink-950) 80%, transparent)');
    expect(root['quiet-bar']).toBe('color-mix(in srgb, var(--ink-950) 82%, transparent)');
    expect(root.wash).toBe('linear-gradient(180deg, var(--ink-800), var(--ink-900))');
  });
});

describe('type tokens', () => {
  it.each([
    ['display', '652 80px/1'],
    ['h1', '652 56px/1'],
    ['h2', '652 44px/1.13'],
    ['h3', '652 32px/1.13'],
    ['h4', '652 24px/1.25'],
    ['title', '600 20px/1.3'],
    ['body-lg', '300 20px/1.38'],
    ['body', '456 16px/1.38'],
    ['body-sm', '456 14px/1.43'],
    ['link', '600 16px/1.38'],
    ['label', '600 12px/1.33'],
    ['caption', '456 12px/1.33'],
  ])('%s is %s in the sans family', (role, spec) => {
    expect(root[`type-${role}`]).toBe(`${spec} var(--font-sans)`);
  });

  it('uses Geist with tabular figures, and Geist Mono for the key', () => {
    expect(root['font-sans'].startsWith("'Geist'")).toBe(true);
    expect(root['font-mono'].startsWith("'Geist Mono'")).toBe(true);
    expect(root['font-numeric']).toBe("'tnum' 1");
  });

  it('bundles both font files and the OFL licence (the CSP blocks fetched fonts)', () => {
    const urls = [...CSS.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      expect(
        existsSync(new URL(u, new URL('../src/renderer/styles/tokens.css', import.meta.url))),
        u,
      ).toBe(true);
    }
    expect(existsSync(new URL('../src/assets/fonts/Geist-OFL.txt', import.meta.url))).toBe(true);
    // Variable faces: one file covers 100–900, so 652 and 456 are exact.
    expect(CSS.match(/font-weight: 100 900;/g)).toHaveLength(2);
  });
});

describe('registers', () => {
  it('cockpit: 30 px controls, 8 px corners, uppercase, on ink-950', () => {
    expect(block("[data-register='cockpit']")).toMatchObject({
      'control-h': '30px',
      'radius-control': '8px',
      'radius-card': '8px',
      'label-case': 'uppercase',
      surface: 'var(--ink-950)',
    });
  });

  it('classroom: 44 px pills, 20 px cards, sentence case, on ink-800', () => {
    expect(block("[data-register='classroom']")).toMatchObject({
      'control-h': '44px',
      'radius-control': '999px',
      'radius-card': '20px',
      'label-case': 'none',
      surface: 'var(--ink-800)',
    });
  });

  it('the default (no register) is classroom', () => {
    const classroom = block("[data-register='classroom']");
    for (const k of Object.keys(classroom)) expect(root[k], k).toBe(classroom[k]);
  });

  it('focus is a 2 px signal ring with a 2 px offset', () => {
    expect(root['focus-width']).toBe('2px');
    expect(root['focus-offset']).toBe('2px');
    expect(root['focus-color']).toBe('var(--signal)');
  });
});
