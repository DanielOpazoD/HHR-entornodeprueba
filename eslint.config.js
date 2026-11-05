import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import { readFileSync } from 'node:fs';

// Feature boundaries. scripts/feature-dependency-matrix.json says which features a feature may
// import, and the public-API allowlist which entry points of a feature are public. ESLint turns
// both into `no-restricted-imports` patterns so a violation shows in the editor and fails
// `npm run lint`; `npm run check:feature-dependencies` keeps the same rule as a backstop in CI.
const readJson = relativePath =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
const FEATURE_MATRIX = readJson('./scripts/feature-dependency-matrix.json');
const FEATURE_PUBLIC_MODULES =
  readJson('./scripts/feature-public-api-allowlist.json').publicModulesByFeature ?? {};
// Known deep imports the dependency check tolerates: `rule|importer|importPath|feature`.
const FEATURE_IMPORT_DEBT = (
  readJson('./scripts/feature-dependency-allowlist.json').violations ?? []
)
  .map(entry => entry.split('|'))
  .filter(([rule]) => rule === 'feature-must-use-public-api')
  .map(([, importer, importPath]) => ({ importer, importPath }));
const FEATURE_NAMES = Object.keys(FEATURE_MATRIX.features);

const featurePublicPaths = feature => [
  ...FEATURE_MATRIX.publicImportPatterns.map(pattern => pattern.replace('{feature}', feature)),
  ...(FEATURE_PUBLIC_MODULES[feature] ?? []),
];

/** `no-restricted-imports` patterns for sources of `feature`; `tolerated` are deep paths one allowlisted importer may still use. */
const featureImportPatterns = (feature, tolerated = []) => {
  const allowed = new Set(FEATURE_MATRIX.features[feature] ?? []);
  return FEATURE_NAMES.filter(other => other !== feature).map(other => {
    const toleratedHere = tolerated
      .filter(path => path.startsWith(`@/features/${other}/`))
      .map(path => `!${path}`);
    if (!allowed.has(other)) {
      return {
        group: [`@/features/${other}`, `@/features/${other}/**`, ...toleratedHere],
        message: `«${feature}» no depende de «${other}» en scripts/feature-dependency-matrix.json. Agrega la dependencia allí o resuelve la necesidad en otra capa.`,
      };
    }
    const publicPaths = featurePublicPaths(other);
    return {
      // `/**` leaves the bare `@/features/<other>` path alone: that one is public.
      group: [
        `@/features/${other}/**`,
        ...publicPaths.filter(path => path !== `@/features/${other}`).map(path => `!${path}`),
        ...toleratedHere,
      ],
      message: `Importa «${other}» por su superficie pública: ${publicPaths.join(', ')}.`,
    };
  });
};

// cudyr and handoff also keep data access behind controllers/use-cases/ports.
const DATA_ACCESS_RESTRICTION = {
  group: [
    '@/services/repositories/*',
    '@/services/RepositoryContext',
    '@/services/infrastructure/*',
  ],
  message:
    'Usa controllers/use-cases/ports para acceder a datos. No importes repositorios ni infraestructura directo desde UI/feature shell.',
};
const FEATURES_WITHOUT_DIRECT_DATA_ACCESS = new Set(['cudyr', 'handoff']);
const featureOf = importer => importer.match(/^src\/features\/([^/]+)\//)?.[1];
const restrictedImportsFor = (feature, tolerated = []) => [
  'error',
  {
    patterns: [
      ...featureImportPatterns(feature, tolerated),
      ...(FEATURES_WITHOUT_DIRECT_DATA_ACCESS.has(feature) ? [DATA_ACCESS_RESTRICTION] : []),
    ],
  },
];
const FEATURE_BOUNDARY_CONFIGS = [
  ...FEATURE_NAMES.map(feature => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    ignores: ['**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrictedImportsFor(feature) },
  })),
  // One block per allowlisted importer: its tolerated deep paths, and nothing else.
  ...Object.entries(
    FEATURE_IMPORT_DEBT.reduce((byImporter, { importer, importPath }) => {
      (byImporter[importer] ??= []).push(importPath);
      return byImporter;
    }, {})
  )
    .filter(([importer]) => featureOf(importer))
    .map(([importer, tolerated]) => ({
      files: [importer],
      rules: { 'no-restricted-imports': restrictedImportsFor(featureOf(importer), tolerated) },
    })),
];

// Glossary enforcement — only terms with zero current usage are banned (see docs/GLOSSARY.md).
// Adding new ones requires first migrating all legitimate uses; otherwise the rule produces noise
// instead of signal.
const GLOSSARY_SYNTAX_RESTRICTIONS = [
  {
    selector: 'Identifier[name="intake"]',
    message: 'Use "admission" / "admisión" instead of "intake" — see docs/GLOSSARY.md',
  },
  {
    selector: 'Identifier[name="swap"]',
    message: 'Use "moveOrCopy" / "bedMovement" instead of "swap" — see docs/GLOSSARY.md',
  },
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
      'storybook-static',
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
      boundaries,
    },
    settings: {
      react: { version: 'detect' },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/application/*' },
        { type: 'features', pattern: 'src/features/*' },
        { type: 'services', pattern: 'src/services/*' }, // Considering domain/services equivalent logic layer for now based on current structure
        {
          type: 'shared',
          pattern: [
            'src/components/*',
            'src/hooks/*',
            'src/utils/*',
            'src/types/*',
            'src/config/*',
          ],
        },
      ],
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

      // Architecture boundaries rules
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'app' }, allow: { to: { type: ['features', 'services', 'shared'] } } },
            { from: { type: 'features' }, allow: { to: { type: ['services', 'shared'] } } },
            { from: { type: 'services' }, allow: { to: { type: 'shared' } } },
            { from: { type: 'shared' }, allow: { to: { type: 'shared' } } },
          ],
        },
      ],

      'no-restricted-syntax': [
        'warn',
        ...GLOSSARY_SYNTAX_RESTRICTIONS,
        {
          // One session scope: the sender in sessionStorageTransition notifies every listener
          // synchronously. Listening to the window message elsewhere brought back reads of the
          // previous person twice (clinical explorer, 2026-11-05).
          selector: 'Literal[value="HHR_RAYEN_SESSION_CHANGED"]',
          message:
            'Observa el cambio de sesión con onSessionChange() o useSessionEpoch(), no con el mensaje HHR_RAYEN_SESSION_CHANGED (AGENTS.md).',
        },
      ],
    },
  },
  {
    // The sender of the session message and the tests that assert the page bridge.
    files: ['src/services/storage/sessionStorageTransition.ts', 'src/tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['warn', ...GLOSSARY_SYNTAX_RESTRICTIONS],
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
    files: ['src/components/layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DATA_ACCESS_RESTRICTION] }],
    },
  },
  ...FEATURE_BOUNDARY_CONFIGS,
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
    files: ['netlify/functions/**/*.{ts,js}', 'functions/**/*.js'],
    rules: {
      'boundaries/dependencies': 'off',
    },
  },
  {
    files: ['**/*.stories.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
