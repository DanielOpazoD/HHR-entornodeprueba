import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import { publicImportBoundaryRule } from './scripts/lib/publicImportBoundaryRule.mjs';
import { featureBoundaryRule } from './scripts/lib/eslint/featureBoundaryRule.mjs';
import { remoteAdmissionRule } from './scripts/lib/eslint/remoteAdmissionRule.mjs';
import { QUEUE_REMOVAL_HOMES, queueRemovalRule } from './scripts/lib/eslint/queueRemovalRule.mjs';
import { sessionRawReadRule } from './scripts/lib/eslint/sessionRawReadRule.mjs';
import { unknownCastRule } from './scripts/lib/eslint/unknownCastRule.mjs';
import {
  ADMIN_TABS_FRAME_RESTRICTION,
  AUDIT_CONTRACT_RESTRICTION,
  BASE_MODAL_ENTRYPOINT_RESTRICTION,
  CUDYR_FUNCTIONS_DOOR_RESTRICTION,
  DATA_ACCESS_RESTRICTION,
  DAY_WINDOW_RESTRICTION,
  EPISODE_KEY_BUILD_RESTRICTION,
  EPISODE_KEY_PARSE_RESTRICTION,
  FEATURES_WITHOUT_DIRECT_DATA_ACCESS,
  REEXPORT_ONLY_RESTRICTION,
  ROLE_RESTRICTIONS,
  RUT_REGEX_RESTRICTION,
  SESSION_MESSAGE_RESTRICTION,
  TEST_DAILY_RECORD_DOUBLE_CAST_RESTRICTION,
  syntaxRestrictions,
} from './scripts/lib/eslint/syntaxRestrictions.mjs';

const HHR_PLUGIN = {
  rules: {
    'feature-boundaries': featureBoundaryRule,
    'public-import-boundaries': publicImportBoundaryRule,
  },
};

const FEATURE_BOUNDARY_CONFIGS = [
  {
    files: ['src/features/**/*.{ts,tsx,js,jsx}'],
    ignores: ['**/*.test.*', '**/*.stories.*'],
    languageOptions: { parser: tseslint.parser },
    plugins: { hhr: HHR_PLUGIN },
    rules: { 'hhr/feature-boundaries': 'error' },
  },
  ...[...FEATURES_WITHOUT_DIRECT_DATA_ACCESS].map(feature => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    ignores: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [DATA_ACCESS_RESTRICTION] }] },
  })),
];

export default tseslint.config(
  {
    ignores: [
      '.agent',
      '.netlify',
      '.claude',
      'coverage',
      'dev-dist',
      'dist',
      // Explicit extension vendors. Every other extension/*.js file is authored code and linted.
      'extension/jspdf.umd.min.js',
      'extension/pdf-lib.min.js',
      'extension/xlsx.full.min.js',
      'extension/pdf.min.mjs',
      'extension/pdf.worker.min.mjs',
      'node_modules',
      'output',
      'playwright-report',
      'reports',
      'test-results',
      '*.config.ts',
    ],
  },
  {
    extends: [js.configs.recommended],
    files: ['extension/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.serviceworker,
        ...globals.webextensions,
        module: 'readonly',
      },
      sourceType: 'script',
    },
    rules: {
      // Existing empty fallbacks and intentionally exported UMD helpers are governed separately.
      'no-empty': 'off',
      'no-extra-boolean-cast': 'off',
      'no-unused-vars': [
        'error',
        {
          args: 'none',
          caughtErrors: 'none',
          // Exact legacy bindings exposed or retained by runtime factories.
          varsIgnorePattern: '^(sendToMatchingTab|fetchRegimenReportBuffer|delay)$',
        },
      ],
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['extension/content-prescription-print.js'],
    languageOptions: {
      globals: {
        // Exact baseline for a pre-existing shell navigation reference. Removing this exception
        // requires the dedicated runtime-owner fix; other undefined names remain blocking here.
        switchCenterModule: 'readonly',
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      react,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-useless-escape': 'warn',
      'no-useless-catch': 'warn',
      'no-control-regex': 'off',
      'no-empty': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',

      'no-restricted-syntax': syntaxRestrictions(),
    },
  },
  {
    // Role decisions are a rule of the app in src/; server functions and e2e check roles on
    // their own side.
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/**'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: ROLE_RESTRICTIONS }) },
  },
  {
    // The sender of the session message.
    files: ['src/services/session/sessionStorageTransition.ts'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: [SESSION_MESSAGE_RESTRICTION] }) },
  },
  {
    // The home of the RUT helpers.
    files: ['src/utils/rutUtils.ts'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: [RUT_REGEX_RESTRICTION] }) },
  },
  {
    // The home of the episode key.
    files: ['src/domain/clinical-episode/clinicalEpisode.ts'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({
        omit: [EPISODE_KEY_BUILD_RESTRICTION, EPISODE_KEY_PARSE_RESTRICTION],
      }),
    },
  },
  {
    // Reminder ids join user, day and shift; they are not clinical keys.
    files: ['src/services/reminders/reminderShared.ts'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({ omit: [EPISODE_KEY_BUILD_RESTRICTION] }),
    },
  },
  {
    // The home of the audit loggers contract.
    files: ['src/hooks/useAudit.ts'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: [AUDIT_CONTRACT_RESTRICTION] }) },
  },
  {
    // The home of the admin tabs frame.
    files: ['src/features/admin/components/internal/AdminTabsShell.tsx'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: [ADMIN_TABS_FRAME_RESTRICTION] }) },
  },
  {
    files: ['src/utils/clinicalDayUtils.ts'],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ add: [REEXPORT_ONLY_RESTRICTION] }) },
  },
  {
    files: ['src/components/shared/BaseModal.tsx'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({ add: [BASE_MODAL_ENTRYPOINT_RESTRICTION] }),
    },
  },
  {
    // The owner of role decisions and of «¿puede escribir este día?».
    files: ['src/shared/access/**/*.ts'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({
        omit: [...ROLE_RESTRICTIONS, DAY_WINDOW_RESTRICTION],
      }),
    },
  },
  {
    // The role type and the reminder role values (a list of values, not a decision).
    files: [
      'src/types/authRoleTypes.ts',
      'src/schemas/reminderSchemas.ts',
      'src/shared/reminders/reminderUiOptions.ts',
    ],
    rules: { 'no-restricted-syntax': syntaxRestrictions({ omit: ROLE_RESTRICTIONS }) },
  },
  {
    // CUDYR code reaches its Functions only through the door, which compares the session.
    files: ['src/services/cudyr/**/*.{ts,tsx}', 'src/features/cudyr/**/*.{ts,tsx}'],
    ignores: ['src/services/cudyr/cudyrFunctionsCall.ts'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({ add: [CUDYR_FUNCTIONS_DOOR_RESTRICTION] }),
    },
  },
  {
    // Census controllers reach the browser only through censusBrowserRuntimeAdapter.ts. By scope:
    // a comment or a local named `document` is not the browser global.
    files: ['src/features/census/controllers/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'globalThis', 'localStorage', 'document', 'navigator'].map(name => ({
          name,
          message:
            'Los controladores del censo reciben el navegador por censusBrowserRuntimeAdapter.ts.',
        })),
      ],
    },
  },
  {
    // Tests assert the page bridge of the session message, build their own document text,
    // exercise the legacy readers they guard and pick roles to test with.
    files: ['src/tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({
        omit: [
          SESSION_MESSAGE_RESTRICTION,
          RUT_REGEX_RESTRICTION,
          EPISODE_KEY_PARSE_RESTRICTION,
          ...ROLE_RESTRICTIONS,
          DAY_WINDOW_RESTRICTION,
        ],
        add: [TEST_DAILY_RECORD_DOUBLE_CAST_RESTRICTION],
      }),
    },
  },
  {
    files: ['scripts/**/*.ts', 'scripts/**/*.js', '*.cjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    // Layer 0 (pure core) never imports React; React wrappers belong in hooks/, components/, or a feature.
    files: ['src/{types,domain,utils,constants,schemas,shared}/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message:
                'La capa 0 (núcleo puro) no importa React; mueve el módulo React a hooks/, components/ o su feature.',
            },
          ],
        },
      ],
    },
  },
  {
    // With `"jsx": "react-jsx"`, a `.tsx` file in Layer 0 would silently inject `react/jsx-runtime`
    // without an explicit React import. Reject JSX elements and fragments in Layer 0 directly.
    files: ['src/{types,domain,utils,constants,schemas,shared}/**/*.tsx'],
    ignores: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({
        add: [
          {
            selector: 'JSXElement, JSXFragment',
            message:
              'La capa 0 (núcleo puro) no usa JSX ni React; mueve el componente a components/, hooks/ o su feature.',
          },
        ],
      }),
    },
  },
  {
    files: ['src/components/layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DATA_ACCESS_RESTRICTION] }],
    },
  },
  ...FEATURE_BOUNDARY_CONFIGS,
  {
    files: ['src/{hooks,components,features,application}/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'src/hooks/controllers/**',
      'src/features/backup/**',
      'src/application/ports/**',
      '**/*.d.ts',
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.stories.*',
    ],
    languageOptions: { parser: tseslint.parser },
    plugins: { hhr: HHR_PLUGIN },
    rules: { 'hhr/feature-boundaries': ['error', { checkPorts: true }] },
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'],
    languageOptions: { parser: tseslint.parser },
    plugins: { hhr: HHR_PLUGIN },
    rules: { 'hhr/public-import-boundaries': 'error' },
  },
  {
    extends: [js.configs.recommended],
    files: ['functions/**/*.js', 'netlify/functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Production source: the former source scanner's scope, with syntax-aware errors.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*', '**/*.spec.*'],
    plugins: {
      types: { rules: { 'unknown-cast-ceiling': unknownCastRule } },
      session: { rules: { 'raw-read': sessionRawReadRule } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'types/unknown-cast-ceiling': 'error',
      'session/raw-read': 'error',
    },
  },
  {
    // Critical services also cover spec and story files, as the critical scanner did.
    files: ['src/services/{storage,session,repositories,admin}/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: [
      'src/services/repositories/dailyRecord*Read*.ts',
      'src/services/repositories/dailyRecord*Initialization*.ts',
      'src/services/repositories/dailyRecordLocalCachePersistence.ts',
    ],
    plugins: { admission: { rules: { 'remote-reads': remoteAdmissionRule } } },
    rules: { 'admission/remote-reads': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*', '**/*.spec.*', ...QUEUE_REMOVAL_HOMES],
    plugins: { queue: { rules: { 'removal-home': queueRemovalRule } } },
    rules: { 'queue/removal-home': 'error' },
  }
);
