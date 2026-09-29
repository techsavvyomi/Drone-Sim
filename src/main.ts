import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './main/ipc/handlers';
import { installCrashReporting } from './main/crash';
import { enforceLockdown } from './main/security';
import { keepExistingUserData } from './main/userDataPath';
import { preferHighPerformanceGpu } from './main/gpu';
import { DEV_FPS_FLAG, shellZoom } from './shared/shellZoom';

// Before any path is read: an install from before the PlutoSim rename keeps its
// settings, sign-in and queued uploads.
keepExistingUserData();

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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    // --ink-950 from tokens.css: the colour the window shows before the page paints.
    // The main process can't read the stylesheet, so this one copy lives here.
    backgroundColor: '#0e0f0e',
    title: 'PlutoSim',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: lockdown.devTools,
    },
  });

  win.once('ready-to-show', () => win.show());

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

app.whenReady().then(() => {
  const backend = registerIpcHandlers();
  createWindow();
  void backend.then((service) => crashReporting.attach(service));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
