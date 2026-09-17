import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { newAssetKey, protectAssets, protectedAssetDefines } from './vite-plugins/protect-assets';

// Vite config for the renderer (React + R3F app).
export default defineConfig(({ command }) => {
  // Production builds encrypt the .glb models with a key made for this build
  // alone; the dev server serves them as they are. See vite-plugins/protect-assets.ts.
  const assetKey = command === 'build' ? newAssetKey() : null;

  return {
    // Relative base so emitted asset URLs resolve under Electron's file://
    // protocol in the packaged app.
    base: './',
    plugins: [react(), ...(assetKey ? [protectAssets(assetKey)] : [])],
    define: protectedAssetDefines(assetKey),
    // .glb models are copied out as files rather than inlined.
    assetsInclude: ['**/*.glb'],
    build: {
      // Never ship source maps: they are the original source, comments and all.
      sourcemap: false,
    },
    server: {
      hmr: {
        overlay: false,
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(process.cwd(), 'src/shared'),
        '@renderer': resolve(process.cwd(), 'src/renderer'),
      },
    },
  };
});
