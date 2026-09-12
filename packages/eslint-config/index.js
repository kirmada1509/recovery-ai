import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for every TypeScript workspace in the monorepo.
 * Rules here encode the plan's cross-cutting standards (Section 4), not taste.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Money is integer minor units everywhere (plan Section 4.1). Floating point
      // arithmetic on currency is a correctness bug, so parseFloat on amounts is banned.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Monetary values are integer paise. Use parseInt/BigInt.' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
