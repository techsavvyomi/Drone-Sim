import { app, BrowserWindow, powerMonitor } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './main/ipc/handlers';
import { installCrashReporting } from './main/crash';
import { enforceLockdown } from './main/security';
import { keepExistingUserData } from './main/userDataPath';
import { preferHighPerformanceGpu } from './main/gpu';
import { DEV_FPS_FLAG, shellZoom } from './shared/shellZoom';
import type { BackendService } from './main/backend/service';

// PlutoSim keeps running in the background (user, 2026-10-29): it starts at
// login with no window, and closing the window, Cmd+Q, the Dock's Quit and the
// app's own Quit only close the window. The process, and with it the license
// and sign-in checks, goes on, so a license that ran out is found the moment
// the computer is online. It ends only when the OS ends it: Force Quit / Task
// Manager, shut down, restart or log out, or the installer (QUIT_FOR_UPDATE).
// On macOS the Dock icon goes with the window (user, 2026-10-31), so a quit app
// shows no running dot; Launchpad or Applications opens it again.

/** The installer and uninstaller start a second copy with this to end the running one. */
const QUIT_FOR_UPDATE = '--quit-for-update';
/** Given by the Windows login item: start with no window. */
const BACKGROUND = '--background';

let quitting = false;
/** Really end the process: only for the OS shutting down and the installer. */
function quitForReal(): void {
  quitting = true;
  app.quit();
}

// Before any path is read: an install from before the PlutoSim rename keeps its
// settings, sign-in and queued uploads.
keepExistingUserData();

// One copy at a time (the lock lives in the user-data folder, so after the line
// above): a second launch opens the running copy's window. Asked to quit with
// nothing running, it just goes. Installed builds only: `npm start` must still
// open beside an installed PlutoSim running in the background.
if (app.isPackaged && (!app.requestSingleInstanceLock() || process.argv.includes(QUIT_FOR_UPDATE)))
  app.exit(0);

// A packaged build refuses debugger switches and never opens DevTools.
const lockdown = enforceLockdown();

// Before anything else: the native crash reporter must start before other
// processes do, and an exception during startup is worth a report too.
const crashReporting = installCrashReporting();

// Before the GPU process starts: the discrete GPU where there is one, and no
// silent fall back to software rendering on a blocklisted driver.
preferHighPerformanceGpu();

// Globals injected by the Electron Forge Vite plugin at build time.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Quit early on Windows Squirrel install/uninstall events.
if (process.platform === 'win32' && process.argv.includes('--squirrel-firstrun')) {
  // no-op placeholder; MakerSquirrel handles shortcut creation
}

let mainWindow: BrowserWindow | null = null;
let backendService: BackendService | null = null;
/**
 * The window has been told to close. On macOS a fullscreen window first leaves
 * its Space, which takes seconds and shows it again on the way: none of that
 * is use.
 */
let windowClosing = false;

/** Window time counts towards usage only while the window is on screen. */
function reportWindowShown(): void {
  const win = mainWindow;
  backendService?.setWindowShown(
    !!win && !windowClosing && !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
  );
}

/** Bring the window back, or open it again if it was closed. */
function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  void app.dock?.show();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    // --ink-950 from tokens.css: the colour the window shows before the page paints.
    // The main process can't read the stylesheet, so this one copy lives here.
    backgroundColor: '#0e0f0e',
    title: 'PlutoSim',
    // Opens over the whole screen: no title bar, no minimise/maximise/close.
    // The size above is what the window returns to if fullscreen is left.
    fullscreen: true,
    // Windows and Linux: no title bar at all, so the minimise/close strip
    // cannot come back even when the fullscreen flag above is dropped.
    // macOS keeps its frame; its fullscreen already hides the traffic lights.
    frame: process.platform === 'darwin',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: lockdown.devTools,
    },
  });

  mainWindow = win;
  windowClosing = false;
  win.on('close', () => {
    windowClosing = true;
    reportWindowShown();
  });
  win.on('show', reportWindowShown);
  win.on('hide', reportWindowShown);
  win.on('minimize', reportWindowShown);
  win.on('restore', reportWindowShown);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    reportWindowShown();
    app.dock?.hide();
  });
  // Windows signing out or shutting down: let the process go with it.
  win.on('session-end', quitForReal);

  // No File · Edit · View · Window bar under the title on Windows and Linux,
  // not even on Alt. macOS keeps its menu, which lives in the system bar.
  win.removeMenu();

  // On Windows a hidden window can ignore `fullscreen` from the constructor,
  // so it is applied again once the window is on screen.
  win.once('ready-to-show', () => {
    win.show();
    win.setFullScreen(true);
  });

  // A screen smaller than the shell's 1100 × 720 minimum (in CSS px) gets the
  // page zoomed out instead of a layout reflowed below the minimum. Content
  // bounds are DIP, i.e. CSS px at zoom 1, so the factor never feeds back.
  const fitZoom = () => {
    const { width, height } = win.getContentBounds();
    win.webContents.setZoomFactor(shellZoom(width, height));
  };
  win.on('resize', fitZoom);
  win.webContents.on('did-finish-load', fitZoom);

  // The FPS read-out is a developer tool: only with --dev-fps.
  const devFps = process.argv.includes(DEV_FPS_FLAG);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(
      devFps ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?devFps=1` : MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    win.webContents.openDevTools();
    // Dev only: the renderer's PerfProbe lines, to the terminal, where a log of
    // a whole flight can be read after it rather than watched in the devtools.
    win.webContents.on('console-message', (event) => {
      if (event.message.startsWith('[perf')) console.log(event.message);
    });
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      devFps ? { query: { devFps: '1' } } : undefined,
    );
  }
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes(QUIT_FOR_UPDATE)) quitForReal();
  else if (app.isReady()) showWindow();
});

app.whenReady().then(() => {
  const backend = registerIpcHandlers({ showWindow });
  // Started by the login item: no window until the pilot opens PlutoSim.
  const atLogin =
    process.argv.includes(BACKGROUND) ||
    (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  if (atLogin) app.dock?.hide();
  else createWindow();
  void backend.then((service) => {
    crashReporting.attach(service);
    backendService = service;
    reportWindowShown();
  });

  // Start at login, in the background. Only the installed app: a dev build
  // would register the bare Electron binary.
  if (app.isPackaged)
    app.setLoginItemSettings({ openAtLogin: true, args: [BACKGROUND], name: 'PlutoSim' });

  // macOS shutting down, restarting or logging out (Linux too).
  powerMonitor.on('shutdown', quitForReal);
  // A termination signal is the OS or an admin ending the process, not the pilot.
  process.on('SIGTERM', quitForReal);
  // Back from sleep: look at the license and the sign-in again straight away.
  powerMonitor.on('resume', () => void backendService?.checkLicense());

  // Dock icon, Finder or Launchpad with no window open.
  app.on('activate', showWindow);
});

// Cmd+Q, the Dock's Quit and the app's own Quit close the window and leave the
// process running; only quitForReal ends it.
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  for (const win of BrowserWindow.getAllWindows()) win.close();
});

// Every window closed is not a quit: the process stays (listening is what stops
// Electron's default of quitting here).
app.on('window-all-closed', () => {});
