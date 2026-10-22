#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_FILES = [
  'src/tests/hooks/useAudit.test.ts',
  'src/tests/hooks/useBackupFiles.test.ts',
  'src/tests/hooks/useBackupFilesQuery.test.tsx',
  'src/tests/hooks/useCensusEmail.test.ts',
  'src/tests/hooks/useHandoffManagement.test.ts',
  'src/tests/hooks/useSharedCensusFiles.test.ts',
  'src/tests/features/clinical-documents/ClinicalDocumentsWorkspace.test.tsx',
  'src/tests/hooks/useExportManager.test.ts',
];

const FORBIDDEN_IMPORTS = [
  '@/services/auditService',
  '@/services/backup/backupService',
  '@/services/census/censusAccessService',
  '@/services/repositories/DailyRecordRepository',
  '@/services/integrations/censusEmailService',
];

const violations = [];

for (const relativePath of TARGET_FILES) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const forbiddenImport of FORBIDDEN_IMPORTS) {
    if (
      source.includes(`from '${forbiddenImport}'`) ||
      source.includes(`from "${forbiddenImport}"`) ||
      source.includes(`mock('${forbiddenImport}'`) ||
      source.includes(`mock("${forbiddenImport}"`)
    ) {
      violations.push({ file: relativePath, importPath: forbiddenImport });
    }
  }
}

if (violations.length === 0) {
  console.log('Core test boundary checks passed.');
  process.exit(0);
}

console.error('\nCore test boundary violations:');
for (const violation of violations) {
  console.error(`- ${violation.file} -> ${violation.importPath}`);
}

process.exit(1);
