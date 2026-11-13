import js from '@eslint/js';
import { publicImportBoundaryRule } from './scripts/lib/publicImportBoundaryRule.mjs';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One AST rule owns cross-feature imports, including relative and dynamic imports.
const readJson = relativePath =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
const FEATURE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FEATURE_MATRIX = readJson('./scripts/feature-dependency-matrix.json');
const FEATURE_PUBLIC_MODULES =
  readJson('./scripts/feature-public-api-allowlist.json').publicModulesByFeature ?? {};
const FEATURE_IMPORT_DEBT = new Set(
  readJson('./scripts/feature-dependency-allowlist.json').violations ?? []
);
const featurePublicPaths = feature => [
  ...FEATURE_MATRIX.publicImportPatterns.map(pattern => pattern.replace('{feature}', feature)),
  ...(FEATURE_PUBLIC_MODULES[feature] ?? []),
];
const featureOf = importer => importer.match(/^src\/features\/([^/]+)\//)?.[1];
const FEATURE_BOUNDARY_RULE = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { checkDynamicImports: { type: 'boolean' }, checkPorts: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      port: 'Accede a «{{target}}» por su puerto de aplicación.',
      dependency:
        '«{{from}}» no depende de «{{to}}» en scripts/feature-dependency-matrix.json. Agrega la dependencia allí o resuelve la necesidad en otra capa.',
      public: '{{target}}: Importa «{{to}}» por su superficie pública: {{paths}}.',
    },
  },
  create(context) {
    const importer = path.relative(FEATURE_ROOT, context.filename).split(path.sep).join('/');
    const from = featureOf(importer);
    const check = source => {
      if (!source || typeof source.value !== 'string') return;
      const raw = source.value;
      const target = raw.startsWith('.')
        ? path.posix
            .normalize(path.posix.join(path.posix.dirname(importer), raw))
            .replace(/^src\/features\//, '@/features/')
        : raw;
      const service = (
        raw.startsWith('.')
          ? path.posix.normalize(path.posix.join(path.posix.dirname(importer), raw))
          : raw.replace(/^@\//, 'src/')
      ).replace(/\.[cm]?[jt]sx?$/, '');
      if (
        context.options[0]?.checkPorts &&
        [
          'src/services/repositories/ClinicalDocumentRepository',
          'src/services/integrations/censusEmailService',
        ].includes(service)
      )
        context.report({ node: source, messageId: 'port', data: { target: raw } });
      if (!from || !target.startsWith('@/features/')) return;
      const to = target.slice('@/features/'.length).split('/')[0];
      if (to === from) return;
      const allowed = FEATURE_MATRIX.features[from]?.includes(to);
      const rule = allowed ? 'feature-must-use-public-api' : 'feature-dependency-not-allowed';
      if (allowed && featurePublicPaths(to).includes(target)) return;
      // Exceptions retain their exact importer and spelling; relative variants gain no exception.
      if (FEATURE_IMPORT_DEBT.has(`${rule}|${importer}|${raw}|${to}`)) return;
      context.report({
        node: source,
        messageId: allowed ? 'public' : 'dependency',
        data: { from, to, target: raw, paths: featurePublicPaths(to).join(', ') },
      });
    };
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => {
        if (context.options[0]?.checkDynamicImports !== false) check(node.source);
      },
      TSImportEqualsDeclaration: node => check(node.moduleReference.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node.arguments[0]);
        }
      },
    };
  },
};

const HHR_PLUGIN = {
  rules: {
    'feature-boundaries': FEATURE_BOUNDARY_RULE,
    'public-import-boundaries': publicImportBoundaryRule,
  },
};

const REMOTE_ADMISSION_RULE = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      admission:
        'Las lecturas remotas deben entrar por admitRemoteDailyRecords y usar su fila devuelta; no abras ni escribas el almacén directamente.',
    },
  },
  create(context) {
    const report = node => context.report({ node, messageId: 'admission' });
    const check = (source, declaration) => {
      if (!source || typeof source.value !== 'string') return;
      const raw = source.value;
      const target = (
        raw.startsWith('.')
          ? path.posix.normalize(
              path.posix.join(
                path.posix.dirname(path.relative(FEATURE_ROOT, context.filename)),
                raw
              )
            )
          : raw.replace(/^@\//, 'src/')
      ).replace(/\.[cm]?[jt]sx?$/, '');
      if (target === 'src/services/storage/indexeddb/indexedDbRecordService') {
        const allowed =
          /^(get|captureLocalRecordBase$|inspectLocalRecordAdmission$|admitLocalRecords$)/;
        if (!declaration || declaration.type !== 'ImportDeclaration') return report(source);
        for (const specifier of declaration.specifiers) {
          if (declaration.importKind === 'type' || specifier.importKind === 'type') continue;
          if (
            specifier.type !== 'ImportSpecifier' ||
            !allowed.test(specifier.imported.name ?? specifier.imported.value)
          )
            report(specifier);
        }
        return;
      }
      if (
        /^dexie(?:\/|$)/.test(target) ||
        /^src\/services\/storage\/(indexeddb|localpersistence|localstorage)\//.test(target)
      )
        report(source);
    };
    return {
      ImportDeclaration: node => check(node.source, node),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      TSImportEqualsDeclaration: node => check(node.moduleReference.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node.arguments[0]);
      },
      Identifier(node) {
        if (node.name !== 'indexedDB') return;
        if (
          node.parent.type === 'MemberExpression' &&
          node.parent.property === node &&
          !node.parent.computed
        )
          return;
        report(node);
      },
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        if (name === 'indexedDB') report(node);
      },
    };
  },
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

// One session scope: the sender in sessionStorageTransition notifies every listener
// synchronously. Listening to the window message elsewhere brought back reads of the
// previous person twice (clinical explorer, 2026-11-05).
const SESSION_MESSAGE_RESTRICTION = {
  selector: 'Literal[value="HHR_RAYEN_SESSION_CHANGED"]',
  message:
    'Observa el cambio de sesión con onSessionChange() o useSessionEpoch(), no con el mensaje HHR_RAYEN_SESSION_CHANGED (AGENTS.md).',
};

// A copy of the RUT cleaner compares a passport by its digits as if it were a RUT. The helpers
// that know the difference live in one module.
const RUT_REGEX_RESTRICTION = {
  selector: 'Literal[regex.pattern=/\\[\\^0-9(kK|Kk)\\]/]',
  message:
    'No copies la expresión de RUT: usa normalizeRut(), isSameRut() o isSameDocument() de src/utils/rutUtils.ts (AGENTS.md).',
};

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
        SESSION_MESSAGE_RESTRICTION,
        RUT_REGEX_RESTRICTION,
      ],
    },
  },
  {
    // The sender of the session message.
    files: ['src/services/storage/sessionStorageTransition.ts'],
    rules: {
      'no-restricted-syntax': ['warn', ...GLOSSARY_SYNTAX_RESTRICTIONS, RUT_REGEX_RESTRICTION],
    },
  },
  {
    // The home of the RUT helpers.
    files: ['src/utils/rutUtils.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        ...GLOSSARY_SYNTAX_RESTRICTIONS,
        SESSION_MESSAGE_RESTRICTION,
      ],
    },
  },
  {
    // Tests assert the page bridge of the session message and build their own document text.
    files: ['src/tests/**/*.{ts,tsx}'],
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
  },
  {
    // Production source: the former source scanner's scope, with syntax-aware errors.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*', '**/*.spec.*'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // Critical services also cover spec and story files, as the critical scanner did.
    files: ['src/services/{storage,repositories,admin}/**/*.{ts,tsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: [
      'src/services/repositories/dailyRecord*Read*.ts',
      'src/services/repositories/dailyRecord*Initialization*.ts',
      'src/services/repositories/dailyRecordLocalCachePersistence.ts',
    ],
    plugins: { admission: { rules: { 'remote-reads': REMOTE_ADMISSION_RULE } } },
    rules: { 'admission/remote-reads': 'error' },
  }
);
