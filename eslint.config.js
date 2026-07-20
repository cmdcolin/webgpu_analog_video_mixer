import eslintReact from '@eslint-react/eslint-plugin'
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Tests are Node-side (child_process/fs to drive naga) and run by vitest, not
  // part of the browser tsconfig — lint and tsc both skip them.
  { ignores: ['dist', 'node_modules', 'scripts', '**/*.mjs', '**/*.test.ts'] },
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      eslintReact.configs['recommended-typescript'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // eslint-plugin-react-hooks already owns dependency-array analysis (and
      // the mount-once effects carry its disable comments); drop eslint-react's
      // duplicate so a single rule reports it.
      '@eslint-react/exhaustive-deps': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Numbers in template literals are fine here (shader prelude, debug logs).
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      // `onClick={() => doThing()}` shorthand returning void is idiomatic React.
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
      // Empty arrow no-ops (`.catch(() => {})`) are a legitimate callback pattern.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions'] },
      ],
    },
  },
)
