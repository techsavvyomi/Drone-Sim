import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite config for the preload script (bridges main <-> renderer securely).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      external: ['electron'],
    },
  },
});
