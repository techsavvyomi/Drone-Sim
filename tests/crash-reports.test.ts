// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashCollector, describeError, scrub } from '../src/main/crash/crashReports';
import { attachCrashReporting, reportRenderError } from '../src/renderer/analytics/crashReporting';
import { useMissionStore } from '../src/renderer/state/missionStore';
import { useUiStore } from '../src/renderer/state/uiStore';
import { MISSIONS } from '../src/renderer/missions';

// A crash report is only useful if it arrives, says where the pilot was, and
// does not carry their name around in file paths. And a crash loop must not turn
// into ten thousand of them.

const env = {
  appVersion: '0.1.0',
  platform: 'win32',
  osVersion: 'Windows_NT 10.0.22631',
  electronVersion: '43.2.0',
  homeDir: 'C:\\Users\\Omkar Dandekar',
};

describe('what a report keeps and removes', () => {
  it('scrubs the home folder in either slash style, and the dev server origin', () => {
    const stack = [
      'TypeError: boom',
      '    at load (C:\\Users\\Omkar Dandekar\\AppData\\Roaming\\Drone Flight Simulator\\x.js:1:2)',
      '    at file:///C:/Users/Omkar Dandekar/app/index.js:3:4',
      '    at tick (http://localhost:5173/src/renderer/missions/MissionDirector.tsx:412:17)',
    ].join('\n');
    const out = scrub(stack, env);
    expect(out).not.toMatch(/Omkar/);
    expect(out).toContain('~\\AppData\\Roaming');
    expect(out).toContain('app://src/renderer/missions/MissionDirector.tsx:412:17');
    expect(scrub('/Users/omkar/Library/x.js', { homeDir: '/Users/omkar/' })).toBe('~/Library/x.js');
  });

  it('describes whatever was thrown', () => {
    expect(describeError(new RangeError('bad'))).toMatchObject({ message: 'bad' });
    expect(describeError('plain')).toEqual({ message: 'plain' });
    expect(describeError({ code: 7 })).toEqual({ message: '{"code":7}' });
    expect(describeError(undefined).message).toBe('undefined');
  });
});

describe('crash collector', () => {
  let clock = 0;
  const collector = () =>
    new CrashCollector({
      env,
      device: async () => ({ deviceId: 'dev-1234567890abcdef', deviceName: 'Lab PC 1 (Windows)' }),
      now: () => clock,
    });

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('holds reports raised before the backend is ready, then delivers them', async () => {
    const c = collector();
    await c.capture({ kind: 'MAIN_EXCEPTION', message: 'early', fatal: false });
    const sink = vi.fn();
    c.attach(sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({
      kind: 'MAIN_EXCEPTION',
      message: 'early',
      appVersion: '0.1.0',
      deviceName: 'Lab PC 1 (Windows)',
    });
  });

  it('turns a crash loop into one report a minute, and at most 50 a run', async () => {
    const c = collector();
    const sink = vi.fn();
    c.attach(sink);
    for (let i = 0; i < 100; i++) await c.capture({ kind: 'RENDERER_GONE', message: 'crashed', fatal: true });
    expect(sink).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await c.capture({ kind: 'RENDERER_GONE', message: 'crashed', fatal: true });
    expect(sink).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 100; i++) await c.capture({ kind: 'MAIN_EXCEPTION', message: `distinct ${i}`, fatal: false });
    expect(sink).toHaveBeenCalledTimes(50);
  });

  it('still reports when the device cannot be read', async () => {
    const c = new CrashCollector({ env, device: () => Promise.reject(new Error('not ready')) });
    const sink = vi.fn();
    c.attach(sink);
    await c.capture({ kind: 'MAIN_REJECTION', message: 'x', fatal: false });
    expect(sink.mock.calls[0][0]).toMatchObject({ kind: 'MAIN_REJECTION', deviceId: undefined });
  });
});

describe('game window', () => {
  let detach: () => void;
  const report = () => window.api.crash.report as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ section: 'missions' });
    useMissionStore.getState().start(MISSIONS[1]);
    detach = attachCrashReporting();
  });

  afterEach(() => {
    detach();
    useMissionStore.getState().exit();
    vi.useRealTimers();
  });

  it('reports an uncaught error with what the pilot was doing', () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('boom'), message: 'boom' }));
    expect(report()).toHaveBeenCalledTimes(1);
    expect(report().mock.calls[0][0]).toMatchObject({
      kind: 'RENDERER_EXCEPTION',
      message: 'boom',
      fatal: false,
      context: { section: 'missions', mission: 'forest-fire' },
    });
  });

  it('reports each error once however often it repeats in a burst', () => {
    for (let i = 0; i < 60; i++) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('every frame'), message: 'every frame' }));
    }
    expect(report()).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('every frame'), message: 'every frame' }));
    expect(report()).toHaveBeenCalledTimes(2);
  });

  it('reports unhandled rejections, render errors and a lost WebGL context', () => {
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('fetch failed') });
    window.dispatchEvent(rejection);

    reportRenderError(new Error('bad render'), '\n    at MissionHud', true);

    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.dispatchEvent(new Event('webglcontextlost'));

    expect(report().mock.calls.map((c) => [c[0].kind, c[0].fatal])).toEqual([
      ['RENDERER_REJECTION', false],
      ['RENDER_ERROR', true],
      ['WEBGL_CONTEXT_LOST', false],
    ]);
    expect(report().mock.calls[1][0].stack).toContain('Component stack:');
  });

  it('keeps the main process told where the pilot is, for crashes the window cannot report', () => {
    const setContext = window.api.crash.setContext as unknown as ReturnType<typeof vi.fn>;
    expect(setContext).toHaveBeenCalledWith(expect.objectContaining({ mission: 'forest-fire' }));
    useUiStore.setState({ section: 'fly' });
    vi.advanceTimersByTime(3500);
    expect(setContext.mock.calls.at(-1)![0]).toMatchObject({ section: 'fly' });
  });
});
