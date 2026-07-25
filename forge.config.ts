import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Drone Flight Simulator',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}), // Windows .exe
    new MakerZIP({}, ['darwin']), // macOS
    new MakerDeb({}), // Linux
  ],
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
  ],
};

export default config;
