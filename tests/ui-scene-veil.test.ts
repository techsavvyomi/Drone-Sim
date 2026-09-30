// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SceneVeil, useVeilProgress } from '../src/renderer/scene/SceneReady';
import { declsFor, parseCss, stylesheet } from './helpers/css';

// The veil over a map while its shaders warm ("Getting the arena ready",
// spinner and percentage), moved onto the design system (2026-09-30): laid out
// like Phase 2's Loading screen, styled from tokens in cockpit.css, the old
// index.css rules gone. The percentage itself is scene-veil.test.ts.

let root: Root | undefined;
let host: HTMLElement | undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function mountVeil(label = 'Getting the city ready') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(h(SceneVeil, { label })));
  return host;
}

describe('scene veil markup', () => {
  it('spinner, the map named, the percentage and a ds progress bar that agree', () => {
    const el = mountVeil();
    // A warming stage opened after the veil: 95 % + part of the warm frames.
    act(() => useVeilProgress.setState({ stage: 'warming', shaders: 1, frames: 3, since: performance.now() + 1 }));
    expect(el.querySelector('.scene-veil')!.getAttribute('role')).toBe('status');
    expect(el.querySelector('.scene-veil__spinner')!.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.scene-veil__label')!.textContent).toBe('Getting the city ready');
    const bar = el.querySelector('.ds-progress[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Getting the city ready');
    const pct = el.querySelector('.scene-veil__pct')!.textContent!;
    expect(pct).toMatch(/^\d{1,3}%$/);
    expect(bar.getAttribute('aria-valuenow')).toBe(pct.replace('%', ''));
    expect((el.querySelector('.ds-progress__fill') as HTMLElement).style.width).toBe(`${pct.replace('%', '')}%`);
  });
});

describe('scene veil styling', () => {
  const cockpit = stylesheet('cockpit.css');
  const index = readFileSync(join(process.cwd(), 'src/renderer/index.css'), 'utf8');

  it('an opaque ink-950 cover in the app font, label and figure from the type roles', () => {
    const veil = declsFor(cockpit, '.scene-veil');
    expect(veil.background).toBe('var(--ink-950)');
    expect(veil.position).toBe('absolute');
    expect(veil.inset).toBe('0');
    expect(veil['font-family']).toBe('var(--font-sans)');
    expect(declsFor(cockpit, '.scene-veil__label').font).toBe('var(--type-title)');
    expect(declsFor(cockpit, '.scene-veil__pct').font).toBe('var(--type-h4)');
  });

  it('the spinner is tokens only, and slows for reduced motion', () => {
    const spin = declsFor(cockpit, '.scene-veil__spinner');
    expect(spin.border).toBe('2px solid var(--ink-700)');
    expect(spin['border-top-color']).toBe('var(--signal)');
    const reduced = parseCss(readFileSync(join(process.cwd(), 'src/renderer/styles/cockpit.css'), 'utf8')).find(
      (r) => r.media.includes('prefers-reduced-motion') && r.selectors.includes('.scene-veil__spinner'),
    );
    expect(reduced?.decls['animation-duration']).toBe('2.4s');
  });

  it('no veil rules or old hexes left in index.css', () => {
    expect(index).not.toContain('scene-veil');
    expect(index).not.toMatch(/#0b1119|#4da3ff|#1e2a3a|#93a4bb|#cfe0f5/i);
  });
});
