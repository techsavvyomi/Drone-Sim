import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite config for the renderer (React + R3F app).
export default defineConfig({
  // Relative base so emitted asset URLs resolve under Electron's file://
  // protocol in the packaged app.
  base: './',
  plugins: [react()],
  // .glb models are copied out as files rather than inlined.
  assetsInclude: ['**/*.glb'],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
});
