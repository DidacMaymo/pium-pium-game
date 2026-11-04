import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js', 'tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
