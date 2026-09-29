import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { check, findViolations } from '../scripts/check-tokens.mjs';

// The rule that makes tokens.css the one place a colour lives:
// scripts/check-tokens.mjs fails on a colour or font name anywhere else in UI code.

const REPO = new URL('..', import.meta.url).pathname;

describe('check-tokens on the repo', () => {
  it('passes: no new UI file writes a colour or a font name', () => {
    const out = execFileSync('node', ['scripts/check-tokens.mjs'], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('check-tokens: ok');
  });

  it('holds the design system itself to the rule (no legacy pass)', () => {
    const { offenders } = check({ root: REPO });
    for (const file of offenders.keys()) {
      expect(
        file.startsWith('src/renderer/ds/') || file.startsWith('src/renderer/styles/'),
        file,
      ).toBe(false);
    }
  });
});

describe('findViolations', () => {
  it.each([
    ['color: #ff7a1a;', 'hex colour'],
    ['background: #fff;', 'hex colour'],
    ["const c = '#0e0f0eCC';", 'hex colour'],
    ['border: 1px solid rgba(0, 0, 0, 0.4);', 'colour function'],
    ['color: hsl(20 100% 55%);', 'colour function'],
    ["font-family: 'Inter', sans-serif;", 'font name'],
    ["style={{ fontFamily: 'Geist' }}", 'font name'],
  ])('flags %s', (line, rule) => {
    expect(findViolations(line)).toEqual([expect.objectContaining({ rule })]);
  });

  it.each([
    'color: var(--signal);',
    'font-family: var(--font-sans);',
    'font-family: inherit;',
    'font: var(--type-body);',
    "document.getElementById('root')",
    '/* was #ff7a1a before the redesign */',
    '// the old accent, #38bdf8',
    '#root { height: 100%; }',
    "href='#about'",
  ])('allows %s', (line) => {
    expect(findViolations(line)).toEqual([]);
  });
});

describe('check-tokens rules', () => {
  let root = '';
  const write = (rel: string, text: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    root = mkdtempSync(join(tmpdir(), 'tokens-'));
    write('src/renderer/styles/tokens.css', ':root { --signal: #ff7a1a; }');
    write('src/renderer/styles/ds.css', '.b { color: var(--signal); }');
  }

  it('lets tokens.css alone hold colours', () => {
    fixture();
    expect(check({ root, legacy: [] }).errors).toEqual([]);
  });

  it('fails a new component that writes its own colour, naming file and line', () => {
    fixture();
    write('src/renderer/ds/Chip.tsx', "const x = 1;\nconst s = { color: '#ff7a1a' };\n");
    const { errors } = check({ root, legacy: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^src\/renderer\/ds\/Chip\.tsx:2 {2}hex colour/);
  });

  it('skips a listed legacy file, and fails once that file is clean so the list shrinks', () => {
    fixture();
    write('src/renderer/app/Old.tsx', "const c = '#38bdf8';");
    expect(check({ root, legacy: ['src/renderer/app/Old.tsx'] }).errors).toEqual([]);
    write('src/renderer/app/Old.tsx', "const c = 'var(--signal)';");
    expect(check({ root, legacy: ['src/renderer/app/Old.tsx'] }).errors[0]).toMatch(/clean now/);
  });

  it('leaves the 3D world alone: scene materials are not UI', () => {
    fixture();
    write('src/renderer/scene/Sky.tsx', "<meshBasicMaterial color='#87ceeb' />");
    expect(check({ root, legacy: [] }).errors).toEqual([]);
  });
});
