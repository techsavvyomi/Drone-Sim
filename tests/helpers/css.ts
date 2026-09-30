import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Just enough of a CSS reader for layout tests: jsdom does no layout and
// ignores media queries, so the rules a screen size switches on are checked in
// the stylesheet itself. Handles plain rules and one level of @media — which is
// all the renderer's stylesheets use.

export interface CssRule {
  /** The selector list, as written ("a,\n b" → ["a", "b"]). */
  selectors: string[];
  /** The @media condition the rule sits in, or '' at the top level. */
  media: string;
  decls: Record<string, string>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name) out[name] = part.slice(at + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}

function parseBlock(css: string, media: string, into: CssRule[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) return;
    const head = css.slice(i, open).trim();
    // Find the matching close brace.
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media')) {
      parseBlock(body, head.slice('@media'.length).trim(), into);
    } else if (!head.startsWith('@')) {
      into.push({
        selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
        media,
        decls: parseDecls(body),
      });
    }
    i = j;
  }
}

export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  parseBlock(stripComments(css), '', rules);
  return rules;
}

/** A stylesheet under src/renderer/styles, parsed. */
export function stylesheet(name: string): CssRule[] {
  return parseCss(readFileSync(join(process.cwd(), 'src/renderer/styles', name), 'utf8'));
}

/**
 * The declarations `selector` gets from every rule naming it (alone or in a
 * list) under `media` ('' = top level), later rules winning — the way the
 * cascade merges rules of equal specificity.
 */
export function declsFor(rules: CssRule[], selector: string, media = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) {
    if (r.media === media && r.selectors.includes(selector)) Object.assign(out, r.decls);
  }
  return out;
}
