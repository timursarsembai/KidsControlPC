import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const sharedRules = {
  'no-unused-vars': ['warn', {
    argsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    varsIgnorePattern: '^React$'
  }],
  'no-control-regex': 'warn',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-useless-escape': 'warn',
  'preserve-caught-error': 'warn',
  'react-hooks/immutability': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/set-state-in-effect': 'off'
}

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/.firebase/**',
    '**/.local-tools/**'
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: 'readonly'
      },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: sharedRules
  }
])
