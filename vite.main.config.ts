import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

/** The commit this build is made from, for Settings → About and bug reports. */
function buildCommit(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${hash}+local` : hash;
  } catch {
    return 'unknown';
  }
}

// Vite config for the Electron main process (Node environment).
export default defineConfig({
  // The profile backend's URL, fixed into the build. See src/main/backend/config.ts.
  define: {
    __DRONESIM_BACKEND_URL__: JSON.stringify(process.env.DRONESIM_BACKEND_URL ?? ''),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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
