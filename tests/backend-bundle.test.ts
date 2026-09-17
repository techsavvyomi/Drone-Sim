import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs build script with no type declarations
import { bundle, ORDER } from '../scripts/build-apps-script.mjs';

// The one-file backend people paste into Apps Script has to be what the tests
// ran: a stale bundle is a deployment of code nobody tested.

describe('Apps Script bundle', () => {
  it('includes every backend file', () => {
    const files = readdirSync(new URL('../backend/apps-script', import.meta.url)).filter((f) => f.endsWith('.js'));
    expect([...ORDER].sort()).toEqual(files.sort());
  });

  it('is up to date. Run `node scripts/build-apps-script.mjs` if not', () => {
    const built = readFileSync(new URL('../backend/dist/DroneSimulatorAPI.gs', import.meta.url), 'utf8');
    expect(built === bundle()).toBe(true);
  });

  it('parses as one script', () => {
    expect(() => new Function(bundle())).not.toThrow();
  });
});
