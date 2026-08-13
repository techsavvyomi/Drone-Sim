import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // public/ is vendored third-party (the minified Draco decoder). Linting it
  // buried the 8 real findings in the repo under 2,771 style complaints about
  // code we neither wrote nor edit.
  { ignores: ['.vite/**', 'out/**', 'dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
