import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite config for the Electron main process (Node environment).
export default defineConfig({
  resolve: {
    // Prefer Node/CommonJS resolution for main-process deps.
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      // Native/electron modules are provided at runtime, never bundled.
      external: ['electron'],
    },
  },
});
