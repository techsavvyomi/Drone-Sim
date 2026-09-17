import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Drone Flight Simulator',
  },
  rebuildConfig: {},
  makers: [
    // Portable ZIPs for every platform. This is what goes to testers: no
    // installer, no admin rights, nothing to uninstall — unzip and
    // double-click. It is also the only maker that CROSS-builds, so all three
    // come off whichever machine runs the build.
    new MakerZIP({}, ['darwin', 'win32', 'linux']),

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
