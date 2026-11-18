import js from '@eslint/js';
import { publicImportBoundaryRule } from './scripts/lib/publicImportBoundaryRule.mjs';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One AST rule owns cross-feature imports, including relative and dynamic imports.
const readJson = relativePath =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
const FEATURE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FEATURE_MATRIX = readJson('./scripts/feature-dependency-matrix.json');
const featurePublicPaths = feature => [
  ...FEATURE_MATRIX.publicImportPatterns.map(pattern => pattern.replace('{feature}', feature)),
  ...(FEATURE_MATRIX.publicModulesByFeature[feature] ?? []),
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
      if (allowed && featurePublicPaths(to).includes(target)) return;
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

// SAVE-03: queue rows and the local database are removed only in the modules whose tests prove when.
const QUEUE_REMOVAL_HOMES = [
  'src/services/storage/sync/dexieSyncQueueStore.ts',
  'src/services/storage/sync/dexieSyncQueueAuthorityAck.ts',
  'src/services/storage/sync/dexieSyncQueueQuarantine.ts',
  'src/services/storage/indexeddb/indexedDbDeleteController.ts',
];
const QUEUE_REMOVAL_RULE = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      removal:
        'Solo dexieSyncQueueStore, dexieSyncQueueAuthorityAck, dexieSyncQueueQuarantine e indexedDbDeleteController borran tareas de la cola o la base local (SAVE-03). Llama a sus funciones; nada borra la cola sin confirmación explícita.',
    },
  },
  create(context) {
    const nameOf = node =>
      node?.type === 'MemberExpression'
        ? node.computed
          ? node.property.value
          : node.property.name
        : undefined;
    const unwrap = node =>
      [
        'ChainExpression',
        'TSNonNullExpression',
        'TSAsExpression',
        'TSSatisfiesExpression',
      ].includes(node?.type)
        ? unwrap(node.expression)
        : node;
    // const names bound to the queue table: `const q = db.syncQueue`, `const { syncQueue } = db`,
    // `const t = db.table('syncQueue')`, and const aliases of those, resolved through the scope.
    // Not followed: let/reassignment, parameters, return values and collections.
    const aliases = new Set();
    const variableOf = node => {
      for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable) return variable;
      }
      return undefined;
    };
    const reachesSyncQueue = node => {
      for (let current = unwrap(node); current; ) {
        if (current.type === 'Identifier') return aliases.has(variableOf(current));
        if (current.type === 'MemberExpression') {
          if (nameOf(current) === 'syncQueue') return true;
          current = unwrap(current.object);
        } else if (current.type === 'CallExpression') {
          const callee = unwrap(current.callee);
          if (nameOf(callee) === 'table' && current.arguments[0]?.value === 'syncQueue')
            return true;
          current = callee;
        } else return false;
      }
      return false;
    };
    const bindings = [];
    const removals = [];
    const bind = (target, value) => {
      if (!target || !value) return;
      if (target.type === 'AssignmentPattern') return bind(target.left, value);
      if (target.type === 'Identifier') return void bindings.push([target, value]);
      if (target.type !== 'ObjectPattern') return;
      for (const property of target.properties) {
        const key = property.type === 'Property' && !property.computed ? property.key : undefined;
        if (key?.name === 'syncQueue' || key?.value === 'syncQueue')
          bind(property.value, {
            type: 'MemberExpression',
            computed: true,
            property: { value: 'syncQueue' },
          });
      }
    };
    return {
      // Only const bindings: they cannot be reassigned, so an alias needs no flow analysis.
      VariableDeclarator: node => node.parent.kind === 'const' && bind(node.id, node.init),
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const method = nameOf(callee);
        const object = unwrap(callee?.object);
        if (
          method === 'deleteDatabase' ||
          (method === 'delete' && ['Dexie', 'hospitalDB'].includes(object?.name))
        )
          context.report({ node, messageId: 'removal' });
        else if (['delete', 'bulkDelete', 'clear'].includes(method)) removals.push([node, object]);
      },
      'Program:exit'() {
        // First every const alias of the file, in any order (a closure may use one declared later).
        for (let size = -1; size !== aliases.size; ) {
          size = aliases.size;
          for (const [target, value] of bindings) {
            const variable = variableOf(target);
            if (variable && reachesSyncQueue(value)) aliases.add(variable);
          }
        }
        for (const [node, object] of removals) {
          if (reachesSyncQueue(object)) context.report({ node, messageId: 'removal' });
        }
      },
    };
  },
};

// `x as unknown as T` converts anything into anything, like an explicit `any`. Each production
// file keeps at most the count it had; the ceilings only go down.
const UNKNOWN_CAST_CEILINGS_PATH = 'scripts/config/unknown-cast-ceilings.json';
const UNKNOWN_CAST_CEILINGS = readJson(`./${UNKNOWN_CAST_CEILINGS_PATH}`).files;
const UNKNOWN_CAST_RULE = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      grown:
        '«as unknown as» convierte cualquier valor en cualquier tipo sin comprobarlo. Este archivo tiene {{now}} y su techo es {{ceiling}} en ' +
        UNKNOWN_CAST_CEILINGS_PATH +
        '. Modela el tipo: un solo `as` si TypeScript lo acepta, una guarda de tipo, un tipo estrecho con nombre propio o el tipo que exporta la librería.',
      lower:
        'Este archivo bajó a {{now}} «as unknown as» (techo {{ceiling}}). Baja su techo en ' +
        UNKNOWN_CAST_CEILINGS_PATH +
        '; si llega a 0, quita la entrada.',
    },
  },
  create(context) {
    const file = path.relative(FEATURE_ROOT, context.filename).split(path.sep).join('/');
    const ceiling = UNKNOWN_CAST_CEILINGS[file] ?? 0;
    const isUnknownCast = node =>
      ['TSAsExpression', 'TSTypeAssertion'].includes(node.type) &&
      node.typeAnnotation.type === 'TSUnknownKeyword';
    const casts = [];
    const visit = node => isUnknownCast(node.expression) && casts.push(node);
    return {
      TSAsExpression: visit,
      TSTypeAssertion: visit,
      'Program:exit'(program) {
        const data = { now: casts.length, ceiling };
        if (casts.length > ceiling)
          casts.forEach(node => context.report({ node, messageId: 'grown', data }));
        else if (casts.length < ceiling)
          context.report({ node: program, messageId: 'lower', data });
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
  selector: 'Literal[regex.pattern=/\\[\\^0-9(kK|Kk|k|K)\\]/]',
  message:
    'No copies la expresión de RUT: usa normalizeRut(), isSameRut(), isSameDocument() o documentIdentityKey() de src/utils/rutUtils.ts (AGENTS.md).',
};

// Identity is patient plus episode (ID-01): only the clinical-episode resolver builds or reads the
// legacy `rut__admission` episode key.
const EPISODE_KEY_BUILD_RESTRICTION = {
  selector: "TemplateElement[value.raw='__'][tail=false]:not(:first-child)",
  message:
    'No armes una clave `${a}__${b}` a mano: la clave de episodio sale de buildClinicalEpisodeKey() en src/domain/clinical-episode/clinicalEpisode.ts. Si la clave no es clínica, exime el archivo junto a reminderShared.ts en eslint.config.js.',
};
const EPISODE_KEY_PARSE_RESTRICTION = {
  selector:
    "CallExpression[callee.property.name=/^(split|includes)$/][arguments.0.value='__']:matches([callee.object.name='episodeKey'], [callee.object.property.name='episodeKey'])",
  message:
    'Lee una clave de episodio antigua con isLegacyClinicalEpisodeKey() o parseLegacyClinicalEpisodeKey() de src/domain/clinical-episode/clinicalEpisode.ts.',
};
const LEGACY_DOCUMENT_HYDRATION_RESTRICTION = {
  selector: "Identifier[name='hydrateLegacyClinicalDocument']",
  message:
    'Hidrata documentos clínicos antiguos con ClinicalDocumentCompatibilityPort (src/application/ports/clinicalDocumentCompatibilityPort.ts), no con hydrateLegacyClinicalDocument().',
};
// The audit loggers are one contract (`AuditLoggers` in src/hooks/useAudit.ts): `AuditContext`
// declared a second copy of it, ~100 lines that drifted apart (2026-11-18).
const AUDIT_LOGGER_NAME =
  '/^log(Event|DebouncedEvent|ViewEvent|PatientCleared|DailyRecord(Created|Deleted)|CudyrModified|HandoffNovedadesModified|MedicalHandoffModified|NurseHandoffModified|ClinicalDocument(Created|Edited|Deleted))$/';
const AUDIT_CONTRACT_RESTRICTION = {
  selector: `:matches(TSMethodSignature[key.name=${AUDIT_LOGGER_NAME}], TSPropertySignature[key.name=${AUDIT_LOGGER_NAME}] > TSTypeAnnotation > TSFunctionType)`,
  message:
    "No escribas a mano la firma de un registrador de auditoría: tómala de AuditLoggers en src/hooks/useAudit.ts (p. ej. `logEvent: AuditLoggers['logEvent']`).",
};
// The admin pages with tabs share one frame. Four pages had copied its ~40 lines of title bar
// and tab buttons (2026-11-18); a copy starts with the tab button's classes.
const ADMIN_TABS_FRAME_RESTRICTION = {
  selector:
    "Literal[value='px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5']",
  message:
    'No copies la barra de pestañas de administración: usa AdminTabsShell (src/features/admin/components/internal/AdminTabsShell.tsx) y pásale las pestañas como datos.',
};
const SOURCE_SYNTAX_RESTRICTIONS = [
  ...GLOSSARY_SYNTAX_RESTRICTIONS,
  SESSION_MESSAGE_RESTRICTION,
  RUT_REGEX_RESTRICTION,
  EPISODE_KEY_BUILD_RESTRICTION,
  EPISODE_KEY_PARSE_RESTRICTION,
  LEGACY_DOCUMENT_HYDRATION_RESTRICTION,
  AUDIT_CONTRACT_RESTRICTION,
  ADMIN_TABS_FRAME_RESTRICTION,
];
// One rule option per file: a later config replaces the whole list, so homes omit only their own.
const syntaxRestrictions = ({ omit = [], add = [] } = {}) => [
  'warn',
  ...SOURCE_SYNTAX_RESTRICTIONS.filter(restriction => !omit.includes(restriction)),
  ...add,
];

// Public entrypoints over focused modules: the code lives in those modules, not here again.
const REEXPORT_ONLY_RESTRICTION = {
  selector: 'Program > :not(ExportNamedDeclaration[source], ExportAllDeclaration)',
  message:
    'Esta entrada pública solo reexporta (`export … from`): escribe el código o el tipo en su módulo enfocado y reexpórtalo aquí.',
};
const BASE_MODAL_ENTRYPOINT_RESTRICTION = {
  selector:
    "ImportSpecifier[imported.name='createPortal'], TSInterfaceDeclaration, TSTypeAliasDeclaration",
  message:
    'BaseModal es la entrada pública: los tipos van en baseModalContracts.ts y el portal en baseModalContent.tsx.',
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
    // The sender of the session message.
    files: ['src/services/storage/sessionStorageTransition.ts'],
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
    // The legacy clinical-document hydration and the port that owns it.
    files: [
      'src/domain/clinical-documents/compatibility.ts',
      'src/application/ports/clinicalDocumentCompatibilityPort.ts',
    ],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({ omit: [LEGACY_DOCUMENT_HYDRATION_RESTRICTION] }),
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
    // Tests assert the page bridge of the session message, build their own document text and
    // exercise the legacy readers they guard.
    files: ['src/tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': syntaxRestrictions({
        omit: [
          SESSION_MESSAGE_RESTRICTION,
          RUT_REGEX_RESTRICTION,
          EPISODE_KEY_PARSE_RESTRICTION,
          LEGACY_DOCUMENT_HYDRATION_RESTRICTION,
        ],
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
    plugins: { types: { rules: { 'unknown-cast-ceiling': UNKNOWN_CAST_RULE } } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'types/unknown-cast-ceiling': 'error',
    },
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
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['**/*.d.ts', '**/tests/**', '**/*.test.*', '**/*.spec.*', ...QUEUE_REMOVAL_HOMES],
    plugins: { queue: { rules: { 'removal-home': QUEUE_REMOVAL_RULE } } },
    rules: { 'queue/removal-home': 'error' },
  }
);
