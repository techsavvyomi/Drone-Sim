import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite config for the Electron main process (Node environment).
export default defineConfig({
  // The profile backend's URL, fixed into the build. See src/main/backend/config.ts.
  define: {
    __DRONESIM_BACKEND_URL__: JSON.stringify(process.env.DRONESIM_BACKEND_URL ?? ''),
    // Only for inspecting a packaged build locally; see src/main/security.ts.
    __DRONESIM_ALLOW_DEBUG__: JSON.stringify(process.env.DRONESIM_ALLOW_DEBUG === '1'),
  },
  resolve: {
    // Prefer Node/CommonJS resolution for main-process deps.
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      // Native/electron modules are provided at runtime, never bundled.
      external: ['electron'],
    },
  },
});
