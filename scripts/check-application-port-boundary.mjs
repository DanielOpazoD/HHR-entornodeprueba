#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const LAYER_RULES = [
  {
    label: 'ui-hooks-feature-boundary',
    includePrefixes: ['src/hooks/', 'src/components/', 'src/features/'],
    excludePrefixes: ['src/hooks/controllers/', 'src/features/backup/'],
    forbiddenImports: [
      '@/services/auditService',
      '@/services/census/censusAccessService',
      '@/services/repositories/DailyRecordRepository',
      '@/services/repositories/ClinicalDocumentRepository',
      '@/services/integrations/censusEmailService',
    ],
  },
  {
    label: 'application-port-boundary',
    includePrefixes: ['src/application/'],
    excludePrefixes: ['src/application/ports/'],
    forbiddenImports: [
      '@/services/auditService',
      '@/services/census/censusAccessService',
      '@/services/repositories/DailyRecordRepository',
      '@/services/repositories/ClinicalDocumentRepository',
      '@/services/integrations/censusEmailService',
    ],
  },
];

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(ROOT, filePath));
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return false;
  return !relativePath.includes('.stories.');
};

const walkFiles = dirPath => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && isSourceFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const importMatchesRule = (relativePath, rule) => {
  const included = rule.includePrefixes.some(prefix => relativePath.startsWith(prefix));
  if (!included) return false;
  return !rule.excludePrefixes.some(prefix => relativePath.startsWith(prefix));
};

const files = walkFiles(SRC_ROOT);
const violations = [];

for (const absolutePath of files) {
  const relativePath = toPosix(path.relative(ROOT, absolutePath));
  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const rule of LAYER_RULES) {
    if (!importMatchesRule(relativePath, rule)) continue;

    for (const forbiddenImport of rule.forbiddenImports) {
      const patterns = [`from '${forbiddenImport}'`, `from "${forbiddenImport}"`];

      if (patterns.some(pattern => source.includes(pattern))) {
        violations.push({
          rule: rule.label,
          file: relativePath,
          importPath: forbiddenImport,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('Application/port boundary checks passed.');
  process.exit(0);
}

console.error('\nApplication/port boundary violations:');
for (const violation of violations) {
  console.error(`- [${violation.rule}] ${violation.file} -> ${violation.importPath}`);
}

process.exit(1);
