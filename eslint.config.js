import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // public/ is vendored third-party (the minified Draco decoder). Linting it
  // buried the 8 real findings in the repo under 2,771 style complaints about
  // code we neither wrote nor edit.
  { ignores: ['.vite/**', 'out/**', 'dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Build scripts run under Node, not the browser. Without this the shared
  // browser globals apply and every `process`/`console` reads as no-undef.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Apps Script joins every file of a project into one global scope and calls
  // entry points (doPost, onOpen, menu items) by name. Undefined and "unused"
  // globals are how that code is supposed to look; tests/backend-api.test.ts
  // runs it for real instead.
  {
    files: ['backend/apps-script/**/*.js'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
