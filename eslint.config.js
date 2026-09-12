import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architectural layer boundaries (see ARCHITECTURE.md, "Layers").
 * Each entry lists the npm packages and the other `src/` layers that a layer must not import.
 * tests/architecture/boundaries.test.ts checks these rules.
 */
const LAYER_RULES = [
  {
    layer: 'kernel',
    packages: ['three', 'react', 'react-dom', 'zustand'],
    layers: ['app', 'render', 'io', 'workers', 'ui'],
  },
  { layer: 'render', packages: ['react', 'react-dom', 'zustand'], layers: ['app', 'io', 'workers', 'ui'] },
  { layer: 'io', packages: ['react', 'react-dom', 'zustand'], layers: ['app', 'render', 'ui'] },
  { layer: 'workers', packages: ['react', 'react-dom', 'zustand'], layers: ['app', 'render', 'ui'] },
  { layer: 'app', packages: ['react', 'react-dom'], layers: ['ui'] },
  { layer: 'ui', packages: ['three'], layers: ['workers'] },
];

function boundaryConfig({ layer, packages, layers }) {
  return {
    name: `planar/boundaries/${layer}`,
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...packages.map((pkg) => ({
              group: [pkg, `${pkg}/*`],
              message: `The ${layer} layer must not depend on "${pkg}".`,
            })),
            {
              regex: `(^|/)(${layers.join('|')})(/|$)`,
              message: `The ${layer} layer must not import from these layers: ${layers.join(', ')}.`,
            },
          ],
        },
      ],
    },
  };
}

export default defineConfig(
  { ignores: ['dist/', 'dev-dist/', 'coverage/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['tests/**/*.{ts,tsx}', '*.config.{ts,js}'], languageOptions: { globals: globals.node } },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  ...LAYER_RULES.map(boundaryConfig),
);
