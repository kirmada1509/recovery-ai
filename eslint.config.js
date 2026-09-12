import recoveryai from '@recoveryai/eslint-config';

export default [
  ...recoveryai,
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/.venv/**',
      '**/next-env.d.ts',
    ],
  },
];
