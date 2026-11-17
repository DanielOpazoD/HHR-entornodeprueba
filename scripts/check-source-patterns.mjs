#!/usr/bin/env node

// Text rules over src/: one walk, one read per file, and every rule names its fix.
// Each rule says which files it reads (`files`), what it rejects (`patterns`) and,
// when a match can be legitimate, which matched text it accepts (`allowMatch`).
// The search is textual on purpose: a comment with the forbidden text also fails.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_FILE = /\.(?:[jt]sx?)$/;

const under =
  (...prefixes) =>
  file =>
    prefixes.some(prefix => file.startsWith(prefix));
const isTestNamed = file => /\.(?:test|spec|stories)\./.test(file);
const isProduction = file => !file.includes('/tests/') && !isTestNamed(file);
const importOf = specifier => {
  const quoted = `['"]${specifier.replace(/[/.]/g, '\\$&')}['"]`;
  return new RegExp(`(?:from|import)\\s+${quoted}`, 'g');
};
const mockOrImportOf = specifier => {
  const quoted = `['"]${specifier.replace(/[/.]/g, '\\$&')}['"]`;
  return new RegExp(`(?:from\\s+${quoted}|mock\\(${quoted})`, 'g');
};

const RULES = [
  {
    id: 'legacy-staff',
    files: file =>
      isProduction(file) &&
      !under(
        'src/schemas/',
        'src/services/repositories/dataMigration.ts',
        'src/services/repositories/dailyRecordAggregate.ts',
        'src/services/staff/dailyRecordStaffing.ts',
        'src/types/domain/dailyRecord.ts'
      )(file),
    patterns: [/\.[ \t]*nurses\b(?![A-Z])/g, /\.[ \t]*nurseName\b/g],
    fix: 'Lee el personal con src/services/staff/dailyRecordStaffing.ts; los campos heredados nurses y nurseName solo se leen al migrar.',
  },
  {
    id: 'hook-tests-mock-ports',
    files: file =>
      [
        'src/tests/hooks/useAudit.test.ts',
        'src/tests/hooks/useBackupFilesQuery.test.tsx',
        'src/tests/hooks/useCensusEmail.test.ts',
        'src/tests/hooks/useHandoffManagement.test.ts',
        'src/tests/hooks/useExportManager.test.ts',
        'src/tests/features/clinical-documents/ClinicalDocumentsWorkspace.test.tsx',
      ].includes(file),
    patterns: [mockOrImportOf('@/services/integrations/censusEmailService')],
    fix: 'Estas pruebas de hooks simulan el hook o puerto del que dependen (por ejemplo useCensusEmailDeliveryActions), no el servicio de correo.',
  },
  {
    id: 'core-console',
    files: under(
      'src/services/repositories/',
      'src/services/exporters/',
      'src/services/pdf/',
      'src/services/admin/',
      'src/services/storage/sync/',
      'src/features/rayen-import/'
    ),
    patterns: [/\bconsole\.(?:log|info|debug|warn|error)\s*\(/g],
    fix: 'Usa logger de @/services/utils/loggerService en vez de console.',
  },
  {
    id: 'lazy-view-entrypoints',
    files: file => file === 'src/views/LazyViews.ts',
    patterns: [/@\/features\/[^/'"]+\/[^'"]+/g],
    // Light subpaths split out of a feature's public surface on purpose (e.g. to keep the
    // authenticated-shell chunk under budget). Keep this list tight.
    allowMatch: text =>
      text.startsWith('@/features/whatsapp/') ||
      [
        '@/features/admin/admission-audit',
        '@/features/census/census-view',
        '@/features/census/public-components',
      ].includes(text),
    fix: 'Carga la vista desde la API pública del feature (@/features/<feature>) o, si es un subcamino ligero a propósito, agrégalo a allowMatch con su motivo.',
  },
  {
    id: 'census-controller-browser',
    files: file => under('src/features/census/controllers/')(file) && !file.includes('.test.'),
    patterns: [
      /\bwindow\./g,
      /\bglobalThis\b/g,
      /\blocalStorage\b/g,
      /\bdocument\./g,
      /\bnavigator\.clipboard\b/g,
    ],
    fix: 'Los controladores del censo reciben el navegador por censusBrowserRuntimeAdapter.ts.',
  },
  {
    id: 'census-controller-default-runtime',
    files: file =>
      under('src/features/census/controllers/')(file) &&
      !file.includes('.test.') &&
      file !== 'src/features/census/controllers/censusBrowserRuntimeAdapter.ts',
    patterns: [/defaultBrowserWindowRuntime/g],
    fix: 'Solo censusBrowserRuntimeAdapter.ts toma defaultBrowserWindowRuntime; el resto lo recibe del adaptador.',
  },
  {
    id: 'browser-runtime-adapter',
    files: file =>
      !isTestNamed(file) &&
      !under('src/shared/runtime/')(file) &&
      file !== 'src/hooks/controllers/censusEmailBrowserRuntimeController.ts',
    patterns: [
      /\bwindow\.alert\(/g,
      /\bwindow\.confirm\(/g,
      /\bwindow\.open\(/g,
      /\bwindow\.location\.reload\(/g,
      /\bnavigator\.clipboard\b/g,
    ],
    fix: 'Pasa por defaultBrowserWindowRuntime (src/shared/runtime/) o recíbelo como dependencia.',
  },
  {
    id: 'native-dialogs',
    files: file => !isTestNamed(file) && !under('src/shared/runtime/')(file),
    // A top-level call whose first argument is a string literal is the browser API;
    // useConfirmDialog takes an options object and member calls (x.confirm) never match.
    patterns: [/(?<![\w.])(?:alert|confirm|prompt)\s*\(\s*['"`]/g],
    fix: 'Usa useConfirmDialog o useNotification de @/context/UIContext.',
  },
  {
    id: 'firestore-runtime',
    files: file =>
      isProduction(file) &&
      ![
        'src/services/storage/firestore/firestoreServiceRuntime.ts',
        'src/services/repositories/repositoryFirestoreRuntime.ts',
      ].includes(file),
    patterns: [importOf('@/services/firebase-runtime/firestoreRuntime')],
    fix: 'Accede a Firestore por firestoreServiceRuntime.ts o repositoryFirestoreRuntime.ts.',
  },
  {
    id: 'legacy-permissions',
    files: file =>
      isProduction(file) &&
      !['src/utils/permissions.ts', 'src/shared/access/operationalAccessPolicy.ts'].includes(file),
    patterns: [importOf('@/utils/permissions')],
    fix: 'Importa los permisos desde @/shared/access/operationalAccessPolicy.',
  },
];

const walk = directory =>
  fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(absolute);
        return entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')
          ? [path.relative(ROOT, absolute).split(path.sep).join('/')]
          : [];
      })
    : [];

const files = walk(path.join(ROOT, 'src')).sort();
const violations = [];
for (const file of files) {
  const rules = RULES.filter(rule => rule.files(file));
  if (rules.length === 0) continue;
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      for (const match of source.matchAll(pattern)) {
        if (rule.allowMatch?.(match[0])) continue;
        const line = source.slice(0, match.index).split('\n').length;
        violations.push({ rule, at: `${file}:${line}`, text: match[0].trim() });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`Source pattern checks passed (${RULES.length} rules, ${files.length} files).`);
  process.exit(0);
}

console.error('\nSource pattern violations:');
for (const rule of RULES) {
  const found = violations.filter(violation => violation.rule === rule);
  if (found.length === 0) continue;
  console.error(`\n[${rule.id}] ${rule.fix}`);
  for (const violation of found) console.error(`- ${violation.at} → ${violation.text}`);
}
process.exit(1);
