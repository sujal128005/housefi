import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // admin/: the portal's website, with its own checks (typecheck, tests, build).
  { ignores: ['dist/**', '.demo-dist/**', 'node_modules/**', 'docs/**', 'coverage/**', 'admin/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
