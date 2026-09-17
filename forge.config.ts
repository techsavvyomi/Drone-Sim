import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import pkg from './package.json';

// ---------------------------------------------------------------------------
// Build identity: name, version and build, stamped into the app and the files.
//
//   version  package.json "version" (bump it for a release)
//   build    the short commit, the same one Settings -> About shows
//   number   the commit count, an always-increasing integer for the OS fields
//            that must be numeric (macOS CFBundleVersion, Windows FileVersion)
// ---------------------------------------------------------------------------

function git(args: string[], fallback: string): string {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

const PRODUCT = 'PlutoSim';
const VERSION = pkg.version;
const BUILD = git(['rev-parse', '--short', 'HEAD'], 'unknown');
const BUILD_NUMBER = git(['rev-list', '--count', 'HEAD'], '0');
const PLATFORM_LABELS: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** e.g. PlutoSim-0.1.0-78bcd62-Windows-x64 */
function artifactName(platform: string, arch: string): string {
  return `${PRODUCT}-${VERSION}-${BUILD}-${PLATFORM_LABELS[platform] ?? platform}-${arch}`;
}

/**
 * The Windows installer: NSIS, from resources/windows/installer.nsi.
 *
 * NSIS rather than Forge's Squirrel maker because `makensis` runs on macOS and
 * Linux as well as Windows, so the installer comes off the same machine as the
 * macOS build. Returns the installer's path, or null when makensis is not
 * installed (`brew install makensis`), in which case only the zip is made.
 */
function makeWindowsInstaller(arch: string): string | null {
  const makensis = ['makensis', '/opt/homebrew/bin/makensis', '/usr/local/bin/makensis'].find((bin) => {
    try {
      execFileSync(bin, ['-VERSION'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  if (!makensis) {
    console.warn('makensis not found: skipping the Windows installer (brew install makensis).');
    return null;
  }
  const root = process.cwd();
  const sourceDir = path.join(root, 'out', `${PRODUCT}-win32-${arch}`);
  const outDir = path.join(root, 'out', 'make', 'installer', 'win32', arch);
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${artifactName('win32', arch)}-Setup.exe`);
  execFileSync(
    makensis,
    [
      '-V2',
      `-DVERSION=${VERSION}`,
      `-DFILE_VERSION=${VERSION}.${BUILD_NUMBER}`,
      `-DBUILD=${BUILD}`,
      `-DSOURCE_DIR=${sourceDir}`,
      `-DOUTFILE=${outFile}`,
      `-DICON=${path.join(root, 'resources', 'icons', 'icon.ico')}`,
      path.join(root, 'resources', 'windows', 'installer.nsi'),
    ],
    { stdio: 'inherit' },
  );
  return outFile;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: PRODUCT,
    executableName: PRODUCT,
    appVersion: VERSION,
    buildVersion: `${VERSION}.${BUILD_NUMBER}`,
    appCopyright: `© ${new Date().getFullYear()} Drona Aviation`,
    appBundleId: 'com.dronaaviation.plutosim',
    appCategoryType: 'public.app-category.education',
    // resources/icons/icon.icns on macOS, icon.ico on Windows (scripts/make-icons.mjs).
    icon: 'resources/icons/icon',
    // What Windows shows under the .exe's Properties -> Details.
    win32metadata: {
      CompanyName: 'Drona Aviation',
      ProductName: PRODUCT,
      FileDescription: `${PRODUCT} flight simulator`,
      InternalName: PRODUCT,
      OriginalFilename: `${PRODUCT}.exe`,
    },
  },
  rebuildConfig: {},
  makers: [
    // Portable ZIPs for every platform. This is what goes to testers: no
    // installer, no admin rights, nothing to uninstall — unzip and
    // double-click. It is also the only maker that CROSS-builds, so all three
    // come off whichever machine runs the build.
    new MakerZIP({}, ['darwin', 'win32', 'linux']),

    // The macOS installer: a disk image with the app and an Applications link
    // to drag it onto. Built on macOS only (it needs hdiutil). The Windows
    // installer is made in the postMake hook below.
    new MakerDMG(
      {
        name: PRODUCT,
        icon: 'resources/icons/icon.icns',
        // Drawn by scripts/make-dmg-background.mjs around the icon positions
        // below (a background@2x.png beside it is picked up for Retina).
        background: 'resources/dmg/background.png',
        iconSize: 100,
        contents: (opts) => [
          { x: 180, y: 290, type: 'file', path: opts.appPath },
          { x: 478, y: 290, type: 'link', path: '/Applications' },
        ],
        additionalDMGOptions: { window: { size: { width: 658, height: 498 } } },
        format: 'ULFO',
        overwrite: true,
      },
      ['darwin'],
    ),

    // The native installers, each only on the OS that can actually build it.
    // Squirrel shells out to Windows tooling (wine/mono elsewhere) and Deb to
    // dpkg/fakeroot; listing them unconditionally made `make` fail on this Mac
    // before it ever reached the ZIPs. They come from CI, where the runner is
    // the right OS.
    ...(process.platform === 'win32' ? [new MakerSquirrel({})] : []),
    ...(process.platform === 'linux' ? [new MakerDeb({})] : []),
  ],
  hooks: {
    /**
     * Name every artifact after what it is, and add the Windows installer:
     *   PlutoSim-0.1.0-78bcd62-macOS-arm64.dmg      (installer)
     *   PlutoSim-0.1.0-78bcd62-Windows-x64-Setup.exe (installer)
     *   PlutoSim-0.1.0-78bcd62-macOS-arm64.zip       (portable)
     * Forge's defaults ("PlutoSim-darwin-arm64-0.1.0.zip", "PlutoSim.dmg") say
     * neither which build it is nor, to a tester, which file is for them.
     */
    postMake: async (_config, results) => {
      for (const result of results) {
        result.artifacts = result.artifacts.map((artifact) => {
          const ext = path.extname(artifact);
          if (ext !== '.zip' && ext !== '.dmg') return artifact;
          const renamed = path.join(path.dirname(artifact), `${artifactName(result.platform, result.arch)}${ext}`);
          renameSync(artifact, renamed);
          return renamed;
        });
      }
      const windows = results.filter((r) => r.platform === 'win32');
      for (const result of windows) {
        const installer = makeWindowsInstaller(result.arch);
        if (installer) result.artifacts.push(installer);
      }
      return results;
    },
    /**
     * Ad-hoc sign the macOS bundle after packaging.
     *
     * Electron ships its binary already ad-hoc signed, but packaging REWRITES
     * the bundle around it: a new name, a new Info.plist, an app.asar dropped
     * into Resources. The old signature no longer covers any of that, and on
     * Apple Silicon an app whose signature does not match is not merely
     * untrusted, it is refused outright: macOS says "damaged and can't be
     * opened", which every tester reads as a corrupt download rather than a
     * policy block. The only way past it was a Terminal command
     * (`xattr -cr ...`), which is not something to ask a test group for.
     *
     * `codesign --sign -` re-seals the whole bundle with an ad-hoc signature.
     * It does not make the app trusted, so a first launch still needs
     * right-click then Open, but that is a normal macOS prompt with a button
     * rather than a dead end. Real trust needs an Apple Developer ID and
     * notarisation; this is the free half of it.
     */
    postPackage: async (_config, options) => {
      if (options.platform !== 'darwin') return;
      for (const dir of options.outputPaths) {
        const app = readdirSync(dir).find((f) => f.endsWith('.app'));
        if (!app || !existsSync(path.join(dir, app))) continue;
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(dir, app)], {
          stdio: 'inherit',
        });
      }
    },
  },

  plugins: [
    new VitePlugin({
      // Build targets for the Node-side bundles (main + preload).
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      // The renderer runs the React app through Vite (HMR in dev).
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Ensures native modules (e.g. better-sqlite3, added in Phase 4) are
    // unpacked from the asar archive so they load at runtime.
    new AutoUnpackNativesPlugin({}),
    // Lock down the packaged Electron binary. These flip switches compiled into
    // the executable itself, so they cannot be undone from outside:
    //   - it cannot be started as a plain Node.js runtime (ELECTRON_RUN_AS_NODE)
    //     or have code injected through NODE_OPTIONS / --inspect;
    //   - it only runs the app from app.asar, and checks that archive against
    //     the hash recorded at build time, so an unpacked-and-edited copy will
    //     not start.
    // Everything the app ships (code, models, textures) is inside app.asar; the
    // .glb models in there are also encrypted (vite.renderer.config.ts).
    // Remote debugging and DevTools are refused separately, in src/main.ts.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
