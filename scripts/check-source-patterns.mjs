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

// A component named for one nursing role, e.g. NurseSelector or TensManagerModal.
const ROLE_NAME = '(?:Nurse|Tens)[A-Z]\\w*';
const EXPORT = '(?:export[ \\t]+(?:default[ \\t]+)?)?';

const RULES = [
  {
    id: 'legacy-staff',
    // Tests and stories beside the code are read too; only src/tests/ is exempt.
    files: file =>
      !under(
        'src/domain/staff/dailyRecordStaffingCompatibility.ts',
        'src/schemas/',
        'src/services/repositories/dataMigration.ts',
        'src/services/repositories/dailyRecordAggregate.ts',
        'src/services/staff/dailyRecordStaffing.ts',
        'src/tests/',
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
      'src/features/admin/services/',
      'src/features/analytics/services/',
      'src/features/clinical-documents/services/',
      'src/features/prescriptions/services/',
      'src/features/wound-care/services/',
      'src/services/storage/sync/',
      'src/services/session/',
      'src/features/rayen-import/'
    ),
    patterns: [/\bconsole\.(?:log|info|debug|warn|error)\s*\(/g],
    fix: 'Usa logger de @/services/utils/loggerService en vez de console.',
  },
  {
    id: 'lazy-view-entrypoints',
    files: file => file === 'src/views/LazyViews.ts',
    patterns: [/@\/features\/[^/'"]+\/[^'"]+/g],
    // A feature's `public.ts` is the surface the dependency matrix already treats as public.
    // Other light subpaths are split out of it on purpose (e.g. to keep the authenticated-shell
    // chunk under budget). Keep this list tight.
    allowMatch: text =>
      /^@\/features\/[^/]+\/public$/.test(text) ||
      [
        '@/features/admin/admission-audit',
        '@/features/census/census-view',
        '@/features/census/public-components',
      ].includes(text),
    fix: 'Carga la vista desde la API pública del feature (@/features/<feature>) o, si es un subcamino ligero a propósito, agrégalo a allowMatch con su motivo.',
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
      file !== 'src/features/census/email/controllers/censusEmailBrowserRuntimeController.ts',
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
    // Stories are read too: only tests and specs may import the runtime directly.
    files: file =>
      !file.includes('/tests/') &&
      !/\.(?:test|spec)\./.test(file) &&
      ![
        'src/services/storage/firestore/firestoreServiceRuntime.ts',
        'src/services/repositories/repositoryFirestoreRuntime.ts',
      ].includes(file),
    patterns: [importOf('@/services/firebase-runtime/firestoreRuntime')],
    fix: 'Accede a Firestore por firestoreServiceRuntime.ts o repositoryFirestoreRuntime.ts.',
  },
  {
    id: 'role-permissions-door',
    files: file => isProduction(file) && !file.startsWith('src/shared/access/'),
    patterns: [importOf('@/shared/access/rolePermissions')],
    fix: 'Importa los permisos desde @/shared/access/operationalAccessPolicy.',
  },
  {
    id: 'staff-role-copies',
    files: file => isProduction(file) && /\.[jt]sx$/.test(file),
    // A component per nursing role (NurseX / TensX) is the copy W15-U1 folded back into one.
    // Only declarations that start a line count, so a string that mentions one does not, and
    // only components: a function, a component class, or a const bound to a function.
    // Data such as `const NurseLabels = [...]` stays allowed.
    patterns: [
      new RegExp(`^[ \\t]*${EXPORT}function[ \\t]+${ROLE_NAME}`, 'gm'),
      new RegExp(
        `^[ \\t]*${EXPORT}class[ \\t]+${ROLE_NAME}[ \\t]+extends[ \\t]+(?:React\\.)?(?:Pure)?Component\\b`,
        'gm'
      ),
      new RegExp(
        `^[ \\t]*${EXPORT}const[ \\t]+${ROLE_NAME}[ \\t]*(?::[^=\\n]+)?=[ \\t]*(?:(?:React\\.)?(?:memo|forwardRef)\\([ \\t]*)?(?:async[ \\t]+)?(?:function\\b|\\(|[A-Za-z_$][\\w$]*[ \\t]*=>)`,
        'gm'
      ),
    ],
    fix: 'No copies un componente por rol: pasa role="nurse" | "tens" a StaffSelector o StaffManagerModal y pon lo que difiere en su tabla por rol.',
  },
  {
    id: 'staff-name-fold',
    // W16-ID1: comparing staff by a folded name outside the identity module joined two Eloísa IDs
    // that spell alike («Luz Pena», «Luz Peña») in views, saves and proposals.
    files: file =>
      isProduction(file) &&
      ![
        'src/services/staff/nurseIdentity.ts',
        'src/services/staff/eloisaStaffIdentity.ts',
      ].includes(file),
    patterns: [/\b(?:nurseIdentityKey|uniqueStaffNames|reconcileNurseCatalogNames)\b/g],
    fix: 'Decide si dos nombres del personal son la misma persona con @/services/staff/eloisaStaffIdentity (staffPerson, listedStaffPerson, staffRowKey, sameStaffMember, staffNameKey, personSpellings); el nombre plegado solo se usa dentro de ese módulo.',
  },
  {
    id: 'staff-name-fold-by-hand',
    // The same fold written by hand (NFD and dropping marks) in code about nursing staff names.
    files: file =>
      isProduction(file) &&
      under(
        'src/services/staff/',
        'src/features/census/components/staff-catalog/',
        'src/features/census/components/Staff',
        'src/features/rayen-import/domain/inferNursingShifts',
        'src/features/rayen-import/domain/staffIdentityReconciliation',
        'src/features/rayen-import/domain/applyNursingShiftProposal',
        'src/features/rayen-import/domain/staffingSlotPolicy',
        'src/features/rayen-import/domain/clinicalFillStaffing',
        'src/hooks/useStaff',
        'src/hooks/useEloisaStaff',
        'src/context/StaffContext'
      )(file) &&
      ![
        'src/services/staff/nurseIdentity.ts',
        'src/services/staff/eloisaStaffIdentity.ts',
        // Physicians are another catalog with its own rules.
        'src/services/staff/treatingPhysicianCatalog.ts',
      ].includes(file),
    patterns: [/\.normalize\(\s*['"]NF[KD]{1,2}['"]\s*\)/g],
    fix: 'No pliegues nombres del personal a mano: compara con @/services/staff/eloisaStaffIdentity (staffPerson, listedStaffPerson, staffRowKey, sameStaffMember).',
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
