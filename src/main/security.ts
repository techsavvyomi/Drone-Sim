import { app, type WebContents } from 'electron';

// Lockdown for packaged builds.
//
// The fuses in forge.config.ts close the Node.js ways in (running as Node,
// --inspect, NODE_OPTIONS). These close the Chromium ones: a packaged build
// refuses to start with remote debugging, and never opens DevTools. Either would
// let anyone read the running app's memory, including decrypted models.
//
// `npm start` is unaffected. A build made with DRONESIM_ALLOW_DEBUG=1 skips the
// lockdown, for inspecting a packaged build; never ship one.

declare const __DRONESIM_ALLOW_DEBUG__: boolean;

/** Command-line switches that attach a debugger or change how V8 runs. */
export const BLOCKED_SWITCHES = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-debugging-address',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'js-flags',
];

export function blockedSwitchIn(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const name = arg.replace(/^-+/, '').split('=')[0].toLowerCase();
    if (arg.startsWith('-') && BLOCKED_SWITCHES.includes(name)) return name;
  }
  return null;
}

function lockdownApplies(): boolean {
  const allowDebug = typeof __DRONESIM_ALLOW_DEBUG__ === 'boolean' && __DRONESIM_ALLOW_DEBUG__;
  return app.isPackaged && !allowDebug;
}

/** Call first thing in the main process. Exits on a debugging switch. */
export function enforceLockdown(): { devTools: boolean } {
  if (!lockdownApplies()) return { devTools: true };

  const blocked = blockedSwitchIn(process.argv);
  if (blocked) {
    console.error(`Refusing to start with --${blocked}`);
    app.exit(1);
  }

  app.on('web-contents-created', (_event, contents: WebContents) => {
    // devTools: false in webPreferences already stops them opening; this is the
    // belt to that brace, for any window created some other way.
    contents.on('devtools-opened', () => contents.closeDevTools());
    // The app has no reason to open other pages or windows.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
  });

  return { devTools: false };
}
